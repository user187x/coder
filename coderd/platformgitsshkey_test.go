package coderd_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/coder/v2/provisioner/echo"
	"github.com/coder/coder/v2/testutil"
)

// Platform: a user's own private key (from their PKCS#12 certificate) as their Git SSH key.
func TestImportGitSSHKey(t *testing.T) {
	t.Parallel()

	client := coderdtest.New(t, &coderdtest.Options{IncludeProvisionerDaemon: true})
	owner := coderdtest.CreateFirstUser(t, client)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	keyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	public, err := ssh.NewPublicKey(&key.PublicKey)
	require.NoError(t, err)
	wantPublic := string(ssh.MarshalAuthorizedKey(public))

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitLong)
	defer cancel()

	t.Run("Imported", func(t *testing.T) {
		got, err := member.ImportGitSSHKey(ctx, codersdk.Me, codersdk.ImportGitSSHKeyRequest{PrivateKey: keyPEM})
		require.NoError(t, err)
		require.Equal(t, wantPublic, got.PublicKey)
		stored, err := member.GitSSHKey(ctx, codersdk.Me)
		require.NoError(t, err)
		require.Equal(t, wantPublic, stored.PublicKey)
	})

	t.Run("WorkspacesUseIt", func(t *testing.T) {
		authToken := uuid.NewString()
		version := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, &echo.Responses{
			Parse:          echo.ParseComplete,
			ProvisionPlan:  echo.PlanComplete,
			ProvisionGraph: echo.ProvisionGraphWithAgent(authToken),
		})
		template := coderdtest.CreateTemplate(t, client, owner.OrganizationID, version.ID)
		coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
		workspace := coderdtest.CreateWorkspace(t, member, template.ID)
		coderdtest.AwaitWorkspaceBuildJobCompleted(t, member, workspace.LatestBuild.ID)

		agentKey, err := agentsdk.New(client.URL, agentsdk.WithFixedToken(authToken)).GitSSHKey(ctx)
		require.NoError(t, err)
		signer, err := ssh.ParsePrivateKey([]byte(agentKey.PrivateKey))
		require.NoError(t, err)
		require.Equal(t, wantPublic, string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
	})

	t.Run("BadKey", func(t *testing.T) {
		_, err := member.ImportGitSSHKey(ctx, codersdk.Me, codersdk.ImportGitSSHKeyRequest{PrivateKey: "not a key"})
		var sdkErr *codersdk.Error
		require.ErrorAs(t, err, &sdkErr)
		require.Equal(t, http.StatusBadRequest, sdkErr.StatusCode())
		require.NotContains(t, sdkErr.Error(), "not a key")
	})

	t.Run("NotForOthers", func(t *testing.T) {
		_, err := member.ImportGitSSHKey(ctx, owner.UserID.String(), codersdk.ImportGitSSHKeyRequest{PrivateKey: keyPEM})
		require.Error(t, err)
	})
}
