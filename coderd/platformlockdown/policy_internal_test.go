package platformlockdown

import (
	"context"
	"database/sql"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/quartz"
)

func TestAgentPolicyPreservesOwnersAndSystemPeers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	owner, member := uuid.New(), uuid.New()
	users := map[uuid.UUID]database.User{
		owner:  {ID: owner, Status: database.UserStatusActive, RBACRoles: []string{"owner"}},
		member: {ID: member, Status: database.UserStatusActive},
	}
	m := New(testStore(t, users), uuid.New(), quartz.NewMock(t))
	require.NoError(t, m.Register(ctx))
	systemPeer, ownerPeer, memberPeer := uuid.New(), uuid.New(), uuid.New()
	require.NoError(t, m.TrackSystemPeer(ctx, systemPeer))
	require.NoError(t, m.TrackPeer(ctx, owner, ownerPeer))
	require.NoError(t, m.TrackPeer(ctx, member, memberPeer))
	_, err := m.Set(ctx, true, "owner")
	require.NoError(t, err)
	agentID := uuid.New()
	require.NoError(t, m.AgentConnected(ctx, agentID, "instance"))
	policy, err := m.SyncAgent(ctx, agentID, "instance", "")
	require.NoError(t, err)
	require.ElementsMatch(t, []uuid.UUID{systemPeer, ownerPeer}, policy.AllowedPeers)
	s, err := m.Load(ctx)
	require.NoError(t, err)
	require.True(t, s.AgentAcks[agentID.String()].Supported)
	require.Empty(t, s.AgentAcks[agentID.String()].Fingerprint)
	_, err = m.SyncAgent(ctx, agentID, "instance", policy.Fingerprint)
	require.NoError(t, err)
	s, err = m.Load(ctx)
	require.NoError(t, err)
	require.Equal(t, policy.Fingerprint, s.AgentAcks[agentID.String()].Fingerprint)
	newOwnerPeer := uuid.New()
	require.NoError(t, m.TrackPeer(ctx, owner, newOwnerPeer))
	updated, err := m.SyncAgent(ctx, agentID, "instance", policy.Fingerprint)
	require.NoError(t, err)
	require.NotEqual(t, policy.Fingerprint, updated.Fingerprint)
	require.ElementsMatch(t, []uuid.UUID{systemPeer, ownerPeer, newOwnerPeer}, updated.AllowedPeers)
	s, err = m.Load(ctx)
	require.NoError(t, err)
	require.NotEqual(t, updated.Fingerprint, s.AgentAcks[agentID.String()].Fingerprint)
	users[owner] = database.User{ID: owner, Status: database.UserStatusActive}
	updated, err = m.SyncAgent(ctx, agentID, "instance", updated.Fingerprint)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{systemPeer}, updated.AllowedPeers)
	require.NoError(t, m.AgentConnected(ctx, agentID, "next-instance"))
	s, err = m.Load(ctx)
	require.NoError(t, err)
	require.False(t, s.AgentAcks[agentID.String()].Supported)
	_, err = m.SyncAgent(ctx, agentID, "instance", updated.Fingerprint)
	require.ErrorIs(t, err, ErrAgentSession, "a superseded process cannot re-acknowledge policy for its replacement")
}

func TestQuarantinePeerPolicyHasNoHumanExemption(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	owner, workspace, other := uuid.New(), uuid.New(), uuid.New()
	db := testStore(t, map[uuid.UUID]database.User{owner: {ID: owner, Status: database.UserStatusActive, RBACRoles: []string{"owner"}}})
	revision := uuid.New()
	db.EXPECT().GetWorkspaceQuarantineByWorkspaceID(gomock.Any(), gomock.Any()).AnyTimes().DoAndReturn(func(_ context.Context, id uuid.UUID) (database.WorkspaceQuarantine, error) {
		if id != workspace {
			return database.WorkspaceQuarantine{}, sql.ErrNoRows
		}
		return database.WorkspaceQuarantine{WorkspaceID: id, Enabled: true, Revision: revision, ManualStartRequired: true}, nil
	})
	m := New(db, uuid.New(), quartz.NewMock(t))
	require.NoError(t, m.Register(ctx))
	serverPeer, ownerPeer := uuid.New(), uuid.New()
	require.NoError(t, m.TrackSystemPeer(ctx, serverPeer))
	require.NoError(t, m.TrackPeer(ctx, owner, ownerPeer))
	_, err := m.Set(ctx, true, "owner")
	require.NoError(t, err)
	targetAgent, otherAgent := uuid.New(), uuid.New()
	require.NoError(t, m.AgentConnected(ctx, targetAgent, "target"))
	require.NoError(t, m.AgentConnected(ctx, otherAgent, "other"))
	target, err := m.SyncAgentForWorkspace(ctx, targetAgent, workspace, "target", "")
	require.NoError(t, err)
	require.True(t, target.Enabled)
	require.ElementsMatch(t, []uuid.UUID{serverPeer}, target.AllowedPeers)
	normal, err := m.SyncAgentForWorkspace(ctx, otherAgent, other, "other", "")
	require.NoError(t, err)
	require.ElementsMatch(t, []uuid.UUID{serverPeer, ownerPeer}, normal.AllowedPeers, "global owner exemption stays unchanged for another workspace")
	_, err = m.SyncAgentForWorkspace(ctx, targetAgent, workspace, "target", target.Fingerprint)
	require.NoError(t, err)
	revision = uuid.New()
	changed, err := m.SyncAgentForWorkspace(ctx, targetAgent, workspace, "target", target.Fingerprint)
	require.NoError(t, err)
	require.NotEqual(t, target.Fingerprint, changed.Fingerprint)
	state, err := m.Load(ctx)
	require.NoError(t, err)
	require.NotEqual(t, changed.Fingerprint, state.AgentAcks[targetAgent.String()].Fingerprint, "stale scoped ACK never confirms a new policy")
}
