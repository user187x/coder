package coderd_test

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"cdr.dev/slog/v3"
	"cdr.dev/slog/v3/sloggers/slogtest"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agenttest"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/coder/v2/codersdk/workspacesdk"
	"github.com/coder/coder/v2/testutil"
)

func TestGlobalLockdownLegacyAgentRequiresAcknowledgement(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	r := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: owner.OrganizationID, OwnerID: owner.UserID}).WithAgent().Do()
	ctx := testutil.Context(t, testutil.WaitLong)
	agentID := r.Agents[0].ID
	now := time.Now()
	require.NoError(t, db.UpdateWorkspaceAgentConnectionByID(dbauthz.AsSystemRestricted(ctx), database.UpdateWorkspaceAgentConnectionByIDParams{
		ID: agentID, FirstConnectedAt: sql.NullTime{Time: now, Valid: true}, LastConnectedAt: sql.NullTime{Time: now, Valid: true}, DisconnectedAt: sql.NullTime{Time: now, Valid: true}, UpdatedAt: now,
	}))
	_, err := client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	require.NoError(t, err)
	state, err := client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.False(t, state.Confirmed, "losing the agent control connection is not revocation proof")
	require.Equal(t, 1, state.AgentsPending)
	require.Equal(t, "update_required", state.Agents[0].State)
	require.Contains(t, state.Agents[0].Name, r.Workspace.Name)
	agent := agentsdk.New(client.URL, agentsdk.WithFixedToken(r.AgentToken))
	control, err := agent.ConnectRPCWithRole(ctx, "agent")
	require.NoError(t, err)
	defer control.Close()
	policy, err := agent.SyncWorkspaceAccess(ctx, agentsdk.SyncWorkspaceAccessRequest{})
	require.NoError(t, err)
	state, err = client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.Equal(t, "waiting", state.Agents[0].State)
	_, err = agent.SyncWorkspaceAccess(ctx, agentsdk.SyncWorkspaceAccessRequest{AppliedPolicy: "stale-policy"})
	require.NoError(t, err)
	state, err = client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.False(t, state.Confirmed)
	_, err = agent.SyncWorkspaceAccess(ctx, agentsdk.SyncWorkspaceAccessRequest{AppliedPolicy: policy.Fingerprint})
	require.NoError(t, err)
	state, err = client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.True(t, state.Confirmed)
	require.Equal(t, 0, state.AgentsPending)
	// Successful stop/rebuild lifecycle cleanup retires old agents; there is
	// no impossible upgrade requirement for their already-destroyed maps.
	require.NoError(t, db.SoftDeletePriorWorkspaceAgents(dbauthz.AsSystemRestricted(ctx), database.SoftDeletePriorWorkspaceAgentsParams{
		WorkspaceID: r.Workspace.ID, CurrentBuildID: uuid.New(),
	}))
	state, err = client.GlobalLockdown(ctx)
	require.NoError(t, err)
	require.Zero(t, state.AgentsTotal)
	require.True(t, state.Confirmed)
}

type detachedControlTransport struct {
	base    http.RoundTripper
	blocked atomic.Bool
	control chan io.Closer
}

var errDetachedControl = errors.New("control connection unavailable")

func (t *detachedControlTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	coordinate := strings.HasSuffix(req.URL.Path, "/coordinate")
	if coordinate && t.blocked.Load() {
		return nil, errDetachedControl
	}
	res, err := t.base.RoundTrip(req)
	if err == nil && coordinate && res.StatusCode == http.StatusSwitchingProtocols {
		select {
		case t.control <- res.Body:
		default:
		}
	}
	return res, err
}

func TestGlobalLockdownAgentRevokesDetachedPeersAndPreservesOwner(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	member, user := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	r := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: owner.OrganizationID, OwnerID: user.ID}).WithAgent().Do()
	_ = agenttest.New(t, client.URL, r.AgentToken)
	resources := coderdtest.AwaitWorkspaceAgents(t, client, r.Workspace.ID)
	agentID := resources[0].Agents[0].ID
	ctx := testutil.Context(t, testutil.WaitLong)
	ownerConn, err := workspacesdk.New(client).DialAgent(ctx, agentID, &workspacesdk.DialAgentOptions{Logger: testutil.Logger(t)})
	require.NoError(t, err)
	defer ownerConn.Close()
	// This API uses the integrated server tailnet, whose peer ID differs from
	// the user coordinate peer and from the API replica ID.
	_, err = client.WorkspaceAgentListeningPorts(ctx, agentID)
	require.NoError(t, err)
	base := member.HTTPClient.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	transport := &detachedControlTransport{base: base, control: make(chan io.Closer, 1)}
	member.HTTPClient = &http.Client{Transport: transport}
	memberLogger := slogtest.Make(t, &slogtest.Options{
		IgnoredErrorIs: []error{errDetachedControl, context.Canceled, context.DeadlineExceeded},
		IgnoreErrorFn:  testutil.IgnoreLoggedError,
	}).Leveled(slog.LevelDebug)
	memberConn, err := workspacesdk.New(member).DialAgent(ctx, agentID, &workspacesdk.DialAgentOptions{Logger: memberLogger})
	require.NoError(t, err)
	defer memberConn.Close()
	control := testutil.TryReceive(ctx, t, transport.control)
	transport.blocked.Store(true)
	require.NoError(t, control.Close())
	_, _, _, err = memberConn.Ping(ctx)
	require.NoError(t, err, "ordinary control loss must preserve the existing data-plane connection")
	_, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: true, Confirmation: "agree"})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		state, err := client.GlobalLockdown(ctx)
		return err == nil && state.Confirmed && state.AgentsTotal == 1
	}, testutil.WaitLong, testutil.IntervalFast)
	_, _, _, err = ownerConn.Ping(ctx)
	require.NoError(t, err, "owner peer must survive agent enforcement")
	_, err = client.WorkspaceAgentListeningPorts(ctx, agentID)
	require.NoError(t, err, "integrated Coder server peer must survive agent enforcement")
	denied, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	_, _, _, err = memberConn.Ping(denied)
	require.Error(t, err, "a detached legacy peer must be removed from the agent")
	_, err = client.UpdateGlobalLockdown(ctx, codersdk.UpdateGlobalLockdownRequest{Enabled: false})
	require.NoError(t, err)
	fresh := codersdk.New(member.URL)
	fresh.SetSessionToken(member.SessionToken())
	fresh.HTTPClient = &http.Client{Transport: base}
	reconnected, err := workspacesdk.New(fresh).DialAgent(ctx, agentID, &workspacesdk.DialAgentOptions{Logger: testutil.Logger(t)})
	require.NoError(t, err, "a fresh member connection must work immediately after unlock")
	defer reconnected.Close()
	_, _, _, err = reconnected.Ping(ctx)
	require.NoError(t, err)
}
