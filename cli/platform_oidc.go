package cli

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"

	"github.com/coder/coder/v2/coderd/promoauth"
)

// Platform: the server must start, and password sign-in work, before the identity provider (Keycloak on the
// air-gapped platform) is up or reachable. Upstream discovers the issuer at startup and exits when it cannot.

// errOIDCUnreachable: the issuer could not be discovered, and its endpoints are not known without discovery.
var errOIDCUnreachable = xerrors.New("oidc issuer unreachable")

// oidcUnreachableError is errOIDCUnreachable with the discovery error that caused it.
type oidcUnreachableError struct{ err error }

func (e oidcUnreachableError) Error() string {
	return errOIDCUnreachable.Error() + ": " + e.err.Error()
}
func (e oidcUnreachableError) Unwrap() error      { return e.err }
func (oidcUnreachableError) Is(target error) bool { return target == errOIDCUnreachable }

// keycloakProviderConfig gives a Keycloak realm's endpoints without discovery. They are fixed by Keycloak
// ("<issuer>/protocol/openid-connect/..."), so sign-in works as soon as Keycloak answers. ok is false for an issuer
// that is not a Keycloak realm ("<base>/realms/<realm>").
func keycloakProviderConfig(issuer string) (oidc.ProviderConfig, bool) {
	u, err := url.Parse(issuer)
	if err != nil || u.Host == "" {
		return oidc.ProviderConfig{}, false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[len(parts)-2] != "realms" || parts[len(parts)-1] == "" {
		return oidc.ProviderConfig{}, false
	}
	base := strings.TrimSuffix(issuer, "/") + "/protocol/openid-connect"
	return oidc.ProviderConfig{
		IssuerURL:     issuer,
		AuthURL:       base + "/auth",
		TokenURL:      base + "/token",
		DeviceAuthURL: base + "/auth/device",
		UserInfoURL:   base + "/userinfo",
		JWKSURL:       base + "/certs",
		Algorithms:    []string{oidc.RS256},
	}, true
}

// platformOIDCProvider discovers the issuer, and when that fails falls back to a Keycloak realm's fixed endpoints.
// It returns the PKCE methods the provider supports (those of a Keycloak realm on the fallback), and
// errOIDCUnreachable (wrapped) when neither works.
func platformOIDCProvider(ctx context.Context, logger slog.Logger, issuer string) (*oidc.Provider, []promoauth.Oauth2PKCEChallengeMethod, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err == nil {
		var pkce struct {
			CodeChallengeMethodsSupported []promoauth.Oauth2PKCEChallengeMethod `json:"code_challenge_methods_supported"`
		}
		if err := provider.Claims(&pkce); err != nil {
			return nil, nil, xerrors.Errorf("pkce detect in claims: %w", err)
		}
		return provider, pkce.CodeChallengeMethodsSupported, nil
	}
	cfg, ok := keycloakProviderConfig(issuer)
	if !ok {
		return nil, nil, oidcUnreachableError{err: err}
	}
	logger.Warn(ctx, "the OIDC issuer could not be discovered: using a Keycloak realm's standard endpoints, so password "+
		"sign-in works now and OIDC sign-in as soon as the issuer answers",
		slog.F("issuer", issuer), slog.Error(err))
	return cfg.NewProvider(ctx), []promoauth.Oauth2PKCEChallengeMethod{promoauth.PKCEChallengeMethodSha256}, nil
}

// watchOIDCIssuer checks every interval whether the issuer can be discovered now, and then sends on restart once,
// so the server restarts (Kubernetes starts it again) with OIDC sign-in configured. Used when the server started
// without OIDC because the issuer was unreachable.
func watchOIDCIssuer(ctx context.Context, logger slog.Logger, client *http.Client, issuer string, interval time.Duration, restart chan<- error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		dctx, cancel := context.WithTimeout(oidc.ClientContext(ctx, client), 15*time.Second)
		_, err := oidc.NewProvider(dctx, issuer)
		cancel()
		if err != nil {
			logger.Debug(ctx, "OIDC issuer still unreachable", slog.F("issuer", issuer), slog.Error(err))
			continue
		}
		logger.Info(ctx, "the OIDC issuer answers now: restarting the server to enable OIDC sign-in", slog.F("issuer", issuer))
		select {
		case restart <- xerrors.New("OIDC issuer reachable: restarting to enable OIDC sign-in"):
		default:
		}
		return
	}
}
