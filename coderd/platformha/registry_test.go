package platformha_test

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3/sloggers/slogtest"

	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/platformha"
	"github.com/coder/coder/v2/testutil"
)

func TestConfigFromEnv(t *testing.T) {
	t.Parallel()
	env := func(kv map[string]string) func(string) string {
		return func(k string) string { return kv[k] }
	}

	c, err := platformha.ConfigFromEnv(env(nil), "v1")
	require.NoError(t, err)
	require.Equal(t, platformha.ModeOff, c.Mode)
	require.False(t, c.Enabled())

	c, err = platformha.ConfigFromEnv(env(map[string]string{
		"CODER_PLATFORM_HA_MODE": "registry", "CODER_PLATFORM_HA_CELL": "b",
		"CODER_PLATFORM_HA_POD_NAME": "coder-0", "CODER_PLATFORM_HA_POD_IP": "10.0.0.7",
		"CODER_PLATFORM_HA_LEASE_TTL": "20s", "CODER_PLATFORM_HA_RENEW_INTERVAL": "5s",
	}), "v1")
	require.NoError(t, err)
	require.True(t, c.Enabled())
	require.Equal(t, platformha.Config{
		Mode: platformha.ModeRegistry, Cell: "b", PodName: "coder-0", PodIP: "10.0.0.7",
		LeaseTTL: 20 * time.Second, RenewInterval: 5 * time.Second, Version: "v1",
		HealthAddress: platformha.DefaultHealthAddress, HandoverTimeout: platformha.DefaultHandoverTimeout,
	}, c)

	for _, bad := range []map[string]string{
		{"CODER_PLATFORM_HA_MODE": "activeActive"}, // a later phase
		{"CODER_PLATFORM_HA_MODE": "registry", "CODER_PLATFORM_HA_LEASE_TTL": "soon"},
		{"CODER_PLATFORM_HA_MODE": "registry", "CODER_PLATFORM_HA_LEASE_TTL": "-1s"},
		// two renewals must fit in a lease
		{"CODER_PLATFORM_HA_MODE": "registry", "CODER_PLATFORM_HA_LEASE_TTL": "10s", "CODER_PLATFORM_HA_RENEW_INTERVAL": "5s"},
	} {
		_, err := platformha.ConfigFromEnv(env(bad), "v1")
		require.Error(t, err, bad)
	}
}

// flakyDB fails every call while broken: the database unreachable.
type flakyDB struct {
	*sql.DB
	broken atomic.Bool
}

var errBroken = xerrors.New("database unreachable (test)")

func (f *flakyDB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	if f.broken.Load() {
		return nil, errBroken
	}
	return f.DB.ExecContext(ctx, q, args...)
}

func (f *flakyDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	if f.broken.Load() {
		return nil, errBroken
	}
	return f.DB.QueryContext(ctx, q, args...)
}

func (f *flakyDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if f.broken.Load() {
		return nil, errBroken
	}
	return f.DB.BeginTx(ctx, opts)
}

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	url, err := dbtestutil.Open(t)
	require.NoError(t, err)
	db, err := sql.Open("postgres", url)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// Short leases so the tests see them lapse quickly.
func testConfig(pod string) platformha.Config {
	return platformha.Config{
		Mode: platformha.ModeRegistry, Cell: "a", PodName: pod, PodIP: "10.0.0.1",
		LeaseTTL: 2 * time.Second, RenewInterval: 300 * time.Millisecond, Version: "test",
	}
}

func start(t *testing.T, db platformha.DB, pod string) *platformha.Registry {
	t.Helper()
	r := platformha.NewRegistry(db, testConfig(pod), slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}), prometheus.NewRegistry())
	require.NoError(t, r.Start(testutil.Context(t, testutil.WaitShort)))
	return r
}

func memberPods(r *platformha.Registry) map[string]string {
	out := map[string]string{}
	for _, m := range r.Members() {
		out[m.Pod] = m.State
	}
	return out
}

func TestRegistryJoinSeeEachOtherAndLeave(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	a := start(t, db, "coder-0")
	b := start(t, db, "coder-1")
	require.Greater(t, b.Self().Epoch, a.Self().Epoch, "each join takes a new epoch")

	testutil.Eventually(ctx, t, func(context.Context) bool {
		return len(a.Members()) == 2 && len(b.Members()) == 2
	}, testutil.IntervalFast, "both replicas see both")

	// draining shows in the registry
	b.SetState(platformha.StateDraining)
	testutil.Eventually(ctx, t, func(context.Context) bool {
		return memberPods(a)["coder-1"] == platformha.StateDraining
	}, testutil.IntervalFast, "the draining state shows")

	// leaving removes the row at once
	require.NoError(t, b.Close(ctx))
	testutil.Eventually(ctx, t, func(context.Context) bool {
		_, ok := memberPods(a)["coder-1"]
		return !ok && len(a.Members()) == 1
	}, testutil.IntervalFast, "the leaver is gone")
	require.NoError(t, a.Close(ctx))
}

func TestRegistryLeaseLapsesWhenAReplicaDies(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	survivor := start(t, db, "coder-0")
	dead := &flakyDB{DB: db}
	victim := start(t, dead, "coder-1")
	testutil.Eventually(ctx, t, func(context.Context) bool { return len(survivor.Members()) == 2 },
		testutil.IntervalFast, "both join")

	// the victim stops renewing (its database calls fail), as a crashed pod would
	dead.broken.Store(true)
	testutil.Eventually(ctx, t, func(context.Context) bool {
		_, ok := memberPods(survivor)["coder-1"]
		return !ok
	}, testutil.IntervalFast, "its lease lapses for the others")
	require.NoError(t, survivor.Close(ctx))
	_ = victim
}

// The safety property: a replica fences itself while its lease is still valid
// in the database - nobody else can have seen it end - and rejoins under a new
// epoch when the database answers again.
func TestRegistryFencesBeforeTheLeaseEndsAndRejoins(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	flaky := &flakyDB{DB: db}
	r := start(t, flaky, "coder-0")
	first := r.Self()

	var mu sync.Mutex
	var events []bool
	var leaseValidAtFence sql.NullBool
	var leftMs sql.NullFloat64
	var scanErr error
	r.OnFenceChange(func(fenced bool) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, fenced)
		if fenced {
			// read through the real connection: was the lease still valid when it fenced?
			row := db.QueryRowContext(context.Background(),
				`SELECT lease_expires > clock_timestamp(), EXTRACT(EPOCH FROM lease_expires - clock_timestamp()) * 1000
				 FROM platform_ha.replicas WHERE id = $1 AND epoch = $2`, first.ID, first.Epoch)
			scanErr = row.Scan(&leaseValidAtFence, &leftMs)
		}
	})

	broke := time.Now()
	flaky.broken.Store(true)
	// the callback (it runs right after the flag flips) has measured the lease
	testutil.Eventually(ctx, t, func(context.Context) bool {
		mu.Lock()
		defer mu.Unlock()
		return r.Fenced() && len(events) == 1
	}, testutil.IntervalFast, "it fences, and says so")
	took := time.Since(broke)
	cfg := testConfig("")
	require.GreaterOrEqual(t, took, cfg.LeaseTTL-2*cfg.RenewInterval, "not before the renewals ran out")
	mu.Lock()
	require.NoError(t, scanErr)
	require.True(t, leaseValidAtFence.Valid && leaseValidAtFence.Bool, "fenced while its lease was still valid (%.0f ms left)", leftMs.Float64)
	t.Logf("fenced with %.0f ms of lease left (headroom: one renew interval, %s)", leftMs.Float64, testConfig("").RenewInterval)
	mu.Unlock()

	flaky.broken.Store(false)
	testutil.Eventually(ctx, t, func(context.Context) bool {
		mu.Lock()
		defer mu.Unlock()
		return !r.Fenced() && len(events) == 2
	}, testutil.IntervalFast, "it rejoins, and says so")
	require.Greater(t, r.Self().Epoch, first.Epoch, "under a new epoch")
	require.Equal(t, first.ID, r.Self().ID)
	mu.Lock()
	require.Equal(t, []bool{true, false}, events)
	mu.Unlock()
	require.NoError(t, r.Close(ctx))
}

func TestRegistryLostRowFencesAtOnce(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	db := openDB(t)
	r := start(t, db, "coder-0")
	first := r.Self()
	fenced := make(chan struct{}, 1)
	r.OnFenceChange(func(f bool) {
		if f {
			select {
			case fenced <- struct{}{}:
			default:
			}
		}
	})

	// someone else's write (an epoch it does not hold): the next renewal finds it lost
	_, err := db.ExecContext(ctx, `UPDATE platform_ha.replicas SET epoch = epoch + 1000 WHERE id = $1`, first.ID)
	require.NoError(t, err)
	select {
	case <-fenced:
	case <-ctx.Done():
		t.Fatal("not fenced after its row was taken")
	}
	testutil.Eventually(ctx, t, func(context.Context) bool { return !r.Fenced() }, testutil.IntervalFast, "it rejoins")
	require.Greater(t, r.Self().Epoch, first.Epoch)
	require.NoError(t, r.Close(ctx))
}

func TestRegistrySchemaConcurrentStarts(t *testing.T) {
	t.Parallel()
	db := openDB(t)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	regs := make(chan *platformha.Registry, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := platformha.NewRegistry(db, testConfig(fmt.Sprintf("coder-%d", i)),
				slogtest.Make(t, &slogtest.Options{IgnoreErrors: true}), prometheus.NewRegistry())
			if err := r.Start(context.Background()); err != nil {
				errs <- err
				return
			}
			regs <- r
		}(i)
	}
	wg.Wait()
	close(errs)
	close(regs)
	for err := range errs {
		require.NoError(t, err)
	}
	epochs := map[int64]bool{}
	for r := range regs {
		require.False(t, epochs[r.Self().Epoch], "epochs are unique")
		epochs[r.Self().Epoch] = true
		require.NoError(t, r.Close(context.Background()))
	}
	require.Len(t, epochs, 8)
}
