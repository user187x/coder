package coderd

import (
	"net/http"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/platformbanner"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
)

// platformBannerPrefix is where the dashboard's announcement banner is served
// (coderd/platformbanner), on Coder's own origin.
const platformBannerPrefix = "/__banner"

// mountPlatformBanner serves the banner under /__banner: banner.json and the
// live socket to everyone, the admin calls to whoever may edit the
// deployment's settings (the dashboard's gate for its Announcement page).
func (api *API) mountPlatformBanner(r chi.Router, apiKeyOptional func(http.Handler) http.Handler) {
	store := platformbanner.NewStore(api.Database, api.Pubsub)
	api.platformBannerHub = platformbanner.NewHub(store, api.Logger.Named("platform_banner"))
	h := &platformbanner.Handler{
		Store:     store,
		Hub:       api.platformBannerHub,
		Authorize: api.platformBannerAdmin,
		Logger:    api.Logger.Named("platform_banner"),
	}
	r.Route(platformBannerPrefix, func(r chi.Router) {
		r.Use(apiKeyOptional)
		h.Routes(r)
	})
}

func (api *API) platformBannerAdmin(r *http.Request) (platformbanner.Admin, error) {
	key, ok := httpmw.APIKeyOptional(r)
	if !ok {
		return platformbanner.Admin{}, platformbanner.ErrUnauthenticated
	}
	if !api.Authorize(r, policy.ActionUpdate, rbac.ResourceDeploymentConfig) {
		return platformbanner.Admin{}, platformbanner.ErrForbidden
	}
	// the caller's own user row, for the summary's "who": they were just
	// authorized to edit the deployment's settings
	//nolint:gocritic // the authenticated caller reads their own name and email
	user, err := api.Database.GetUserByID(dbauthz.AsSystemRestricted(r.Context()), key.UserID)
	if err != nil {
		return platformbanner.Admin{}, err
	}
	roles := []string{}
	if subject, ok := httpmw.UserAuthorizationOptional(r.Context()); ok {
		for _, role := range subject.SafeRoleNames() {
			roles = append(roles, role.Name)
		}
	}
	sort.Strings(roles)
	return platformbanner.Admin{Username: user.Username, Email: user.Email, Roles: roles}, nil
}
