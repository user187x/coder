package coderd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/httpapi/httperror"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/wsbuilder"
	"github.com/coder/coder/v2/codersdk"
)

// platformQuotaPrefix is the platform service that keeps the per-user
// workspace quota (Health > User Quota in the dashboard).
const platformQuotaPrefix = "/__coder-ui"

// platformQuotaTimeout bounds the check, so a slow service delays a
// workspace creation by at most this long.
const platformQuotaTimeout = 10 * time.Second

type platformQuotaRequest struct {
	OwnerID             uuid.UUID                          `json:"owner_id"`
	OrganizationID      uuid.UUID                          `json:"organization_id"`
	CurrentWorkspaceID  *uuid.UUID                         `json:"current_workspace_id,omitempty"`
	Owner               string                             `json:"owner"`
	TemplateID          uuid.UUID                          `json:"template_id"`
	TemplateVersionID   uuid.UUID                          `json:"template_version_id"`
	RichParameterValues []codersdk.WorkspaceBuildParameter `json:"rich_parameter_values"`
}

type platformQuotaResponse struct {
	Allowed bool   `json:"allowed"`
	Message string `json:"message"`
}

// checkPlatformQuota asks the platform service whether owner may have one
// more workspace built with req's parameters (the number of workspaces and the
// CPU cores and memory they ask for). It runs with the requester's own session,
// so the service sees exactly what they may see.
func (api *API) checkPlatformQuota(ctx context.Context, db database.Store, sessionToken string, owner workspaceOwner, organizationID, templateID, templateVersionID uuid.UUID, req codersdk.CreateWorkspaceRequest) error {
	if !api.platformQuotaConfigured() {
		return nil
	}
	if err := db.AcquireLock(ctx, database.GenLockID("workspace-admission:"+owner.ID.String())); err != nil {
		return err
	}
	parameters := req.RichParameterValues
	if req.TemplateVersionPresetID != uuid.Nil {
		preset, err := db.GetPresetParametersByPresetID(ctx, req.TemplateVersionPresetID)
		if err != nil {
			return err
		}
		parameters = append([]codersdk.WorkspaceBuildParameter(nil), parameters...)
		for _, p := range preset {
			parameters = append(parameters, codersdk.WorkspaceBuildParameter{Name: p.Name, Value: p.Value})
		}
	}
	return api.checkPlatformQuotaRequest(ctx, sessionToken, platformQuotaRequest{
		Owner:               owner.Username,
		OwnerID:             owner.ID,
		OrganizationID:      organizationID,
		TemplateID:          templateID,
		TemplateVersionID:   templateVersionID,
		RichParameterValues: parameters,
	})
}

func (api *API) checkPlatformQuotaRequest(ctx context.Context, sessionToken string, request platformQuotaRequest) error {
	var answer platformQuotaResponse
	if !api.askPlatformService(ctx, "platform_quota", sessionToken, "/api/quota/check", request, &answer) {
		return httperror.NewResponseError(http.StatusServiceUnavailable, codersdk.Response{
			Message: "Workspace capacity and quota could not be checked. Please try again.",
		})
	}
	if answer.Allowed {
		return nil
	}
	message := answer.Message
	if message == "" {
		message = "The workspace quota is reached."
	}
	return httperror.NewResponseError(http.StatusForbidden, codersdk.Response{
		Message: message,
	})
}

func (api *API) platformQuotaConfigured() bool {
	for _, route := range api.PlatformServiceRoutes {
		if route.PathPrefix == platformQuotaPrefix {
			return true
		}
	}
	return false
}

// checkPlatformStartQuota checks the resolved size before a user starts a workspace.
func (api *API) checkPlatformStartQuota(ctx context.Context, db database.Store, sessionToken string, initiatorID uuid.UUID, workspace database.Workspace, req codersdk.CreateWorkspaceBuildRequest, authorize func(policy.Action, rbac.Objecter) bool) error {
	if req.Transition != codersdk.WorkspaceTransitionStart || workspace.IsPrebuild() || sessionToken == "" || req.Orphan {
		return nil
	}
	if !api.platformQuotaConfigured() {
		return nil
	}
	if err := validateCreateWorkspaceBuildOnSuccess(req); err != nil {
		return err
	}
	builder := wsbuilder.New(workspace, database.WorkspaceTransitionStart, *api.BuildUsageChecker.Load()).
		Initiator(initiatorID).
		RichParameterValues(req.RichParameterValues).
		TemplateVersionPresetID(req.TemplateVersionPresetID).
		DeploymentValues(api.Options.DeploymentValues).
		Experiments(api.Experiments).
		LogLevel(string(req.LogLevel))
	if len(req.ProvisionerState) > 0 {
		builder = builder.State(req.ProvisionerState)
	}
	if req.TemplateVersionID != uuid.Nil {
		builder = builder.VersionID(req.TemplateVersionID)
	}
	if err := db.AcquireLock(ctx, database.GenLockID("workspace-admission:"+workspace.OwnerID.String())); err != nil {
		return err
	}
	version, parameters, err := builder.ResolveParameters(ctx, db, api.FileCache, authorize)
	if err != nil {
		return err
	}
	return api.checkPlatformQuotaRequest(ctx, sessionToken, platformQuotaRequest{
		Owner:               workspace.OwnerUsername,
		OwnerID:             workspace.OwnerID,
		OrganizationID:      workspace.OrganizationID,
		CurrentWorkspaceID:  &workspace.ID,
		TemplateID:          workspace.TemplateID,
		TemplateVersionID:   version,
		RichParameterValues: parameters,
	})
}

// askPlatformService POSTs request to the platform service (path under
// platformQuotaPrefix) with the requester's own session, so the service sees
// exactly what they may see, and decodes its answer. It reports whether an
// answer came: without the service, a session token or a usable answer it
// returns false, and callers go ahead as usual (fail open).
func (api *API) askPlatformService(ctx context.Context, name, sessionToken, path string, request, answer any) bool {
	if sessionToken == "" {
		return false
	}
	var target string
	for _, route := range api.PlatformServiceRoutes {
		if route.PathPrefix == platformQuotaPrefix {
			target = route.Target.String()
		}
	}
	if target == "" {
		return false
	}
	logger := api.Logger.Named(name)
	body, err := json.Marshal(request)
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, platformQuotaTimeout)
	defer cancel()
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, target+platformQuotaPrefix+path, bytes.NewReader(body))
	if err != nil {
		logger.Warn(ctx, "platform service not asked", slog.Error(err))
		return false
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("X-Requested-With", "coder-ui")
	hreq.Header.Set(codersdk.SessionTokenHeader, sessionToken)
	res, err := http.DefaultClient.Do(hreq)
	if err != nil {
		logger.Warn(ctx, "platform service not reached", slog.Error(err))
		return false
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, answer) != nil {
		logger.Warn(ctx, "platform service gave no answer", slog.F("status", res.StatusCode), slog.F("body", string(raw)))
		return false
	}
	return true
}
