package coderd_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestDeleteTemplateVersion(t *testing.T) {
	t.Parallel()

	ownerClient := coderdtest.New(t, &coderdtest.Options{IncludeProvisionerDaemon: true})
	owner := coderdtest.CreateFirstUser(t, ownerClient)
	client, _ := coderdtest.CreateAnotherUser(t, ownerClient, owner.OrganizationID, rbac.RoleTemplateAdmin())
	member, _ := coderdtest.CreateAnotherUser(t, ownerClient, owner.OrganizationID)

	v1 := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, v1.ID)
	template := coderdtest.CreateTemplate(t, client, owner.OrganizationID, v1.ID)
	newVersion := func() codersdk.TemplateVersion {
		v := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil, func(req *codersdk.CreateTemplateVersionRequest) {
			req.TemplateID = template.ID
		})
		coderdtest.AwaitTemplateVersionJobCompleted(t, client, v.ID)
		return v
	}
	v2 := newVersion()
	unused := newVersion()

	ctx := testutil.Context(t, testutil.WaitLong)
	status := func(err error) int {
		var sdkErr *codersdk.Error
		require.ErrorAs(t, err, &sdkErr)
		return sdkErr.StatusCode()
	}

	// The active version stays.
	require.Equal(t, http.StatusBadRequest, status(client.DeleteTemplateVersion(ctx, v1.ID)))

	// A workspace runs v1; v2 becomes active: v1 stays while the workspace is on it.
	workspace := coderdtest.CreateWorkspace(t, client, template.ID)
	coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, workspace.LatestBuild.ID)
	require.NoError(t, client.UpdateActiveTemplateVersion(ctx, template.ID, codersdk.UpdateActiveTemplateVersion{ID: v2.ID}))
	err := client.DeleteTemplateVersion(ctx, v1.ID)
	require.Equal(t, http.StatusBadRequest, status(err))
	require.ErrorContains(t, err, "1 workspace(s) run this version")

	// A member may not delete versions.
	require.Equal(t, http.StatusNotFound, status(member.DeleteTemplateVersion(ctx, unused.ID)))

	// An unused version goes for good.
	require.NoError(t, client.DeleteTemplateVersion(ctx, unused.ID))
	_, err = client.TemplateVersion(ctx, unused.ID)
	require.Equal(t, http.StatusNotFound, status(err))

	// The workspace updated to v2: v1 goes, with the build that used it in the workspace's history.
	build := coderdtest.CreateWorkspaceBuild(t, client, workspace, "start", func(req *codersdk.CreateWorkspaceBuildRequest) {
		req.TemplateVersionID = v2.ID
	})
	coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, build.ID)
	require.NoError(t, client.DeleteTemplateVersion(ctx, v1.ID))
	versions, err := client.TemplateVersionsByTemplate(ctx, codersdk.TemplateVersionsByTemplateRequest{TemplateID: template.ID})
	require.NoError(t, err)
	ids := make([]uuid.UUID, 0, len(versions))
	for _, v := range versions {
		ids = append(ids, v.ID)
	}
	require.Equal(t, []uuid.UUID{v2.ID}, ids)
	got, err := client.Workspace(ctx, workspace.ID)
	require.NoError(t, err)
	require.Equal(t, v2.ID, got.LatestBuild.TemplateVersionID)
}
