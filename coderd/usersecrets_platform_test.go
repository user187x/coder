package coderd_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestUserCertificateFile(t *testing.T) {
	t.Parallel()

	ownerClient := coderdtest.New(t, nil)
	owner := coderdtest.CreateFirstUser(t, ownerClient)
	alice, aliceUser := coderdtest.CreateAnotherUser(t, ownerClient, owner.OrganizationID)
	bob, _ := coderdtest.CreateAnotherUser(t, ownerClient, owner.OrganizationID)
	ctx := testutil.Context(t, testutil.WaitMedium)

	_, err := alice.CreateUserSecret(ctx, codersdk.Me, codersdk.CreateUserSecretRequest{
		Name:     "certificate-alice",
		Value:    "MIIP12base64==",
		FilePath: "~/.cert/." + aliceUser.Username + ".p12.b64",
	})
	require.NoError(t, err)
	_, err = alice.CreateUserSecret(ctx, codersdk.Me, codersdk.CreateUserSecretRequest{
		Name:    "api-token",
		Value:   "not-a-certificate",
		EnvName: "API_TOKEN",
	})
	require.NoError(t, err)

	status := func(err error) int {
		var sdkErr *codersdk.Error
		require.ErrorAs(t, err, &sdkErr)
		return sdkErr.StatusCode()
	}

	// Alice gets her own certificate file back.
	file, err := alice.UserCertificateFile(ctx, codersdk.Me, "certificate-alice")
	require.NoError(t, err)
	require.Equal(t, "MIIP12base64==", file.Base64)

	// Never another secret of hers.
	_, err = alice.UserCertificateFile(ctx, codersdk.Me, "api-token")
	require.Equal(t, http.StatusBadRequest, status(err))

	// Nobody else: not another user, not an admin.
	_, err = bob.UserCertificateFile(ctx, aliceUser.ID.String(), "certificate-alice")
	require.Equal(t, http.StatusNotFound, status(err))
	_, err = ownerClient.UserCertificateFile(ctx, aliceUser.ID.String(), "certificate-alice")
	require.Equal(t, http.StatusNotFound, status(err))
}
