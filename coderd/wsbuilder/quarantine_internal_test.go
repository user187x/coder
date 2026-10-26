package wsbuilder

import (
	"context"
	"database/sql"
	"testing"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type quarantineStore struct {
	database.Store
	row      database.WorkspaceQuarantine
	err      error
	consumed bool
	queried  bool
}

func (s *quarantineStore) AcquireLock(context.Context, int64) error { return nil }
func (s *quarantineStore) TouchWorkspaceQuarantineLock(context.Context, uuid.UUID) (int64, error) {
	return 1, nil
}
func (s *quarantineStore) GetWorkspaceQuarantineByWorkspaceID(context.Context, uuid.UUID) (database.WorkspaceQuarantine, error) {
	s.queried = true
	return s.row, s.err
}
func (s *quarantineStore) ConsumeWorkspaceQuarantineManualStart(context.Context, database.ConsumeWorkspaceQuarantineManualStartParams) error {
	s.consumed = true
	return nil
}

func TestWorkspaceQuarantineBuildGuard(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name                                     string
		transition                               database.WorkspaceTransition
		enabled, manual, latch, denied, consumed bool
	}{
		{name: "quarantined manual Start", transition: database.WorkspaceTransitionStart, enabled: true, manual: true, latch: true, denied: true},
		{name: "quarantined Delete", transition: database.WorkspaceTransitionDelete, enabled: true, latch: true, denied: true},
		{name: "quarantined Stop permitted", transition: database.WorkspaceTransitionStop, enabled: true, latch: true},
		{name: "released scheduled Start denied", transition: database.WorkspaceTransitionStart, latch: true, denied: true},
		{name: "released explicit Start consumes latch", transition: database.WorkspaceTransitionStart, latch: true, manual: true, consumed: true},
		{name: "released reviewed Delete needs no boot", transition: database.WorkspaceTransitionDelete, latch: true},
		{name: "unrestricted scheduled Start", transition: database.WorkspaceTransitionStart},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			wid, oid := uuid.New(), uuid.New()
			store := &quarantineStore{row: database.WorkspaceQuarantine{WorkspaceID: wid, OrganizationID: oid, Enabled: tc.enabled, ManualStartRequired: tc.latch, ReleasePrepared: true}}
			builder := Builder{workspace: database.Workspace{ID: wid, OrganizationID: oid}, trans: tc.transition, ctx: context.Background(), store: store, manualStart: tc.manual}
			err := builder.checkQuarantine()
			if tc.denied {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.Equal(t, tc.consumed, store.consumed)
			if tc.transition == database.WorkspaceTransitionStop {
				require.False(t, store.queried)
			}
		})
	}
}

func TestWorkspaceQuarantineBuildGuardFailClosed(t *testing.T) {
	t.Parallel()
	store := &quarantineStore{err: sql.ErrConnDone}
	builder := Builder{workspace: database.Workspace{ID: uuid.New()}, trans: database.WorkspaceTransitionStart, ctx: context.Background(), store: store, manualStart: true}
	require.Error(t, builder.checkQuarantine())
	require.False(t, store.consumed)
	store.err = nil
	store.row = database.WorkspaceQuarantine{ManualStartRequired: true, ReleasePrepared: false}
	require.Error(t, builder.checkQuarantine())
	require.False(t, store.consumed)
	store.err = sql.ErrNoRows
	require.NoError(t, builder.checkQuarantine())
}
