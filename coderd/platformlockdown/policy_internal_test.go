package platformlockdown

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

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
