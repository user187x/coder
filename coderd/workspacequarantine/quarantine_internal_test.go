package workspacequarantine

import (
	"context"
	"database/sql"
	"sync"
	"testing"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestWorkspaceQuarantineReplicaSessions(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	target, unrelated := uuid.New(), uuid.New()
	var mu sync.Mutex
	current := map[uuid.UUID]database.WorkspaceQuarantine{}
	db := dbmock.NewMockStore(gomock.NewController(t))
	db.EXPECT().GetShortTermLeaseByWorkspaceID(gomock.Any(), gomock.Any()).Return(database.ShortTermLease{}, sql.ErrNoRows).AnyTimes()
	db.EXPECT().GetWorkspaceQuarantineByWorkspaceID(gomock.Any(), gomock.Any()).AnyTimes().DoAndReturn(func(_ context.Context, id uuid.UUID) (database.WorkspaceQuarantine, error) {
		mu.Lock()
		defer mu.Unlock()
		p, ok := current[id]
		if !ok {
			return p, sql.ErrNoRows
		}
		return p, nil
	})
	first, second := New(db, quartz.NewMock(t)), New(db, quartz.NewMock(t))
	a, endA, err := first.Guard(ctx, target)
	require.NoError(t, err)
	defer endA()
	b, endB, err := second.Guard(ctx, target)
	require.NoError(t, err)
	defer endB()
	other, endOther, err := second.Guard(ctx, unrelated)
	require.NoError(t, err)
	defer endOther()
	mu.Lock()
	current[target] = database.WorkspaceQuarantine{WorkspaceID: target, Enabled: true, ManualStartRequired: true}
	mu.Unlock()
	first.Revoke(target)
	second.reconcile(ctx)
	testutil.TryReceive(ctx, t, a.Done())
	testutil.TryReceive(ctx, t, b.Done())
	select {
	case <-other.Done():
		t.Fatal("another workspace was disconnected")
	default:
	}
	_, _, err = second.Guard(ctx, target)
	require.ErrorIs(t, err, ErrQuarantined)
	mu.Lock()
	current[target] = database.WorkspaceQuarantine{WorkspaceID: target, ManualStartRequired: true}
	mu.Unlock()
	_, _, err = second.Guard(ctx, target)
	require.ErrorIs(t, err, ErrQuarantined, "release cannot restore stale connections")
	mu.Lock()
	current[target] = database.WorkspaceQuarantine{WorkspaceID: target}
	mu.Unlock()
	_, end, err := second.Guard(ctx, target)
	require.NoError(t, err)
	end()
	require.ErrorIs(t, a.Err(), context.Canceled, "old sessions never resurrect")
}

func TestWorkspaceQuarantineGuardRejectsMissingIdentity(t *testing.T) {
	t.Parallel()
	db := dbmock.NewMockStore(gomock.NewController(t))
	manager := New(db, quartz.NewMock(t))
	_, _, err := manager.Guard(context.Background(), uuid.Nil)
	require.ErrorIs(t, err, ErrQuarantined)
}
