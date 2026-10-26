package coderd

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/platformlockdown"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

var errGlobalLockdownExternalProxy = errors.New("external workspace app proxy configured")

func (api *API) mountGlobalLockdown(r chi.Router, auth func(http.Handler) http.Handler) {
	r.Route("/api/v2/global-lockdown", func(r chi.Router) {
		r.Use(auth)
		r.Get("/", api.getGlobalLockdown)
		r.Post("/", api.postGlobalLockdown)
		r.Get("/controls", api.getGlobalControls)
		r.Put("/controls", api.putGlobalControls)
		r.Post("/controls/unlock", api.unlockGlobalControls)
		r.Post("/controls/close", api.closeGlobalControls)
		r.Post("/organizations/{organization}/workspace-power", api.globalControlPower)
	})
}

func (api *API) globalLockdownResponse(r *http.Request, s platformlockdown.State) (codersdk.GlobalLockdownState, error) {
	admin := api.globalLockdown.Admin(r.Context(), httpmw.APIKey(r).UserID)
	out := codersdk.GlobalLockdownState{
		Enabled: s.Enabled, Revision: s.Revision, UpdatedBy: s.UpdatedBy,
		UpdatedAt: s.UpdatedAt, Admin: admin, Confirmed: s.Confirmed(),
	}
	policy := api.globalLockdown.Policy(r.Context(), s)
	// A lost control connection does not remove an agent's direct WireGuard
	// peers. Only an applied policy acknowledgement, or a successfully deleted
	// agent lifecycle row, establishes that those peers can no longer connect.
	//nolint:gocritic // This shared enforcement summary exposes agent names only to owners.
	agents, err := api.Database.GetWorkspaceAgentsCreatedAfter(dbauthz.AsSystemRestricted(r.Context()), time.Time{})
	if err != nil {
		return out, err
	}
	for _, agent := range agents {
		ack := s.AgentAcks[agent.ID.String()]
		if !agent.FirstConnectedAt.Valid && !ack.Supported {
			continue
		}
		agentPolicy := policy
		//nolint:gocritic // Enforcement status needs the target policy, including quarantined workspaces.
		workspace, lookupErr := api.Database.GetWorkspaceByAgentID(dbauthz.AsSystemRestricted(r.Context()), agent.ID)
		if lookupErr == nil {
			agentPolicy, err = api.globalLockdown.PolicyForWorkspace(r.Context(), s, workspace.ID)
			if err != nil {
				return out, err
			}
		} else if !errors.Is(lookupErr, sql.ErrNoRows) {
			return out, lookupErr
		}
		out.AgentsTotal++
		status := "confirmed"
		if !ack.Supported {
			status = "update_required"
		} else if ack.Fingerprint != agentPolicy.Fingerprint {
			status = "waiting"
		}
		if status != "confirmed" {
			out.AgentsPending++
		}
		if admin {
			name := agent.Name
			//nolint:gocritic // The owner needs an actionable workspace label for the agent update.
			if workspace, err := api.Database.GetWorkspaceAgentAndWorkspaceByID(dbauthz.AsSystemRestricted(r.Context()), agent.ID); err == nil {
				name = fmt.Sprintf("%s/%s/%s", workspace.OwnerUsername, workspace.WorkspaceTable.Name, agent.Name)
			}
			out.Agents = append(out.Agents, codersdk.GlobalLockdownAgent{ID: agent.ID.String(), Name: name, State: status})
		}
	}
	out.Confirmed = out.Confirmed && out.AgentsPending == 0
	if !admin {
		return out, nil
	}
	//nolint:gocritic // Only deployment owners receive the connected-user matrix.
	users, err := api.Database.GetUsers(dbauthz.AsSystemRestricted(r.Context()), database.GetUsersParams{
		Status: []database.UserStatus{database.UserStatusActive},
	})
	if err != nil {
		return out, err
	}
	for _, u := range users {
		connected := u.ID == httpmw.APIKey(r).UserID || s.Connected(u.ID.String()) || u.LastSeenAt.After(api.Clock.Now().Add(-2*time.Minute))
		owner := false
		for _, role := range u.RBACRoles {
			owner = owner || role == "owner"
		}
		out.Users = append(out.Users, codersdk.GlobalLockdownUser{
			ID: u.ID.String(), Username: u.Username, AvatarURL: u.AvatarURL, Admin: owner, Connected: connected,
			Disconnected: s.Enabled && out.Confirmed && !owner && !s.Connected(u.ID.String()),
		})
	}
	return out, nil
}

// @Summary Synchronize workspace access enforcement
// @ID sync-workspace-agent-access
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Agents
// @Param request body agentsdk.SyncWorkspaceAccessRequest true "Applied policy acknowledgement"
// @Success 200 {object} agentsdk.WorkspaceAccessPolicy
// @Router /api/v2/workspaceagents/me/global-lockdown [post]
// @x-apidocgen {"skip": true}
func (api *API) syncAgentWorkspaceAccess(rw http.ResponseWriter, r *http.Request) {
	var req agentsdk.SyncWorkspaceAccessRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	agent := httpmw.WorkspaceAgent(r)
	policy, err := api.globalLockdown.SyncAgentForWorkspace(r.Context(), agent.ID, httpmw.LatestBuild(r).WorkspaceID, req.Session, req.AppliedPolicy)
	if errors.Is(err, platformlockdown.ErrAgentSession) {
		httpapi.Write(r.Context(), rw, http.StatusConflict, codersdk.Response{Message: err.Error()})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, policy)
}

func (api *API) trackGlobalLockdownPeer(rw http.ResponseWriter, r *http.Request, peerID uuid.UUID) bool {
	userID := uuid.Nil
	if key, ok := httpmw.APIKeyOptional(r); ok {
		userID = key.UserID
	}
	if err := api.globalLockdown.TrackPeer(r.Context(), userID, peerID); err != nil {
		httpapi.Write(r.Context(), rw, http.StatusServiceUnavailable, codersdk.Response{Message: "Workspace access cannot be verified."})
		return false
	}
	return true
}

// @Summary Get global workspace lockdown
// @ID get-global-lockdown
// @Security CoderSessionToken
// @Produce json
// @Tags Deployment
// @Success 200 {object} codersdk.GlobalLockdownState
// @Router /api/v2/global-lockdown [get]
// @x-apidocgen {"skip": true}
func (api *API) getGlobalLockdown(rw http.ResponseWriter, r *http.Request) {
	s, err := api.globalLockdown.Load(r.Context())
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	out, err := api.globalLockdownResponse(r, s)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, out)
}

// @Summary Change global workspace lockdown
// @ID update-global-lockdown
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Deployment
// @Param request body codersdk.UpdateGlobalLockdownRequest true "Lockdown setting"
// @Success 200 {object} codersdk.GlobalLockdownState
// @Router /api/v2/global-lockdown [post]
// @x-apidocgen {"skip": true}
func (api *API) postGlobalLockdown(rw http.ResponseWriter, r *http.Request) {
	key := httpmw.APIKey(r)
	if !api.requireGlobalControlGrant(rw, r, false) {
		return
	}
	if !api.globalLockdown.Admin(r.Context(), key.UserID) {
		httpapi.Write(r.Context(), rw, http.StatusForbidden, codersdk.Response{Message: "Only deployment owners may change global lockdown."})
		return
	}
	var req codersdk.UpdateGlobalLockdownRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	if req.Enabled && req.Confirmation != "agree" {
		httpapi.Write(r.Context(), rw, http.StatusBadRequest, codersdk.Response{Message: "Type agree to confirm global lockdown."})
		return
	}
	//nolint:gocritic // The authenticated owner supplies the audit attribution for this setting.
	u, err := api.Database.GetUserByID(dbauthz.AsSystemRestricted(r.Context()), key.UserID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	s, err := api.globalLockdown.SetChecked(r.Context(), req.Enabled, u.Username, func(tx database.Store) error {
		// Cached app tickets on external proxies do not consult this manager.
		//nolint:gocritic // Only owners reach this deployment-wide enforcement check.
		proxies, err := tx.GetWorkspaceProxies(dbauthz.AsSystemRestricted(r.Context()))
		if err != nil {
			return err
		}
		for _, proxy := range proxies {
			if !proxy.DerpOnly {
				return errGlobalLockdownExternalProxy
			}
		}
		return nil
	})
	if errors.Is(err, errGlobalLockdownExternalProxy) {
		httpapi.Write(r.Context(), rw, http.StatusConflict, codersdk.Response{
			Message: "Global Lock Down requires integrated workspace app proxying.",
			Detail:  "An external workspace proxy is configured and cannot confirm session revocation.",
		})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	out, err := api.globalLockdownResponse(r, s)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, out)
}

func globalLockdownWorkspacePath(path string) bool {
	if path == "/api/v2/tailnet" {
		return true
	}
	for _, prefix := range []string{"/api/v2/workspaces", "/api/v2/workspacebuilds", "/api/v2/workspaceagents"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return path != "/api/v2/workspaceagents/me" && !strings.HasPrefix(path, "/api/v2/workspaceagents/me/") &&
				!strings.HasSuffix(path, "-instance-identity")
		}
	}
	return strings.HasPrefix(path, "/api/v2/") && (strings.Contains(path, "/workspace/") || strings.HasSuffix(path, "/workspaces"))
}

func (api *API) globalLockdownMiddleware(auth func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		protected := auth(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			key, ok := httpmw.APIKeyOptional(r)
			if !ok {
				// Agents and trusted workspace proxies have separate authentication.
				// Application sessions are additionally checked using their signed token.
				next.ServeHTTP(rw, r)
				return
			}
			s, err := api.globalLockdown.Load(r.Context())
			if err != nil {
				httpapi.Write(r.Context(), rw, http.StatusServiceUnavailable, codersdk.Response{Message: "Workspace access cannot be verified."})
				return
			}
			if s.Enabled && !api.globalLockdown.Admin(r.Context(), key.UserID) {
				httpapi.Write(r.Context(), rw, http.StatusLocked, codersdk.Response{Message: "System Lockdown Enabled"})
				return
			}
			// Tailnet must complete its graceful peer removal before cancellation.
			// Its handler registers the revocation signal separately.
			if r.URL.Path == "/api/v2/tailnet" || strings.HasSuffix(r.URL.Path, "/coordinate") {
				next.ServeHTTP(rw, r)
				return
			}
			ctx, end, err := api.globalLockdown.Guard(r.Context(), key.UserID)
			if err != nil {
				httpapi.Write(r.Context(), rw, http.StatusLocked, codersdk.Response{Message: "System Lockdown Enabled"})
				return
			}
			defer end()
			next.ServeHTTP(rw, r.WithContext(ctx))
		}))
		return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			if globalLockdownWorkspacePath(r.URL.Path) {
				protected.ServeHTTP(rw, r)
				return
			}
			next.ServeHTTP(rw, r)
		})
	}
}

func (api *API) beginGlobalLockdownSession(rw http.ResponseWriter, r *http.Request) (platformlockdown.Session, bool) {
	id := uuid.Nil
	if key, ok := httpmw.APIKeyOptional(r); ok {
		id = key.UserID
	}
	s, err := api.globalLockdown.Begin(r.Context(), id)
	if err != nil {
		httpapi.Write(r.Context(), rw, http.StatusLocked, codersdk.Response{Message: "System Lockdown Enabled"})
		return s, false
	}
	return s, true
}

func (api *API) guardGlobalLockdownSession(ctx context.Context, id uuid.UUID) (context.Context, func(), error) {
	return api.globalLockdown.Guard(ctx, id)
}

// WithGlobalLockdownProxyRegistration prevents an unsupported external app
// proxy from being registered concurrently with lockdown activation.
func (api *API) WithGlobalLockdownProxyRegistration(ctx context.Context, register func(database.Store) error) error {
	return api.globalLockdown.WithUnlocked(ctx, register)
}
