package coderd

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/apikey"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/shorttermlease"
	"github.com/coder/coder/v2/codersdk"
)

// issueShortTermLeaseToken must run in the transaction holding the lease lock.
// A replacement invalidates the previous token and its browser sessions together.
func (api *API) issueShortTermLeaseToken(ctx context.Context, tx database.Store, row database.ShortTermLease) (database.ShortTermLease, string, error) {
	params, token, err := apikey.Generate(apikey.CreateParams{
		UserID: row.UserID, LoginType: database.LoginTypePassword,
		// The lease clock remains authoritative across extensions.
		ExpiresAt: api.Clock.Now().Add(366 * 24 * time.Hour),
		Scopes:    database.APIKeyScopes{database.ApiKeyScopeWorkspaceRead, database.ApiKeyScopeWorkspaceApplicationConnect, database.ApiKeyScopeUserReadPersonal, database.ApiKeyScopeUserRead, database.ApiKeyScopeOrganizationRead, database.ApiKeyScopeTemplateRead},
	})
	if err != nil {
		return row, "", err
	}
	key, err := tx.InsertAPIKey(ctx, params)
	if err != nil {
		return row, "", err
	}
	if row.TokenID != "" {
		if err := tx.DeleteAPIKeyByID(ctx, row.TokenID); err != nil {
			return row, "", err
		}
	}
	row, err = tx.BindShortTermLease(ctx, database.BindShortTermLeaseParams{
		UserID: row.UserID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, TokenID: key.ID,
	})
	if err != nil {
		return row, "", err
	}
	err = tx.UpsertShortTermLeaseCredential(ctx, database.UpsertShortTermLeaseCredentialParams{
		UserID: row.UserID, OrganizationID: row.OrganizationID, TokenID: key.ID, Value: token, ValueKeyID: sql.NullString{},
	})
	return row, token, err
}

// @Summary Get short term lease token
// @Description Reveal an active lease token to an administrator.
// @ID get-short-term-lease-token
// @Security CoderSessionToken
// @Produce json
// @Tags Organizations
// @Param organization path string true "Organization ID" format(uuid)
// @Param user path string true "Temporary user ID" format(uuid)
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/organizations/{organization}/short-term-leases/{user}/token [get]
func (api *API) shortTermLeaseToken(rw http.ResponseWriter, r *http.Request) {
	api.handleShortTermLeaseToken(rw, r)
}

// @Summary Replace short term lease token
// @Description Replace an active lease token and invalidate its previous sessions.
// @ID replace-short-term-lease-token
// @Security CoderSessionToken
// @Produce json
// @Tags Organizations
// @Param organization path string true "Organization ID" format(uuid)
// @Param user path string true "Temporary user ID" format(uuid)
// @Success 200 {object} codersdk.ShortTermLease
// @Router /api/v2/organizations/{organization}/short-term-leases/{user}/token [post]
func (api *API) replaceShortTermLeaseToken(rw http.ResponseWriter, r *http.Request) {
	api.handleShortTermLeaseToken(rw, r)
}

func (api *API) handleShortTermLeaseToken(rw http.ResponseWriter, r *http.Request) {
	replace := r.Method == http.MethodPost
	rw.Header().Set("Cache-Control", "no-store")
	if !api.leaseAdmin(rw, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "user"))
	if err != nil {
		httpapi.ResourceNotFound(rw)
		return
	}
	org := httpmw.OrganizationParam(r).ID
	//nolint:gocritic // Deployment administrator authorized above; the query binds user and organization.
	ctx := dbauthz.AsSystemRestricted(r.Context())
	var row database.ShortTermLease
	var token string
	errUnavailable := xerrors.New("lease credential unavailable")
	err = api.Database.InTx(func(tx database.Store) error {
		var err error
		row, err = tx.GetShortTermLeaseForUpdate(ctx, database.GetShortTermLeaseForUpdateParams{UserID: id, OrganizationID: org})
		if err != nil {
			return err
		}
		if !shorttermlease.Active(row, api.Clock.Now()) || !row.WorkspaceID.Valid {
			return errUnavailable
		}
		if replace {
			row, token, err = api.issueShortTermLeaseToken(ctx, tx, row)
			return err
		}
		credential, err := tx.GetShortTermLeaseCredential(ctx, database.GetShortTermLeaseCredentialParams{UserID: id, OrganizationID: org})
		if xerrors.Is(err, sql.ErrNoRows) {
			return errUnavailable
		}
		if err != nil {
			return err
		}
		if credential.TokenID != row.TokenID {
			return errUnavailable
		}
		token = credential.Value
		return nil
	}, nil)
	if xerrors.Is(err, sql.ErrNoRows) {
		httpapi.ResourceNotFound(rw)
		return
	}
	if xerrors.Is(err, errUnavailable) {
		httpapi.Write(ctx, rw, http.StatusConflict, codersdk.Response{Message: "This lease token is unavailable. For an active lease, issue a replacement token."})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	api.Logger.Info(ctx, "administrator accessed lease token", slog.F("user_id", id), slog.F("organization_id", org), slog.F("actor_id", httpmw.APIKey(r).UserID), slog.F("replaced", replace))
	out := leaseSDK(row)
	out.Token = token
	httpapi.Write(ctx, rw, http.StatusOK, out)
}
