package dbpurge_test

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"
	"go.uber.org/mock/gomock"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
	"cdr.dev/slog/v3/sloggers/slogtest"
	"github.com/coder/coder/v2/coderd/coderdtest/promhelp"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/database/dbpurge"
	"github.com/coder/coder/v2/coderd/database/dbrollup"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/provisionerdserver"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/provisionerd/proto"
	"github.com/coder/coder/v2/provisionersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
	"github.com/coder/serpent"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m, testutil.GoleakOptions...)
}

// Ensures no goroutines leak.
//
//nolint:paralleltest // It uses LockIDDBPurge.
func TestPurge(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
	defer cancel()

	// We want to make sure dbpurge is actually started so that this test is meaningful.
	clk := quartz.NewMock(t)
	done := awaitDoTick(ctx, t, clk)
	mDB := dbmock.NewMockStore(gomock.NewController(t))
	mDB.EXPECT().InTx(gomock.Any(), database.DefaultTXOptions().WithID("db_purge")).Return(nil).Times(2)
	purger := dbpurge.New(context.Background(), testutil.Logger(t), mDB, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	<-done // wait for doTick() to run.
	require.NoError(t, purger.Close())
}

//nolint:paralleltest // It uses LockIDDBPurge.
func TestMetrics(t *testing.T) {
	t.Run("SuccessfulIteration", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
		defer cancel()

		reg := prometheus.NewRegistry()
		clk := quartz.NewMock(t)
		now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)
		clk.Set(now).MustWait(ctx)

		db, _ := dbtestutil.NewDB(t)
		logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
		user := dbgen.User(t, db, database.User{})

		oldExpiredKey, _ := dbgen.APIKey(t, db, database.APIKey{
			UserID:    user.ID,
			ExpiresAt: now.Add(-8 * 24 * time.Hour), // Expired 8 days ago
			TokenName: "old-expired-key",
		})

		_, err := db.GetAPIKeyByID(ctx, oldExpiredKey.ID)
		require.NoError(t, err, "key should exist before purge")

		done := awaitDoTick(ctx, t, clk)
		closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
			Retention: codersdk.RetentionConfig{
				APIKeys: serpent.Duration(7 * 24 * time.Hour), // 7 days retention
			},
		}, reg, dbpurge.WithClock(clk))
		defer closer.Close()
		testutil.TryReceive(ctx, t, done)

		hist := promhelp.HistogramValue(t, reg, "coderd_dbpurge_iteration_duration_seconds", prometheus.Labels{
			"success": "true",
		})
		require.NotNil(t, hist)
		require.Greater(t, hist.GetSampleCount(), uint64(0), "should have at least one sample")

		expiredAPIKeys := promhelp.CounterValue(t, reg, "coderd_dbpurge_records_purged_total", prometheus.Labels{
			"record_type": "expired_api_keys",
		})
		require.Greater(t, expiredAPIKeys, 0, "should have deleted at least one expired API key")

		_, err = db.GetAPIKeyByID(ctx, oldExpiredKey.ID)
		require.Error(t, err, "key should be deleted after purge")

		workspaceAgentLogs := promhelp.CounterValue(t, reg, "coderd_dbpurge_records_purged_total", prometheus.Labels{
			"record_type": "workspace_agent_logs",
		})
		require.GreaterOrEqual(t, workspaceAgentLogs, 0)

		connectionLogs := promhelp.CounterValue(t, reg, "coderd_dbpurge_records_purged_total", prometheus.Labels{
			"record_type": "connection_logs",
		})
		require.GreaterOrEqual(t, connectionLogs, 0)

		auditLogs := promhelp.CounterValue(t, reg, "coderd_dbpurge_records_purged_total", prometheus.Labels{
			"record_type": "audit_logs",
		})
		require.GreaterOrEqual(t, auditLogs, 0)

		workspaceBuildOrchestrations := promhelp.CounterValue(t, reg, "coderd_dbpurge_records_purged_total", prometheus.Labels{
			"record_type": "workspace_build_orchestrations",
		})
		require.GreaterOrEqual(t, workspaceBuildOrchestrations, 0)
	})

	t.Run("LockNotAcquiredSkipsIterationMetric", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
		defer cancel()

		reg := prometheus.NewRegistry()
		clk := quartz.NewMock(t)
		now := clk.Now()
		clk.Set(now).MustWait(ctx)

		ctrl := gomock.NewController(t)
		mDB := dbmock.NewMockStore(ctrl)
		mDB.EXPECT().TryAcquireLock(gomock.Any(), int64(database.LockIDDBPurge)).Return(false, nil).AnyTimes()
		mDB.EXPECT().InTx(gomock.Any(), database.DefaultTXOptions().WithID("db_purge")).
			DoAndReturn(func(f func(database.Store) error, _ *database.TxOptions) error {
				return f(mDB)
			}).MinTimes(1)

		logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

		done := awaitDoTick(ctx, t, clk)
		closer := dbpurge.New(ctx, logger, mDB, &codersdk.DeploymentValues{}, reg, dbpurge.WithClock(clk))
		defer closer.Close()
		testutil.TryReceive(ctx, t, done)

		successHist := promhelp.MetricValue(t, reg, "coderd_dbpurge_iteration_duration_seconds", prometheus.Labels{
			"success": "true",
		})
		require.Nil(t, successHist, "lock contention should not record a successful purge iteration")

		failedHist := promhelp.MetricValue(t, reg, "coderd_dbpurge_iteration_duration_seconds", prometheus.Labels{
			"success": "false",
		})
		require.Nil(t, failedHist, "lock contention should not record a failed purge iteration")
	})

	t.Run("FailedIteration", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
		defer cancel()

		reg := prometheus.NewRegistry()
		clk := quartz.NewMock(t)
		now := clk.Now()
		clk.Set(now).MustWait(ctx)

		ctrl := gomock.NewController(t)
		mDB := dbmock.NewMockStore(ctrl)
		mDB.EXPECT().InTx(gomock.Any(), database.DefaultTXOptions().WithID("db_purge")).
			Return(xerrors.New("simulated database error")).
			MinTimes(1)

		logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

		done := awaitDoTick(ctx, t, clk)
		closer := dbpurge.New(ctx, logger, mDB, &codersdk.DeploymentValues{}, reg, dbpurge.WithClock(clk))
		defer closer.Close()
		testutil.TryReceive(ctx, t, done)

		hist := promhelp.HistogramValue(t, reg, "coderd_dbpurge_iteration_duration_seconds", prometheus.Labels{
			"success": "false",
		})
		require.NotNil(t, hist)
		require.Greater(t, hist.GetSampleCount(), uint64(0), "should have at least one sample")

		successHist := promhelp.MetricValue(t, reg, "coderd_dbpurge_iteration_duration_seconds", prometheus.Labels{
			"success": "true",
		})
		require.Nil(t, successHist, "should not have success=true metric on failure")
	})

}

//nolint:paralleltest // It uses LockIDDBPurge.
func TestDeleteOldWorkspaceAgentStats(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitLong)
	defer cancel()

	now := dbtime.Now()
	// TODO: must refactor DeleteOldWorkspaceAgentStats to allow passing in cutoff
	//       before using quarts.NewMock()
	clk := quartz.NewReal()
	db, _ := dbtestutil.NewDB(t)
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}).Leveled(slog.LevelDebug)

	defer func() {
		if t.Failed() {
			t.Log("Test failed, printing rows...")
			ctx := testutil.Context(t, testutil.WaitShort)
			buf := &bytes.Buffer{}
			enc := json.NewEncoder(buf)
			enc.SetIndent("", "\t")
			wasRows, err := db.GetWorkspaceAgentStats(ctx, now.AddDate(0, -7, 0))
			if err == nil {
				_, _ = fmt.Fprintf(buf, "workspace agent stats: ")
				_ = enc.Encode(wasRows)
			}
			tusRows, err := db.GetTemplateUsageStats(context.Background(), database.GetTemplateUsageStatsParams{
				StartTime: now.AddDate(0, -7, 0),
				EndTime:   now,
			})
			if err == nil {
				_, _ = fmt.Fprintf(buf, "template usage stats: ")
				_ = enc.Encode(tusRows)
			}
			s := bufio.NewScanner(buf)
			for s.Scan() {
				t.Log(s.Text())
			}
			_ = s.Err()
		}
	}()

	// given
	// Note: We use increments of 2 hours to ensure we avoid any DST
	// conflicts, verifying DST behavior is beyond the scope of this
	// test.
	// Let's use RxBytes to identify stat entries.
	// Stat inserted 180 days + 2 hour ago, should be deleted.
	first := dbgen.WorkspaceAgentStat(t, db, database.WorkspaceAgentStat{
		CreatedAt:                 now.AddDate(0, 0, -180).Add(-2 * time.Hour),
		ConnectionCount:           1,
		ConnectionMedianLatencyMS: 1,
		RxBytes:                   1111,
		SessionCounts:             dbgen.SessionCounts(t, map[string]int64{"ssh": 1}),
	})

	// Stat inserted 180 days - 2 hour ago, should not be deleted before rollup.
	second := dbgen.WorkspaceAgentStat(t, db, database.WorkspaceAgentStat{
		CreatedAt:                 now.AddDate(0, 0, -180).Add(2 * time.Hour),
		ConnectionCount:           1,
		ConnectionMedianLatencyMS: 1,
		RxBytes:                   2222,
		SessionCounts:             dbgen.SessionCounts(t, map[string]int64{"ssh": 1}),
	})

	// Stat inserted 179 days - 4 hour ago, should not be deleted at all.
	third := dbgen.WorkspaceAgentStat(t, db, database.WorkspaceAgentStat{
		CreatedAt:                 now.AddDate(0, 0, -179).Add(4 * time.Hour),
		ConnectionCount:           1,
		ConnectionMedianLatencyMS: 1,
		RxBytes:                   3333,
		SessionCounts:             dbgen.SessionCounts(t, map[string]int64{"ssh": 1}),
	})

	// when
	closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	defer closer.Close()

	// then
	var stats []database.GetWorkspaceAgentStatsRow
	var err error
	require.Eventuallyf(t, func() bool {
		// Query all stats created not earlier than ~7 months ago
		stats, err = db.GetWorkspaceAgentStats(ctx, now.AddDate(0, 0, -210))
		if err != nil {
			return false
		}
		return !containsWorkspaceAgentStat(stats, first) &&
			containsWorkspaceAgentStat(stats, second)
	}, testutil.WaitShort, testutil.IntervalFast, "it should delete old stats: %v", stats)

	// when
	events := make(chan dbrollup.Event)
	rolluper := dbrollup.New(logger, db, dbrollup.WithEventChannel(events))
	defer rolluper.Close()

	_, _ = <-events, <-events

	// Start a new purger to immediately trigger delete after rollup.
	_ = closer.Close()
	closer = dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	defer closer.Close()

	// then
	require.Eventuallyf(t, func() bool {
		// Query all stats created not earlier than ~7 months ago
		stats, err = db.GetWorkspaceAgentStats(ctx, now.AddDate(0, 0, -210))
		if err != nil {
			return false
		}
		return !containsWorkspaceAgentStat(stats, first) &&
			!containsWorkspaceAgentStat(stats, second) &&
			containsWorkspaceAgentStat(stats, third)
	}, testutil.WaitShort, testutil.IntervalFast, "it should delete old stats after rollup: %v", stats)
}

func containsWorkspaceAgentStat(stats []database.GetWorkspaceAgentStatsRow, needle database.WorkspaceAgentStat) bool {
	return slices.ContainsFunc(stats, func(s database.GetWorkspaceAgentStatsRow) bool {
		return s.WorkspaceRxBytes == needle.RxBytes
	})
}

//nolint:paralleltest // It uses LockIDDBPurge.
func TestDeleteOldWorkspaceAgentLogs(t *testing.T) {
	ctx := testutil.Context(t, testutil.WaitShort)
	clk := quartz.NewMock(t)
	now := dbtime.Now()
	threshold := now.Add(-7 * 24 * time.Hour)
	beforeThreshold := threshold.Add(-24 * time.Hour)
	afterThreshold := threshold.Add(24 * time.Hour)
	clk.Set(now).MustWait(ctx)

	db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
	org := dbgen.Organization(t, db, database.Organization{})
	user := dbgen.User(t, db, database.User{})
	_ = dbgen.OrganizationMember(t, db, database.OrganizationMember{UserID: user.ID, OrganizationID: org.ID})
	tv := dbgen.TemplateVersion(t, db, database.TemplateVersion{OrganizationID: org.ID, CreatedBy: user.ID})
	tmpl := dbgen.Template(t, db, database.Template{OrganizationID: org.ID, ActiveVersionID: tv.ID, CreatedBy: user.ID})

	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

	// Given the following:

	// Workspace A was built twice before the threshold, and never connected on
	// either attempt.
	wsA := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "a", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
	wbA1 := mustCreateWorkspaceBuild(t, db, org, tv, wsA.ID, beforeThreshold, 1)
	wbA2 := mustCreateWorkspaceBuild(t, db, org, tv, wsA.ID, beforeThreshold, 2)
	agentA1 := mustCreateAgent(t, db, wbA1)
	agentA2 := mustCreateAgent(t, db, wbA2)
	mustCreateAgentLogs(ctx, t, db, agentA1, nil, "agent a1 logs should be deleted")
	mustCreateAgentLogs(ctx, t, db, agentA2, nil, "agent a2 logs should be retained")

	// Workspace B was built twice before the threshold.
	wsB := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "b", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
	wbB1 := mustCreateWorkspaceBuild(t, db, org, tv, wsB.ID, beforeThreshold, 1)
	wbB2 := mustCreateWorkspaceBuild(t, db, org, tv, wsB.ID, beforeThreshold, 2)
	agentB1 := mustCreateAgent(t, db, wbB1)
	agentB2 := mustCreateAgent(t, db, wbB2)
	mustCreateAgentLogs(ctx, t, db, agentB1, &beforeThreshold, "agent b1 logs should be deleted")
	mustCreateAgentLogs(ctx, t, db, agentB2, &beforeThreshold, "agent b2 logs should be retained")

	// Workspace C was built once before the threshold, and once after.
	wsC := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "c", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
	wbC1 := mustCreateWorkspaceBuild(t, db, org, tv, wsC.ID, beforeThreshold, 1)
	wbC2 := mustCreateWorkspaceBuild(t, db, org, tv, wsC.ID, afterThreshold, 2)
	agentC1 := mustCreateAgent(t, db, wbC1)
	agentC2 := mustCreateAgent(t, db, wbC2)
	mustCreateAgentLogs(ctx, t, db, agentC1, &beforeThreshold, "agent c1 logs should be deleted")
	mustCreateAgentLogs(ctx, t, db, agentC2, &afterThreshold, "agent c2 logs should be retained")

	// Workspace D was built twice after the threshold.
	wsD := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "d", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
	wbD1 := mustCreateWorkspaceBuild(t, db, org, tv, wsD.ID, afterThreshold, 1)
	wbD2 := mustCreateWorkspaceBuild(t, db, org, tv, wsD.ID, afterThreshold, 2)
	agentD1 := mustCreateAgent(t, db, wbD1)
	agentD2 := mustCreateAgent(t, db, wbD2)
	mustCreateAgentLogs(ctx, t, db, agentD1, &afterThreshold, "agent d1 logs should be retained")
	mustCreateAgentLogs(ctx, t, db, agentD2, &afterThreshold, "agent d2 logs should be retained")

	// Workspace E was build once after threshold but never connected.
	wsE := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "e", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
	wbE1 := mustCreateWorkspaceBuild(t, db, org, tv, wsE.ID, beforeThreshold, 1)
	agentE1 := mustCreateAgent(t, db, wbE1)
	mustCreateAgentLogs(ctx, t, db, agentE1, nil, "agent e1 logs should be retained")

	// when dbpurge runs

	// After dbpurge completes, the ticker is reset. Trap this call.

	done := awaitDoTick(ctx, t, clk)
	closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
		Retention: codersdk.RetentionConfig{
			WorkspaceAgentLogs: serpent.Duration(7 * 24 * time.Hour),
		},
	}, prometheus.NewRegistry(), dbpurge.WithClock(clk))

	defer closer.Close()
	<-done // doTick() has now run.

	// then logs related to the following agents should be deleted:
	// Agent A1 never connected, was created before the threshold, and is not the
	// latest build.
	assertNoWorkspaceAgentLogs(ctx, t, db, agentA1.ID)
	// Agent B1 is not the latest build and the logs are from before threshold.
	assertNoWorkspaceAgentLogs(ctx, t, db, agentB1.ID)
	// Agent C1 is not the latest build and the logs are from before threshold.
	assertNoWorkspaceAgentLogs(ctx, t, db, agentC1.ID)

	// then logs related to the following agents should be retained:
	// Agent A2 is the latest build.
	assertWorkspaceAgentLogs(ctx, t, db, agentA2.ID, "agent a2 logs should be retained")
	// Agent B2 is the latest build.
	assertWorkspaceAgentLogs(ctx, t, db, agentB2.ID, "agent b2 logs should be retained")
	// Agent C2 is the latest build.
	assertWorkspaceAgentLogs(ctx, t, db, agentC2.ID, "agent c2 logs should be retained")
	// Agents D1, D2, and E1 are all after threshold.
	assertWorkspaceAgentLogs(ctx, t, db, agentD1.ID, "agent d1 logs should be retained")
	assertWorkspaceAgentLogs(ctx, t, db, agentD2.ID, "agent d2 logs should be retained")
	assertWorkspaceAgentLogs(ctx, t, db, agentE1.ID, "agent e1 logs should be retained")
}

func awaitDoTick(ctx context.Context, t *testing.T, clk *quartz.Mock) chan struct{} {
	t.Helper()
	ch := make(chan struct{})
	trapNow := clk.Trap().Now()
	trapStop := clk.Trap().TickerStop()
	trapReset := clk.Trap().TickerReset()
	go func() {
		defer close(ch)
		defer trapReset.Close()
		defer trapStop.Close()
		defer trapNow.Close()
		// Wait for the initial tick signified by a call to Now().
		trapNow.MustWait(ctx).MustRelease(ctx)
		// doTick runs here. Wait for the next
		// ticker reset event that signifies it's completed.
		trapReset.MustWait(ctx).MustRelease(ctx)
		// Ensure that the next tick happens in 10 minutes from start.
		d, w := clk.AdvanceNext()
		if !assert.Equal(t, 10*time.Minute, d) {
			return
		}
		w.MustWait(ctx)
		// Wait for the ticker stop event.
		trapStop.MustWait(ctx).MustRelease(ctx)
	}()

	return ch
}

func assertNoWorkspaceAgentLogs(ctx context.Context, t *testing.T, db database.Store, agentID uuid.UUID) {
	t.Helper()
	agentLogs, err := db.GetWorkspaceAgentLogsAfter(ctx, database.GetWorkspaceAgentLogsAfterParams{
		AgentID:      agentID,
		CreatedAfter: 0,
	})
	require.NoError(t, err)
	assert.Empty(t, agentLogs)
}

func assertWorkspaceAgentLogs(ctx context.Context, t *testing.T, db database.Store, agentID uuid.UUID, msg string) {
	t.Helper()
	agentLogs, err := db.GetWorkspaceAgentLogsAfter(ctx, database.GetWorkspaceAgentLogsAfterParams{
		AgentID:      agentID,
		CreatedAfter: 0,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, agentLogs)
	for _, al := range agentLogs {
		assert.Equal(t, msg, al.Output)
	}
}

func mustCreateWorkspaceBuild(t *testing.T, db database.Store, org database.Organization, tv database.TemplateVersion, wsID uuid.UUID, createdAt time.Time, n int32) database.WorkspaceBuild {
	t.Helper()
	job := dbgen.ProvisionerJob(t, db, nil, database.ProvisionerJob{
		CreatedAt:      createdAt,
		OrganizationID: org.ID,
		Type:           database.ProvisionerJobTypeWorkspaceBuild,
		Provisioner:    database.ProvisionerTypeEcho,
		StorageMethod:  database.ProvisionerStorageMethodFile,
	})
	wb := dbgen.WorkspaceBuild(t, db, database.WorkspaceBuild{
		CreatedAt:         createdAt,
		WorkspaceID:       wsID,
		JobID:             job.ID,
		TemplateVersionID: tv.ID,
		Transition:        database.WorkspaceTransitionStart,
		Reason:            database.BuildReasonInitiator,
		BuildNumber:       n,
	})
	require.Equal(t, createdAt.UTC(), wb.CreatedAt.UTC())
	return wb
}

func mustCreateAgent(t *testing.T, db database.Store, wb database.WorkspaceBuild) database.WorkspaceAgent {
	t.Helper()
	resource := dbgen.WorkspaceResource(t, db, database.WorkspaceResource{
		JobID:      wb.JobID,
		Transition: database.WorkspaceTransitionStart,
		CreatedAt:  wb.CreatedAt,
	})

	ws, err := db.GetWorkspaceByID(context.Background(), wb.WorkspaceID)
	require.NoError(t, err)

	wa := dbgen.WorkspaceAgent(t, db, database.WorkspaceAgent{
		Name:             fmt.Sprintf("%s%d", ws.Name, wb.BuildNumber),
		ResourceID:       resource.ID,
		CreatedAt:        wb.CreatedAt,
		FirstConnectedAt: sql.NullTime{},
		DisconnectedAt:   sql.NullTime{},
		LastConnectedAt:  sql.NullTime{},
	})
	require.Equal(t, wb.CreatedAt.UTC(), wa.CreatedAt.UTC())
	return wa
}

func mustCreateAgentLogs(ctx context.Context, t *testing.T, db database.Store, agent database.WorkspaceAgent, agentLastConnectedAt *time.Time, output string) {
	t.Helper()
	if agentLastConnectedAt != nil {
		require.NoError(t, db.UpdateWorkspaceAgentConnectionByID(ctx, database.UpdateWorkspaceAgentConnectionByIDParams{
			ID:              agent.ID,
			LastConnectedAt: sql.NullTime{Time: *agentLastConnectedAt, Valid: true},
		}))
	}
	_, err := db.InsertWorkspaceAgentLogs(ctx, database.InsertWorkspaceAgentLogsParams{
		AgentID:   agent.ID,
		CreatedAt: agent.CreatedAt,
		Output:    []string{output},
		Level:     []database.LogLevel{database.LogLevelDebug},
	})
	require.NoError(t, err)
	// Make sure that agent logs have been collected.
	agentLogs, err := db.GetWorkspaceAgentLogsAfter(ctx, database.GetWorkspaceAgentLogsAfterParams{
		AgentID: agent.ID,
	})
	require.NoError(t, err)
	require.NotEmpty(t, agentLogs, "agent logs must be present")
}

func TestDeleteOldWorkspaceAgentLogsRetention(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)

	testCases := []struct {
		name            string
		retentionConfig codersdk.RetentionConfig
		logsAge         time.Duration
		expectDeleted   bool
	}{
		{
			name: "RetentionEnabled",
			retentionConfig: codersdk.RetentionConfig{
				WorkspaceAgentLogs: serpent.Duration(7 * 24 * time.Hour), // 7 days
			},
			logsAge:       8 * 24 * time.Hour, // 8 days ago
			expectDeleted: true,
		},
		{
			name: "RetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				WorkspaceAgentLogs: serpent.Duration(0),
			},
			logsAge:       60 * 24 * time.Hour, // 60 days ago
			expectDeleted: false,
		},

		{
			name: "CustomRetention30Days",
			retentionConfig: codersdk.RetentionConfig{
				WorkspaceAgentLogs: serpent.Duration(30 * 24 * time.Hour), // 30 days
			},
			logsAge:       31 * 24 * time.Hour, // 31 days ago
			expectDeleted: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			oldTime := now.Add(-tc.logsAge)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
			org := dbgen.Organization(t, db, database.Organization{})
			user := dbgen.User(t, db, database.User{})
			_ = dbgen.OrganizationMember(t, db, database.OrganizationMember{UserID: user.ID, OrganizationID: org.ID})
			tv := dbgen.TemplateVersion(t, db, database.TemplateVersion{OrganizationID: org.ID, CreatedBy: user.ID})
			tmpl := dbgen.Template(t, db, database.Template{OrganizationID: org.ID, ActiveVersionID: tv.ID, CreatedBy: user.ID})

			ws := dbgen.Workspace(t, db, database.WorkspaceTable{Name: "test-ws", OwnerID: user.ID, OrganizationID: org.ID, TemplateID: tmpl.ID})
			wb1 := mustCreateWorkspaceBuild(t, db, org, tv, ws.ID, oldTime, 1)
			wb2 := mustCreateWorkspaceBuild(t, db, org, tv, ws.ID, oldTime, 2)
			agent1 := mustCreateAgent(t, db, wb1)
			agent2 := mustCreateAgent(t, db, wb2)
			mustCreateAgentLogs(ctx, t, db, agent1, &oldTime, "agent 1 logs")
			mustCreateAgentLogs(ctx, t, db, agent2, &oldTime, "agent 2 logs")

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify results.
			if tc.expectDeleted {
				assertNoWorkspaceAgentLogs(ctx, t, db, agent1.ID)
			} else {
				assertWorkspaceAgentLogs(ctx, t, db, agent1.ID, "agent 1 logs")
			}
			// Latest build logs are always retained.
			assertWorkspaceAgentLogs(ctx, t, db, agent2.ID, "agent 2 logs")
		})
	}
}

//nolint:paralleltest // It uses LockIDDBPurge.
func TestDeleteOldProvisionerDaemons(t *testing.T) {
	// TODO: must refactor DeleteOldProvisionerDaemons to allow passing in cutoff
	//       before using quartz.NewMock
	clk := quartz.NewReal()
	db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
	defaultOrg := dbgen.Organization(t, db, database.Organization{})
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
	defer cancel()

	now := dbtime.Now()

	// given
	_, err := db.UpsertProvisionerDaemon(ctx, database.UpsertProvisionerDaemonParams{
		// Provisioner daemon created 14 days ago, and checked in just before 7 days deadline.
		Name:         "external-0",
		Provisioners: []database.ProvisionerType{"echo"},
		Tags:         database.StringMap{provisionersdk.TagScope: provisionersdk.ScopeOrganization},
		CreatedAt:    now.AddDate(0, 0, -14),
		// Note: adding an hour and a minute to account for DST variations
		LastSeenAt:     sql.NullTime{Valid: true, Time: now.AddDate(0, 0, -7).Add(61 * time.Minute)},
		Version:        "1.0.0",
		APIVersion:     proto.CurrentVersion.String(),
		OrganizationID: defaultOrg.ID,
		KeyID:          codersdk.ProvisionerKeyUUIDBuiltIn,
	})
	require.NoError(t, err)
	_, err = db.UpsertProvisionerDaemon(ctx, database.UpsertProvisionerDaemonParams{
		// Provisioner daemon created 8 days ago, and checked in last time an hour after creation.
		Name:           "external-1",
		Provisioners:   []database.ProvisionerType{"echo"},
		Tags:           database.StringMap{provisionersdk.TagScope: provisionersdk.ScopeOrganization},
		CreatedAt:      now.AddDate(0, 0, -8),
		LastSeenAt:     sql.NullTime{Valid: true, Time: now.AddDate(0, 0, -8).Add(time.Hour)},
		Version:        "1.0.0",
		APIVersion:     proto.CurrentVersion.String(),
		OrganizationID: defaultOrg.ID,
		KeyID:          codersdk.ProvisionerKeyUUIDBuiltIn,
	})
	require.NoError(t, err)
	_, err = db.UpsertProvisionerDaemon(ctx, database.UpsertProvisionerDaemonParams{
		// Provisioner daemon created 9 days ago, and never checked in.
		Name:         "alice-provisioner",
		Provisioners: []database.ProvisionerType{"echo"},
		Tags: database.StringMap{
			provisionersdk.TagScope: provisionersdk.ScopeUser,
			provisionersdk.TagOwner: uuid.NewString(),
		},
		CreatedAt:      now.AddDate(0, 0, -9),
		Version:        "1.0.0",
		APIVersion:     proto.CurrentVersion.String(),
		OrganizationID: defaultOrg.ID,
		KeyID:          codersdk.ProvisionerKeyUUIDBuiltIn,
	})
	require.NoError(t, err)
	_, err = db.UpsertProvisionerDaemon(ctx, database.UpsertProvisionerDaemonParams{
		// Provisioner daemon created 6 days ago, and never checked in.
		Name:         "bob-provisioner",
		Provisioners: []database.ProvisionerType{"echo"},
		Tags: database.StringMap{
			provisionersdk.TagScope: provisionersdk.ScopeUser,
			provisionersdk.TagOwner: uuid.NewString(),
		},
		CreatedAt:      now.AddDate(0, 0, -6),
		LastSeenAt:     sql.NullTime{Valid: true, Time: now.AddDate(0, 0, -6)},
		Version:        "1.0.0",
		APIVersion:     proto.CurrentVersion.String(),
		OrganizationID: defaultOrg.ID,
		KeyID:          codersdk.ProvisionerKeyUUIDBuiltIn,
	})
	require.NoError(t, err)

	// when
	closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	defer closer.Close()

	// then
	require.Eventually(t, func() bool {
		daemons, err := db.GetProvisionerDaemons(ctx)
		if err != nil {
			return false
		}

		daemonNames := make([]string, 0, len(daemons))
		for _, d := range daemons {
			daemonNames = append(daemonNames, d.Name)
		}
		t.Logf("found %d daemons: %v", len(daemons), daemonNames)

		return containsProvisionerDaemon(daemons, "external-0") &&
			!containsProvisionerDaemon(daemons, "external-1") &&
			!containsProvisionerDaemon(daemons, "alice-provisioner") &&
			containsProvisionerDaemon(daemons, "bob-provisioner")
	}, testutil.WaitShort, testutil.IntervalSlow)
}

func containsProvisionerDaemon(daemons []database.ProvisionerDaemon, name string) bool {
	return slices.ContainsFunc(daemons, func(d database.ProvisionerDaemon) bool {
		return d.Name == name
	})
}

//nolint:paralleltest // It uses LockIDDBPurge.
func TestDeleteOldAuditLogConnectionEvents(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
	defer cancel()

	clk := quartz.NewMock(t)
	now := dbtime.Now()
	afterThreshold := now.Add(-91 * 24 * time.Hour)       // 91 days ago (older than 90 day threshold)
	beforeThreshold := now.Add(-30 * 24 * time.Hour)      // 30 days ago (newer than 90 day threshold)
	closeBeforeThreshold := now.Add(-89 * 24 * time.Hour) // 89 days ago
	clk.Set(now).MustWait(ctx)

	db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
	user := dbgen.User(t, db, database.User{})
	org := dbgen.Organization(t, db, database.Organization{})

	oldConnectLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           afterThreshold,
		Action:         database.AuditActionConnect,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	oldDisconnectLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           afterThreshold,
		Action:         database.AuditActionDisconnect,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	oldOpenLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           afterThreshold,
		Action:         database.AuditActionOpen,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	oldCloseLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           afterThreshold,
		Action:         database.AuditActionClose,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	recentConnectLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           beforeThreshold,
		Action:         database.AuditActionConnect,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	oldNonConnectionLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           afterThreshold,
		Action:         database.AuditActionCreate,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	nearThresholdConnectLog := dbgen.AuditLog(t, db, database.AuditLog{
		UserID:         user.ID,
		OrganizationID: org.ID,
		Time:           closeBeforeThreshold,
		Action:         database.AuditActionConnect,
		ResourceType:   database.ResourceTypeWorkspace,
	})

	// Run the purge
	done := awaitDoTick(ctx, t, clk)
	closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	defer closer.Close()
	// Wait for tick
	testutil.TryReceive(ctx, t, done)

	// Verify results by querying all audit logs
	logs, err := db.GetAuditLogsOffset(ctx, database.GetAuditLogsOffsetParams{})
	require.NoError(t, err)

	// Extract log IDs for comparison
	logIDs := make([]uuid.UUID, len(logs))
	for i, log := range logs {
		logIDs[i] = log.AuditLog.ID
	}

	require.NotContains(t, logIDs, oldConnectLog.ID, "old connect log should be deleted")
	require.NotContains(t, logIDs, oldDisconnectLog.ID, "old disconnect log should be deleted")
	require.NotContains(t, logIDs, oldOpenLog.ID, "old open log should be deleted")
	require.NotContains(t, logIDs, oldCloseLog.ID, "old close log should be deleted")
	require.Contains(t, logIDs, recentConnectLog.ID, "recent connect log should be kept")
	require.Contains(t, logIDs, nearThresholdConnectLog.ID, "near threshold connect log should be kept")
	require.Contains(t, logIDs, oldNonConnectionLog.ID, "old non-connection log should be kept")
}

func TestDeleteOldAuditLogConnectionEventsLimit(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), testutil.WaitShort)
	defer cancel()

	db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
	user := dbgen.User(t, db, database.User{})
	org := dbgen.Organization(t, db, database.Organization{})

	now := dbtime.Now()
	threshold := now.Add(-90 * 24 * time.Hour)

	for i := 0; i < 5; i++ {
		dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           threshold.Add(-time.Duration(i+1) * time.Hour),
			Action:         database.AuditActionConnect,
			ResourceType:   database.ResourceTypeWorkspace,
		})
	}

	err := db.DeleteOldAuditLogConnectionEvents(ctx, database.DeleteOldAuditLogConnectionEventsParams{
		BeforeTime: threshold,
		LimitCount: 1,
	})
	require.NoError(t, err)

	logs, err := db.GetAuditLogsOffset(ctx, database.GetAuditLogsOffsetParams{})
	require.NoError(t, err)

	require.Len(t, logs, 4)

	err = db.DeleteOldAuditLogConnectionEvents(ctx, database.DeleteOldAuditLogConnectionEventsParams{
		BeforeTime: threshold,
		LimitCount: 100,
	})
	require.NoError(t, err)

	logs, err = db.GetAuditLogsOffset(ctx, database.GetAuditLogsOffsetParams{})
	require.NoError(t, err)

	require.Len(t, logs, 0)
}

func TestExpireOldAPIKeys(t *testing.T) {
	t.Parallel()

	// Given: a number of workspaces and API keys owned by a regular user and the prebuilds system user.
	var (
		ctx    = testutil.Context(t, testutil.WaitShort)
		now    = dbtime.Now()
		db, _  = dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
		org    = dbgen.Organization(t, db, database.Organization{})
		user   = dbgen.User(t, db, database.User{})
		tpl    = dbgen.Template(t, db, database.Template{OrganizationID: org.ID, CreatedBy: user.ID})
		userWs = dbgen.Workspace(t, db, database.WorkspaceTable{
			OwnerID:    user.ID,
			TemplateID: tpl.ID,
		})
		prebuildsWs = dbgen.Workspace(t, db, database.WorkspaceTable{
			OwnerID:    database.PrebuildsSystemUserID,
			TemplateID: tpl.ID,
		})
		createAPIKey = func(userID uuid.UUID, name string) database.APIKey {
			k, _ := dbgen.APIKey(t, db, database.APIKey{UserID: userID, TokenName: name, ExpiresAt: now.Add(time.Hour)}, func(iap *database.InsertAPIKeyParams) {
				iap.TokenName = name
			})
			return k
		}
		assertKeyActive = func(kid string) {
			k, err := db.GetAPIKeyByID(ctx, kid)
			require.NoError(t, err)
			assert.True(t, k.ExpiresAt.After(now))
		}
		assertKeyExpired = func(kid string) {
			k, err := db.GetAPIKeyByID(ctx, kid)
			require.NoError(t, err)
			assert.True(t, k.ExpiresAt.Equal(now))
		}
		unnamedUserAPIKey         = createAPIKey(user.ID, "")
		unnamedPrebuildsAPIKey    = createAPIKey(database.PrebuildsSystemUserID, "")
		namedUserAPIKey           = createAPIKey(user.ID, "my-token")
		namedPrebuildsAPIKey      = createAPIKey(database.PrebuildsSystemUserID, "also-my-token")
		userWorkspaceAPIKey1      = createAPIKey(user.ID, provisionerdserver.WorkspaceSessionTokenName(user.ID, userWs.ID))
		userWorkspaceAPIKey2      = createAPIKey(user.ID, provisionerdserver.WorkspaceSessionTokenName(user.ID, prebuildsWs.ID))
		prebuildsWorkspaceAPIKey1 = createAPIKey(database.PrebuildsSystemUserID, provisionerdserver.WorkspaceSessionTokenName(database.PrebuildsSystemUserID, prebuildsWs.ID))
		prebuildsWorkspaceAPIKey2 = createAPIKey(database.PrebuildsSystemUserID, provisionerdserver.WorkspaceSessionTokenName(database.PrebuildsSystemUserID, userWs.ID))
	)

	// When: we call ExpirePrebuildsAPIKeys
	err := db.ExpirePrebuildsAPIKeys(ctx, now)
	// Then: no errors is reported.
	require.NoError(t, err)

	// We do not touch user API keys.
	assertKeyActive(unnamedUserAPIKey.ID)
	assertKeyActive(namedUserAPIKey.ID)
	assertKeyActive(userWorkspaceAPIKey1.ID)
	assertKeyActive(userWorkspaceAPIKey2.ID)
	// Unnamed prebuilds API keys get expired.
	assertKeyExpired(unnamedPrebuildsAPIKey.ID)
	// API keys for workspaces still owned by prebuilds user remain active until claimed.
	assertKeyActive(prebuildsWorkspaceAPIKey1.ID)
	// API keys for workspaces no longer owned by prebuilds user get expired.
	assertKeyExpired(prebuildsWorkspaceAPIKey2.ID)
	// Out of an abundance of caution, we do not expire explicitly named prebuilds API keys.
	assertKeyActive(namedPrebuildsAPIKey.ID)
}

func TestDeleteOldTelemetryHeartbeats(t *testing.T) {
	t.Parallel()

	ctx := testutil.Context(t, testutil.WaitLong)

	db, _, sqlDB := dbtestutil.NewDBWithSQLDB(t, dbtestutil.WithDumpOnFailure())
	logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
	clk := quartz.NewMock(t)
	now := clk.Now().UTC()

	// Insert telemetry heartbeats.
	err := db.InsertTelemetryLock(ctx, database.InsertTelemetryLockParams{
		EventType:      "aibridge_interceptions_summary",
		PeriodEndingAt: now.Add(-25 * time.Hour), // should be purged
	})
	require.NoError(t, err)
	err = db.InsertTelemetryLock(ctx, database.InsertTelemetryLockParams{
		EventType:      "aibridge_interceptions_summary",
		PeriodEndingAt: now.Add(-23 * time.Hour), // should be kept
	})
	require.NoError(t, err)
	err = db.InsertTelemetryLock(ctx, database.InsertTelemetryLockParams{
		EventType:      "aibridge_interceptions_summary",
		PeriodEndingAt: now, // should be kept
	})
	require.NoError(t, err)

	done := awaitDoTick(ctx, t, clk)
	closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
	defer closer.Close()
	<-done // doTick() has now run.

	require.Eventuallyf(t, func() bool {
		// We use an SQL queries directly here because we don't expose queries
		// for deleting heartbeats in the application code.
		var totalCount int
		err := sqlDB.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM telemetry_locks;
		`).Scan(&totalCount)
		assert.NoError(t, err)

		var oldCount int
		err = sqlDB.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM telemetry_locks WHERE period_ending_at < $1;
		`, now.Add(-24*time.Hour)).Scan(&oldCount)
		assert.NoError(t, err)

		// Expect 2 heartbeats remaining and none older than 24 hours.
		t.Logf("eventually: total count: %d, old count: %d", totalCount, oldCount)
		return totalCount == 2 && oldCount == 0
	}, testutil.WaitShort, testutil.IntervalFast, "it should delete old telemetry heartbeats")
}

func TestDeleteOldWorkspaceBuildOrchestrations(t *testing.T) {
	t.Parallel()

	ctx := testutil.Context(t, testutil.WaitShort)
	db, _, rawDB := dbtestutil.NewDBWithSQLDB(t)

	org := dbgen.Organization(t, db, database.Organization{})
	user := dbgen.User(t, db, database.User{})
	versionJob := dbgen.ProvisionerJob(t, db, nil, database.ProvisionerJob{
		OrganizationID: org.ID,
		Type:           database.ProvisionerJobTypeTemplateVersionImport,
	})
	version := dbgen.TemplateVersion(t, db, database.TemplateVersion{
		OrganizationID: org.ID,
		JobID:          versionJob.ID,
		CreatedBy:      user.ID,
	})
	template := dbgen.Template(t, db, database.Template{
		OrganizationID:  org.ID,
		ActiveVersionID: version.ID,
		CreatedBy:       user.ID,
	})
	workspace := dbgen.Workspace(t, db, database.WorkspaceTable{
		OwnerID:        user.ID,
		OrganizationID: org.ID,
		TemplateID:     template.ID,
	})

	now := dbtime.Now()
	cutoff := now.Add(-24 * time.Hour)
	buildTime := cutoff.Add(-time.Hour)
	oldCompletedTime := cutoff.Add(-3 * time.Minute)
	oldFailedTime := cutoff.Add(-2 * time.Minute)
	oldCanceledTime := cutoff.Add(-time.Minute)
	oldPendingTime := cutoff.Add(-time.Minute)
	recentTime := cutoff.Add(time.Minute)

	createBuild := func(buildNumber int32, createdAt time.Time) database.WorkspaceBuild {
		return mustCreateWorkspaceBuild(t, db, org, version, workspace.ID, createdAt, buildNumber)
	}
	insertOrchestration := func(parentBuild database.WorkspaceBuild, updatedAt time.Time) database.WorkspaceBuildOrchestration {
		orchestration, err := db.InsertWorkspaceBuildOrchestration(ctx, database.InsertWorkspaceBuildOrchestrationParams{
			ID:                       uuid.New(),
			CreatedAt:                updatedAt,
			UpdatedAt:                updatedAt,
			ParentBuildID:            parentBuild.ID,
			ChildTransition:          database.WorkspaceTransitionStart,
			ChildRichParameterValues: json.RawMessage("[]"),
		})
		require.NoError(t, err)
		return orchestration
	}

	// Given: old terminal orchestration rows (completed, failed,
	// canceled), an old pending row, and a recent terminal row.
	oldCompletedParent := createBuild(1, buildTime)
	oldCompletedChild := createBuild(2, buildTime)
	oldCompleted := insertOrchestration(oldCompletedParent, oldCompletedTime)
	_, err := db.UpdateWorkspaceBuildOrchestrationCompletedByID(ctx, database.UpdateWorkspaceBuildOrchestrationCompletedByIDParams{
		ID:           oldCompleted.ID,
		ChildBuildID: uuid.NullUUID{UUID: oldCompletedChild.ID, Valid: true},
		UpdatedAt:    oldCompletedTime,
	})
	require.NoError(t, err)

	oldFailedParent := createBuild(3, buildTime)
	oldFailed := insertOrchestration(oldFailedParent, oldFailedTime)
	_, err = db.UpdateWorkspaceBuildOrchestrationFailedByID(ctx, database.UpdateWorkspaceBuildOrchestrationFailedByIDParams{
		ID:        oldFailed.ID,
		Error:     sql.NullString{String: "failed", Valid: true},
		UpdatedAt: oldFailedTime,
	})
	require.NoError(t, err)

	oldCanceledParent := createBuild(4, buildTime)
	oldCanceled := insertOrchestration(oldCanceledParent, oldCanceledTime)
	_, err = db.UpdateWorkspaceBuildOrchestrationCanceledByID(ctx, database.UpdateWorkspaceBuildOrchestrationCanceledByIDParams{
		ID:        oldCanceled.ID,
		UpdatedAt: oldCanceledTime,
	})
	require.NoError(t, err)

	oldPendingParent := createBuild(5, buildTime)
	oldPending := insertOrchestration(oldPendingParent, oldPendingTime)

	recentCompletedParent := createBuild(6, buildTime)
	recentCompletedChild := createBuild(7, buildTime)
	recentCompleted := insertOrchestration(recentCompletedParent, recentTime)
	_, err = db.UpdateWorkspaceBuildOrchestrationCompletedByID(ctx, database.UpdateWorkspaceBuildOrchestrationCompletedByIDParams{
		ID:           recentCompleted.ID,
		ChildBuildID: uuid.NullUUID{UUID: recentCompletedChild.ID, Valid: true},
		UpdatedAt:    recentTime,
	})
	require.NoError(t, err)

	// When: old workspace build orchestrations are deleted with LimitCount 1
	deleted, err := db.DeleteOldWorkspaceBuildOrchestrations(ctx, database.DeleteOldWorkspaceBuildOrchestrationsParams{
		BeforeTime: cutoff,
		LimitCount: 1,
	})
	require.NoError(t, err)
	require.EqualValues(t, 1, deleted)

	// Then: only the oldest terminal row is deleted.
	assertOrchestrationDeleted(ctx, t, rawDB, oldCompletedParent.ID)
	assertOrchestrationExists(ctx, t, rawDB, oldFailedParent.ID, oldFailed.ID)
	assertOrchestrationExists(ctx, t, rawDB, oldCanceledParent.ID, oldCanceled.ID)
	assertOrchestrationExists(ctx, t, rawDB, oldPendingParent.ID, oldPending.ID)
	assertOrchestrationExists(ctx, t, rawDB, recentCompletedParent.ID, recentCompleted.ID)

	// When: old workspace build orchestrations are deleted again.
	deleted, err = db.DeleteOldWorkspaceBuildOrchestrations(ctx, database.DeleteOldWorkspaceBuildOrchestrationsParams{
		BeforeTime: cutoff,
		LimitCount: 10,
	})
	require.NoError(t, err)
	require.EqualValues(t, 2, deleted)

	// Then: the remaining old terminal rows are deleted.
	assertOrchestrationDeleted(ctx, t, rawDB, oldFailedParent.ID)
	assertOrchestrationDeleted(ctx, t, rawDB, oldCanceledParent.ID)
	assertOrchestrationExists(ctx, t, rawDB, oldPendingParent.ID, oldPending.ID)
	assertOrchestrationExists(ctx, t, rawDB, recentCompletedParent.ID, recentCompleted.ID)
}

func assertOrchestrationDeleted(ctx context.Context, t *testing.T, rawDB *sql.DB, parentBuildID uuid.UUID) {
	t.Helper()

	_, err := dbtestutil.GetWorkspaceBuildOrchestrationByParentBuildID(ctx, rawDB, parentBuildID)
	require.ErrorIs(t, err, sql.ErrNoRows)
}

func assertOrchestrationExists(ctx context.Context, t *testing.T, rawDB *sql.DB, parentBuildID uuid.UUID, orchestrationID uuid.UUID) {
	t.Helper()

	orchestration, err := dbtestutil.GetWorkspaceBuildOrchestrationByParentBuildID(ctx, rawDB, parentBuildID)
	require.NoError(t, err)
	require.Equal(t, orchestrationID, orchestration.ID)
}

func TestDeleteOldConnectionLogs(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)
	retentionPeriod := 30 * 24 * time.Hour
	afterThreshold := now.Add(-retentionPeriod).Add(-24 * time.Hour) // 31 days ago (older than threshold)
	beforeThreshold := now.Add(-15 * 24 * time.Hour)                 // 15 days ago (newer than threshold)

	testCases := []struct {
		name                  string
		retentionConfig       codersdk.RetentionConfig
		oldLogTime            time.Time
		recentLogTime         *time.Time // nil means no recent log created
		expectOldDeleted      bool
		expectedLogsRemaining int
	}{
		{
			name: "RetentionEnabled",
			retentionConfig: codersdk.RetentionConfig{
				ConnectionLogs: serpent.Duration(retentionPeriod),
			},
			oldLogTime:            afterThreshold,
			recentLogTime:         &beforeThreshold,
			expectOldDeleted:      true,
			expectedLogsRemaining: 1, // only recent log remains
		},
		{
			name: "RetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				ConnectionLogs: serpent.Duration(0),
			},
			oldLogTime:            now.Add(-365 * 24 * time.Hour), // 1 year ago
			recentLogTime:         nil,
			expectOldDeleted:      false,
			expectedLogsRemaining: 1, // old log is kept
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

			// Setup test fixtures.
			user := dbgen.User(t, db, database.User{})
			org := dbgen.Organization(t, db, database.Organization{})
			_ = dbgen.OrganizationMember(t, db, database.OrganizationMember{UserID: user.ID, OrganizationID: org.ID})
			tv := dbgen.TemplateVersion(t, db, database.TemplateVersion{OrganizationID: org.ID, CreatedBy: user.ID})
			tmpl := dbgen.Template(t, db, database.Template{OrganizationID: org.ID, ActiveVersionID: tv.ID, CreatedBy: user.ID})
			workspace := dbgen.Workspace(t, db, database.WorkspaceTable{
				OwnerID:        user.ID,
				OrganizationID: org.ID,
				TemplateID:     tmpl.ID,
			})

			// Create old connection log.
			oldLog := dbgen.ConnectionLog(t, db, database.UpsertConnectionLogParams{
				ID:               uuid.New(),
				Time:             tc.oldLogTime,
				OrganizationID:   org.ID,
				WorkspaceOwnerID: user.ID,
				WorkspaceID:      workspace.ID,
				WorkspaceName:    workspace.Name,
				AgentName:        "agent1",
				Type:             database.ConnectionTypeSsh,
				ConnectionStatus: database.ConnectionStatusConnected,
			})

			// Create recent connection log if specified.
			var recentLog database.ConnectionLog
			if tc.recentLogTime != nil {
				recentLog = dbgen.ConnectionLog(t, db, database.UpsertConnectionLogParams{
					ID:               uuid.New(),
					Time:             *tc.recentLogTime,
					OrganizationID:   org.ID,
					WorkspaceOwnerID: user.ID,
					WorkspaceID:      workspace.ID,
					WorkspaceName:    workspace.Name,
					AgentName:        "agent2",
					Type:             database.ConnectionTypeSsh,
					ConnectionStatus: database.ConnectionStatusConnected,
				})
			}

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify results.
			logs, err := db.GetConnectionLogsOffset(ctx, database.GetConnectionLogsOffsetParams{
				LimitOpt: 100,
			})
			require.NoError(t, err)
			require.Len(t, logs, tc.expectedLogsRemaining, "unexpected number of logs remaining")

			logIDs := make([]uuid.UUID, len(logs))
			for i, log := range logs {
				logIDs[i] = log.ConnectionLog.ID
			}

			if tc.expectOldDeleted {
				require.NotContains(t, logIDs, oldLog.ID, "old connection log should be deleted")
			} else {
				require.Contains(t, logIDs, oldLog.ID, "old connection log should NOT be deleted")
			}

			if tc.recentLogTime != nil {
				require.Contains(t, logIDs, recentLog.ID, "recent connection log should be kept")
			}
		})
	}
}

func TestDeleteOldAuditLogs(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)
	retentionPeriod := 30 * 24 * time.Hour
	afterThreshold := now.Add(-retentionPeriod).Add(-24 * time.Hour) // 31 days ago (older than threshold)
	beforeThreshold := now.Add(-15 * 24 * time.Hour)                 // 15 days ago (newer than threshold)

	testCases := []struct {
		name                  string
		retentionConfig       codersdk.RetentionConfig
		oldLogTime            time.Time
		recentLogTime         *time.Time // nil means no recent log created
		expectOldDeleted      bool
		expectedLogsRemaining int
	}{
		{
			name: "RetentionEnabled",
			retentionConfig: codersdk.RetentionConfig{
				AuditLogs: serpent.Duration(retentionPeriod),
			},
			oldLogTime:            afterThreshold,
			recentLogTime:         &beforeThreshold,
			expectOldDeleted:      true,
			expectedLogsRemaining: 1, // only recent log remains
		},
		{
			name: "RetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				AuditLogs: serpent.Duration(0),
			},
			oldLogTime:            now.Add(-365 * 24 * time.Hour), // 1 year ago
			recentLogTime:         nil,
			expectOldDeleted:      false,
			expectedLogsRemaining: 1, // old log is kept
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

			// Setup test fixtures.
			user := dbgen.User(t, db, database.User{})
			org := dbgen.Organization(t, db, database.Organization{})

			// Create old audit log.
			oldLog := dbgen.AuditLog(t, db, database.AuditLog{
				UserID:         user.ID,
				OrganizationID: org.ID,
				Time:           tc.oldLogTime,
				Action:         database.AuditActionCreate,
				ResourceType:   database.ResourceTypeWorkspace,
			})

			// Create recent audit log if specified.
			var recentLog database.AuditLog
			if tc.recentLogTime != nil {
				recentLog = dbgen.AuditLog(t, db, database.AuditLog{
					UserID:         user.ID,
					OrganizationID: org.ID,
					Time:           *tc.recentLogTime,
					Action:         database.AuditActionCreate,
					ResourceType:   database.ResourceTypeWorkspace,
				})
			}

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify results.
			logs, err := db.GetAuditLogsOffset(ctx, database.GetAuditLogsOffsetParams{
				LimitOpt: 100,
			})
			require.NoError(t, err)
			require.Len(t, logs, tc.expectedLogsRemaining, "unexpected number of logs remaining")

			logIDs := make([]uuid.UUID, len(logs))
			for i, log := range logs {
				logIDs[i] = log.AuditLog.ID
			}

			if tc.expectOldDeleted {
				require.NotContains(t, logIDs, oldLog.ID, "old audit log should be deleted")
			} else {
				require.Contains(t, logIDs, oldLog.ID, "old audit log should NOT be deleted")
			}

			if tc.recentLogTime != nil {
				require.Contains(t, logIDs, recentLog.ID, "recent audit log should be kept")
			}
		})
	}

	// ConnectionEventsNotDeleted is a special case that tests multiple audit
	// action types, so it's kept as a separate subtest.
	t.Run("ConnectionEventsNotDeleted", func(t *testing.T) {
		t.Parallel()

		ctx := testutil.Context(t, testutil.WaitShort)
		clk := quartz.NewMock(t)
		clk.Set(now).MustWait(ctx)

		db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
		logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
		user := dbgen.User(t, db, database.User{})
		org := dbgen.Organization(t, db, database.Organization{})

		// Create old connection events (should NOT be deleted by audit logs retention).
		oldConnectLog := dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           afterThreshold,
			Action:         database.AuditActionConnect,
			ResourceType:   database.ResourceTypeWorkspace,
		})

		oldDisconnectLog := dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           afterThreshold,
			Action:         database.AuditActionDisconnect,
			ResourceType:   database.ResourceTypeWorkspace,
		})

		oldOpenLog := dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           afterThreshold,
			Action:         database.AuditActionOpen,
			ResourceType:   database.ResourceTypeWorkspace,
		})

		oldCloseLog := dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           afterThreshold,
			Action:         database.AuditActionClose,
			ResourceType:   database.ResourceTypeWorkspace,
		})

		// Create old non-connection audit log (should be deleted).
		oldCreateLog := dbgen.AuditLog(t, db, database.AuditLog{
			UserID:         user.ID,
			OrganizationID: org.ID,
			Time:           afterThreshold,
			Action:         database.AuditActionCreate,
			ResourceType:   database.ResourceTypeWorkspace,
		})

		// Run the purge with audit logs retention enabled.
		done := awaitDoTick(ctx, t, clk)
		closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
			Retention: codersdk.RetentionConfig{
				AuditLogs: serpent.Duration(retentionPeriod),
			},
		}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
		defer closer.Close()
		testutil.TryReceive(ctx, t, done)

		// Verify results.
		logs, err := db.GetAuditLogsOffset(ctx, database.GetAuditLogsOffsetParams{
			LimitOpt: 100,
		})
		require.NoError(t, err)
		require.Len(t, logs, 4, "should have 4 connection event logs remaining")

		logIDs := make([]uuid.UUID, len(logs))
		for i, log := range logs {
			logIDs[i] = log.AuditLog.ID
		}

		// Connection events should NOT be deleted by audit logs retention.
		require.Contains(t, logIDs, oldConnectLog.ID, "old connect log should NOT be deleted by audit logs retention")
		require.Contains(t, logIDs, oldDisconnectLog.ID, "old disconnect log should NOT be deleted by audit logs retention")
		require.Contains(t, logIDs, oldOpenLog.ID, "old open log should NOT be deleted by audit logs retention")
		require.Contains(t, logIDs, oldCloseLog.ID, "old close log should NOT be deleted by audit logs retention")

		// Non-connection event should be deleted.
		require.NotContains(t, logIDs, oldCreateLog.ID, "old create log should be deleted by audit logs retention")
	})
}

func TestDeleteOldBoundaryLogs(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)
	retentionPeriod := 90 * 24 * time.Hour
	beforeThreshold := now.Add(-retentionPeriod).Add(-24 * time.Hour) // 91 days ago (older than threshold, before the cutoff)
	afterThreshold := now.Add(-15 * 24 * time.Hour)                   // 15 days ago (newer than threshold, after the cutoff)

	testCases := []struct {
		name                  string
		retentionConfig       codersdk.RetentionConfig
		oldLogTime            time.Time
		recentLogTime         *time.Time // nil means no recent log created
		expectOldDeleted      bool
		expectedLogsRemaining int
	}{
		{
			name: "RetentionEnabled",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(retentionPeriod),
			},
			oldLogTime:            beforeThreshold,
			recentLogTime:         &afterThreshold,
			expectOldDeleted:      true,
			expectedLogsRemaining: 1, // only recent log remains
		},
		{
			name: "RetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(0),
			},
			oldLogTime:            now.Add(-365 * 24 * time.Hour), // 1 year ago
			recentLogTime:         nil,
			expectOldDeleted:      false,
			expectedLogsRemaining: 1, // old log is kept
		},
		{
			name: "RetentionNegative",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(-retentionPeriod),
			},
			oldLogTime:            now.Add(-365 * 24 * time.Hour), // 1 year ago
			recentLogTime:         nil,
			expectOldDeleted:      false,
			expectedLogsRemaining: 1, // old log is kept
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

			// Create the prerequisite rows (user, org, template, workspace,
			// build, agent) needed to satisfy boundary_sessions foreign keys.
			user := dbgen.User(t, db, database.User{})
			org := dbgen.Organization(t, db, database.Organization{})
			_ = dbgen.OrganizationMember(t, db, database.OrganizationMember{UserID: user.ID, OrganizationID: org.ID})
			tv := dbgen.TemplateVersion(t, db, database.TemplateVersion{OrganizationID: org.ID, CreatedBy: user.ID})
			tmpl := dbgen.Template(t, db, database.Template{OrganizationID: org.ID, ActiveVersionID: tv.ID, CreatedBy: user.ID})
			ws := dbgen.Workspace(t, db, database.WorkspaceTable{
				OwnerID:        user.ID,
				OrganizationID: org.ID,
				TemplateID:     tmpl.ID,
			})
			wb := mustCreateWorkspaceBuild(t, db, org, tv, ws.ID, now, 1)
			agent := mustCreateAgent(t, db, wb)

			session := dbgen.BoundarySession(t, db, database.BoundarySession{
				WorkspaceAgentID: agent.ID,
				OwnerID:          uuid.NullUUID{UUID: user.ID, Valid: true},
			})

			// Create old boundary log.
			oldLogs := dbgen.BoundaryLogs(t, db, []database.BoundaryLog{{
				SessionID:      session.ID,
				OwnerID:        uuid.NullUUID{UUID: user.ID, Valid: true},
				SequenceNumber: 0,
				CapturedAt:     tc.oldLogTime,
				CreatedAt:      tc.oldLogTime,
			}})
			oldLog := oldLogs[0]

			// Create recent boundary log if specified.
			var recentLog database.BoundaryLog
			if tc.recentLogTime != nil {
				recentLogs := dbgen.BoundaryLogs(t, db, []database.BoundaryLog{{
					SessionID:      session.ID,
					OwnerID:        uuid.NullUUID{UUID: user.ID, Valid: true},
					SequenceNumber: 1,
					CapturedAt:     *tc.recentLogTime,
					CreatedAt:      *tc.recentLogTime,
				}})
				recentLog = recentLogs[0]
			}

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify results.
			logs, err := db.ListBoundaryLogsBySessionID(ctx, database.ListBoundaryLogsBySessionIDParams{
				SessionID: session.ID,
				LimitOpt:  100,
			})
			require.NoError(t, err)
			require.Len(t, logs, tc.expectedLogsRemaining, "unexpected number of boundary logs remaining")

			logIDs := make([]uuid.UUID, len(logs))
			for i, l := range logs {
				logIDs[i] = l.ID
			}

			if tc.expectOldDeleted {
				require.NotContains(t, logIDs, oldLog.ID, "old boundary log should be deleted")
			} else {
				require.Contains(t, logIDs, oldLog.ID, "old boundary log should NOT be deleted")
			}

			if tc.recentLogTime != nil {
				require.Contains(t, logIDs, recentLog.ID, "recent boundary log should be kept")
			}
		})
	}
}

func TestDeleteOldBoundarySessions(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)
	retentionPeriod := 90 * 24 * time.Hour
	// oldTime is 91 days ago (past threshold).
	oldTime := now.Add(-retentionPeriod).Add(-24 * time.Hour)
	// recentTime is 15 days ago (within threshold).
	recentTime := now.Add(-15 * 24 * time.Hour)

	testCases := []struct {
		name             string
		retentionConfig  codersdk.RetentionConfig
		sessionUpdatedAt time.Time
		// logTime is the captured_at for the single log inserted with the session.
		// Set to nil to create a session with no logs.
		logTime              *time.Time
		expectSessionDeleted bool
	}{
		{
			name: "SessionDeletedWhenAllLogsExpired",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(retentionPeriod),
			},
			sessionUpdatedAt:     oldTime,
			logTime:              &oldTime, // log is old; will be purged first, leaving session empty
			expectSessionDeleted: true,
		},
		{
			name: "SessionKeptWhenRecentLogExists",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(retentionPeriod),
			},
			sessionUpdatedAt:     oldTime,
			logTime:              &recentTime, // recent log survives log purge, so session kept
			expectSessionDeleted: false,
		},
		{
			name: "SessionKeptWhenRetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(0),
			},
			sessionUpdatedAt:     oldTime,
			logTime:              &oldTime,
			expectSessionDeleted: false,
		},
		{
			name: "SessionKeptWhenRetentionNegative",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(-retentionPeriod),
			},
			sessionUpdatedAt:     oldTime,
			logTime:              &oldTime,
			expectSessionDeleted: false,
		},
		{
			name: "SessionKeptWhenUpdatedAtRecent",
			retentionConfig: codersdk.RetentionConfig{
				BoundaryLogs: serpent.Duration(retentionPeriod),
			},
			sessionUpdatedAt:     recentTime, // session itself is recent. NOT eligible for session purge
			logTime:              nil,        // no logs; but updated_at guard keeps it
			expectSessionDeleted: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})

			// Create the prerequisite rows needed to satisfy boundary_sessions FKs.
			user := dbgen.User(t, db, database.User{})
			org := dbgen.Organization(t, db, database.Organization{})
			_ = dbgen.OrganizationMember(t, db, database.OrganizationMember{UserID: user.ID, OrganizationID: org.ID})
			tv := dbgen.TemplateVersion(t, db, database.TemplateVersion{OrganizationID: org.ID, CreatedBy: user.ID})
			tmpl := dbgen.Template(t, db, database.Template{OrganizationID: org.ID, ActiveVersionID: tv.ID, CreatedBy: user.ID})
			ws := dbgen.Workspace(t, db, database.WorkspaceTable{
				OwnerID:        user.ID,
				OrganizationID: org.ID,
				TemplateID:     tmpl.ID,
			})
			wb := mustCreateWorkspaceBuild(t, db, org, tv, ws.ID, now, 1)
			agent := mustCreateAgent(t, db, wb)

			session := dbgen.BoundarySession(t, db, database.BoundarySession{
				WorkspaceAgentID: agent.ID,
				OwnerID:          uuid.NullUUID{UUID: user.ID, Valid: true},
				UpdatedAt:        tc.sessionUpdatedAt,
			})

			if tc.logTime != nil {
				dbgen.BoundaryLogs(t, db, []database.BoundaryLog{{
					SessionID:      session.ID,
					OwnerID:        uuid.NullUUID{UUID: user.ID, Valid: true},
					SequenceNumber: 0,
					CapturedAt:     *tc.logTime,
					CreatedAt:      *tc.logTime,
				}})
			}

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify session presence/absence.
			_, err := db.GetBoundarySessionByID(ctx, session.ID)
			if tc.expectSessionDeleted {
				require.ErrorIs(t, err, sql.ErrNoRows, "session should have been deleted")
			} else {
				require.NoError(t, err, "session should still exist")
			}
		})
	}
}

func TestDeleteExpiredAPIKeys(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 1, 15, 7, 30, 0, 0, time.UTC)

	testCases := []struct {
		name                    string
		retentionConfig         codersdk.RetentionConfig
		oldExpiredTime          time.Time
		recentExpiredTime       *time.Time // nil means no recent expired key created
		activeTime              *time.Time // nil means no active key created
		expectOldExpiredDeleted bool
		expectedKeysRemaining   int
	}{
		{
			name: "RetentionEnabled",
			retentionConfig: codersdk.RetentionConfig{
				APIKeys: serpent.Duration(7 * 24 * time.Hour), // 7 days
			},
			oldExpiredTime:          now.Add(-8 * 24 * time.Hour),      // Expired 8 days ago
			recentExpiredTime:       ptr(now.Add(-6 * 24 * time.Hour)), // Expired 6 days ago
			activeTime:              ptr(now.Add(24 * time.Hour)),      // Expires tomorrow
			expectOldExpiredDeleted: true,
			expectedKeysRemaining:   2, // recent expired + active
		},
		{
			name: "RetentionDisabled",
			retentionConfig: codersdk.RetentionConfig{
				APIKeys: serpent.Duration(0),
			},
			oldExpiredTime:          now.Add(-365 * 24 * time.Hour), // Expired 1 year ago
			recentExpiredTime:       nil,
			activeTime:              nil,
			expectOldExpiredDeleted: false,
			expectedKeysRemaining:   1, // old expired is kept
		},

		{
			name: "CustomRetention30Days",
			retentionConfig: codersdk.RetentionConfig{
				APIKeys: serpent.Duration(30 * 24 * time.Hour), // 30 days
			},
			oldExpiredTime:          now.Add(-31 * 24 * time.Hour),      // Expired 31 days ago
			recentExpiredTime:       ptr(now.Add(-29 * 24 * time.Hour)), // Expired 29 days ago
			activeTime:              nil,
			expectOldExpiredDeleted: true,
			expectedKeysRemaining:   1, // only recent expired remains
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ctx := testutil.Context(t, testutil.WaitShort)
			clk := quartz.NewMock(t)
			clk.Set(now).MustWait(ctx)

			db, _ := dbtestutil.NewDB(t, dbtestutil.WithDumpOnFailure())
			logger := slogtest.Make(t, &slogtest.Options{IgnoreErrors: true})
			user := dbgen.User(t, db, database.User{})

			// Create API key that expired long ago.
			oldExpiredKey, _ := dbgen.APIKey(t, db, database.APIKey{
				UserID:    user.ID,
				ExpiresAt: tc.oldExpiredTime,
				TokenName: "old-expired-key",
			})

			// Create API key that expired recently if specified.
			var recentExpiredKey database.APIKey
			if tc.recentExpiredTime != nil {
				recentExpiredKey, _ = dbgen.APIKey(t, db, database.APIKey{
					UserID:    user.ID,
					ExpiresAt: *tc.recentExpiredTime,
					TokenName: "recent-expired-key",
				})
			}

			// Create API key that hasn't expired yet if specified.
			var activeKey database.APIKey
			if tc.activeTime != nil {
				activeKey, _ = dbgen.APIKey(t, db, database.APIKey{
					UserID:    user.ID,
					ExpiresAt: *tc.activeTime,
					TokenName: "active-key",
				})
			}

			// Run the purge.
			done := awaitDoTick(ctx, t, clk)
			closer := dbpurge.New(ctx, logger, db, &codersdk.DeploymentValues{
				Retention: tc.retentionConfig,
			}, prometheus.NewRegistry(), dbpurge.WithClock(clk))
			defer closer.Close()
			testutil.TryReceive(ctx, t, done)

			// Verify total keys remaining.
			keys, err := db.GetAPIKeysLastUsedAfter(ctx, time.Time{})
			require.NoError(t, err)
			require.Len(t, keys, tc.expectedKeysRemaining, "unexpected number of keys remaining")

			// Verify results.
			_, err = db.GetAPIKeyByID(ctx, oldExpiredKey.ID)
			if tc.expectOldExpiredDeleted {
				require.Error(t, err, "old expired key should be deleted")
			} else {
				require.NoError(t, err, "old expired key should NOT be deleted")
			}

			if tc.recentExpiredTime != nil {
				_, err = db.GetAPIKeyByID(ctx, recentExpiredKey.ID)
				require.NoError(t, err, "recently expired key should be kept")
			}

			if tc.activeTime != nil {
				_, err = db.GetAPIKeyByID(ctx, activeKey.ID)
				require.NoError(t, err, "active key should be kept")
			}
		})
	}
}

// ptr is a helper to create a pointer to a value.
func ptr[T any](v T) *T {
	return &v
}

func awaitDoTicks(ctx context.Context, t *testing.T, clk *quartz.Mock, n int) func() {
	t.Helper()
	completed := make(chan struct{})
	advance := make(chan struct{})
	trapNow := clk.Trap().Now()
	trapStop := clk.Trap().TickerStop()
	trapReset := clk.Trap().TickerReset()
	go func() {
		defer close(completed)
		defer trapReset.Close()
		defer trapStop.Close()
		defer trapNow.Close()
		trapNow.MustWait(ctx).MustRelease(ctx)
		trapReset.MustWait(ctx).MustRelease(ctx)
		select {
		case completed <- struct{}{}:
		case <-ctx.Done():
			return
		}
		for i := 1; i < n; i++ {
			select {
			case <-advance:
			case <-ctx.Done():
				return
			}
			d, w := clk.AdvanceNext()
			if !assert.Equal(t, 10*time.Minute, d) {
				return
			}
			w.MustWait(ctx)
			trapStop.MustWait(ctx).MustRelease(ctx)
			trapReset.MustWait(ctx).MustRelease(ctx)
			select {
			case completed <- struct{}{}:
			case <-ctx.Done():
				return
			}
		}
	}()
	first := true
	return func() {
		t.Helper()
		if !first {
			testutil.RequireSend(ctx, t, advance, struct{}{})
		}
		first = false
		testutil.TryReceive(ctx, t, completed)
	}
}
