package coderd

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/apikey"
	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/provisionerjobs"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/shorttermlease"
	"github.com/coder/coder/v2/coderd/wsbuilder"
	"github.com/coder/coder/v2/codersdk"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/xerrors"
)

func leaseSDK(row database.ShortTermLease) codersdk.ShortTermLease {
	out := codersdk.ShortTermLease{UserID: row.UserID, OrganizationID: row.OrganizationID, IssuedAt: row.IssuedAt, ExpiresAt: row.ExpiresAt, TokenID: row.TokenID}
	if row.WorkspaceID.Valid {
		out.WorkspaceID = &row.WorkspaceID.UUID
	}
	if row.RevokedAt.Valid {
		out.RevokedAt = &row.RevokedAt.Time
	}
	if row.ExtensionRequestedAt.Valid {
		out.ExtensionRequestedAt = &row.ExtensionRequestedAt.Time
	}
	return out
}

func (api *API) leaseAdmin(rw http.ResponseWriter, r *http.Request) bool {
	if !api.Authorize(r, policy.ActionUpdate, rbac.ResourceDeploymentConfig) {
		httpapi.Forbidden(rw)
		return false
	}
	return true
}

// @Summary List short term leases
// @ID list-short-term-leases
// @Security CoderSessionToken
// @Produce json
// @Tags Organizations
// @Param organization path string true "Organization ID" format(uuid)
// @Success 200 {array} codersdk.ShortTermLease
// @Router /api/v2/organizations/{organization}/short-term-leases [get]
func (api *API) getShortTermLeases(rw http.ResponseWriter, r *http.Request) {
	if !api.leaseAdmin(rw, r) {
		return
	}
	//nolint:gocritic // Authorized deployment administrators list one resolved organization.
	rows, err := api.Database.GetShortTermLeasesByOrganization(dbauthz.AsSystemRestricted(r.Context()), httpmw.OrganizationParam(r).ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	out := make([]codersdk.ShortTermLease, 0, len(rows))
	for _, row := range rows {
		out = append(out, leaseSDK(row))
	}
	rw.Header().Set("Cache-Control", "no-store")
	httpapi.Write(r.Context(), rw, http.StatusOK, out)
}

// @Summary Create an isolated short term Browser lease
// @ID create-short-term-lease
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Organizations
// @Param organization path string true "Organization ID" format(uuid)
// @Param request body codersdk.CreateShortTermLeaseRequest true "Lease duration and Browser template"
// @Success 201 {object} codersdk.ShortTermLease
// @Router /api/v2/organizations/{organization}/short-term-leases [post]
func (api *API) postShortTermLease(rw http.ResponseWriter, r *http.Request) {
	if !api.leaseAdmin(rw, r) {
		return
	}
	var req codersdk.CreateShortTermLeaseRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	if req.Minutes == 0 {
		req.Minutes = 15
	}
	if req.Minutes < 1 || req.Minutes > 1440 {
		httpapi.Write(r.Context(), rw, 400, codersdk.Response{Message: "Lease duration must be 1 to 1440 minutes."})
		return
	}
	org := httpmw.OrganizationParam(r).ID
	tmpl, err := api.Database.GetTemplateByID(r.Context(), req.TemplateID)
	if err != nil || tmpl.OrganizationID != org || (strings.ToLower(tmpl.Name) != "browser" && strings.ToLower(tmpl.Name) != "neko") {
		httpapi.Write(r.Context(), rw, 400, codersdk.Response{Message: "Choose the Browser template in this organization."})
		return
	}
	now := api.Clock.Now()
	issuer := httpmw.APIKey(r).UserID
	//nolint:gocritic // The administrator authorized creation; account and restriction commit atomically.
	ctx := dbauthz.AsSystemRestricted(r.Context())
	var row database.ShortTermLease
	var user database.User
	err = api.Database.InTx(func(tx database.Store) error {
		active := codersdk.UserStatusActive
		name := "lease-" + uuid.NewString()[:18]
		var e error
		user, e = api.CreateUser(ctx, tx, CreateUserRequest{CreateUserRequestWithOrgs: codersdk.CreateUserRequest{Username: name, Email: name + "@lease.invalid", OrganizationIDs: []uuid.UUID{org}, UserStatus: &active}, LoginType: database.LoginTypeNone, SkipNotifications: true})
		if e != nil {
			return e
		}
		row, e = tx.InsertShortTermLease(ctx, database.InsertShortTermLeaseParams{UserID: user.ID, OrganizationID: org, IssuedBy: issuer, IssuedAt: now, ExpiresAt: now.Add(time.Duration(req.Minutes) * time.Minute)})
		return e
	}, nil)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	client := codersdk.New(api.AccessURL)
	client.SetSessionToken(httpmw.APITokenFromRequest(r))
	// The lease clock owns shutdown so extensions do not race a fixed workspace TTL.
	ttl := int64(0)
	ws, err := client.CreateUserWorkspace(r.Context(), user.ID.String(), codersdk.CreateWorkspaceRequest{TemplateID: req.TemplateID, Name: "browser", TTLMillis: &ttl})
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		_, revokeErr := api.Database.RevokeShortTermLease(cleanupCtx, database.RevokeShortTermLeaseParams{UserID: user.ID, OrganizationID: org})
		if revokeErr != nil {
			api.Logger.Error(ctx, "revoke incomplete lease", slog.Error(revokeErr))
		}
		httpapi.InternalServerError(rw, xerrors.Errorf("create isolated Browser workspace: %w", err))
		return
	}
	var token string
	err = api.Database.InTx(func(tx database.Store) error {
		// Account policy, not refreshable key expiry, is the authoritative lease clock.
		params, raw, e := apikey.Generate(apikey.CreateParams{UserID: user.ID, LoginType: database.LoginTypePassword, ExpiresAt: now.Add(366 * 24 * time.Hour), Scopes: database.APIKeyScopes{database.ApiKeyScopeWorkspaceRead, database.ApiKeyScopeWorkspaceApplicationConnect, database.ApiKeyScopeUserReadPersonal, database.ApiKeyScopeUserRead, database.ApiKeyScopeOrganizationRead, database.ApiKeyScopeTemplateRead}})
		if e != nil {
			return e
		}
		key, e := tx.InsertAPIKey(ctx, params)
		if e != nil {
			return e
		}
		row, e = tx.BindShortTermLease(ctx, database.BindShortTermLeaseParams{UserID: user.ID, OrganizationID: org, WorkspaceID: uuid.NullUUID{UUID: ws.ID, Valid: true}, TokenID: key.ID})
		token = raw
		return e
	}, nil)
	if err != nil {
		// Cleanup must survive an issuer closing the request after creation.
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if _, revokeErr := api.Database.RevokeShortTermLease(cleanupCtx, database.RevokeShortTermLeaseParams{UserID: user.ID, OrganizationID: org}); revokeErr != nil {
			api.Logger.Error(cleanupCtx, "revoke unbound lease", slog.Error(revokeErr))
		}
		httpapi.InternalServerError(rw, err)
		return
	}
	out := leaseSDK(row)
	out.Token = token
	rw.Header().Set("Cache-Control", "no-store")
	httpapi.Write(r.Context(), rw, http.StatusCreated, out)
}

// @Summary Extend or revoke an active short term lease
// @ID update-short-term-lease
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Organizations
// @Param organization path string true "Organization ID" format(uuid)
// @Param user path string true "Temporary user ID" format(uuid)
// @Param request body codersdk.UpdateShortTermLeaseRequest true "Extension or revocation"
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/organizations/{organization}/short-term-leases/{user} [patch]
func (api *API) patchShortTermLease(rw http.ResponseWriter, r *http.Request) {
	if !api.leaseAdmin(rw, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "user"))
	if err != nil {
		httpapi.ResourceNotFound(rw)
		return
	}
	var req codersdk.UpdateShortTermLeaseRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	//nolint:gocritic // Authorized admin; every write includes the resolved organization.
	ctx := dbauthz.AsSystemRestricted(r.Context())
	org := httpmw.OrganizationParam(r).ID
	var row database.ShortTermLease
	if req.Revoke {
		row, err = api.Database.RevokeShortTermLease(ctx, database.RevokeShortTermLeaseParams{UserID: id, OrganizationID: org})
	} else {
		if req.Minutes < 1 || req.Minutes > 1440 {
			httpapi.Write(r.Context(), rw, 400, codersdk.Response{Message: "Extension must be 1 to 1440 minutes."})
			return
		}
		row, err = api.Database.GetShortTermLeaseByUserID(ctx, id)
		if err == nil && row.OrganizationID != org {
			httpapi.ResourceNotFound(rw)
			return
		}
		if err == nil {
			row, err = api.Database.ExtendShortTermLease(ctx, database.ExtendShortTermLeaseParams{UserID: id, OrganizationID: org, ExpiresAt: row.ExpiresAt.Add(time.Duration(req.Minutes) * time.Minute)})
		}
	}
	if xerrors.Is(err, sql.ErrNoRows) {
		httpapi.Write(r.Context(), rw, 409, codersdk.Response{Message: "Lease is unavailable or has expired."})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	if req.Revoke && row.WorkspaceID.Valid {
		api.workspaceQuarantine.Revoke(row.WorkspaceID.UUID)
	}
	httpapi.Write(r.Context(), rw, 200, leaseSDK(row))
}

// @Summary Read the current temporary lease
// @ID get-current-short-term-lease
// @Security CoderSessionToken
// @Produce json
// @Tags Users
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/short-term-lease [get]
func (api *API) getMyShortTermLease(rw http.ResponseWriter, r *http.Request) {
	row, err := shorttermlease.Load(r.Context(), api.Database, httpmw.APIKey(r).UserID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	if row == nil {
		httpapi.Write(r.Context(), rw, 200, nil)
		return
	}
	httpapi.Write(r.Context(), rw, 200, leaseSDK(*row))
}

// @Summary Request a temporary lease extension
// @ID request-short-term-lease-extension
// @Security CoderSessionToken
// @Produce json
// @Tags Users
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/short-term-lease/extension [post]
func (api *API) requestShortTermLeaseExtension(rw http.ResponseWriter, r *http.Request) {
	//nolint:gocritic // A user may request only their own still-active lease extension.
	row, err := api.Database.RequestShortTermLeaseExtension(dbauthz.AsSystemRestricted(r.Context()), httpmw.APIKey(r).UserID)
	if xerrors.Is(err, sql.ErrNoRows) {
		httpapi.Write(r.Context(), rw, 409, codersdk.Response{Message: "An active lease is required."})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, 200, leaseSDK(row))
}

func (api *API) runShortTermLeases() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-api.ctx.Done():
			return
		case <-ticker.C:
		}
		//nolint:gocritic // Expired account cleanup is a system task on every replica.
		ctx := dbauthz.AsSystemRestricted(api.ctx)
		rows, err := api.Database.GetExpiredShortTermLeases(ctx)
		if err != nil {
			api.Logger.Error(ctx, "read expired leases", slog.Error(err))
			continue
		}
		for _, row := range rows {
			if err := api.expireShortTermLease(ctx, row); err != nil {
				api.Logger.Warn(ctx, "expire short term lease", slog.F("user_id", row.UserID), slog.Error(err))
			}
		}
	}
}

func (api *API) expireShortTermLease(ctx context.Context, row database.ShortTermLease) error {
	if err := api.Database.DeleteAPIKeysByUserID(ctx, row.UserID); err != nil {
		return err
	}
	user, err := api.Database.GetUserByID(ctx, row.UserID)
	if err != nil {
		return err
	}
	if user.Status != database.UserStatusSuspended {
		if _, err := api.Database.UpdateUserStatus(ctx, database.UpdateUserStatusParams{ID: row.UserID, Status: database.UserStatusSuspended, UpdatedAt: api.Clock.Now(), UserIsSeen: true}); err != nil {
			return err
		}
	}
	if !row.WorkspaceID.Valid {
		// Workspace creation can finish before the issuing request binds its result.
		// Recover it by the dedicated account so a disconnected issuer cannot orphan it.
		ws, err := api.Database.GetWorkspaceByOwnerIDAndName(ctx, database.GetWorkspaceByOwnerIDAndNameParams{OwnerID: row.UserID, Name: "browser"})
		if xerrors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		row.WorkspaceID = uuid.NullUUID{UUID: ws.ID, Valid: true}
	}
	api.workspaceQuarantine.Revoke(row.WorkspaceID.UUID)
	ws, err := api.Database.GetWorkspaceByID(ctx, row.WorkspaceID.UUID)
	if err != nil {
		return err
	}
	if ws.Deleted {
		return nil
	}
	last, err := api.Database.GetLatestWorkspaceBuildByWorkspaceID(ctx, ws.ID)
	if err != nil {
		return err
	}
	if last.Transition == database.WorkspaceTransitionDelete {
		return nil
	}
	if last.Transition == database.WorkspaceTransitionStop {
		job, err := api.Database.GetProvisionerJobByID(ctx, last.JobID)
		if err != nil {
			return err
		}
		// A failed stop may have left the browser running; retry until stopped.
		if job.JobStatus != database.ProvisionerJobStatusFailed && job.JobStatus != database.ProvisionerJobStatusCanceled {
			return nil
		}
	}
	b := wsbuilder.New(ws, database.WorkspaceTransitionStop, *api.BuildUsageChecker.Load()).Initiator(row.IssuedBy)
	_, job, _, err := b.Build(ctx, api.Database, api.FileCache, nil, audit.WorkspaceBuildBaggage{IP: "127.0.0.1"})
	if err != nil {
		return err
	}
	return provisionerjobs.PostJob(api.Pubsub, *job)
}

// @Summary Sign in with a temporary lease token
// @ID login-short-term-lease
// @Accept json
// @Produce json
// @Tags Users
// @Param request body codersdk.LeaseTokenLoginRequest true "Temporary token"
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/short-term-lease/login [post]
func (api *API) loginShortTermLease(rw http.ResponseWriter, r *http.Request) {
	var req codersdk.LeaseTokenLoginRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	clone := r.Clone(r.Context())
	u := *r.URL
	u.Path = "/api/v2/users/me"
	clone.URL = &u
	clone.Method = http.MethodGet
	result, authErr := httpmw.ValidateAPIKey(r.Context(), httpmw.ValidateAPIKeyConfig{DB: api.Database, OAuth2Configs: &httpmw.OAuth2Configs{}, DisableSessionExpiryRefresh: true, SessionTokenFunc: func(*http.Request) string { return req.Token }, Logger: api.Logger}, clone)
	if authErr != nil {
		httpapi.Write(r.Context(), rw, http.StatusUnauthorized, codersdk.Response{Message: "Invalid or expired lease token."})
		return
	}
	row, err := shorttermlease.Load(r.Context(), api.Database, result.Key.UserID)
	if err != nil || row == nil || !shorttermlease.Active(*row, api.Clock.Now()) {
		httpapi.Write(r.Context(), rw, http.StatusUnauthorized, codersdk.Response{Message: "Invalid or expired lease token."})
		return
	}
	http.SetCookie(rw, &http.Cookie{Name: codersdk.SessionTokenCookie, Value: req.Token, Path: "/", HttpOnly: true, Secure: api.AccessURL.Scheme == "https", SameSite: http.SameSiteLaxMode})
	rw.Header().Set("Cache-Control", "no-store")
	httpapi.Write(r.Context(), rw, http.StatusOK, leaseSDK(*row))
}

func (api *API) checkLeaseAppAccess(ctx context.Context, user, workspace uuid.UUID, slug string) error {
	row, err := shorttermlease.Load(ctx, api.Database, user)
	if err != nil {
		return err
	}
	if row == nil {
		return nil
	}
	if !shorttermlease.Active(*row, api.Clock.Now()) || !row.WorkspaceID.Valid || row.WorkspaceID.UUID != workspace || slug != "neko-browser" {
		return xerrors.New("Browser lease access required")
	}
	return nil
}
