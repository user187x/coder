package coderd_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/golang-jwt/jwt/v4"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/coderdtest/oidctest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

// Platform: with PlatformFirstOwnerByBootstrap, nobody becomes the owner by signing in with OIDC first: the sign-in
// is refused until the first user (the installer's owner) exists, and then works as an ordinary sign-up.
func TestPlatformFirstOwnerByBootstrap(t *testing.T) {
	t.Parallel()

	fake := oidctest.NewFakeIDP(t, oidctest.WithServing())
	cfg := fake.OIDCConfig(t, nil, func(cfg *coderd.OIDCConfig) {
		cfg.AllowSignups = true
	})
	client := coderdtest.New(t, &coderdtest.Options{OIDCConfig: cfg, PlatformFirstOwnerByBootstrap: true})
	claims := jwt.MapClaims{"sub": "first-sub", "email": "first@example.com", "email_verified": true, "preferred_username": "first"}

	_, resp := fake.AttemptLogin(t, client, claims)
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusServiceUnavailable, resp.StatusCode, string(body))

	owner := coderdtest.CreateFirstUser(t, client)
	require.NotEmpty(t, owner.UserID)

	member, resp := fake.AttemptLogin(t, client, claims)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	ctx := testutil.Context(t, testutil.WaitShort)
	me, err := member.User(ctx, codersdk.Me)
	require.NoError(t, err)
	for _, r := range me.Roles {
		require.NotEqual(t, codersdk.RoleOwner, r.Name, "an OIDC sign-in after the bootstrap is not an owner")
	}
}
