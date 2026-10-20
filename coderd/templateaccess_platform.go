package coderd

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpapi/httperror"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/codersdk"
)

// The platform's template access list: a template's whitelist of the users
// who may see it and create workspaces from it, set in the Templates table's
// Access menu. None (the default): everyone who may otherwise. Coder's own
// template permissions (its template ACLs) are a Premium feature this
// deployment is not licensed for, so the list is the platform's own: kept in
// the runtime config and checked here - the templates lists, a template read
// by its ID or its name (and its versions by name), and a workspace's
// creation (for its owner). Those who may edit the template are never kept
// out: they set the list.

const templateAccessTTL = 5 * time.Second

func templateAccessKey(templateID uuid.UUID) string {
	return "platform-template-access:" + templateID.String()
}

type templateAccessEntry struct {
	users []uuid.UUID
	at    time.Time
}

type templateAccessValue struct {
	Users []uuid.UUID `json:"users"`
}

// templateAccessUsers is the template's list (empty: none, everyone), read
// at most every templateAccessTTL by each replica.
func (api *API) templateAccessUsers(ctx context.Context, templateID uuid.UUID) ([]uuid.UUID, error) {
	if v, ok := api.templateAccess.Load(templateID); ok {
		if e, _ := v.(templateAccessEntry); time.Since(e.at) < templateAccessTTL {
			return e.users, nil
		}
	}
	//nolint:gocritic // The list is read for every template a user sees: as the system, after their own checks.
	raw, err := api.Database.GetRuntimeConfig(dbauthz.AsSystemRestricted(ctx), templateAccessKey(templateID))
	var users []uuid.UUID
	switch {
	case err == nil:
		var v templateAccessValue
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			return nil, xerrors.Errorf("template %s's access list: %w", templateID, err)
		}
		users = v.Users
	case xerrors.Is(err, sql.ErrNoRows):
	default:
		return nil, xerrors.Errorf("template %s's access list: %w", templateID, err)
	}
	api.templateAccess.Store(templateID, templateAccessEntry{users: users, at: time.Now()})
	return users, nil
}

// templateAccessAllows: the user is on the template's list, or it has none.
// A list that cannot be read keeps everyone out but its editors.
func (api *API) templateAccessAllows(ctx context.Context, templateID, userID uuid.UUID) bool {
	users, err := api.templateAccessUsers(ctx, templateID)
	if err != nil {
		api.Logger.Warn(ctx, "template access list", slog.Error(err))
		return false
	}
	return len(users) == 0 || slices.Contains(users, userID)
}

// templateVisible: the request's user may see the template - on its list (or
// it has none), or they may edit it.
func (api *API) templateVisible(r *http.Request, template database.Template) bool {
	return api.templateAccessAllows(r.Context(), template.ID, httpmw.APIKey(r).UserID) ||
		api.Authorize(r, policy.ActionUpdate, template)
}

// templatesVisible: of the templates, those the request's user may see.
func (api *API) templatesVisible(r *http.Request, templates []database.Template) []database.Template {
	return slices.DeleteFunc(templates, func(t database.Template) bool { return !api.templateVisible(r, t) })
}

// templateAccessMW: a template (by its ID in the path) the user may not see
// is not there for them.
func (api *API) templateAccessMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if !api.templateVisible(r, httpmw.TemplateParam(r)) {
			httpapi.ResourceNotFound(rw)
			return
		}
		next.ServeHTTP(rw, r)
	})
}

// templateAccessForOwner: a workspace of the template for this owner - on its
// list (or it has none), or one who may edit it.
func (api *API) templateAccessForOwner(ctx context.Context, template database.Template, ownerID uuid.UUID) error {
	if api.templateAccessAllows(ctx, template.ID, ownerID) {
		return nil
	}
	//nolint:gocritic // Whether the owner may edit the template: their roles, read as the system.
	sys := dbauthz.AsSystemRestricted(ctx)
	if subject, _, err := httpmw.UserRBACSubject(sys, api.Database, ownerID, rbac.ScopeAll); err == nil &&
		api.Authorizer.Authorize(ctx, subject, policy.ActionUpdate, template.RBACObject()) == nil {
		return nil
	}
	return httperror.NewResponseError(http.StatusForbidden, codersdk.Response{
		Message: fmt.Sprintf("The template %q is not available to this user.", template.Name),
		Detail:  "Its access list names who may use it. Ask a template administrator to add the user.",
	})
}

// @Summary Get template access list
// @Description The platform's whitelist of the users who may see and use the template; empty: everyone.
// @ID get-template-access-list
// @Security CoderSessionToken
// @Produce json
// @Tags Templates
// @Param template path string true "Template ID" format(uuid)
// @Success 200 {object} codersdk.TemplateAccessList
// @Router /api/v2/templates/{template}/access [get]
func (api *API) templateAccessList(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	template := httpmw.TemplateParam(r)
	if !api.Authorize(r, policy.ActionUpdate, template) {
		httpapi.Forbidden(rw)
		return
	}
	users, err := api.templateAccessUsers(ctx, template.ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(ctx, rw, http.StatusOK, codersdk.TemplateAccessList{UserIDs: accessIDs(users)})
}

// @Summary Set template access list
// @Description Only the users given may see the template and create workspaces from it (its editors always may);
// @Description none: everyone.
// @ID set-template-access-list
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Templates
// @Param template path string true "Template ID" format(uuid)
// @Param request body codersdk.TemplateAccessList true "The users"
// @Success 200 {object} codersdk.TemplateAccessList
// @Router /api/v2/templates/{template}/access [put]
func (api *API) putTemplateAccessList(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	template := httpmw.TemplateParam(r)
	if !api.Authorize(r, policy.ActionUpdate, template) {
		httpapi.Forbidden(rw)
		return
	}
	var req codersdk.TemplateAccessList
	if !httpapi.Read(ctx, rw, r, &req) {
		return
	}
	users := slices.Compact(slices.SortedFunc(slices.Values(req.UserIDs), func(a, b uuid.UUID) int {
		return slices.Compare(a[:], b[:])
	}))
	//nolint:gocritic // The list is the platform's: kept in the runtime config, as the system (its editor checked above).
	sys := dbauthz.AsSystemRestricted(ctx)
	if len(users) > 0 {
		found, err := api.Database.GetUsersByIDs(sys, users)
		if err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
		if len(found) != len(users) || slices.ContainsFunc(found, func(u database.User) bool { return u.Deleted }) {
			httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "Every user must be an account here."})
			return
		}
		raw, err := json.Marshal(templateAccessValue{Users: users})
		if err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
		if err := api.Database.UpsertRuntimeConfig(sys, database.UpsertRuntimeConfigParams{
			Key:   templateAccessKey(template.ID),
			Value: string(raw),
		}); err != nil {
			httpapi.InternalServerError(rw, err)
			return
		}
	} else if err := api.Database.DeleteRuntimeConfig(sys, templateAccessKey(template.ID)); err != nil &&
		!xerrors.Is(err, sql.ErrNoRows) {
		httpapi.InternalServerError(rw, err)
		return
	}
	api.templateAccess.Store(template.ID, templateAccessEntry{users: users, at: time.Now()})
	api.Logger.Info(ctx, "template access list", slog.F("template", template.Name), slog.F("users", len(users)),
		slog.F("by", httpmw.APIKey(r).UserID))
	httpapi.Write(ctx, rw, http.StatusOK, codersdk.TemplateAccessList{UserIDs: accessIDs(users)})
}

func accessIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}
