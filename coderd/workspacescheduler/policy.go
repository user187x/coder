// Package workspacescheduler enforces the deployment's workspace schedule policy.
package workspacescheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/schedule/cron"
)

// ConfigKey is the shared runtime configuration used by the scheduler editor.
const ConfigKey = "workspace_scheduler"

// CorrectionWindow bounds running workspaces that need their schedule repaired.
const CorrectionWindow = 5 * time.Minute

// Policy is the persisted global workspace scheduling policy.
type Policy struct {
	Enabled bool   `json:"enabled"`
	Mode    string `json:"mode"`
	Fixed   struct {
		Start    string `json:"start"`
		Stop     string `json:"stop"`
		Days     []int  `json:"days"`
		Timezone string `json:"timezone"`
	} `json:"fixed"`
	MaxActiveHours *float64 `json:"maxActiveHours"`
	IgnoreAdmins   bool     `json:"ignoreAdmins"`
	ExcludedUsers  []string `json:"excludedUsers"`
}

// Load reads policy directly from the database, including during automatic builds.
func Load(ctx context.Context, db database.Store) (Policy, error) {
	//nolint:gocritic // Internal enforcement needs policy even for non-admin requests.
	raw, err := db.GetRuntimeConfig(dbauthz.AsSystemRestricted(ctx), ConfigKey)
	if xerrors.Is(err, sql.ErrNoRows) {
		return Policy{}, nil
	}
	if err != nil {
		return Policy{}, xerrors.Errorf("read workspace scheduler: %w", err)
	}
	p := Policy{IgnoreAdmins: true}
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return Policy{}, xerrors.Errorf("decode workspace scheduler: %w", err)
	}
	return p, nil
}

// Exempt reports whether the global scheduler leaves this owner alone.
func (p Policy) Exempt(user database.User) bool {
	return !p.Enabled || slices.Contains(p.ExcludedUsers, user.Username) || (p.IgnoreAdmins && slices.Contains(user.RBACRoles, "owner"))
}

// FixedSchedule returns the administrator's required cron schedule and TTL.
func (p Policy) FixedSchedule() (string, time.Duration, error) {
	start, err := time.Parse("15:04", p.Fixed.Start)
	if err != nil {
		return "", 0, xerrors.Errorf("parse scheduler start: %w", err)
	}
	stop, err := time.Parse("15:04", p.Fixed.Stop)
	if err != nil {
		return "", 0, xerrors.Errorf("parse scheduler stop: %w", err)
	}
	weekdays := slices.Clone(p.Fixed.Days)
	slices.Sort(weekdays)
	weekdays = slices.Compact(weekdays)
	days := make([]string, len(weekdays))
	for i, day := range weekdays {
		if day < 0 || day > 6 {
			return "", 0, xerrors.New("invalid scheduler weekday")
		}
		days[i] = strconv.Itoa(day)
	}
	if len(days) == 0 {
		return "", 0, xerrors.New("scheduler needs at least one weekday")
	}
	daySpec := strings.Join(days, ",")
	if len(days) == 7 {
		daySpec = "*"
	}
	spec := fmt.Sprintf("CRON_TZ=%s %d %d * * %s", p.Fixed.Timezone, start.Minute(), start.Hour(), daySpec)
	if _, err := cron.Weekly(spec); err != nil {
		return "", 0, err
	}
	ttl := stop.Sub(start)
	if ttl <= 0 {
		ttl += 24 * time.Hour
	}
	return spec, ttl, nil
}

// Problem explains why the supplied schedule cannot start a workspace.
func (p Policy) Problem(spec string, ttl time.Duration) string {
	if _, err := cron.Weekly(spec); err != nil {
		return "Set a valid workspace start schedule before starting."
	}
	if ttl < time.Minute {
		return "Set a workspace shutdown time before starting."
	}
	if p.MaxActiveHours != nil && ttl > time.Duration(*p.MaxActiveHours*float64(time.Hour)) {
		return fmt.Sprintf("Workspace shutdown must be within %g hours of starting.", *p.MaxActiveHours)
	}
	if p.Mode == "fixed" {
		want, duration, err := p.FixedSchedule()
		if err != nil || spec != want || ttl != duration {
			return "This workspace must use the administrator's required schedule."
		}
	}
	return ""
}

// ForWorkspace resolves exemptions, including leases with their own hard expiry.
func ForWorkspace(ctx context.Context, db database.Store, ws database.Workspace) (Policy, error) {
	p, err := Load(ctx, db)
	if err != nil || !p.Enabled || ws.IsPrebuild() {
		return Policy{}, err
	}
	user, err := db.GetUserByID(ctx, ws.OwnerID)
	if err != nil {
		return Policy{}, xerrors.Errorf("read scheduler owner: %w", err)
	}
	if p.Exempt(user) {
		return Policy{}, nil
	}
	//nolint:gocritic // Temporary leases have a separate authoritative expiry policy.
	_, err = db.GetShortTermLeaseByUserID(dbauthz.AsSystemRestricted(ctx), ws.OwnerID)
	if err == nil {
		return Policy{}, nil
	}
	if !xerrors.Is(err, sql.ErrNoRows) {
		return Policy{}, xerrors.Errorf("read scheduler lease: %w", err)
	}
	return p, nil
}

// ApplyFixed updates both halves of a required schedule in the caller's transaction.
func (p Policy) ApplyFixed(ctx context.Context, db database.Store, ws *database.Workspace) error {
	if !p.Enabled || p.Mode != "fixed" {
		return nil
	}
	spec, ttl, err := p.FixedSchedule()
	if err != nil {
		return err
	}
	updated := *ws
	// This applies an administrator's policy after the caller authorizes the build.
	//nolint:gocritic // Starting a workspace need not grant arbitrary schedule edits.
	ctx = dbauthz.AsSystemRestricted(ctx)
	if ws.AutostartSchedule.String != spec || !ws.AutostartSchedule.Valid {
		updated.AutostartSchedule = sql.NullString{String: spec, Valid: true}
		updated.NextStartAt = sql.NullTime{}
		if err := db.UpdateWorkspaceAutostart(ctx, database.UpdateWorkspaceAutostartParams{ID: ws.ID, AutostartSchedule: updated.AutostartSchedule, NextStartAt: updated.NextStartAt}); err != nil {
			return err
		}
	}
	if ws.Ttl.Int64 != int64(ttl) || !ws.Ttl.Valid {
		updated.Ttl = sql.NullInt64{Int64: int64(ttl), Valid: true}
		if err := db.UpdateWorkspaceTTL(ctx, database.UpdateWorkspaceTTLParams{ID: ws.ID, Ttl: updated.Ttl}); err != nil {
			return err
		}
	}
	*ws = updated
	return nil
}

// Limit clamps the deadline and its activity-resistant ceiling. Existing ceilings
// never move later, so subsequent ticks or schedule edits cannot restart a countdown.
func (p Policy) Limit(ws database.Workspace, started, now, deadline, maximum time.Time) (effectiveDeadline, effectiveMaximum time.Time) {
	if !p.Enabled {
		return deadline, maximum
	}
	var limit time.Time
	if p.Problem(ws.AutostartSchedule.String, time.Duration(ws.Ttl.Int64)) != "" {
		limit = now.Add(CorrectionWindow)
	} else {
		limit = started.Add(time.Duration(ws.Ttl.Int64))
	}
	if p.MaxActiveHours != nil {
		limit = earlier(limit, started.Add(time.Duration(*p.MaxActiveHours*float64(time.Hour))))
	}
	maximum = earlier(maximum, limit)
	return earlier(deadline, maximum), maximum
}

func earlier(a, b time.Time) time.Time {
	if a.IsZero() || (!b.IsZero() && b.Before(a)) {
		return b
	}
	return a
}
