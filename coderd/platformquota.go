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
	"github.com/coder/coder/v2/coderd/httpapi/httperror"
	"github.com/coder/coder/v2/codersdk"
)

// platformQuotaPrefix is the platform service that keeps the per-user
// workspace quota (Health > User Quota in the dashboard).
const platformQuotaPrefix = "/__coder-ui"

// platformQuotaTimeout bounds the check, so a slow service delays a
// workspace creation by at most this long.
const platformQuotaTimeout = 10 * time.Second

type platformQuotaRequest struct {
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
// so the service sees exactly what they may see. It fails open: without the
// service, a session token or an answer, the workspace is created as usual.
func (api *API) checkPlatformQuota(ctx context.Context, sessionToken string, owner workspaceOwner, templateID, templateVersionID uuid.UUID, req codersdk.CreateWorkspaceRequest) error {
	if sessionToken == "" {
		return nil
	}
	var target string
	for _, route := range api.PlatformServiceRoutes {
		if route.PathPrefix == platformQuotaPrefix {
			target = route.Target.String()
		}
	}
	if target == "" {
		return nil
	}
	logger := api.Logger.Named("platform_quota")
	body, err := json.Marshal(platformQuotaRequest{
		Owner:               owner.Username,
		TemplateID:          templateID,
		TemplateVersionID:   templateVersionID,
		RichParameterValues: req.RichParameterValues,
	})
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, platformQuotaTimeout)
	defer cancel()
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, target+platformQuotaPrefix+"/api/quota/check", bytes.NewReader(body))
	if err != nil {
		logger.Warn(ctx, "workspace quota not checked", slog.Error(err))
		return nil
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("X-Requested-With", "coder-ui")
	hreq.Header.Set(codersdk.SessionTokenHeader, sessionToken)
	res, err := http.DefaultClient.Do(hreq)
	if err != nil {
		logger.Warn(ctx, "workspace quota not checked", slog.Error(err))
		return nil
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	var answer platformQuotaResponse
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, &answer) != nil {
		logger.Warn(ctx, "workspace quota not checked", slog.F("status", res.StatusCode), slog.F("body", string(raw)))
		return nil
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
		Detail:  "Workspace quota: an administrator sets it in Health > User Quota.",
	})
}
