package platformlockdown

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/workspacequarantine"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

// PeerGrant identifies an owner client or an integrated Coder server peer.
type PeerGrant struct {
	UserID    string `json:"user_id,omitempty"`
	ReplicaID string `json:"replica_id,omitempty"`
}

// AgentAck records capability support and the exact applied peer policy.
type AgentAck struct {
	Supported   bool   `json:"supported"`
	Fingerprint string `json:"fingerprint"`
	Session     string `json:"session"`
}

// ErrAgentSession means the acknowledgement belongs to a superseded agent process.
var ErrAgentSession = xerrors.New("agent access session is not current")

// TrackPeer retains peer identity beyond control connection loss. Agents can
// therefore preserve owner peers while purging every unrecognized legacy peer.
func (m *Manager) TrackPeer(ctx context.Context, userID, peerID uuid.UUID) error {
	_, err := m.change(ctx, func(s *State) {
		if s.PeerGrants == nil {
			s.PeerGrants = make(map[string]PeerGrant)
		}
		s.PeerGrants[peerID.String()] = PeerGrant{UserID: userID.String()}
	})
	return err
}

// TrackSystemPeer exempts an integrated server's transport to workspace agents.
func (m *Manager) TrackSystemPeer(ctx context.Context, peerID uuid.UUID) error {
	m.mu.Lock()
	m.systemPeer = peerID
	m.mu.Unlock()
	_, err := m.change(ctx, func(s *State) {
		if s.PeerGrants == nil {
			s.PeerGrants = make(map[string]PeerGrant)
		}
		s.PeerGrants[peerID.String()] = PeerGrant{ReplicaID: m.id}
	})
	return err
}

// Policy describes the WireGuard peers an upgraded agent may retain. The
// fingerprint changes with owner role changes and newly registered owner peers.
func (m *Manager) Policy(ctx context.Context, s State) agentsdk.WorkspaceAccessPolicy {
	return policyFor(ctx, m.db, s)
}

func policyFor(ctx context.Context, db database.Store, s State) agentsdk.WorkspaceAccessPolicy {
	p := agentsdk.WorkspaceAccessPolicy{Enabled: s.Enabled, Revision: s.Revision, AllowedPeers: []uuid.UUID{}}
	if s.Enabled {
		owners := make(map[string]bool)
		for peer, grant := range s.PeerGrants {
			allowed := false
			if grant.ReplicaID != "" {
				_, allowed = s.Replicas[grant.ReplicaID]
			} else if grant.UserID != "" {
				owner, checked := owners[grant.UserID]
				if !checked {
					id, err := uuid.Parse(grant.UserID)
					owner = err == nil && isAdmin(ctx, db, id)
					owners[grant.UserID] = owner
				}
				allowed = owner
			}
			if allowed {
				id, err := uuid.Parse(peer)
				if err == nil {
					p.AllowedPeers = append(p.AllowedPeers, id)
				}
			}
		}
		slices.SortFunc(p.AllowedPeers, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	}
	return fingerprintPolicy(p)
}

func fingerprintPolicy(p agentsdk.WorkspaceAccessPolicy) agentsdk.WorkspaceAccessPolicy {
	p.Fingerprint = ""
	raw, _ := json.Marshal(p)
	hash := sha256.Sum256(raw)
	p.Fingerprint = hex.EncodeToString(hash[:])
	return p
}

// PolicyForWorkspace combines deployment policy with workspace containment.
// Quarantined targets retain only trusted server transports, never human peers.
func (m *Manager) PolicyForWorkspace(ctx context.Context, s State, workspaceID uuid.UUID) (agentsdk.WorkspaceAccessPolicy, error) {
	return policyForWorkspace(ctx, m.db, s, workspaceID)
}

func policyForWorkspace(ctx context.Context, db database.Store, s State, workspaceID uuid.UUID) (agentsdk.WorkspaceAccessPolicy, error) {
	p := policyFor(ctx, db, s)
	if workspaceID == uuid.Nil {
		return p, nil
	}
	q, err := workspacequarantine.Load(ctx, db, workspaceID)
	if err != nil {
		return p, err
	}
	if !workspacequarantine.Blocked(q) {
		return p, nil
	}
	p.Enabled = true
	p.Revision = s.Revision + ":" + q.Revision.String()
	p.AllowedPeers = []uuid.UUID{}
	for peer, grant := range s.PeerGrants {
		if grant.ReplicaID == "" {
			continue
		}
		if _, ok := s.Replicas[grant.ReplicaID]; !ok {
			continue
		}
		id, err := uuid.Parse(peer)
		if err == nil {
			p.AllowedPeers = append(p.AllowedPeers, id)
		}
	}
	slices.SortFunc(p.AllowedPeers, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return fingerprintPolicy(p), nil
}

// SyncAgent accepts an acknowledgement only for the policy currently in force.
// Acknowledging an old revision or an outdated allowlist cannot confirm a lock.
func (m *Manager) SyncAgent(ctx context.Context, id uuid.UUID, session, applied string) (agentsdk.WorkspaceAccessPolicy, error) {
	return m.SyncAgentForWorkspace(ctx, id, uuid.Nil, session, applied)
}

// SyncAgentForWorkspace acknowledges only the combined policy for this target.
func (m *Manager) SyncAgentForWorkspace(ctx context.Context, id, workspaceID uuid.UUID, session, applied string) (agentsdk.WorkspaceAccessPolicy, error) {
	var policy agentsdk.WorkspaceAccessPolicy
	_, err := m.changeDB(ctx, func(s *State, tx database.Store) error {
		var err error
		policy, err = policyForWorkspace(ctx, tx, *s, workspaceID)
		if err != nil {
			return err
		}
		if s.AgentAcks == nil {
			s.AgentAcks = make(map[string]AgentAck)
		}
		ack := s.AgentAcks[id.String()]
		if session == "" || ack.Session != session {
			return ErrAgentSession
		}
		ack.Supported = true
		if applied != "" && applied == policy.Fingerprint {
			ack.Fingerprint = applied
		}
		s.AgentAcks[id.String()] = ack
		return nil
	})
	return policy, err
}

// AgentConnected invalidates any acknowledgement from a previous process.
func (m *Manager) AgentConnected(ctx context.Context, id uuid.UUID, session string) error {
	_, err := m.change(ctx, func(s *State) {
		if s.AgentAcks == nil {
			s.AgentAcks = make(map[string]AgentAck)
		}
		s.AgentAcks[id.String()] = AgentAck{Session: session}
	})
	return err
}
