package coderd_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

// The platform's template access list: only the users on it see the template
// and create workspaces from it; its editors always do; none: everyone.
func TestTemplateAccessList(t *testing.T) {
	t.Parallel()

	client := coderdtest.New(t, &coderdtest.Options{IncludeProvisionerDaemon: true})
	owner := coderdtest.CreateFirstUser(t, client)
	member, memberUser := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	other, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	templateAdmin, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID, rbac.RoleTemplateAdmin())
	version := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
	template := coderdtest.CreateTemplate(t, client, owner.OrganizationID, version.ID)

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitLong)
	defer cancel()

	sees := func(c *codersdk.Client) bool {
		t.Helper()
		list, err := c.Templates(ctx, codersdk.TemplateFilter{})
		require.NoError(t, err)
		listed := false
		for _, tpl := range list {
			listed = listed || tpl.ID == template.ID
		}
		_, byID := c.Template(ctx, template.ID)
		_, byName := c.TemplateByName(ctx, owner.OrganizationID, template.Name)
		require.Equal(t, listed, byID == nil, "listed and readable by its ID alike")
		require.Equal(t, listed, byName == nil, "listed and readable by its name alike")
		return listed
	}
	creates := func(c *codersdk.Client) error {
		t.Helper()
		_, err := c.CreateUserWorkspace(ctx, codersdk.Me, codersdk.CreateWorkspaceRequest{
			TemplateID: template.ID,
			Name:       "ws-" + uuid.NewString()[:8],
		})
		return err
	}

	// No list: everyone.
	got, err := client.TemplateAccessList(ctx, template.ID)
	require.NoError(t, err)
	require.Empty(t, got.UserIDs)
	require.True(t, sees(member))
	require.True(t, sees(other))

	// Only the member: the other user no longer sees it, nor creates from it; its editors do.
	got, err = templateAdmin.SetTemplateAccessList(ctx, template.ID, codersdk.TemplateAccessList{UserIDs: []uuid.UUID{memberUser.ID}})
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{memberUser.ID}, got.UserIDs)
	require.True(t, sees(member))
	require.False(t, sees(other))
	require.NoError(t, creates(member))
	err = creates(other)
	var sdkErr *codersdk.Error
	require.ErrorAs(t, err, &sdkErr)
	require.Contains(t, []int{http.StatusForbidden, http.StatusNotFound}, sdkErr.StatusCode())
	require.True(t, sees(client))
	require.True(t, sees(templateAdmin))
	require.NoError(t, creates(client))

	// Neither user may read or set the list.
	_, err = member.TemplateAccessList(ctx, template.ID)
	require.Error(t, err)
	_, err = member.SetTemplateAccessList(ctx, template.ID, codersdk.TemplateAccessList{})
	require.Error(t, err)
	// Unknown users are refused.
	_, err = client.SetTemplateAccessList(ctx, template.ID, codersdk.TemplateAccessList{UserIDs: []uuid.UUID{uuid.New()}})
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusBadRequest, sdkErr.StatusCode())

	// Cleared: everyone again.
	got, err = client.SetTemplateAccessList(ctx, template.ID, codersdk.TemplateAccessList{})
	require.NoError(t, err)
	require.Empty(t, got.UserIDs)
	require.True(t, sees(other))
	require.NoError(t, creates(other))
}
