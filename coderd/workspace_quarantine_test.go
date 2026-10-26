package coderd_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceQuarantinePolicyAndStart(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	first := coderdtest.CreateFirstUser(t, client)
	member, user := coderdtest.CreateAnotherUser(t, client, first.OrganizationID)
	fixture := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: first.OrganizationID, OwnerID: user.ID}).Seed(database.WorkspaceBuild{Transition: database.WorkspaceTransitionStop}).Do()
	workspace := fixture.Workspace
	ctx := testutil.Context(t, testutil.WaitLong)
	code := func(err error) int {
		t.Helper()
		var e *codersdk.Error
		require.ErrorAs(t, err, &e)
		return e.StatusCode()
	}
	initial, err := member.WorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID)
	require.NoError(t, err)
	require.False(t, initial.Enabled)
	require.False(t, initial.ManualStartRequired)
	_, err = member.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true, Reason: "suspicious activity"})
	require.Equal(t, http.StatusForbidden, code(err))
	_, err = client.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true})
	require.Equal(t, http.StatusBadRequest, code(err))
	active, err := client.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true, Reason: "suspicious activity"})
	require.NoError(t, err)
	require.True(t, active.Enabled)
	require.True(t, active.ManualStartRequired)
	require.NotEqual(t, uuid.Nil, active.Revision)
	again, err := client.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true, Reason: "repeat"})
	require.NoError(t, err)
	require.Equal(t, active.Revision, again.Revision)
	_, err = member.Workspace(ctx, workspace.ID)
	require.NoError(t, err, "dashboard metadata stays readable")
	_, err = member.User(ctx, codersdk.Me)
	require.NoError(t, err, "account login stays available")
	_, err = client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart})
	require.Equal(t, http.StatusLocked, code(err), "owners have no containment exemption")
	err = client.UpdateWorkspaceBuildState(ctx, fixture.Build.ID, []byte("replacement is blocked"))
	require.Equal(t, http.StatusLocked, code(err))
	_, err = member.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionDelete})
	require.Equal(t, http.StatusLocked, code(err))
	org := dbgen.Organization(t, db, database.Organization{})
	_, err = client.WorkspaceQuarantine(ctx, org.ID, workspace.ID)
	require.Equal(t, http.StatusNotFound, code(err))
	_, err = client.UpdateWorkspaceQuarantine(ctx, org.ID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: false})
	require.Equal(t, http.StatusNotFound, code(err))
	released, err := client.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: false, Reason: "reviewed"})
	require.NoError(t, err)
	require.False(t, released.Enabled)
	require.True(t, released.ManualStartRequired)
	require.NotEqual(t, active.Revision, released.Revision)
	_, err = member.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart})
	require.Equal(t, http.StatusConflict, code(err), "manual Start must wait for durable release preparation")
	count, err := db.PrepareWorkspaceQuarantineRelease(dbauthz.AsSystemRestricted(ctx), database.PrepareWorkspaceQuarantineReleaseParams{WorkspaceID: workspace.ID, OrganizationID: first.OrganizationID, Revision: uuid.New()})
	require.NoError(t, err)
	require.Zero(t, count, "stale revision cannot acknowledge release")
	count, err = db.PrepareWorkspaceQuarantineRelease(dbauthz.AsSystemRestricted(ctx), database.PrepareWorkspaceQuarantineReleaseParams{WorkspaceID: workspace.ID, OrganizationID: first.OrganizationID, Revision: released.Revision})
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	current, err := db.GetLatestWorkspaceBuildByWorkspaceID(dbauthz.AsSystemRestricted(ctx), workspace.ID)
	require.NoError(t, err)
	require.Equal(t, fixture.Build.ID, current.ID, "release created no build")
	_, err = member.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, TemplateVersionID: uuid.New()})
	require.Error(t, err)
	row, err := db.GetWorkspaceQuarantineByWorkspaceID(dbauthz.AsSystemRestricted(ctx), workspace.ID)
	require.NoError(t, err)
	require.True(t, row.ManualStartRequired, "failed Start rolls back latch consumption")
	_, err = member.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart})
	require.NoError(t, err)
	row, err = db.GetWorkspaceQuarantineByWorkspaceID(dbauthz.AsSystemRestricted(ctx), workspace.ID)
	require.NoError(t, err)
	require.False(t, row.ManualStartRequired)
	_, err = client.UpdateWorkspaceQuarantine(ctx, first.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: false})
	require.NoError(t, err)
	row, err = db.GetWorkspaceQuarantineByWorkspaceID(dbauthz.AsSystemRestricted(ctx), workspace.ID)
	require.NoError(t, err)
	require.False(t, row.ManualStartRequired, "repeated release cannot re-latch a started workspace")
}

func TestWorkspaceQuarantineRejectsReadonlyOwnerToken(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	workspace := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: owner.OrganizationID, OwnerID: owner.UserID}).Do().Workspace
	ctx := testutil.Context(t, testutil.WaitLong)
	token, err := client.CreateToken(ctx, codersdk.Me, codersdk.CreateTokenRequest{TokenName: uuid.NewString(), Lifetime: time.Hour, Scopes: []codersdk.APIKeyScope{codersdk.APIKeyScopeWorkspaceRead, codersdk.APIKeyScopeOrganizationRead}})
	require.NoError(t, err)
	limited := codersdk.New(client.URL)
	limited.SetSessionToken(token.Key)
	_, err = limited.WorkspaceQuarantine(ctx, owner.OrganizationID, workspace.ID)
	require.NoError(t, err)
	_, err = limited.UpdateWorkspaceQuarantine(ctx, owner.OrganizationID, workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true, Reason: "not permitted"})
	var sdkErr *codersdk.Error
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusForbidden, sdkErr.StatusCode())
}

func TestWorkspaceQuarantineCancelsCapturedStartAndDelete(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	ctx := testutil.Context(t, testutil.WaitLong)
	for _, tc := range []struct {
		name       string
		transition database.WorkspaceTransition
		running    bool
	}{
		{"pending-start", database.WorkspaceTransitionStart, false}, {"running-start", database.WorkspaceTransitionStart, true},
		{"pending-delete", database.WorkspaceTransitionDelete, false}, {"running-delete", database.WorkspaceTransitionDelete, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			builder := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: owner.OrganizationID, OwnerID: owner.UserID}).Seed(database.WorkspaceBuild{Transition: tc.transition})
			if tc.running {
				builder = builder.Starting()
			} else {
				builder = builder.Pending()
			}
			fixture := builder.Do()
			policy, err := client.UpdateWorkspaceQuarantine(ctx, owner.OrganizationID, fixture.Workspace.ID, codersdk.UpdateWorkspaceQuarantineRequest{Enabled: true, Reason: "contain in-flight build"})
			require.NoError(t, err)
			require.True(t, policy.Enabled)
			job, err := db.GetProvisionerJobByID(dbauthz.AsSystemRestricted(ctx), fixture.Build.JobID)
			require.NoError(t, err)
			require.True(t, job.CanceledAt.Valid)
			require.Equal(t, !tc.running, job.CompletedAt.Valid, "a running worker must acknowledge completion")
		})
	}
}
