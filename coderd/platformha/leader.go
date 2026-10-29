package platformha

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
)

// leaseWatchInterval is how often a standby looks at the active lease between
// rounds (one small read).
const leaseWatchInterval = 250 * time.Millisecond

// Roles a replica plays in activeStandby.
const (
	RoleActive  = "active"
	RoleStandby = "standby"
)

// leaseSQL is the leases table (activeStandby): one row per lease name, its
// holder under its registry epoch, its end by the database's clock; a handover
// marks it, a successor claims it and says when it serves.
const leaseSQL = `
CREATE TABLE IF NOT EXISTS platform_ha.leases (
	name            text PRIMARY KEY,
	holder          uuid,
	holder_epoch    bigint NOT NULL DEFAULT 0,
	expires         timestamptz NOT NULL DEFAULT 'epoch',
	acquired_at     timestamptz NOT NULL DEFAULT now(),
	handover        boolean NOT NULL DEFAULT false,
	successor       uuid,
	successor_ready boolean NOT NULL DEFAULT false
);
`

// leadership is the activeStandby part of a Registry, guarded by its mutex.
type leadership struct {
	holding    bool      // this replica holds the active lease
	serving    bool      // Coder serves here (MarkServing)
	handedOver bool      // gave the lease up (a handover, or leaving): not a loss, and never takes it again
	safeUntil  time.Time // last lease renewal's start + LeaseTTL - RenewInterval
	successor  bool      // claimed the successor's place in a handover
	ready      bool      // told the leader it serves (successor_ready)
	turn       chan struct{}
	turnSent   bool
	lost       chan struct{}
	lostSent   bool
	role       string
	onRole     []func(role string)
	seen       string // the active lease as leaseChanged last read it
}

func newLeadership() leadership {
	return leadership{turn: make(chan struct{}), lost: make(chan struct{}), role: RoleStandby}
}

// WaitForTurn blocks until this replica may start Coder: it holds the active
// lease, or it is the successor of a handover (it starts while the leader still
// serves, and becomes active when the leader lets go). A registry without
// leadership never waits.
func (r *Registry) WaitForTurn(ctx context.Context) error {
	if !r.cfg.Leadership() {
		return nil
	}
	r.logger.Info(ctx, "standby: waiting for the active lease (or a handover) before starting Coder")
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-r.lead.turn:
		return nil
	}
}

// MarkServing records that Coder serves on this replica: the pod is labeled
// active once it also holds the lease, and a successor tells its leader it is
// ready.
func (r *Registry) MarkServing() {
	r.mu.Lock()
	r.lead.serving = true
	r.mu.Unlock()
	r.updateRole(context.Background())
	// a successor tells its leader now, not at the next round
	r.kickRound()
}

// LostActive is closed when this replica, starting or serving Coder, loses the
// active lease without handing it over (its lease taken or lapsed, or fenced),
// or when it started Coder as a handover's successor and the handover ended
// without it: Coder must stop here - the process exits and comes back as a
// standby.
func (r *Registry) LostActive() <-chan struct{} {
	return r.lead.lost
}

// Role is "active" while Coder serves here and this replica holds the lease or
// is a handover's successor (it takes traffic before the leader lets go: the
// leader's pod, terminating, has none), else "standby".
func (r *Registry) Role() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.lead.role
}

// OnRoleChange registers fn, called with the new role ("active", "standby")
// whenever it changes. Called from the registry's loop or MarkServing: fn must
// not block.
func (r *Registry) OnRoleChange(fn func(role string)) {
	r.mu.Lock()
	r.lead.onRole = append(r.lead.onRole, fn)
	r.mu.Unlock()
}

func (r *Registry) openTurn(ctx context.Context, why string) {
	r.mu.Lock()
	if r.lead.turnSent {
		r.mu.Unlock()
		return
	}
	r.lead.turnSent = true
	close(r.lead.turn)
	r.mu.Unlock()
	r.logger.Info(ctx, "this replica's turn to start Coder", slog.F("why", why))
}

// updateRole derives the role (Role) and tells the callbacks when it changed.
func (r *Registry) updateRole(ctx context.Context) {
	r.mu.Lock()
	role := RoleStandby
	if (r.lead.holding || r.lead.successor) && r.lead.serving && !r.fenced && !r.lead.lostSent {
		role = RoleActive
	}
	if role == r.lead.role {
		r.mu.Unlock()
		return
	}
	r.lead.role = role
	callbacks := make([]func(string), len(r.lead.onRole))
	copy(callbacks, r.lead.onRole)
	r.mu.Unlock()
	r.logger.Info(ctx, "this replica's role changed", slog.F("role", role))
	for _, fn := range callbacks {
		fn(role)
	}
}

// loseTurn: Coder, started here as a handover's successor, must stop - LostActive
// fires (the process comes back as a standby).
func (r *Registry) loseTurn(ctx context.Context, why string) {
	r.mu.Lock()
	r.lead.successor, r.lead.ready = false, false
	sent := r.lead.lostSent
	r.lead.lostSent = true
	if !sent {
		close(r.lead.lost)
	}
	r.mu.Unlock()
	if !sent {
		r.logger.Warn(ctx, "lost its place as the successor: Coder stops here", slog.F("why", why))
	}
	r.updateRole(ctx)
}

// leaseChanged reads the active lease (a standby, between rounds) and reports
// whether it changed since the last read: a handover marked or claimed, the
// lease let go, or its end passed.
func (r *Registry) leaseChanged(ctx context.Context) bool {
	r.mu.Lock()
	skip := r.lead.holding || r.lead.handedOver || r.fenced
	r.mu.Unlock()
	if skip {
		return false
	}
	qctx, cancel := context.WithTimeout(ctx, leaseWatchInterval*4)
	defer cancel()
	rows, err := r.db.QueryContext(qctx, `SELECT (holder, holder_epoch, handover, successor, successor_ready,
		expires < now())::text FROM platform_ha.leases WHERE name = $1`, ActiveLease)
	if err != nil {
		return false
	}
	defer rows.Close()
	now := ""
	if rows.Next() {
		_ = rows.Scan(&now)
	}
	r.mu.Lock()
	changed := now != r.lead.seen
	r.lead.seen = now
	r.mu.Unlock()
	return changed
}

// stepDown: this replica no longer holds the active lease. Unless it handed it
// over, a replica that began startup has lost it: LostActive fires.
func (r *Registry) stepDown(ctx context.Context, why string) {
	r.mu.Lock()
	if !r.lead.holding {
		r.mu.Unlock()
		return
	}
	r.lead.holding = false
	lostTurn := r.lead.turnSent && !r.lead.handedOver && !r.lead.lostSent
	if lostTurn {
		r.lead.lostSent = true
		close(r.lead.lost)
	}
	r.mu.Unlock()
	if lostTurn {
		r.logger.Warn(ctx, "lost the active lease: Coder stops here", slog.F("why", why))
	} else {
		r.logger.Info(ctx, "stepped down from the active lease", slog.F("why", why))
	}
	r.updateRole(ctx)
}

// leadRound runs after a successful registry renewal: renew the active lease
// when holding it, else take it when it lapsed, or claim a handover.
func (r *Registry) leadRound(ctx context.Context) {
	r.mu.Lock()
	self, holding, serving, retired := r.self, r.lead.holding, r.lead.serving, r.lead.handedOver || r.lead.lostSent
	r.mu.Unlock()
	if retired {
		// A replica that handed over or lost its turn must not take it again.
		return
	}
	ttl := r.cfg.LeaseTTL.Seconds()

	if holding {
		began := r.now()
		rows, err := r.db.QueryContext(ctx, `
			UPDATE platform_ha.leases SET expires = now() + make_interval(secs => $4)
			WHERE name = $1 AND holder = $2 AND holder_epoch = $3
			RETURNING handover, successor_ready`, ActiveLease, self.ID, self.Epoch, ttl)
		if err != nil {
			r.logger.Warn(ctx, "renew the active lease", slog.Error(err))
			return // the leadership timer decides
		}
		defer rows.Close()
		if !rows.Next() {
			if rows.Err() == nil {
				r.stepDown(ctx, "the active lease was taken")
			}
			return
		}
		var handover, ready bool
		if err := rows.Scan(&handover, &ready); err != nil {
			return
		}
		r.mu.Lock()
		r.lead.safeUntil = began.Add(r.cfg.LeaseTTL - r.cfg.RenewInterval)
		r.mu.Unlock()
		return
	}

	// Standby: take the lease when it lapsed (or was never held); the take resets
	// any handover marks. A lease let go in a handover is its successor's for one
	// more lease (it serves already), anyone's after that (the successor died).
	// Otherwise the longest-running ready standby (the lowest epoch among the live
	// ready replicas, the lapsed holder aside) takes it first, so a crashed
	// leader's container, restarted in place, does not win it straight back (a
	// crash-looping pod would keep retaking it); anyone may after one more lease.
	began := r.now()
	rows, err := r.db.QueryContext(ctx, `
		INSERT INTO platform_ha.leases (name, holder, holder_epoch, expires, acquired_at)
		VALUES ($1, $2, $3, now() + make_interval(secs => $4), now())
		ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, holder_epoch = EXCLUDED.holder_epoch,
			expires = EXCLUDED.expires, acquired_at = now(), handover = false, successor = NULL,
			successor_ready = false
		WHERE platform_ha.leases.expires < now() AND (NOT platform_ha.leases.handover
			OR platform_ha.leases.successor IS NULL OR platform_ha.leases.successor = EXCLUDED.holder
			OR platform_ha.leases.expires < now() - make_interval(secs => $4))
		AND ((platform_ha.leases.handover AND platform_ha.leases.successor = EXCLUDED.holder)
			OR platform_ha.leases.expires < now() - make_interval(secs => $4)
			OR NOT EXISTS (SELECT 1 FROM platform_ha.replicas o WHERE o.lease_expires > now() AND o.state = $5
				AND o.epoch < EXCLUDED.holder_epoch AND o.id IS DISTINCT FROM platform_ha.leases.holder))
		RETURNING holder`, ActiveLease, self.ID, self.Epoch, ttl, StateReady)
	if err != nil {
		r.logger.Debug(ctx, "take the active lease", slog.Error(err))
		return
	}
	took := rows.Next()
	_ = rows.Close()
	if took {
		r.mu.Lock()
		r.lead.holding, r.lead.handedOver = true, false
		r.lead.safeUntil = began.Add(r.cfg.LeaseTTL - r.cfg.RenewInterval)
		r.lead.successor, r.lead.ready = false, false
		r.mu.Unlock()
		r.logger.Info(ctx, "took the active lease", slog.F("replica_id", self.ID), slog.F("epoch", self.Epoch))
		r.openTurn(ctx, "holds the active lease")
		r.updateRole(ctx)
		return
	}

	// A handover in progress: claim the successor's place (one standby wins it),
	// start Coder, and say when it serves.
	var successor uuid.NullUUID
	var handover bool
	hrows, err := r.db.QueryContext(ctx, `SELECT handover, successor FROM platform_ha.leases WHERE name = $1`, ActiveLease)
	if err != nil {
		return
	}
	if hrows.Next() {
		_ = hrows.Scan(&handover, &successor)
	}
	_ = hrows.Close()
	r.mu.Lock()
	claimed := r.lead.successor
	r.mu.Unlock()
	if claimed && (!handover || !successor.Valid || successor.UUID != self.ID) {
		// It started Coder as a successor and the handover ended without it
		// (another replica took the lease): Coder must stop here.
		r.loseTurn(ctx, "the handover it was the successor of ended without it")
		return
	}
	if !handover {
		return
	}
	if !successor.Valid || successor.UUID == self.ID {
		claimed, err := r.exec1(ctx, `UPDATE platform_ha.leases SET successor = $2
			WHERE name = $1 AND handover AND (successor IS NULL OR successor = $2) RETURNING 1`, ActiveLease, self.ID)
		if err == nil && claimed {
			r.mu.Lock()
			first := !r.lead.successor
			r.lead.successor = true
			r.mu.Unlock()
			if first {
				r.logger.Info(ctx, "successor of a handover: starting Coder before the leader lets go")
			}
			r.openTurn(ctx, "the successor of a handover")
			if serving {
				r.mu.Lock()
				told := r.lead.ready
				r.mu.Unlock()
				if !told {
					if ok, err := r.exec1(ctx, `UPDATE platform_ha.leases SET successor_ready = true
						WHERE name = $1 AND successor = $2 RETURNING 1`, ActiveLease, self.ID); err == nil && ok {
						r.mu.Lock()
						r.lead.ready = true
						r.mu.Unlock()
						r.logger.Info(ctx, "successor serves: told the leader")
					}
				}
			}
		}
	}
}

// exec1 runs a statement that returns a row when it applied.
func (r *Registry) exec1(ctx context.Context, q string, args ...any) (bool, error) {
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	return rows.Next(), rows.Err()
}

// Handover gives the active lease to a successor without a gap (a rolling
// update's preStop): it marks the lease, waits up to HandoverTimeout for a
// standby to claim it and serve, then lets go - the successor takes the lease at
// its next round. Without a successor it lets go anyway at the timeout.
//
// On a replica that does not hold the lease (its pod goes away too, as in a
// rolling update) it retires: it never takes or claims the lease again, and a
// successor's claim it had not made good is withdrawn for another standby to
// take. A successor already serving takes the lease first and hands it on.
func (r *Registry) Handover(ctx context.Context) error {
	r.mu.Lock()
	self, holding, successor, ready := r.self, r.lead.holding, r.lead.successor, r.lead.ready
	r.mu.Unlock()
	r.markDraining(ctx)
	if !holding && successor && ready {
		// Its Coder serves and the leader lets go: it takes the lease at its next round.
		holding = r.waitHolding(ctx, 2*r.cfg.RenewInterval)
	}
	if !holding {
		r.mu.Lock()
		r.lead.handedOver = true
		r.lead.successor, r.lead.ready = false, false
		r.mu.Unlock()
		r.updateRole(ctx)
		if successor {
			if _, err := r.db.ExecContext(ctx, `UPDATE platform_ha.leases SET successor = NULL, successor_ready = false
				WHERE name = $1 AND successor = $2`, ActiveLease, self.ID); err != nil {
				r.logger.Warn(ctx, "leaving: withdraw the successor's claim", slog.Error(err))
			} else {
				r.logger.Info(ctx, "leaving: withdrew the successor's claim")
			}
		}
		return nil
	}
	if _, err := r.db.ExecContext(ctx, `UPDATE platform_ha.leases SET handover = true
		WHERE name = $1 AND holder = $2 AND holder_epoch = $3`, ActiveLease, self.ID, self.Epoch); err != nil {
		return xerrors.Errorf("mark the handover: %w", err)
	}
	r.logger.Info(ctx, "handover: waiting for a successor to serve", slog.F("timeout", r.cfg.HandoverTimeout))
	deadline := time.NewTimer(r.cfg.HandoverTimeout)
	defer deadline.Stop()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	readyFound := false
wait:
	for {
		select {
		case <-ctx.Done():
			break wait
		case <-deadline.C:
			break wait
		case <-tick.C:
			var ready sql.NullBool
			rows, err := r.db.QueryContext(ctx, `SELECT successor_ready FROM platform_ha.leases WHERE name = $1`, ActiveLease)
			if err != nil {
				continue
			}
			if rows.Next() {
				_ = rows.Scan(&ready)
			}
			_ = rows.Close()
			if ready.Valid && ready.Bool {
				readyFound = true
				break wait
			}
		}
	}
	r.mu.Lock()
	r.lead.handedOver = true
	r.mu.Unlock()
	// Let go: ended, and no holder - a renewal of ours still in flight finds nothing to extend.
	if _, err := r.db.ExecContext(context.Background(), `UPDATE platform_ha.leases SET expires = now() - interval '1 second',
		holder = NULL WHERE name = $1 AND holder = $2 AND holder_epoch = $3`, ActiveLease, self.ID, self.Epoch); err != nil {
		r.logger.Warn(ctx, "handover: let go of the active lease", slog.Error(err))
	}
	if readyFound {
		r.logger.Info(ctx, "handover: the successor serves; let go of the active lease")
	} else {
		r.logger.Warn(ctx, "handover: no successor served in time; let go of the active lease anyway")
	}
	r.stepDown(ctx, "handed over")
	return nil
}

// markDraining reports this replica as leaving (StateDraining), at once and at
// every renewal from now on: it no longer counts as the senior standby a lapsed
// lease waits for.
func (r *Registry) markDraining(ctx context.Context) {
	r.SetState(StateDraining)
	r.mu.Lock()
	self := r.self
	r.mu.Unlock()
	if _, err := r.db.ExecContext(ctx, `UPDATE platform_ha.replicas SET state = $3 WHERE id = $1 AND epoch = $2`,
		self.ID, self.Epoch, StateDraining); err != nil {
		r.logger.Debug(ctx, "report draining", slog.Error(err))
	}
}

// waitHolding waits up to d for this replica to hold the active lease.
func (r *Registry) waitHolding(ctx context.Context, d time.Duration) bool {
	deadline := time.NewTimer(d)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		r.mu.Lock()
		holding := r.lead.holding
		r.mu.Unlock()
		if holding {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-deadline.C:
			return false
		case <-tick.C:
		}
	}
}

// releaseLease lets go of the active lease when leaving (Close), so a standby
// takes it at its next round instead of after the lease's end.
func (r *Registry) releaseLease(ctx context.Context) {
	r.mu.Lock()
	self, holding := r.self, r.lead.holding
	r.lead.handedOver = true
	r.mu.Unlock()
	if !holding {
		return
	}
	_, _ = r.db.ExecContext(ctx, `UPDATE platform_ha.leases SET expires = now() - interval '1 second', holder = NULL
		WHERE name = $1 AND holder = $2 AND holder_epoch = $3`, ActiveLease, self.ID, self.Epoch)
}

// untilLeaderSafe: the time left before the active lease cannot be trusted
// (meaningful while holding it).
func (r *Registry) untilLeaderSafe() (time.Duration, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.lead.holding {
		return 0, false
	}
	return r.lead.safeUntil.Sub(r.now()), true
}

// Status is what /status reports: this replica, its role, the members and the
// active lease's holder.
type Status struct {
	Mode    Mode      `json:"mode"`
	Self    Replica   `json:"self"`
	Fenced  bool      `json:"fenced"`
	Role    string    `json:"role,omitempty"`
	Members []Replica `json:"members"`
}

// Status is a snapshot for /status (and the network view).
func (r *Registry) Status() Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	st := Status{Mode: r.cfg.Mode, Self: r.self, Fenced: r.fenced, Members: append([]Replica(nil), r.members...)}
	if r.cfg.Leadership() {
		st.Role = r.lead.role
	}
	return st
}
