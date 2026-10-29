// Package workspacequarantine guards workspace data-plane sessions independently of account login.
package workspacequarantine

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/shorttermlease"
	"github.com/coder/quartz"
	"github.com/google/uuid"
	"golang.org/x/xerrors"
)

// ErrQuarantined means the workspace requires containment or a new explicit Start.
var ErrQuarantined = xerrors.New("Workspace is quarantined or requires an explicit Start")

// LockKey serializes policy changes with workspace start creation.
func LockKey(id uuid.UUID) int64 { return database.GenLockID("workspace-quarantine-" + id.String()) }

// Acquire serializes security changes and forces stale RepeatableRead builders
// to retry, including when the policy row did not exist in their snapshot.
func Acquire(ctx context.Context, db database.Store, id uuid.UUID) error {
	if err := db.AcquireLock(ctx, LockKey(id)); err != nil {
		return err
	}
	//nolint:gocritic // The caller has authorized its target; this updates no visible workspace values.
	count, err := db.TouchWorkspaceQuarantineLock(dbauthz.AsSystemRestricted(ctx), id)
	if err != nil {
		return err
	}
	if count != 1 {
		return xerrors.New("workspace quarantine lock target is unavailable")
	}
	return nil
}

// Load reads authoritative policy. No row means the workspace has never been quarantined.
func Load(ctx context.Context, db database.Store, id uuid.UUID) (database.WorkspaceQuarantine, error) {
	//nolint:gocritic // Signed app tickets also need authoritative lease expiry checks.
	lease, err := db.GetShortTermLeaseByWorkspaceID(dbauthz.AsSystemRestricted(ctx), uuid.NullUUID{UUID: id, Valid: true})
	if err != nil && !xerrors.Is(err, sql.ErrNoRows) {
		return database.WorkspaceQuarantine{}, err
	}
	if err == nil && !shorttermlease.Active(lease, time.Now()) {
		return database.WorkspaceQuarantine{WorkspaceID: id, Enabled: true}, nil
	}
	return LoadContainment(ctx, db, id)
}

// LoadContainment reads explicit quarantine independently of expired login leases.
// Deleting an expired lease workspace does not reopen its data plane.
func LoadContainment(ctx context.Context, db database.Store, id uuid.UUID) (database.WorkspaceQuarantine, error) {
	//nolint:gocritic // Security enforcement reads only policy for an already resolved target, including signed app sessions.
	policy, err := db.GetWorkspaceQuarantineByWorkspaceID(dbauthz.AsSystemRestricted(ctx), id)
	if xerrors.Is(err, sql.ErrNoRows) {
		return database.WorkspaceQuarantine{WorkspaceID: id}, nil
	}
	return policy, err
}

// Blocked reports restrictions that remain until a new explicit user Start.
func Blocked(policy database.WorkspaceQuarantine) bool {
	return policy.Enabled || policy.ManualStartRequired
}

type connection struct {
	workspace uuid.UUID
	revoked   chan struct{}
	once      sync.Once
}

// Manager cancels active sessions on every replica after authoritative policy changes.
type Manager struct {
	db       database.Store
	clock    quartz.Clock
	mu       sync.Mutex
	sessions map[*connection]struct{}
}

// New constructs the session manager. Run must follow during server startup.
func New(db database.Store, clock quartz.Clock) *Manager {
	return &Manager{db: db, clock: clock, sessions: make(map[*connection]struct{})}
}

// Guard registers one workspace session. Account and other workspace sessions are unaffected.
func (m *Manager) Guard(ctx context.Context, id uuid.UUID) (context.Context, func(), error) {
	if id == uuid.Nil {
		return ctx, nil, ErrQuarantined
	}
	m.mu.Lock()
	policy, err := Load(ctx, m.db, id)
	if err != nil || Blocked(policy) {
		m.mu.Unlock()
		if err != nil {
			return ctx, nil, err
		}
		return ctx, nil, ErrQuarantined
	}
	c := &connection{workspace: id, revoked: make(chan struct{})}
	m.sessions[c] = struct{}{}
	m.mu.Unlock()
	guarded, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		select {
		case <-c.revoked:
			cancel()
		case <-guarded.Done():
		case <-done:
		}
	}()
	return guarded, func() { close(done); cancel(); m.mu.Lock(); delete(m.sessions, c); m.mu.Unlock() }, nil
}

// Revoke immediately closes this replica's sessions for one workspace.
func (m *Manager) Revoke(id uuid.UUID) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for c := range m.sessions {
		if c.workspace == id {
			c.once.Do(func() { close(c.revoked) })
		}
	}
}

// Run observes restrictions committed by other replicas and never acknowledges physical enforcement.
func (m *Manager) Run(ctx context.Context) {
	ticker := m.clock.NewTicker(time.Second, "workspace-quarantine")
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		m.reconcile(ctx)
	}
}

func (m *Manager) reconcile(ctx context.Context) {
	m.mu.Lock()
	targets := map[uuid.UUID]bool{}
	for c := range m.sessions {
		targets[c.workspace] = true
	}
	m.mu.Unlock()
	for id := range targets {
		policy, err := Load(ctx, m.db, id)
		if err != nil || Blocked(policy) {
			m.Revoke(id)
		}
	}
}
