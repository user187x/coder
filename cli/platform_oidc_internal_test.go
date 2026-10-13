package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3/sloggers/slogtest"

	"github.com/coder/coder/v2/coderd/promoauth"
	"github.com/coder/coder/v2/testutil"
)

func TestKeycloakProviderConfig(t *testing.T) {
	t.Parallel()

	cfg, ok := keycloakProviderConfig("https://keycloak.example.com/realms/master")
	require.True(t, ok)
	require.Equal(t, "https://keycloak.example.com/realms/master", cfg.IssuerURL)
	require.Equal(t, "https://keycloak.example.com/realms/master/protocol/openid-connect/auth", cfg.AuthURL)
	require.Equal(t, "https://keycloak.example.com/realms/master/protocol/openid-connect/token", cfg.TokenURL)
	require.Equal(t, "https://keycloak.example.com/realms/master/protocol/openid-connect/certs", cfg.JWKSURL)

	// Keycloak behind a path prefix (the legacy /auth).
	cfg, ok = keycloakProviderConfig("https://sso.example.com/auth/realms/dev/")
	require.True(t, ok)
	require.Equal(t, "https://sso.example.com/auth/realms/dev/protocol/openid-connect/userinfo", cfg.UserInfoURL)

	for _, issuer := range []string{
		"https://accounts.google.com",
		"https://login.example.com/realms/",
		"https://example.com/tenant",
		"not a url",
	} {
		_, ok := keycloakProviderConfig(issuer)
		require.False(t, ok, issuer)
	}
}

// An issuer that is not up (a closed port): nothing answers.
func unreachableURL(t *testing.T) string {
	srv := httptest.NewServer(http.NotFoundHandler())
	u := srv.URL
	srv.Close()
	return u
}

func TestPlatformOIDCProvider(t *testing.T) {
	t.Parallel()
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

	t.Run("KeycloakUnreachable", func(t *testing.T) {
		t.Parallel()
		ctx := testutil.Context(t, testutil.WaitShort)
		issuer := unreachableURL(t) + "/realms/master"
		p, pkce, err := platformOIDCProvider(ctx, logger, issuer)
		require.NoError(t, err)
		require.Equal(t, issuer+"/protocol/openid-connect/token", p.Endpoint().TokenURL)
		require.Equal(t, []promoauth.Oauth2PKCEChallengeMethod{promoauth.PKCEChallengeMethodSha256}, pkce)
	})

	t.Run("OtherUnreachable", func(t *testing.T) {
		t.Parallel()
		ctx := testutil.Context(t, testutil.WaitShort)
		_, _, err := platformOIDCProvider(ctx, logger, unreachableURL(t))
		require.True(t, xerrors.Is(err, errOIDCUnreachable), err)
	})

	t.Run("Discovered", func(t *testing.T) {
		t.Parallel()
		ctx := testutil.Context(t, testutil.WaitShort)
		srv := discoveryServer(t)
		p, pkce, err := platformOIDCProvider(ctx, logger, srv.URL)
		require.NoError(t, err)
		require.Equal(t, srv.URL+"/token", p.Endpoint().TokenURL)
		require.Equal(t, []promoauth.Oauth2PKCEChallengeMethod{"S256", "plain"}, pkce)
	})
}

func TestWatchOIDCIssuer(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

	var up atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if !up.Load() {
			http.Error(rw, "starting", http.StatusServiceUnavailable)
			return
		}
		serveDiscovery(rw, r, "http://"+r.Host)
	}))
	t.Cleanup(srv.Close)

	restart := make(chan error, 1)
	go watchOIDCIssuer(ctx, logger, srv.Client(), srv.URL, 10*time.Millisecond, restart)
	select {
	case <-restart:
		t.Fatal("restarted while the issuer was down")
	case <-time.After(100 * time.Millisecond):
	}
	up.Store(true)
	select {
	case err := <-restart:
		require.ErrorContains(t, err, "OIDC issuer reachable")
	case <-ctx.Done():
		t.Fatal("no restart once the issuer answered")
	}
}

func discoveryServer(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		serveDiscovery(rw, r, "http://"+r.Host)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func serveDiscovery(rw http.ResponseWriter, _ *http.Request, issuer string) {
	rw.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(rw).Encode(map[string]any{
		"issuer":                           issuer,
		"authorization_endpoint":           issuer + "/auth",
		"token_endpoint":                   issuer + "/token",
		"jwks_uri":                         issuer + "/certs",
		"userinfo_endpoint":                issuer + "/userinfo",
		"code_challenge_methods_supported": []string{"S256", "plain"},
	})
}
