package platformha_test

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"cdr.dev/slog/v3/sloggers/slogtest"

	"github.com/coder/coder/v2/coderd/platformha"
	"github.com/coder/coder/v2/testutil"
)

func standbyConfig(pod string) platformha.Config {
	c := testConfig(pod)
	c.Mode = platformha.ModeActiveStandby
	c.HandoverTimeout = 5 * time.Second
	return c
}

func startStandby(t *testing.T, db platformha.DB, pod string, mutate ...func(*platformha.Config)) *platformha.Registry {
	t.Helper()
	cfg := standbyConfig(pod)
	for _, m := range mutate {
		m(&cfg)
	}
	r := platformha.NewRegistry(db, cfg, slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}), prometheus.NewRegistry())
	require.NoError(t, r.Start(testutil.Context(t, testutil.WaitShort)))
	return r
}

// turned reports whether WaitForTurn returned within d (a testutil duration).
func turned(t *testing.T, r *platformha.Registry, d time.Duration) bool {
	t.Helper()
	return r.WaitForTurn(testutil.Context(t, d)) == nil
}

func closed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// startActive brings up two replicas and returns them as (active, standby).
func startActive(ctx context.Context, t *testing.T, a, b *platformha.Registry) (active, standby *platformha.Registry) {
	t.Helper()
	testutil.Eventually(ctx, t, func(context.Context) bool {
		switch {
		case turned(t, a, testutil.IntervalFast):
			active, standby = a, b
		case turned(t, b, testutil.IntervalFast):
			active, standby = b, a
		}
		return active != nil
	}, testutil.IntervalFast, "one replica gets its turn")
	active.MarkServing()
	require.Equal(t, platformha.RoleActive, active.Role())
	require.False(t, turned(t, standby, testutil.IntervalSlow), "only one replica starts Coder")
	require.Equal(t, platformha.RoleStandby, standby.Role())
	return active, standby
}

func TestConfigActiveStandby(t *testing.T) {
	t.Parallel()
	c, err := platformha.ConfigFromEnv(func(k string) string {
		return map[string]string{"CODER_PLATFORM_HA_MODE": "activeStandby", "CODER_PLATFORM_HA_HANDOVER_TIMEOUT": "90s"}[k]
	}, "v1")
	require.NoError(t, err)
	require.True(t, c.Leadership())
	require.Equal(t, platformha.DefaultHealthAddress, c.HealthAddress)
	require.Equal(t, 90*time.Second, c.HandoverTimeout)
}

func TestLeadershipOneActiveAndCrashTakeover(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	flakyA := &flakyDB{DB: db}
	flakyB := &flakyDB{DB: db}
	a := startStandby(t, flakyA, "coder-0")
	b := startStandby(t, flakyB, "coder-1")
	active, standby := startActive(ctx, t, a, b)
	flaky := flakyA
	if active == b {
		flaky = flakyB
	}

	// the active replica's database goes away (a partition, a crash): it fences, steps down and must stop Coder
	crashed := time.Now()
	flaky.broken.Store(true)
	testutil.Eventually(ctx, t, func(context.Context) bool { return closed(active.LostActive()) },
		testutil.IntervalFast, "the old leader is told it lost the active lease")
	require.Equal(t, platformha.RoleStandby, active.Role())

	// the standby takes the lease once it lapses, and starts Coder
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, standby, testutil.IntervalFast) },
		testutil.IntervalFast, "the standby gets its turn")
	took := time.Since(crashed)
	cfg := standbyConfig("")
	require.Less(t, took, cfg.LeaseTTL+3*cfg.RenewInterval, "within a lease and a few renewals")
	standby.MarkServing()
	require.Equal(t, platformha.RoleActive, standby.Role())
	t.Logf("takeover after a crash: %s (lease %s)", took.Round(time.Millisecond), cfg.LeaseTTL)
	require.NoError(t, standby.Close(ctx))
}

func TestLeadershipHandoverWithoutAGap(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, next := startActive(ctx, t, a, b)

	done := make(chan error, 1)
	go func() { done <- leader.Handover(ctx) }()

	// the successor starts while the leader still serves
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, next, testutil.IntervalFast) },
		testutil.IntervalFast, "the successor gets its turn during the handover")
	require.Equal(t, platformha.RoleActive, leader.Role(), "the leader still serves while its successor starts")
	next.MarkServing()

	select {
	case err := <-done:
		require.NoError(t, err)
	case <-ctx.Done():
		t.Fatal("the handover did not finish")
	}
	testutil.Eventually(ctx, t, func(context.Context) bool { return next.Role() == platformha.RoleActive },
		testutil.IntervalFast, "the successor takes the lease")
	require.Equal(t, platformha.RoleStandby, leader.Role())
	require.False(t, closed(leader.LostActive()), "a handover is not a loss")
	require.NoError(t, leader.Close(ctx))
	require.NoError(t, next.Close(ctx))
}

func TestLeadershipHandoverAloneGivesUpInTime(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0", func(c *platformha.Config) { c.HandoverTimeout = time.Second })
	require.True(t, turned(t, a, testutil.WaitShort))
	a.MarkServing()
	start := time.Now()
	require.NoError(t, a.Handover(ctx))
	require.Less(t, time.Since(start), 3*time.Second)
	require.Equal(t, platformha.RoleStandby, a.Role())
	require.NoError(t, a.Close(ctx))
}

func TestLeadershipCloseLetsAStandbyTakeOverAtOnce(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, next := startActive(ctx, t, a, b)
	left := time.Now()
	require.NoError(t, leader.Close(ctx))
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, next, testutil.IntervalFast) },
		testutil.IntervalFast, "the standby takes over")
	cfg := standbyConfig("")
	require.Less(t, time.Since(left), cfg.LeaseTTL-cfg.RenewInterval, "not after a whole lease: the leader let go")
	require.NoError(t, next.Close(ctx))
}

func TestLeadershipLeaseTakenStopsTheLeader(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	require.True(t, turned(t, a, testutil.WaitShort))
	a.MarkServing()
	_, err := db.ExecContext(ctx, `UPDATE platform_ha.leases SET holder_epoch = holder_epoch + 1000 WHERE name = $1`,
		platformha.ActiveLease)
	require.NoError(t, err)
	testutil.Eventually(ctx, t, func(context.Context) bool { return closed(a.LostActive()) },
		testutil.IntervalFast, "a leader whose lease was taken must stop")
	require.Equal(t, platformha.RoleStandby, a.Role())
	require.NoError(t, a.Close(ctx))
}

// successorOf waits for the one of the standbys rs that claims a handover's successor (its turn).
func successorOf(ctx context.Context, t *testing.T, rs ...*platformha.Registry) (succ *platformha.Registry, others []*platformha.Registry) {
	t.Helper()
	testutil.Eventually(ctx, t, func(context.Context) bool {
		for i, r := range rs {
			if turned(t, r, testutil.IntervalFast) {
				succ = r
				others = append(append([]*platformha.Registry{}, rs[:i]...), rs[i+1:]...)
				return true
			}
		}
		return false
	}, testutil.IntervalFast, "a standby claims the successor's place")
	return succ, others
}

func TestLeadershipLeavingStandbyRetires(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, standby := startActive(ctx, t, a, b)

	// the standby's pod goes away first (a rolling update): it retires, and takes nothing after
	require.NoError(t, standby.Handover(ctx))
	require.NoError(t, leader.Close(ctx))
	require.False(t, turned(t, standby, testutil.WaitShort), "a retired standby never takes the lease")
	require.Equal(t, platformha.RoleStandby, standby.Role())
	require.NoError(t, standby.Close(ctx))
}

func TestLeadershipLeavingSuccessorWithdraws(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, standby := startActive(ctx, t, a, b)
	c := startStandby(t, db, "coder-2")

	done := make(chan error, 1)
	go func() { done <- leader.Handover(ctx) }()
	first, others := successorOf(ctx, t, standby, c)
	third := others[0]

	// the successor's pod goes away before it serves: its claim goes to the third replica
	require.NoError(t, first.Handover(ctx))
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, third, testutil.IntervalFast) },
		testutil.IntervalFast, "the third replica claims the successor's place")
	third.MarkServing()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-ctx.Done():
		t.Fatal("the handover did not finish")
	}
	testutil.Eventually(ctx, t, func(context.Context) bool { return third.Role() == platformha.RoleActive },
		testutil.IntervalFast, "the new successor takes the lease")
	require.Equal(t, platformha.RoleStandby, first.Role())
	require.NoError(t, leader.Close(ctx))
	require.NoError(t, first.Close(ctx))
	require.NoError(t, third.Close(ctx))
}

func TestLeadershipReleasedLeaseIsTheSuccessors(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, standby := startActive(ctx, t, a, b)
	c := startStandby(t, db, "coder-2")

	done := make(chan error, 1)
	go func() { done <- leader.Handover(ctx) }()
	succ, others := successorOf(ctx, t, standby, c)
	succ.MarkServing()
	require.NoError(t, <-done)
	testutil.Eventually(ctx, t, func(context.Context) bool { return succ.Role() == platformha.RoleActive },
		testutil.IntervalFast, "the successor takes the lease")
	require.False(t, turned(t, others[0], testutil.IntervalSlow), "the other standby leaves the lease to the successor")
	require.False(t, closed(succ.LostActive()))
	for _, r := range []*platformha.Registry{a, b, c} {
		require.NoError(t, r.Close(ctx))
	}
}

func TestLeadershipVoidClaimStopsCoder(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := startStandby(t, db, "coder-0")
	b := startStandby(t, db, "coder-1")
	leader, next := startActive(ctx, t, a, b)

	go func() { _ = leader.Handover(ctx) }()
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, next, testutil.IntervalFast) },
		testutil.IntervalFast, "the successor gets its turn")
	// another replica takes the lease from under the handover (the take resets its marks)
	_, err := db.ExecContext(ctx, `UPDATE platform_ha.leases SET holder = gen_random_uuid(), holder_epoch = 1,
		expires = now() + interval '1 minute', handover = false, successor = NULL, successor_ready = false
		WHERE name = $1`, platformha.ActiveLease)
	require.NoError(t, err)
	testutil.Eventually(ctx, t, func(context.Context) bool { return closed(next.LostActive()) },
		testutil.IntervalFast, "a successor whose handover ended without it stops Coder")
	require.Equal(t, platformha.RoleStandby, next.Role())
	require.NoError(t, leader.Close(ctx))
	require.NoError(t, next.Close(ctx))
}
