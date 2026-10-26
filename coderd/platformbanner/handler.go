package platformbanner

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
)

// Admin is the caller of an admin call, as coderd authenticated them.
type Admin struct {
	Username string   `json:"username"`
	Email    string   `json:"email"`
	Roles    []string `json:"roles"`
}

// Errors an Authorizer returns; anything else is "Coder cannot tell" (503).
var (
	ErrUnauthenticated = xerrors.New("no session")
	ErrForbidden       = xerrors.New("not an admin")
)

// Authorizer tells who calls an admin call and whether they may change the
// banner (coderd: a session, and the right to edit the deployment's
// settings - the dashboard's own gate for its Announcement page).
type Authorizer func(r *http.Request) (Admin, error)

// csrfHeader is what the dashboard's banner client sends with every change.
const csrfHeader, csrfValue = "X-Requested-With", "coder-banner-admin"

// maxBody bounds an admin's payload (a 4000-character message in any script
// fits).
const maxBody = 64 << 10

// Handler serves /__banner.
type Handler struct {
	Store     *Store
	Hub       *Hub
	Authorize Authorizer
	Viewer    func(*http.Request) string
	Logger    slog.Logger
}

// Routes mounts the banner's paths on r (at /__banner).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/banner.json", h.serveBanner)
	r.Get("/live", h.Hub.ServeHTTP)
	r.Get("/api/state", h.serveState)
	r.Post("/api/banner", h.change(h.save))
	r.Post("/api/reappear", h.change(h.reappear))
	r.Post("/api/reset", h.change(h.reset))
	// the banner service's loader, its admin page and their files are gone:
	// the dashboard draws and edits the banner itself
	r.NotFound(func(rw http.ResponseWriter, _ *http.Request) {
		http.Error(rw, "not found", http.StatusNotFound)
	})
}

func (h *Handler) serveBanner(rw http.ResponseWriter, r *http.Request) {
	st, err := h.Store.Load(r.Context())
	if err != nil {
		h.Logger.Warn(r.Context(), "read the published banner", slog.Error(err))
		writeError(rw, http.StatusServiceUnavailable, "The banner is unavailable.")
		return
	}
	rw.Header().Set("Cache-Control", "no-store")
	viewer := ""
	if h.Viewer != nil {
		viewer = h.Viewer(r)
	}
	writeJSON(rw, http.StatusOK, st.Banner().ForViewer(viewer))
}

// summary is GET /api/state's answer (and every change's).
type summary struct {
	User           Admin   `json:"user"`
	Banner         Banner  `json:"banner"`
	OverrideActive bool    `json:"overrideActive"`
	Defaults       Fields  `json:"defaults"`
	Revision       int64   `json:"revision"`
	UpdatedBy      *string `json:"updatedBy"`
	UpdatedAt      *string `json:"updatedAt"`
	Subscribers    int     `json:"subscribers"`
	Delivered      *int    `json:"delivered,omitempty"`
}

func (h *Handler) summary(admin Admin, st State) summary {
	return summary{
		User:           admin,
		Banner:         st.Banner(),
		OverrideActive: st.Override != nil,
		Defaults:       Defaults(),
		Revision:       st.Revision,
		UpdatedBy:      st.UpdatedBy,
		UpdatedAt:      st.UpdatedAt,
		Subscribers:    h.Hub.Subscribers(),
	}
}

// Without a session, a read asks to sign in and a change says the session
// expired (the banner service's words; the dashboard words 401 itself).
const (
	signInFirst    = "Sign in to Coder first."
	sessionExpired = "Your Coder session has expired. Sign in again."
)

// admin authorizes an admin call, or answers it with the banner service's
// errors: noSession for a missing session.
func (h *Handler) admin(rw http.ResponseWriter, r *http.Request, noSession string) (Admin, bool) {
	a, err := h.Authorize(r)
	switch {
	case err == nil:
		return a, true
	case errors.Is(err, ErrUnauthenticated):
		writeError(rw, http.StatusUnauthorized, noSession)
	case errors.Is(err, ErrForbidden):
		writeError(rw, http.StatusForbidden, "Only Coder admins can change the banner.")
	default:
		h.Logger.Warn(r.Context(), "authorize a banner admin call", slog.Error(err))
		writeError(rw, http.StatusServiceUnavailable, "Coder could not check your session. Try again shortly.")
	}
	return Admin{}, false
}

func (h *Handler) serveState(rw http.ResponseWriter, r *http.Request) {
	a, ok := h.admin(rw, r, signInFirst)
	if !ok {
		return
	}
	st, err := h.Store.Load(r.Context())
	if err != nil {
		writeError(rw, http.StatusServiceUnavailable, "The banner is unavailable.")
		return
	}
	writeAdminJSON(rw, http.StatusOK, h.summary(a, st))
}

// change wraps a POST: the cross-site checks, the admin, the body (JSON), the
// action; then the summary, with how many of this replica's tabs got it now.
func (h *Handler) change(action func(r *http.Request, a Admin, body []byte) (State, error)) http.HandlerFunc {
	return func(rw http.ResponseWriter, r *http.Request) {
		if !sameSite(r) {
			writeError(rw, http.StatusForbidden, "Request rejected (cross-site protection).")
			return
		}
		a, ok := h.admin(rw, r, sessionExpired)
		if !ok {
			return
		}
		if r.ContentLength > maxBody {
			writeError(rw, http.StatusRequestEntityTooLarge, "Request too large.")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil || len(body) > maxBody {
			writeError(rw, http.StatusRequestEntityTooLarge, "Request too large.")
			return
		}
		if !json.Valid(body) {
			writeError(rw, http.StatusBadRequest, "Invalid JSON.")
			return
		}
		st, err := action(r, a, body)
		var invalid ValidationError
		switch {
		case errors.As(err, &invalid):
			writeError(rw, http.StatusBadRequest, invalid.Error())
			return
		case err != nil:
			h.Logger.Error(r.Context(), "save the published banner", slog.Error(err))
			writeError(rw, http.StatusInternalServerError, "Could not save the banner. Check Coder's logs.")
			return
		}
		h.Logger.Info(r.Context(), "announcement banner changed", slog.F("user", a.Username), slog.F("path", r.URL.Path),
			slog.F("enabled", st.Banner().Enabled), slog.F("id", st.Banner().ID))
		delivered := h.Hub.Broadcast(st.Banner())
		s := h.summary(a, st)
		s.Delivered = &delivered
		writeAdminJSON(rw, http.StatusOK, s)
	}
}

func (h *Handler) save(r *http.Request, a Admin, body []byte) (State, error) {
	f, err := Clean(body)
	if err != nil {
		return State{}, err
	}
	return h.Store.Save(r.Context(), f, a.Username)
}

func (h *Handler) reappear(r *http.Request, a Admin, _ []byte) (State, error) {
	return h.Store.Reappear(r.Context(), a.Username)
}

func (h *Handler) reset(r *http.Request, a Admin, _ []byte) (State, error) {
	return h.Store.Reset(r.Context(), a.Username)
}

// sameSite: the dashboard's own request - its header (a cross-site form
// cannot set one), JSON, and an Origin (when sent) and Sec-Fetch-Site of this
// site.
func sameSite(r *http.Request) bool {
	if r.Header.Get(csrfHeader) != csrfValue {
		return false
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host {
			return false
		}
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
		return true
	}
	return false
}

func writeJSON(rw http.ResponseWriter, status int, v any) {
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(status)
	_ = json.NewEncoder(rw).Encode(v)
}

// writeAdminJSON adds the headers the banner service sent with every admin
// answer.
func writeAdminJSON(rw http.ResponseWriter, status int, v any) {
	rw.Header().Set("Cache-Control", "no-store")
	rw.Header().Set("X-Content-Type-Options", "nosniff")
	rw.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(rw, status, v)
}

func writeError(rw http.ResponseWriter, status int, msg string) {
	writeAdminJSON(rw, status, map[string]string{"error": msg})
}
