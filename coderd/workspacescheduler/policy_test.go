package workspacescheduler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/workspacescheduler"
)

func fixedPolicy(t *testing.T) workspacescheduler.Policy {
	t.Helper()
	var p workspacescheduler.Policy
	require.NoError(t, json.Unmarshal([]byte(`{"enabled":true,"mode":"fixed","ignoreAdmins":false,"fixed":{"start":"08:00","stop":"18:00","days":[6,0,1,2,3,4,5,1],"timezone":"UTC"}}`), &p))
	return p
}

func TestFixedSchedule(t *testing.T) {
	t.Parallel()
	p := fixedPolicy(t)
	spec, ttl, err := p.FixedSchedule()
	require.NoError(t, err)
	require.Equal(t, "CRON_TZ=UTC 0 8 * * *", spec)
	require.Equal(t, 10*time.Hour, ttl)
	require.Empty(t, p.Problem(spec, ttl))
	p.Fixed.Timezone = "America/Not_A_Zone"
	_, _, err = p.FixedSchedule()
	require.Error(t, err)
	require.NotEmpty(t, p.Problem(spec, ttl))
}

func TestFixedScheduleFailureDoesNotPoisonRetry(t *testing.T) {
	t.Parallel()
	p := fixedPolicy(t)
	ws := database.Workspace{ID: uuid.New()}
	before := ws
	db := dbmock.NewMockStore(gomock.NewController(t))
	failure := xerrors.New("serialization failure")
	db.EXPECT().UpdateWorkspaceAutostart(gomock.Any(), database.UpdateWorkspaceAutostartParams{ID: ws.ID, AutostartSchedule: sql.NullString{String: "CRON_TZ=UTC 0 8 * * *", Valid: true}}).Return(nil).Times(2)
	db.EXPECT().UpdateWorkspaceTTL(gomock.Any(), database.UpdateWorkspaceTTLParams{ID: ws.ID, Ttl: sql.NullInt64{Int64: int64(10 * time.Hour), Valid: true}}).Return(failure)
	require.ErrorIs(t, p.ApplyFixed(context.Background(), db, &ws), failure)
	require.Equal(t, before, ws)
	db.EXPECT().UpdateWorkspaceTTL(gomock.Any(), gomock.Any()).Return(nil)
	require.NoError(t, p.ApplyFixed(context.Background(), db, &ws))
	require.Equal(t, int64(10*time.Hour), ws.Ttl.Int64)
}

func TestDeadlineCannotBeExtendedByActivityOrScheduleRepair(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	p := workspacescheduler.Policy{Enabled: true, Mode: "user"}
	ws := database.Workspace{}
	deadline, maximum := p.Limit(ws, now.Add(-time.Hour), now, time.Time{}, time.Time{})
	require.Equal(t, now.Add(workspacescheduler.CorrectionWindow), deadline)
	require.Equal(t, deadline, maximum)
	ws.AutostartSchedule = sql.NullString{String: "0 8 * * *", Valid: true}
	ws.Ttl = sql.NullInt64{Int64: int64(8 * time.Hour), Valid: true}
	next, ceiling := p.Limit(ws, now.Add(-time.Hour), now.Add(time.Minute), now.Add(10*time.Hour), maximum)
	require.Equal(t, deadline, next)
	require.Equal(t, maximum, ceiling)
	p = fixedPolicy(t)
	p.Fixed.Timezone = "Invalid/Zone"
	next, ceiling = p.Limit(ws, now.Add(-time.Hour), now, deadline, maximum)
	require.Equal(t, deadline, next)
	require.Equal(t, maximum, ceiling)
}
