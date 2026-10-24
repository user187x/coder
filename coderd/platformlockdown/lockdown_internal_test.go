package platformlockdown

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
)

func testStore(t *testing.T, users map[uuid.UUID]database.User) *dbmock.MockStore {
	t.Helper()
	db := dbmock.NewMockStore(gomock.NewController(t))
	var tx, mu sync.Mutex
	var value string
	db.EXPECT().InTx(gomock.Any(), gomock.Any()).DoAndReturn(func(fn func(database.Store) error, _ *database.TxOptions) error {
		tx.Lock()
		defer tx.Unlock()
		return fn(db)
	}).AnyTimes()
	db.EXPECT().AcquireLock(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	db.EXPECT().GetRuntimeConfig(gomock.Any(), stateKey).DoAndReturn(func(context.Context, string) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		if value == "" {
			return "", sql.ErrNoRows
		}
		return value, nil
	}).AnyTimes()
	db.EXPECT().UpsertRuntimeConfig(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, arg database.UpsertRuntimeConfigParams) error {
		mu.Lock()
		defer mu.Unlock()
		value = arg.Value
		return nil
	}).AnyTimes()
	db.EXPECT().GetUserByID(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, id uuid.UUID) (database.User, error) {
		u, ok := users[id]
		if !ok {
			return database.User{}, sql.ErrNoRows
		}
		return u, nil
	}).AnyTimes()
	return db
}

func TestLockdownWaitsForEveryReplicaAndActualTeardown(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	user, owner := uuid.New(), uuid.New()
	db := testStore(t, map[uuid.UUID]database.User{
		user:  {ID: user, Status: database.UserStatusActive},
		owner: {ID: owner, Status: database.UserStatusActive, RBACRoles: []string{"owner"}},
	})
	a, b := New(db, uuid.New(), quartz.NewMock(t)), New(db, uuid.New(), quartz.NewMock(t))
	require.NoError(t, a.Register(ctx))
	require.NoError(t, b.Register(ctx))
	first, err := a.Begin(ctx, user)
	require.NoError(t, err)
	second, err := b.Begin(ctx, user)
	require.NoError(t, err)
	admin, err := a.Begin(ctx, owner)
	require.NoError(t, err)
	defer admin.End()
	_, err = a.Set(ctx, true, "owner")
	require.NoError(t, err)
	select {
	case <-first.Revoked:
	default:
		t.Fatal("the activating replica did not revoke its session")
	}
	select {
	case <-admin.Revoked:
		t.Fatal("owner session was revoked")
	default:
	}
	s, err := a.Load(ctx)
	require.NoError(t, err)
	require.False(t, s.Confirmed())
	_, err = b.Begin(ctx, user)
	require.ErrorIs(t, err, ErrLocked)
	b.reconcile(ctx)
	select {
	case <-second.Revoked:
	default:
		t.Fatal("the second replica did not revoke its session")
	}
	s, err = a.Load(ctx)
	require.NoError(t, err)
	require.False(t, s.Confirmed(), "signaling revocation is not confirmation of teardown")
	first.End()
	second.End()
	a.reconcile(ctx)
	b.reconcile(ctx)
	s, err = a.Load(ctx)
	require.NoError(t, err)
	require.True(t, s.Confirmed())
	_, err = a.Set(ctx, false, "owner")
	require.NoError(t, err)
	resumed, err := b.Begin(ctx, user)
	require.NoError(t, err)
	resumed.End()
}

func TestUnresponsiveReplicaNeverConfirms(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := testStore(t, nil)
	a, b := New(db, uuid.New(), quartz.NewMock(t)), New(db, uuid.New(), quartz.NewMock(t))
	require.NoError(t, a.Register(ctx))
	require.NoError(t, b.Register(ctx))
	_, err := a.Set(ctx, true, "owner")
	require.NoError(t, err)
	s, err := a.Load(ctx)
	require.NoError(t, err)
	require.False(t, s.Confirmed())
	b.Retire(ctx)
	s, err = a.Load(ctx)
	require.NoError(t, err)
	require.True(t, s.Confirmed())
}

func TestDatabaseFailureRevokesAndDeniesSessions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := testStore(t, nil)
	m := New(db, uuid.New(), quartz.NewMock(t))
	require.NoError(t, m.Register(ctx))
	session, err := m.Begin(ctx, uuid.New())
	require.NoError(t, err)
	defer session.End()
	m.db = failingConfigStore{Store: db}
	m.reconcile(ctx)
	select {
	case <-session.Revoked:
	default:
		t.Fatal("session survived inability to verify access")
	}
	_, err = m.Begin(ctx, uuid.New())
	require.Error(t, err)
}

func TestUnregisteredReplicaCannotServeSessions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	m := New(testStore(t, nil), uuid.New(), quartz.NewMock(t))
	_, err := m.Begin(ctx, uuid.New())
	require.Error(t, err)
	require.NoError(t, m.Register(ctx))
	session, err := m.Begin(ctx, uuid.New())
	require.NoError(t, err)
	session.End()
}

type failingConfigStore struct{ database.Store }

func (failingConfigStore) GetRuntimeConfig(context.Context, string) (string, error) {
	return "", errors.New("unreachable")
}

func TestLockdownCancelsGuardedWorkspaceRequest(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	m := New(testStore(t, nil), uuid.New(), quartz.NewMock(t))
	require.NoError(t, m.Register(ctx))
	guard, end, err := m.Guard(ctx, uuid.New())
	require.NoError(t, err)
	defer end()
	_, err = m.Set(ctx, true, "owner")
	require.NoError(t, err)
	_ = testutil.TryReceive(ctx, t, guard.Done())
}

func TestLockdownSerializesExternalProxyRegistration(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	m := New(testStore(t, nil), uuid.New(), quartz.NewMock(t))
	require.NoError(t, m.Register(ctx))
	registered := false
	registering := make(chan struct{})
	finishRegistration := make(chan struct{})
	registrationResult := make(chan error, 1)
	go func() {
		registrationResult <- m.WithUnlocked(ctx, func(database.Store) error {
			close(registering)
			_ = testutil.TryReceive(ctx, t, finishRegistration)
			registered = true
			return nil
		})
	}()
	_ = testutil.TryReceive(ctx, t, registering)
	activationResult := make(chan error, 1)
	unsupported := errors.New("unsupported proxy")
	go func() {
		_, err := m.SetChecked(ctx, true, "owner", func(database.Store) error {
			if registered {
				return unsupported
			}
			return nil
		})
		activationResult <- err
	}()
	close(finishRegistration)
	require.NoError(t, testutil.TryReceive(ctx, t, registrationResult))
	require.ErrorIs(t, testutil.TryReceive(ctx, t, activationResult), unsupported)
	s, err := m.Load(ctx)
	require.NoError(t, err)
	require.False(t, s.Enabled)
	_, err = m.Set(ctx, true, "owner")
	require.NoError(t, err)
	called := false
	err = m.WithUnlocked(ctx, func(database.Store) error { called = true; return nil })
	require.ErrorIs(t, err, ErrLocked)
	require.False(t, called)
}
