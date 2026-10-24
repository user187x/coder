package coderd_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestGlobalLockdownUserAvatarsAndOfflineAccounts(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	offline := dbgen.User(t, db, database.User{
		AvatarURL:  "https://example.com/avatar.png",
		Status:     database.UserStatusActive,
		LastSeenAt: time.Now().Add(-time.Hour),
	})
	state, err := client.GlobalLockdown(testutil.Context(t, testutil.WaitLong))
	require.NoError(t, err)
	var found bool
	for _, user := range state.Users {
		if user.ID == owner.UserID.String() {
			require.True(t, user.Connected, "the authenticated requester is connected")
		}
		if user.ID == offline.ID.String() {
			found = true
			require.Equal(t, offline.AvatarURL, user.AvatarURL)
			require.False(t, user.Connected)
		}
	}
	require.True(t, found, "offline active accounts remain visible in the administrator grid")
}

func TestGlobalLockdownAccess(t *testing.T) {
	t.Parallel()
	client := coderdtest.New(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	ctx := testutil.Context(t, testutil.WaitLong)
	status := func(err error) int {
		t.Helper()
		var sdkErr *codersdk.Error
		require.ErrorAs(t, err, &sdkErr)
		return sdkErr.StatusCode()
	}
	state, err := member.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.False(t, state.Enabled)
	require.False(t, state.Admin)
	require.Empty(t, state.Users)
	_, err = member.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	require.Error(t, err)
	require.Equal(t, http.StatusForbidden, status(err))
	_, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "Agree"})
	require.Error(t, err)
	require.Equal(t, http.StatusBadRequest, status(err))
	state, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	require.NoError(t, err)
	require.True(t, state.Enabled)
	require.True(t, state.Admin)
	require.NotEmpty(t, state.Revision)
	_, err = member.Workspaces(ctx, codersdk.WorkspaceFilter{})
	require.Error(t, err)
	require.Equal(t, http.StatusLocked, status(err))
	_, err = client.Workspaces(ctx, codersdk.WorkspaceFilter{})
	require.NoError(t, err)
	_, err = member.User(ctx, codersdk.Me)
	require.NoError(t, err, "dashboard identity and chat authentication must survive")
	state, err = member.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.True(t, state.Enabled)
	require.Empty(t, state.Users, "non-owners must not receive the user matrix")
	_, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: false})
	require.NoError(t, err)
	_, err = member.Workspaces(ctx, codersdk.WorkspaceFilter{})
	require.NoError(t, err)
}

func TestGlobalLockdownRejectsExternalWorkspaceProxies(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	coderdtest.CreateFirstUser(t, client)
	dbgen.WorkspaceProxy(t, db, database.WorkspaceProxy{Url: "https://proxy.example.com"})
	ctx := testutil.Context(t, testutil.WaitLong)
	_, err := client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	var sdkErr *codersdk.Error
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusConflict, sdkErr.StatusCode())
	state, err := client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.False(t, state.Enabled)
}

func TestGlobalLockdownClosesExistingWorkspaceWatch(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	member, user := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	workspace := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{
		OrganizationID: owner.OrganizationID, OwnerID: user.ID,
	}).Do().Workspace
	ctx := testutil.Context(t, testutil.WaitLong)
	updates, err := member.WatchWorkspace(ctx, workspace.ID)
	require.NoError(t, err)
	first := testutil.TryReceive(ctx, t, updates)
	require.Equal(t, workspace.ID, first.ID)
	_, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	require.NoError(t, err)
	for {
		select {
		case _, open := <-updates:
			if !open {
				return
			}
		case <-ctx.Done():
			t.Fatal("existing workspace watch survived lockdown")
		}
	}
}
