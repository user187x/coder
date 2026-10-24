package coderd_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/coder/v2/testutil"
)

func TestWorkspaceAgentTunnelIdentity(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	r := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{
		OrganizationID: owner.OrganizationID, OwnerID: owner.UserID,
	}).WithAgent().Do()
	ctx := testutil.Context(t, testutil.WaitLong)
	for _, token := range []string{"", uuid.NewString(), client.SessionToken()} {
		unauthorized := codersdk.New(client.URL)
		unauthorized.SetSessionToken(token)
		response, err := unauthorized.Request(ctx, http.MethodGet, "/api/v2/workspaceagents/me/tunnel-identity", nil)
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, response.StatusCode)
		require.NoError(t, response.Body.Close())
	}
	agent := codersdk.New(client.URL)
	agent.SetSessionToken(r.AgentToken)
	response, err := agent.Request(ctx, http.MethodGet, "/api/v2/workspaceagents/me/tunnel-identity", nil)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	var identity agentsdk.TunnelIdentity
	require.NoError(t, json.NewDecoder(response.Body).Decode(&identity))
	require.Equal(t, r.Agents[0].ID, identity.AgentID)
	require.Equal(t, r.Workspace.ID, identity.WorkspaceID)
	require.Equal(t, owner.OrganizationID, identity.OrganizationID)

	dbfake.WorkspaceBuild(t, db, r.Workspace).Seed(database.WorkspaceBuild{BuildNumber: 2}).WithAgent().Do()
	stale, err := agent.Request(ctx, http.MethodGet, "/api/v2/workspaceagents/me/tunnel-identity", nil)
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, stale.StatusCode)
	require.NoError(t, stale.Body.Close())
}
