package platformha_test

import (
	"context"
	"database/sql"
	"strings"
	"sync/atomic"
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

func TestLeadershipLostDuringStartup(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	flaky := &flakyDB{DB: db}
	starting := startStandby(t, flaky, "starting")
	require.NoError(t, starting.WaitForTurn(ctx))
	standby := startStandby(t, db, "standby")
	// Startup has permission to proceed, but has not reached MarkServing yet.
	flaky.broken.Store(true)
	testutil.Eventually(ctx, t, func(context.Context) bool { return closed(starting.LostActive()) },
		testutil.IntervalFast, "lease loss aborts startup before the server begins serving")
	require.Equal(t, platformha.RoleStandby, starting.Role())
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, standby, testutil.IntervalFast) },
		testutil.IntervalFast, "the healthy standby takes over")
	standby.MarkServing()
	require.Equal(t, platformha.RoleActive, standby.Role())
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
	require.Equal(t, platformha.RoleStandby, next.Role(), "no traffic for the successor before Coder serves there")
	next.MarkServing()
	require.Equal(t, platformha.RoleActive, next.Role(), "the successor takes traffic as soon as Coder serves there")

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

func TestLeadershipTheSeniorStandbyTakesALapsedLease(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	flakyA := &flakyDB{DB: db}
	flakyB := &flakyDB{DB: db}
	a := startStandby(t, flakyA, "coder-0")
	b := startStandby(t, flakyB, "coder-1")
	active, senior := startActive(ctx, t, a, b)
	flaky := flakyA
	if active == b {
		flaky = flakyB
	}
	// the leader crashes; its pod's container comes back at once as a fresh
	// replica (a higher epoch) - it must not win the lapsed lease back
	flaky.broken.Store(true)
	restarted := startStandby(t, db, "coder-restarted")
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, senior, testutil.IntervalFast) },
		testutil.IntervalFast, "the senior standby takes the lapsed lease")
	require.False(t, turned(t, restarted, testutil.IntervalSlow), "the restarted replica waits")
	senior.MarkServing()
	require.Equal(t, platformha.RoleActive, senior.Role())
	require.NoError(t, senior.Close(ctx))
	require.NoError(t, restarted.Close(ctx))
}

func TestLeadershipAnyoneTakesALeaseLapsedTooLong(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	flakyA := &flakyDB{DB: db}
	flakyB := &flakyDB{DB: db}
	a := startStandby(t, flakyA, "coder-0")
	b := startStandby(t, flakyB, "coder-1")
	active, senior := startActive(ctx, t, a, b)
	broken := flakyA
	if senior == b {
		broken = flakyB
	}
	// the leader crashes and the senior standby is stuck (its database calls
	// fail, though its registry row is still live for a while): a younger
	// replica takes the lease once it has been lapsed a whole lease
	(map[bool]*flakyDB{true: flakyA, false: flakyB})[active == a].broken.Store(true)
	broken.broken.Store(true)
	younger := startStandby(t, db, "coder-2")
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, younger, testutil.IntervalFast) },
		testutil.IntervalFast, "a younger replica takes the lease in the end")
	require.NoError(t, younger.Close(ctx))
}

// slowDB delays the lease renewals (the registry's and the active lease's), as
// a database answering slowly from a loaded host would. Every other statement
// runs at once.
type slowDB struct {
	*sql.DB
	// delay holds each renewal this long (0: none).
	delay atomic.Int64
	// hangs is how many renewals from now on hang until their context ends.
	hangs atomic.Int64
	// hung counts the renewals that hung.
	hung atomic.Int64
}

func isRenewal(q string) bool {
	return strings.Contains(q, "UPDATE platform_ha.replicas SET lease_expires") ||
		strings.Contains(q, "UPDATE platform_ha.leases SET expires = now() +")
}

func (s *slowDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	if isRenewal(q) {
		if s.hangs.Add(-1) >= 0 {
			s.hung.Add(1)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		if d := time.Duration(s.delay.Load()); d > 0 {
			t := time.NewTimer(d)
			select {
			case <-ctx.Done():
				t.Stop()
				return nil, ctx.Err()
			case <-t.C:
			}
		}
	}
	return s.DB.QueryContext(ctx, q, args...)
}

// holdsThrough asserts that active keeps the active lease, unfenced, and that
// standby never gets its turn, for d.
func holdsThrough(t *testing.T, active, standby *platformha.Registry, d time.Duration) {
	t.Helper()
	require.False(t, turned(t, standby, d), "the standby must not take over")
	require.False(t, active.Fenced(), "the active replica must not fence")
	require.False(t, closed(active.LostActive()), "the active replica must keep the lease")
	require.Equal(t, platformha.RoleActive, active.Role())
}

// Every renewal slow but answering (a loaded host): the registry and the active
// lease each get an attempt's full timeout, so neither starves the other.
func TestLeadershipSlowRenewalsKeepTheLease(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	slowA, slowB := &slowDB{DB: db}, &slowDB{DB: db}
	a := startStandby(t, slowA, "coder-0")
	b := startStandby(t, slowB, "coder-1")
	active, standby := startActive(ctx, t, a, b)
	slow := slowA
	if active == b {
		slow = slowB
	}
	cfg := standbyConfig("")
	// Two renewals per round, each taking most of an attempt's timeout: together
	// they exceed one renew interval.
	slow.delay.Store(int64(cfg.RenewInterval * 2 / 3))
	holdsThrough(t, active, standby, 3*cfg.LeaseTTL)
	require.NoError(t, active.Close(ctx))
	require.NoError(t, standby.Close(ctx))
}

// Renewals that hang (a stalled host) are abandoned after an attempt's timeout
// and retried: several in a row within the safe window do not cost the lease.
func TestLeadershipRenewalSurvivesHungAttempts(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	slowA, slowB := &slowDB{DB: db}, &slowDB{DB: db}
	a := startStandby(t, slowA, "coder-0")
	b := startStandby(t, slowB, "coder-1")
	active, standby := startActive(ctx, t, a, b)
	slow := slowA
	if active == b {
		slow = slowB
	}
	cfg := standbyConfig("")
	// Each hung attempt costs a renew interval; three fit in FenceAfter.
	const hangs = 3
	require.Less(t, hangs*cfg.RenewInterval, cfg.FenceAfter())
	slow.hangs.Store(hangs)
	holdsThrough(t, active, standby, cfg.LeaseTTL+hangs*cfg.RenewInterval)
	require.EqualValues(t, hangs, slow.hung.Load(), "every hung attempt was retried")
	require.NoError(t, active.Close(ctx))
	require.NoError(t, standby.Close(ctx))
}

// The safety property under retries: renewals that never answer still fence the
// active replica, and step it down, while both its leases are valid in the
// database, so no standby can have taken over yet.
func TestLeadershipHungRenewalsFenceBeforeTheLeaseEnds(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	slowA, slowB := &slowDB{DB: db}, &slowDB{DB: db}
	a := startStandby(t, slowA, "coder-0")
	b := startStandby(t, slowB, "coder-1")
	active, standby := startActive(ctx, t, a, b)
	slow := slowA
	if active == b {
		slow = slowB
	}
	self := active.Self()

	type check struct {
		replicaValid, activeValid bool
		err                       error
	}
	checks := make(chan check, 1)
	active.OnFenceChange(func(fenced bool) {
		if !fenced {
			return
		}
		var c check
		c.err = db.QueryRowContext(context.Background(), `SELECT
			(SELECT lease_expires > clock_timestamp() FROM platform_ha.replicas WHERE id = $1 AND epoch = $2),
			(SELECT expires > clock_timestamp() FROM platform_ha.leases WHERE name = $3 AND holder = $1)`,
			self.ID, self.Epoch, platformha.ActiveLease).Scan(&c.replicaValid, &c.activeValid)
		select {
		case checks <- c:
		default:
		}
	})

	slow.hangs.Store(1 << 30)
	var c check
	select {
	case c = <-checks:
	case <-ctx.Done():
		t.Fatal("not fenced while its renewals hang")
	}
	require.NoError(t, c.err)
	require.True(t, c.replicaValid, "fenced while its registry lease was valid")
	require.True(t, c.activeValid, "fenced while its active lease was valid")
	require.True(t, closed(active.LostActive()), "fencing stops Coder")
	require.Equal(t, platformha.RoleStandby, active.Role())
	testutil.Eventually(ctx, t, func(context.Context) bool { return turned(t, standby, testutil.IntervalFast) },
		testutil.IntervalFast, "the standby takes over once the lease lapses")
	require.NoError(t, standby.Close(ctx))
}
