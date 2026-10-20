package platformha

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
)

// The registry's schema: its own (not a Coder migration, so rolling back to
// upstream Coder stays possible), created idempotently at startup.
const schemaSQL = `
CREATE SCHEMA IF NOT EXISTS platform_ha;
CREATE SEQUENCE IF NOT EXISTS platform_ha.epochs;
CREATE TABLE IF NOT EXISTS platform_ha.replicas (
	id            uuid PRIMARY KEY,
	epoch         bigint NOT NULL,
	pod           text NOT NULL DEFAULT '',
	pod_ip        text NOT NULL DEFAULT '',
	cell          text NOT NULL DEFAULT '',
	state         text NOT NULL,
	version       text NOT NULL DEFAULT '',
	started_at    timestamptz NOT NULL DEFAULT now(),
	lease_expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS replicas_lease_expires ON platform_ha.replicas (lease_expires);
`

// States a replica reports.
const (
	StateReady    = "ready"
	StateDraining = "draining"
)

// Replica is one row of the registry.
type Replica struct {
	ID           uuid.UUID `json:"id"`
	Epoch        int64     `json:"epoch"`
	Pod          string    `json:"pod"`
	PodIP        string    `json:"pod_ip"`
	Cell         string    `json:"cell"`
	State        string    `json:"state"`
	Version      string    `json:"version"`
	StartedAt    time.Time `json:"started_at"`
	LeaseExpires time.Time `json:"lease_expires"`
}

// DB is what the registry needs of the database (a *sql.DB).
type DB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

// Registry is this replica's membership: its lease in platform_ha.replicas,
// kept by a loop of its own (never inside other work, so a slow round of
// anything else cannot cost the lease), and the live members it last read.
//
// Fencing: the database decides a lease's end (lease_expires = its now() at the
// renewal + LeaseTTL). The replica measures from when its renewal started (before
// the database's now(), so on the safe side) and fences itself by a timer of its
// own at LeaseTTL-RenewInterval - a full interval before anyone else can see the
// lease end - and at once when a renewal finds its row taken or gone. Every
// database call is cut off by that deadline, so a hung call cannot delay the
// fence. A fenced replica must not serve (OnFenceChange tells the parts that
// serve); it rejoins under a new epoch as soon as the database answers.
type Registry struct {
	db     DB
	cfg    Config
	logger slog.Logger
	now    func() time.Time

	mu        sync.Mutex
	self      Replica
	state     string
	fenced    bool
	lastRenew time.Time // when the last successful renewal (or join) started, local monotonic
	safeUntil time.Time // lastRenew + LeaseTTL - RenewInterval: past it, the lease cannot be trusted
	members   []Replica
	onFence   []func(fenced bool)
	lead      leadership  // activeStandby only
	kube      *kubeClient // the pod's Kubernetes API (activeStandby), or nil

	cancel context.CancelFunc
	done   chan struct{}

	metrics *metrics
}

type metrics struct {
	fenced   prometheus.Gauge
	epoch    prometheus.Gauge
	members  prometheus.Gauge
	renewals *prometheus.CounterVec
}

func newMetrics(reg prometheus.Registerer) *metrics {
	m := &metrics{
		fenced: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "coderd", Subsystem: "platform_ha", Name: "fenced",
			Help: "1 while this replica is fenced (it could not renew its lease and must not serve).",
		}),
		epoch: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "coderd", Subsystem: "platform_ha", Name: "epoch",
			Help: "This replica's current epoch in the registry.",
		}),
		members: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "coderd", Subsystem: "platform_ha", Name: "members",
			Help: "Live replicas in the registry, this one included.",
		}),
		renewals: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "coderd", Subsystem: "platform_ha", Name: "lease_renewals_total",
			Help: "Lease renewals by result: ok, error (the database did not answer), lost (the row was taken or gone).",
		}, []string{"result"}),
	}
	if reg != nil {
		reg.MustRegister(m.fenced, m.epoch, m.members, m.renewals)
	}
	return m
}

// NewRegistry makes a registry; Start joins it.
func NewRegistry(db DB, cfg Config, logger slog.Logger, reg prometheus.Registerer) *Registry {
	return &Registry{
		db:      db,
		cfg:     cfg,
		logger:  logger,
		now:     time.Now,
		self:    Replica{ID: uuid.New(), Pod: cfg.PodName, PodIP: cfg.PodIP, Cell: cfg.Cell, Version: cfg.Version},
		state:   StateReady,
		lead:    newLeadership(),
		metrics: newMetrics(reg),
	}
}

// Start creates the schema if needed, joins the registry (a new epoch) and
// starts the renewal loop. It fails when the database cannot be reached: a
// replica that cannot hold a lease does not start.
func (r *Registry) Start(ctx context.Context) error {
	if err := ensureSchema(ctx, r.db); err != nil {
		return xerrors.Errorf("platform HA schema: %w", err)
	}
	if err := r.join(ctx); err != nil {
		return xerrors.Errorf("join the replica registry: %w", err)
	}
	loopCtx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.done = make(chan struct{})
	go r.loop(loopCtx)
	return nil
}

// Close stops the loop and leaves the registry (deletes its own row, under its
// epoch only).
func (r *Registry) Close(ctx context.Context) error {
	if r.cancel != nil {
		r.cancel()
		<-r.done
	}
	if r.cfg.Leadership() {
		r.releaseLease(ctx)
	}
	r.mu.Lock()
	self := r.self
	r.mu.Unlock()
	_, err := r.db.ExecContext(ctx, `DELETE FROM platform_ha.replicas WHERE id = $1 AND epoch = $2`, self.ID, self.Epoch)
	if err != nil {
		return xerrors.Errorf("leave the replica registry: %w", err)
	}
	r.logger.Info(ctx, "left the replica registry", slog.F("replica_id", self.ID), slog.F("epoch", self.Epoch))
	return nil
}

// Self is this replica as last joined.
func (r *Registry) Self() Replica {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.self
}

// Fenced reports whether this replica is fenced: it must not serve.
func (r *Registry) Fenced() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.fenced
}

// Members are the live replicas (unexpired leases, by the database's clock) as
// of the last round, ordered by epoch.
func (r *Registry) Members() []Replica {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Replica(nil), r.members...)
}

// SetState sets the state this replica reports from its next renewal on
// (StateDraining while it hands its sessions over).
func (r *Registry) SetState(state string) {
	r.mu.Lock()
	r.state = state
	r.mu.Unlock()
}

// OnFenceChange registers fn, called with true when this replica fences itself
// and with false when it has rejoined. Called from the registry's loop: fn must
// not block.
func (r *Registry) OnFenceChange(fn func(fenced bool)) {
	r.mu.Lock()
	r.onFence = append(r.onFence, fn)
	r.mu.Unlock()
}

func ensureSchema(ctx context.Context, db DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Replicas starting together: one creates, the others wait and find it there.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('platform_ha.schema'))`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, schemaSQL+leaseSQL); err != nil {
		return err
	}
	return tx.Commit()
}

// join takes a new epoch for this replica's ID and a fresh lease.
func (r *Registry) join(ctx context.Context) error {
	r.mu.Lock()
	self, state := r.self, r.state
	r.mu.Unlock()
	began := r.now()
	rows, err := r.db.QueryContext(ctx, `
		INSERT INTO platform_ha.replicas (id, epoch, pod, pod_ip, cell, state, version, lease_expires)
		VALUES ($1, nextval('platform_ha.epochs'), $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
		ON CONFLICT (id) DO UPDATE SET epoch = EXCLUDED.epoch, state = EXCLUDED.state,
			lease_expires = EXCLUDED.lease_expires
		RETURNING epoch, started_at, lease_expires`,
		self.ID, self.Pod, self.PodIP, self.Cell, state, self.Version, r.cfg.LeaseTTL.Seconds())
	if err != nil {
		return err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return err
		}
		return xerrors.New("no row returned")
	}
	var epoch int64
	var started, expires time.Time
	if err := rows.Scan(&epoch, &started, &expires); err != nil {
		return err
	}
	r.mu.Lock()
	r.self.Epoch, r.self.StartedAt, r.self.LeaseExpires, r.self.State = epoch, started, expires, state
	r.lastRenew, r.safeUntil = began, began.Add(r.cfg.LeaseTTL-r.cfg.RenewInterval)
	r.mu.Unlock()
	r.metrics.epoch.Set(float64(epoch))
	r.logger.Info(ctx, "joined the replica registry", slog.F("replica_id", self.ID), slog.F("epoch", epoch),
		slog.F("cell", self.Cell), slog.F("pod", self.Pod))
	return nil
}

// errLost: the renewal found the row taken (another epoch) or gone.
var errLost = xerrors.New("lease lost: the registry row was taken or removed")

// renew extends the lease by compare-and-set on (id, epoch).
func (r *Registry) renew(ctx context.Context) error {
	r.mu.Lock()
	self, state := r.self, r.state
	r.mu.Unlock()
	began := r.now()
	rows, err := r.db.QueryContext(ctx, `
		UPDATE platform_ha.replicas SET lease_expires = now() + make_interval(secs => $3), state = $4
		WHERE id = $1 AND epoch = $2 RETURNING lease_expires`,
		self.ID, self.Epoch, r.cfg.LeaseTTL.Seconds(), state)
	if err != nil {
		return err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return err
		}
		return errLost
	}
	var expires time.Time
	if err := rows.Scan(&expires); err != nil {
		return err
	}
	r.mu.Lock()
	r.self.LeaseExpires, r.self.State = expires, state
	r.lastRenew, r.safeUntil = began, began.Add(r.cfg.LeaseTTL-r.cfg.RenewInterval)
	r.mu.Unlock()
	return nil
}

func (r *Registry) readMembers(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, epoch, pod, pod_ip, cell, state, version, started_at, lease_expires
		FROM platform_ha.replicas WHERE lease_expires > now() ORDER BY epoch`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var members []Replica
	for rows.Next() {
		var m Replica
		if err := rows.Scan(&m.ID, &m.Epoch, &m.Pod, &m.PodIP, &m.Cell, &m.State, &m.Version, &m.StartedAt, &m.LeaseExpires); err != nil {
			return err
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	r.members = members
	r.mu.Unlock()
	r.metrics.members.Set(float64(len(members)))
	return nil
}

// gc removes rows whose lease lapsed long ago (replicas that died without
// leaving); any replica may, the delete is idempotent.
func (r *Registry) gc(ctx context.Context) {
	keep := 10 * r.cfg.LeaseTTL
	if keep < 5*time.Minute {
		keep = 5 * time.Minute
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM platform_ha.replicas WHERE lease_expires < now() - make_interval(secs => $1)`,
		keep.Seconds()); err != nil {
		r.logger.Debug(ctx, "replica registry gc", slog.Error(err))
	}
}

// fence marks this replica fenced and tells the parts that serve.
func (r *Registry) fence(ctx context.Context, why string) {
	r.mu.Lock()
	if r.fenced {
		r.mu.Unlock()
		return
	}
	r.fenced = true
	callbacks := make([]func(bool), len(r.onFence))
	copy(callbacks, r.onFence)
	self := r.self
	r.mu.Unlock()
	r.metrics.fenced.Set(1)
	r.logger.Warn(ctx, "fenced: this replica stops serving until it holds a lease again",
		slog.F("replica_id", self.ID), slog.F("epoch", self.Epoch), slog.F("why", why))
	for _, fn := range callbacks {
		fn(true)
	}
	if r.cfg.Leadership() {
		r.stepDown(ctx, "fenced: "+why)
		r.updateRole(ctx)
	}
}

// unfence: this replica holds a lease again (a new epoch).
func (r *Registry) unfence(ctx context.Context) {
	r.mu.Lock()
	if !r.fenced {
		r.mu.Unlock()
		return
	}
	r.fenced = false
	callbacks := make([]func(bool), len(r.onFence))
	copy(callbacks, r.onFence)
	self := r.self
	r.mu.Unlock()
	r.metrics.fenced.Set(0)
	r.logger.Info(ctx, "unfenced: this replica holds a lease again", slog.F("replica_id", self.ID), slog.F("epoch", self.Epoch))
	for _, fn := range callbacks {
		fn(false)
	}
}

// round is one pass of the loop: renew (or rejoin when fenced) and read the
// members. A renewal is cut off at the lease's safe deadline; the fence timer
// in loop fences when that passes without one.
func (r *Registry) round(ctx context.Context, n int) {
	deadline := r.now().Add(r.cfg.RenewInterval)
	if !r.Fenced() {
		r.mu.Lock()
		if r.safeUntil.Before(deadline) {
			deadline = r.safeUntil
		}
		if r.lead.holding && r.lead.safeUntil.Before(deadline) {
			deadline = r.lead.safeUntil
		}
		r.mu.Unlock()
	}
	opCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	if r.Fenced() {
		// Rejoin under a new epoch; the old one is gone for good.
		if err := r.join(opCtx); err != nil {
			r.metrics.renewals.WithLabelValues("error").Inc()
			return
		}
		r.unfence(ctx)
		if r.cfg.Leadership() {
			r.leadRound(opCtx)
		}
	} else {
		err := r.renew(opCtx)
		switch {
		case err == nil:
			r.metrics.renewals.WithLabelValues("ok").Inc()
			if r.cfg.Leadership() {
				r.leadRound(opCtx)
			}
		case xerrors.Is(err, errLost):
			r.metrics.renewals.WithLabelValues("lost").Inc()
			r.fence(ctx, err.Error())
			return
		default:
			r.metrics.renewals.WithLabelValues("error").Inc()
			r.logger.Warn(ctx, "lease renewal failed", slog.Error(err))
			return
		}
	}
	if err := r.readMembers(opCtx); err != nil {
		r.logger.Debug(ctx, "read the replica registry", slog.Error(err))
	}
	if n%20 == 0 {
		r.gc(opCtx)
	}
}

func (r *Registry) loop(ctx context.Context) {
	defer close(r.done)
	// The members right away, then every interval.
	if err := r.readMembers(ctx); err != nil {
		r.logger.Debug(ctx, "read the replica registry", slog.Error(err))
	}
	ticker := time.NewTicker(r.cfg.RenewInterval)
	defer ticker.Stop()
	// The fence timer: armed for the lease's safe deadline after every renewal.
	fenceTimer := time.NewTimer(r.untilSafe())
	defer fenceTimer.Stop()
	for n := 1; ; n++ {
		select {
		case <-ctx.Done():
			return
		case <-fenceTimer.C:
			if !r.Fenced() && r.untilSafe() <= 0 {
				r.mu.Lock()
				since := r.now().Sub(r.lastRenew)
				r.mu.Unlock()
				r.fence(ctx, "no renewal for "+since.Round(time.Millisecond).String())
			} else if left, holding := r.untilLeaderSafe(); holding && left <= 0 {
				r.stepDown(ctx, "the active lease could not be renewed in time")
			}
			fenceTimer.Reset(r.nextDeadline())
		case <-ticker.C:
			r.round(ctx, n)
			if !fenceTimer.Stop() {
				select {
				case <-fenceTimer.C:
				default:
				}
			}
			fenceTimer.Reset(r.nextDeadline())
		}
	}
}

// nextDeadline is when the fence timer must look again: the nearer of the
// registry lease's and the active lease's safe deadlines (an interval when
// fenced).
func (r *Registry) nextDeadline() time.Duration {
	if r.Fenced() {
		return r.cfg.RenewInterval
	}
	d := r.untilSafe()
	if left, holding := r.untilLeaderSafe(); holding && left < d {
		d = left
	}
	if d < time.Millisecond {
		d = time.Millisecond
	}
	return d
}

// untilSafe is the time left before the lease cannot be trusted (<= 0: past).
func (r *Registry) untilSafe() time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.safeUntil.Sub(r.now())
}
