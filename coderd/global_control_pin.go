package coderd

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"cdr.dev/slog/v3"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/userpassword"
	"github.com/coder/coder/v2/codersdk"
)

const globalControlConfigKey = "platform_global_control_pin"
const globalControlHeader = "X-Coder-Global-Control-Token"
const globalControlLifetime = 5 * time.Minute

type controlGrant struct {
	Hash    string `json:"hash"`
	User    string `json:"user"`
	Expires int64  `json:"expires"`
}
type controlAttempt struct {
	Count int   `json:"count"`
	Until int64 `json:"until"`
}
type globalControlConfig struct {
	Hash     string                    `json:"hash"`
	Grants   map[string]controlGrant   `json:"grants"`
	Attempts map[string]controlAttempt `json:"attempts"`
}
type controlFailure struct {
	status  int
	message string
}

func (e controlFailure) Error() string { return e.message }

// Failed verification attempts must commit, including across Coder replicas.
func (api *API) changeGlobalControls(ctx context.Context, fn func(*globalControlConfig) error) error {
	//nolint:gocritic // Every caller first verifies deployment ownership.
	ctx = dbauthz.AsSystemRestricted(ctx)
	var actionErr error
	err := api.Database.InTx(func(tx database.Store) error {
		if err := tx.AcquireLock(ctx, database.GenLockID(globalControlConfigKey)); err != nil {
			return err
		}
		var state globalControlConfig
		raw, err := tx.GetRuntimeConfig(ctx, globalControlConfigKey)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil {
			if err := json.Unmarshal([]byte(raw), &state); err != nil {
				return err
			}
		}
		if state.Grants == nil {
			state.Grants = make(map[string]controlGrant)
		}
		if state.Attempts == nil {
			state.Attempts = make(map[string]controlAttempt)
		}
		now := api.Clock.Now().Unix()
		for id, grant := range state.Grants {
			if grant.Expires <= now {
				delete(state.Grants, id)
			}
		}
		for id, attempt := range state.Attempts {
			if attempt.Until <= now {
				delete(state.Attempts, id)
			}
		}
		actionErr = fn(&state)
		encoded, err := json.Marshal(state)
		if err != nil {
			return err
		}
		return tx.UpsertRuntimeConfig(ctx, database.UpsertRuntimeConfigParams{Key: globalControlConfigKey, Value: string(encoded)})
	}, nil)
	if err != nil {
		return err
	}
	return actionErr
}

func validControlPIN(pin string) bool {
	if len(pin) != 6 {
		return false
	}
	for _, digit := range pin {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}
func controlDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func controlUnlocked(state *globalControlConfig, key database.APIKey, token string, now time.Time) bool {
	grant, ok := state.Grants[key.ID]
	return ok && token != "" && len(token) <= 128 && grant.User == key.UserID.String() && grant.Expires > now.Unix() && subtle.ConstantTimeCompare([]byte(grant.Hash), []byte(controlDigest(token))) == 1
}
func verifyControlPIN(state *globalControlConfig, user string, pin string, now time.Time) error {
	attempt := state.Attempts[user]
	if attempt.Until <= now.Unix() {
		attempt = controlAttempt{Until: now.Add(5 * time.Minute).Unix()}
	}
	if attempt.Count >= 5 {
		return controlFailure{http.StatusTooManyRequests, "Too many PIN attempts. Try again after five minutes."}
	}
	ok := false
	if validControlPIN(pin) && state.Hash != "" {
		var err error
		ok, err = userpassword.Compare(state.Hash, pin)
		if err != nil {
			return err
		}
	}
	if !ok {
		attempt.Count++
		state.Attempts[user] = attempt
		return controlFailure{http.StatusForbidden, "Incorrect admin PIN."}
	}
	delete(state.Attempts, user)
	return nil
}
func issueControlGrant(state *globalControlConfig, key database.APIKey, now time.Time) (codersdk.GlobalControlStatus, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return codersdk.GlobalControlStatus{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	expires := now.Add(globalControlLifetime)
	state.Grants[key.ID] = controlGrant{Hash: controlDigest(token), User: key.UserID.String(), Expires: expires.Unix()}
	return codersdk.GlobalControlStatus{Configured: true, Token: token, ExpiresAt: expires.UTC().Format(time.RFC3339)}, nil
}
func (api *API) controlOwner(rw http.ResponseWriter, r *http.Request) bool {
	if api.globalLockdown.Admin(r.Context(), httpmw.APIKey(r).UserID) {
		return true
	}
	httpapi.Write(r.Context(), rw, http.StatusForbidden, codersdk.Response{Message: "Only deployment owners may use global controls."})
	return false
}
func controlResponse(rw http.ResponseWriter, r *http.Request, out codersdk.GlobalControlStatus, err error) {
	rw.Header().Set("Cache-Control", "no-store")
	if err != nil {
		var failure controlFailure
		if errors.As(err, &failure) {
			httpapi.Write(r.Context(), rw, failure.status, codersdk.Response{Message: failure.message})
			return
		}
		httpapi.InternalServerError(rw, fmt.Errorf("verify global control access: %w", err))
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, out)
}

// @Summary Read global control PIN configuration
// @ID get-global-control-pin
// @Security CoderSessionToken
// @Tags Deployment
// @Produce json
// @Success 200 {object} codersdk.GlobalControlStatus
// @Router /api/v2/global-lockdown/controls [get]
func (api *API) getGlobalControls(rw http.ResponseWriter, r *http.Request) {
	if !api.controlOwner(rw, r) {
		return
	}
	var out codersdk.GlobalControlStatus
	err := api.changeGlobalControls(r.Context(), func(state *globalControlConfig) error { out.Configured = state.Hash != ""; return nil })
	controlResponse(rw, r, out, err)
}

// @Summary Configure the global control PIN
// @ID configure-global-control-pin
// @Security CoderSessionToken
// @Tags Deployment
// @Accept json
// @Produce json
// @Param request body codersdk.ConfigureGlobalControlPINRequest true "Six-digit PIN and current PIN when rotating"
// @Success 200 {object} codersdk.GlobalControlStatus
// @Router /api/v2/global-lockdown/controls [put]
func (api *API) putGlobalControls(rw http.ResponseWriter, r *http.Request) {
	if !api.controlOwner(rw, r) {
		return
	}
	var req codersdk.ConfigureGlobalControlPINRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	if !validControlPIN(req.PIN) {
		controlResponse(rw, r, codersdk.GlobalControlStatus{}, controlFailure{http.StatusBadRequest, "Choose a six-digit admin PIN."})
		return
	}
	key := httpmw.APIKey(r)
	var out codersdk.GlobalControlStatus
	err := api.changeGlobalControls(r.Context(), func(state *globalControlConfig) error {
		if state.Hash != "" && !controlUnlocked(state, key, r.Header.Get(globalControlHeader), api.Clock.Now()) {
			if err := verifyControlPIN(state, key.UserID.String(), req.CurrentPIN, api.Clock.Now()); err != nil {
				return err
			}
		}
		hash, err := userpassword.Hash(req.PIN)
		if err != nil {
			return err
		}
		state.Hash = hash
		state.Grants = make(map[string]controlGrant)
		out, err = issueControlGrant(state, key, api.Clock.Now())
		return err
	})
	if err == nil {
		api.Logger.Info(r.Context(), "global control PIN configured", slog.F("user_id", key.UserID))
	}
	controlResponse(rw, r, out, err)
}

// @Summary Unlock global controls for five minutes
// @ID unlock-global-controls
// @Security CoderSessionToken
// @Tags Deployment
// @Accept json
// @Produce json
// @Param request body codersdk.GlobalControlPINRequest true "Admin PIN"
// @Success 200 {object} codersdk.GlobalControlStatus
// @Router /api/v2/global-lockdown/controls/unlock [post]
func (api *API) unlockGlobalControls(rw http.ResponseWriter, r *http.Request) {
	if !api.controlOwner(rw, r) {
		return
	}
	var req codersdk.GlobalControlPINRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	key := httpmw.APIKey(r)
	var out codersdk.GlobalControlStatus
	err := api.changeGlobalControls(r.Context(), func(state *globalControlConfig) error {
		if state.Hash == "" {
			return controlFailure{http.StatusConflict, "Configure an admin PIN first."}
		}
		if err := verifyControlPIN(state, key.UserID.String(), req.PIN, api.Clock.Now()); err != nil {
			return err
		}
		var err error
		out, err = issueControlGrant(state, key, api.Clock.Now())
		return err
	})
	controlResponse(rw, r, out, err)
}

// @Summary Close the current session's global control panel
// @ID close-global-controls
// @Security CoderSessionToken
// @Tags Deployment
// @Produce json
// @Success 200 {object} codersdk.GlobalControlStatus
// @Router /api/v2/global-lockdown/controls/close [post]
func (api *API) closeGlobalControls(rw http.ResponseWriter, r *http.Request) {
	if !api.controlOwner(rw, r) {
		return
	}
	var out codersdk.GlobalControlStatus
	err := api.changeGlobalControls(r.Context(), func(state *globalControlConfig) error {
		delete(state.Grants, httpmw.APIKey(r).ID)
		out.Configured = state.Hash != ""
		return nil
	})
	controlResponse(rw, r, out, err)
}

func (api *API) requireGlobalControlGrant(rw http.ResponseWriter, r *http.Request, required bool) bool {
	if !api.controlOwner(rw, r) {
		return false
	}
	err := api.changeGlobalControls(r.Context(), func(state *globalControlConfig) error {
		if state.Hash == "" && !required {
			return nil
		}
		if !controlUnlocked(state, httpmw.APIKey(r), r.Header.Get(globalControlHeader), api.Clock.Now()) {
			return controlFailure{http.StatusForbidden, "Unlock the Global Command & Control panel first."}
		}
		return nil
	})
	if err != nil {
		controlResponse(rw, r, codersdk.GlobalControlStatus{}, err)
		return false
	}
	return true
}

// @Summary Submit reviewed global workspace power targets
// @ID global-workspace-power
// @Security CoderSessionToken
// @Tags Deployment
// @Accept json
// @Produce json
// @Param organization path string true "Organization ID"
// @Param request body map[string]interface{} true "Reviewed action, workspace_ids and confirmation"
// @Success 202 {object} map[string]interface{}
// @Router /api/v2/global-lockdown/organizations/{organization}/workspace-power [post]
func (api *API) globalControlPower(rw http.ResponseWriter, r *http.Request) {
	if !api.requireGlobalControlGrant(rw, r, true) {
		return
	}
	organization, err := uuid.Parse(chi.URLParam(r, "organization"))
	if err != nil {
		httpapi.Write(r.Context(), rw, http.StatusBadRequest, codersdk.Response{Message: "Invalid organization ID."})
		return
	}
	for _, route := range api.PlatformServiceRoutes {
		if route.PathPrefix != "/__coder-ui" {
			continue
		}
		forward := r.Clone(r.Context())
		copied := *r.URL
		forward.URL = &copied
		forward.URL.Path = "/__coder-ui/api/organizations/" + organization.String() + "/workspace-power"
		forward.URL.RawPath = ""
		forward.URL.RawQuery = ""
		forward.Header = r.Header.Clone()
		forward.Header.Del(globalControlHeader)
		platformServiceProxy(api.Logger, route.Target).ServeHTTP(rw, forward)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusServiceUnavailable, codersdk.Response{Message: "Workspace power service is not configured."})
}
