package workspaceapps

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/tracing"
	"github.com/coder/coder/v2/coderd/workspaceapps/appurl"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/websocket"
)

type cachedLockdownToken struct {
	SignedTokenProvider
	token *SignedToken
	t     *testing.T
}

func (p cachedLockdownToken) Issue(_ context.Context, _ http.ResponseWriter, _ *http.Request, req IssueTokenRequest) (*SignedToken, string, bool) {
	p.t.Errorf("cached ticket mismatch: token=%+v request=%+v", p.token.Request, req.AppRequest)
	return nil, "", false
}

func (p cachedLockdownToken) FromRequest(*http.Request) (*SignedToken, bool) {
	return p.token, true
}

func TestSessionGuardRejectsCachedTokens(t *testing.T) {
	t.Parallel()
	userID, agentID := uuid.New(), uuid.New()
	for _, method := range []AccessMethod{AccessMethodPath, AccessMethodSubdomain, AccessMethodTerminal} {
		t.Run(string(method), func(t *testing.T) {
			t.Parallel()
			base := &url.URL{Scheme: "http", Host: "coder.test"}
			token := &SignedToken{UserID: userID, AgentID: agentID, AppURL: "http://127.0.0.1:8080"}
			token.Request = Request{
				AccessMethod: method, BasePath: "/", UsernameOrID: "alice", WorkspaceNameOrID: "workspace",
				AppSlugOrPort: "editor",
			}
			hostname := "*--apps.coder.test"
			hostnameRegex, err := appurl.CompileHostnamePattern(hostname)
			require.NoError(t, err)
			guarded := false
			s := NewServer(ServerOptions{
				Logger: testutil.Logger(t), DashboardURL: base, AccessURL: base,
				Hostname: hostname, HostnameRegex: hostnameRegex, RealIPConfig: &httpmw.RealIPConfig{},
				SignedTokenProvider: cachedLockdownToken{token: token, t: t},
				GuardSession: func(ctx context.Context, id uuid.UUID) (context.Context, func(), error) {
					require.Equal(t, userID, id)
					guarded = true
					return ctx, nil, errors.New("locked")
				},
			})
			router := chi.NewRouter()
			router.Use(tracing.StatusWriterMiddleware)
			router.Use(tracing.Middleware(nil, tracing.DefaultRoutePatterns, "test"))
			s.Attach(router)
			var target string
			var handler http.Handler = router
			switch method {
			case AccessMethodPath:
				token.BasePath = "/@alice/workspace/apps/editor/"
				target = base.String() + token.BasePath
			case AccessMethodTerminal:
				token.Request = Request{AccessMethod: method, BasePath: "/api/v2/workspaceagents/" + agentID.String() + "/pty", AgentNameOrID: agentID.String()}
				target = base.String() + token.BasePath
			case AccessMethodSubdomain:
				app := appurl.ApplicationURL{AppSlugOrPort: "editor", WorkspaceName: "workspace", Username: "alice"}
				target = "http://" + app.String() + "--apps.coder.test/"
				handler = s.HandleSubdomain()(router)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
			require.True(t, guarded, "cached tickets must still pass through the session guard")
			require.Equal(t, http.StatusLocked, response.Code)
		})
	}
}

type lockdownProxyAgent struct{ AgentProvider }

func (lockdownProxyAgent) ReverseProxy(target, _ *url.URL, _ uuid.UUID, _ appurl.ApplicationURL, _ string) *httputil.ReverseProxy {
	return httputil.NewSingleHostReverseProxy(target)
}

func TestSessionGuardClosesActiveAppWebsocket(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	backendClosed := make(chan error, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(rw, r, nil)
		if err != nil {
			backendClosed <- err
			return
		}
		defer conn.CloseNow()
		_, _, err = conn.Read(r.Context())
		backendClosed <- err
	}))
	defer backend.Close()
	base, err := url.Parse(backend.URL)
	require.NoError(t, err)
	revocation := make(chan context.CancelFunc, 1)
	ended := make(chan struct{})
	s := NewServer(ServerOptions{
		Logger: testutil.Logger(t), DashboardURL: base, AccessURL: base,
		RealIPConfig: &httpmw.RealIPConfig{}, AgentProvider: lockdownProxyAgent{},
		GuardSession: func(ctx context.Context, _ uuid.UUID) (context.Context, func(), error) {
			guard, cancel := context.WithCancel(ctx)
			revocation <- cancel
			return guard, func() { cancel(); close(ended) }, nil
		},
	})
	token := SignedToken{UserID: uuid.New(), AgentID: uuid.New(), WorkspaceID: uuid.New(), AppURL: backend.URL,
		Request: Request{AccessMethod: AccessMethodPath, AppSlugOrPort: "editor"}}
	proxy := httptest.NewServer(httpmw.ExtractRealIP(&httpmw.RealIPConfig{})(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		s.proxyWorkspaceApp(rw, r, token, "/", appurl.ApplicationURL{})
	})))
	defer proxy.Close()
	conn, _, err := websocket.Dial(ctx, strings.Replace(proxy.URL, "http://", "ws://", 1), nil) //nolint:bodyclose
	require.NoError(t, err)
	defer conn.CloseNow()
	revoke := testutil.TryReceive(ctx, t, revocation)
	revoke()
	_, _, err = conn.Read(ctx)
	require.Error(t, err)
	_ = testutil.TryReceive(ctx, t, ended)
	require.Error(t, testutil.TryReceive(ctx, t, backendClosed))
}
