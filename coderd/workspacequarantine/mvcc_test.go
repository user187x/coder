package workspacequarantine_test

import (
	"database/sql"
	"sync/atomic"
	"testing"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/workspacequarantine"
	"github.com/coder/coder/v2/testutil"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestWorkspaceQuarantineWaiterRetriesStaleSnapshot(t *testing.T) {
	t.Parallel()
	db, _ := dbtestutil.NewDB(t)
	org := dbgen.Organization(t, db, database.Organization{})
	owner := dbgen.User(t, db, database.User{})
	fixture := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: org.ID, OwnerID: owner.ID}).Do()
	workspace := fixture.Workspace
	ctx := dbauthz.AsSystemRestricted(testutil.Context(t, testutil.WaitLong))
	locked, snapshot, commit := make(chan struct{}), make(chan struct{}), make(chan struct{})
	activationDone, waiterDone := make(chan error, 1), make(chan error, 1)
	go func() {
		activationDone <- db.InTx(func(tx database.Store) error {
			if err := workspacequarantine.Acquire(ctx, tx, workspace.ID); err != nil {
				return err
			}
			close(locked)
			select {
			case <-commit:
			case <-ctx.Done():
				return ctx.Err()
			}
			_, err := tx.UpsertWorkspaceQuarantine(ctx, database.UpsertWorkspaceQuarantineParams{WorkspaceID: workspace.ID, OrganizationID: workspace.OrganizationID, Enabled: true, Revision: uuid.New(), Reason: "snapshot race", UpdatedBy: workspace.OwnerID})
			return err
		}, nil)
	}()
	testutil.TryReceive(ctx, t, locked)
	var attempts atomic.Int64
	var observed atomic.Bool
	go func() {
		waiterDone <- database.ReadModifyUpdate(db, func(tx database.Store) error {
			if attempts.Add(1) == 1 {
				if _, err := tx.GetWorkspaceByID(ctx, workspace.ID); err != nil {
					return err
				}
				close(snapshot)
			}
			if err := workspacequarantine.Acquire(ctx, tx, workspace.ID); err != nil {
				return err
			}
			policy, err := workspacequarantine.Load(ctx, tx, workspace.ID)
			if err == nil {
				observed.Store(policy.Enabled)
			}
			return err
		})
	}()
	testutil.TryReceive(ctx, t, snapshot)
	close(commit)
	require.NoError(t, testutil.TryReceive(ctx, t, activationDone))
	require.NoError(t, testutil.TryReceive(ctx, t, waiterDone))
	require.GreaterOrEqual(t, attempts.Load(), int64(2), "waiting RepeatableRead must retry after activation")
	require.True(t, observed.Load(), "a stale no-policy snapshot cannot permit Start")
}

func TestWorkspaceQuarantineSecurityReadDoesNotDependOnVisibleMetadata(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	db := dbmock.NewMockStore(gomock.NewController(t))
	db.EXPECT().GetShortTermLeaseByWorkspaceID(gomock.Any(), gomock.Any()).Return(database.ShortTermLease{}, sql.ErrNoRows).AnyTimes()
	db.EXPECT().GetWorkspaceQuarantineByWorkspaceID(gomock.Any(), id).Return(database.WorkspaceQuarantine{WorkspaceID: id, Enabled: true}, nil)
	db.EXPECT().Wrappers().Return([]string{}).AnyTimes()
	wrapped := dbauthz.New(db, &coderdtest.FakeAuthorizer{}, slog.Make(), coderdtest.AccessControlStorePointer())
	policy, err := workspacequarantine.Load(testutil.Context(t, testutil.WaitShort), wrapped, id)
	require.NoError(t, err)
	require.True(t, policy.Enabled)
}
