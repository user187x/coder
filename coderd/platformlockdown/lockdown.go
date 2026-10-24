// Package platformlockdown revokes Coder workspace sessions while preserving
// account sessions and the running workspaces.
package platformlockdown

import (
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/quartz"
)

const stateKey = "platform_global_lockdown"

// ErrLocked means workspace access has been revoked.
var ErrLocked = xerrors.New("System Lockdown Enabled")

type replica struct {
	Revision string         `json:"revision"`
	Sessions map[string]int `json:"sessions"`
}

// State is shared by all Coder replicas. A replica must explicitly acknowledge
// the current revision; an unreachable replica is never assumed disconnected.
type State struct {
	Enabled    bool                 `json:"enabled"`
	Revision   string               `json:"revision"`
	UpdatedBy  string               `json:"updated_by"`
	UpdatedAt  string               `json:"updated_at"`
	Replicas   map[string]replica   `json:"replicas"`
	PeerGrants map[string]PeerGrant `json:"peer_grants,omitempty"`
	AgentAcks  map[string]AgentAck  `json:"agent_acks,omitempty"`
}

// Confirmed reports whether every registered replica has revoked its sessions.
func (s State) Confirmed() bool {
	if len(s.Replicas) == 0 {
		return false
	}
	for _, r := range s.Replicas {
		if r.Revision != s.Revision {
			return false
		}
		for _, count := range r.Sessions {
			if count > 0 {
				return false
			}
		}
	}
	return true
}

// Connected reports whether any replica still serves workspace sessions for id.
func (s State) Connected(id string) bool {
	for _, r := range s.Replicas {
		if r.Sessions[id] > 0 {
			return true
		}
	}
	return false
}

// Session is a workspace connection. Revoked closes only when the server
// withdraws access, allowing tailnet to send a graceful Disconnect first.
type Session struct {
	Revoked <-chan struct{}
	End     func()
}

type connection struct {
	userID uuid.UUID
	revoke chan struct{}
	once   sync.Once
}

// Manager tracks a single replica's sessions and acknowledges shared changes.
type Manager struct {
	db         database.Store
	id         string
	clock      quartz.Clock
	mu         sync.Mutex
	conns      map[*connection]struct{}
	systemPeer uuid.UUID
}

// New constructs a manager. Run must be started before serving requests.
func New(db database.Store, id uuid.UUID, clock quartz.Clock) *Manager {
	return &Manager{db: db, id: id.String(), clock: clock, conns: make(map[*connection]struct{})}
}

// Load reads the persisted restriction, including replica acknowledgements.
func (m *Manager) Load(ctx context.Context) (State, error) {
	//nolint:gocritic // This deployment setting is read independently of user workspace permissions.
	return load(dbauthz.AsSystemRestricted(ctx), m.db)
}

func load(ctx context.Context, db database.Store) (State, error) {
	s := State{Replicas: make(map[string]replica)}
	raw, err := db.GetRuntimeConfig(ctx, stateKey)
	if xerrors.Is(err, sql.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return s, xerrors.Errorf("decode global lockdown: %w", err)
	}
	if s.Replicas == nil {
		s.Replicas = make(map[string]replica)
	}
	return s, nil
}

func (m *Manager) change(ctx context.Context, fn func(*State)) (State, error) {
	return m.changeDB(ctx, func(s *State, _ database.Store) error { fn(s); return nil })
}

func (m *Manager) changeDB(ctx context.Context, fn func(*State, database.Store) error) (State, error) {
	var state State
	//nolint:gocritic // Callers authorize configuration changes; acknowledgement is internal bookkeeping.
	sys := dbauthz.AsSystemRestricted(ctx)
	err := m.db.InTx(func(tx database.Store) error {
		if err := tx.AcquireLock(sys, database.GenLockID(stateKey)); err != nil {
			return err
		}
		var err error
		state, err = load(sys, tx)
		if err != nil {
			return err
		}
		if err := fn(&state, tx); err != nil {
			return err
		}
		raw, err := json.Marshal(state)
		if err != nil {
			return err
		}
		return tx.UpsertRuntimeConfig(sys, database.UpsertRuntimeConfigParams{Key: stateKey, Value: string(raw)})
	}, nil)
	return state, err
}

// Set persists a restriction; acknowledgement follows actual session teardown.
func (m *Manager) Set(ctx context.Context, enabled bool, by string) (State, error) {
	return m.SetChecked(ctx, enabled, by, nil)
}

// SetChecked serializes activation with changes to external enforcement
// boundaries. The check runs on the same transaction while the setting is locked.
func (m *Manager) SetChecked(ctx context.Context, enabled bool, by string, check func(database.Store) error) (State, error) {
	s, err := m.changeDB(ctx, func(s *State, tx database.Store) error {
		if enabled && check != nil {
			if err := check(tx); err != nil {
				return err
			}
		}
		s.Enabled, s.UpdatedBy = enabled, by
		s.UpdatedAt = m.clock.Now().UTC().Format(time.RFC3339)
		s.Revision = uuid.NewString()
		return nil
	})
	if err == nil {
		m.reconcile(ctx)
	}
	return s, err
}

// WithUnlocked serializes app proxy registration with lockdown activation.
func (m *Manager) WithUnlocked(ctx context.Context, register func(database.Store) error) error {
	_, err := m.changeDB(ctx, func(s *State, tx database.Store) error {
		if s.Enabled {
			return ErrLocked
		}
		return register(tx)
	})
	return err
}

// Admin reports whether id has the deployment owner role. Missing accounts and
// database errors never grant an exemption, including anonymous shared apps.
func (m *Manager) Admin(ctx context.Context, id uuid.UUID) bool {
	return isAdmin(ctx, m.db, id)
}

func isAdmin(ctx context.Context, db database.Store, id uuid.UUID) bool {
	//nolint:gocritic // Only the exemption decision is exposed, never another account's data.
	u, err := db.GetUserByID(dbauthz.AsSystemRestricted(ctx), id)
	return err == nil && !u.Deleted && u.Status == database.UserStatusActive && slices.Contains(u.RBACRoles, "owner")
}

// Begin checks the current setting and registers a connection atomically with
// respect to local revocation. Owner connections remain tracked so a subsequent
// role change cannot retain an exemption.
func (m *Manager) Begin(ctx context.Context, id uuid.UUID) (Session, error) {
	admin := m.Admin(ctx, id)
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.Load(ctx)
	if err != nil {
		return Session{}, xerrors.Errorf("check global lockdown: %w", err)
	}
	if _, registered := s.Replicas[m.id]; !registered {
		return Session{}, xerrors.New("workspace access replica is not registered")
	}
	if s.Enabled && !admin {
		return Session{}, ErrLocked
	}
	c := &connection{userID: id, revoke: make(chan struct{})}
	m.conns[c] = struct{}{}
	return Session{Revoked: c.revoke, End: func() {
		m.mu.Lock()
		delete(m.conns, c)
		m.mu.Unlock()
	}}, nil
}

// Guard returns a request context canceled on revocation, for HTTP and PTY
// sessions. End must be called after the connection has actually closed.
func (m *Manager) Guard(ctx context.Context, id uuid.UUID) (context.Context, func(), error) {
	s, err := m.Begin(ctx, id)
	if err != nil {
		return ctx, nil, err
	}
	guard, cancel := context.WithCancel(ctx)
	stop := make(chan struct{})
	go func() {
		select {
		case <-s.Revoked:
			cancel()
		case <-guard.Done():
		case <-stop:
		}
	}()
	return guard, func() { close(stop); cancel(); s.End() }, nil
}

func (m *Manager) revokeAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for c := range m.conns {
		c.once.Do(func() { close(c.revoke) })
	}
}

func (m *Manager) reconcile(ctx context.Context) {
	s, err := m.Load(ctx)
	if err != nil {
		m.revokeAll()
		return
	}
	m.mu.Lock()
	counts := make(map[string]int)
	systemPeer := m.systemPeer
	admins := make(map[uuid.UUID]bool)
	for c := range m.conns {
		admin, checked := admins[c.userID]
		if !checked {
			admin = m.Admin(ctx, c.userID)
			admins[c.userID] = admin
		}
		if !admin {
			if s.Enabled {
				c.once.Do(func() { close(c.revoke) })
			}
			counts[c.userID.String()]++
		}
	}
	m.mu.Unlock()
	_, _ = m.change(ctx, func(current *State) {
		// A concurrent activation must be observed before acknowledging it.
		current.Replicas[m.id] = replica{Revision: s.Revision, Sessions: counts}
		if systemPeer != uuid.Nil {
			if current.PeerGrants == nil {
				current.PeerGrants = make(map[string]PeerGrant)
			}
			current.PeerGrants[systemPeer.String()] = PeerGrant{ReplicaID: m.id}
		}
	})
}

// Register makes this replica visible before it accepts any workspace sessions.
func (m *Manager) Register(ctx context.Context) error {
	_, err := m.change(ctx, func(s *State) {
		s.Replicas[m.id] = replica{Revision: s.Revision, Sessions: make(map[string]int)}
	})
	return err
}

// Retire removes a replica only after its tracked connections have ended. An
// interrupted shutdown deliberately leaves it unconfirmed for administrators.
func (m *Manager) Retire(ctx context.Context) {
	m.mu.Lock()
	empty := len(m.conns) == 0
	m.mu.Unlock()
	if empty {
		_, _ = m.change(ctx, func(s *State) { delete(s.Replicas, m.id) })
	}
}

// Run polls shared configuration. Database failures revoke local sessions and
// leave the last acknowledgement pending instead of claiming success.
func (m *Manager) Run(ctx context.Context) {
	m.reconcile(ctx)
	t := m.clock.NewTicker(time.Second, "global-lockdown")
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			m.revokeAll()
			return
		case <-t.C:
			check, cancel := context.WithTimeout(ctx, 5*time.Second)
			m.reconcile(check)
			cancel()
		}
	}
}
