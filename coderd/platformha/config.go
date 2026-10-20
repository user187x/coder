// Package platformha is the platform's own high availability for Coder's control
// plane (docs/adr/0001-platform-ha.md in the deployment repository): Community
// code only, independent of the Enterprise high_availability entitlement.
//
// Phase 1 is the replica registry: each Coder replica holds a lease in
// PostgreSQL (schema platform_ha) under an epoch, renews it by compare-and-set,
// and fences itself - stops serving - before its lease can lapse when it cannot
// renew. The later phases (active/standby, active/active) build on it.
package platformha

import (
	"os"
	"strings"
	"time"

	"golang.org/x/xerrors"
)

// Mode selects how much of Platform HA runs. Off is the default: nothing runs,
// Coder behaves exactly as before.
type Mode string

const (
	ModeOff Mode = "off"
	// ModeRegistry runs the replica registry only: leases, fencing, metrics.
	// Nothing else changes.
	ModeRegistry Mode = "registry"
	// ModeActiveStandby runs one Coder at a time: the replica holding the
	// "coder-active" lease serves (its pod labeled active, which the Service
	// selects); the others wait, warm, without starting Coder, and take over
	// when the lease lapses - or, on a rolling update, by a handover that starts
	// the successor before the leader lets go.
	ModeActiveStandby Mode = "activeStandby"
)

// ActiveLease is the lease of the replica that serves in activeStandby.
const ActiveLease = "coder-active"

const (
	DefaultCell          = "a"
	DefaultLeaseTTL      = 10 * time.Second
	DefaultRenewInterval = 3 * time.Second
	// DefaultHealthAddress serves the replica's probes and status in the HA
	// modes, from the start (a standby does not serve Coder's own port).
	DefaultHealthAddress = ":2113"
	// DefaultHandoverTimeout bounds a handover: the leader waits this long for
	// its successor to serve before it lets go anyway.
	DefaultHandoverTimeout = 60 * time.Second
)

// Config is Platform HA's configuration, read from the environment
// (CODER_PLATFORM_HA_*).
type Config struct {
	Mode Mode
	// Cell is the replica's cell: one DERP region of up to a few replicas.
	Cell string
	// PodName and PodIP identify the replica (the Downward API's
	// metadata.name and status.podIP).
	PodName string
	PodIP   string
	// LeaseTTL is how long a lease lasts unrenewed; RenewInterval how often
	// it is renewed. A replica fences itself once LeaseTTL-RenewInterval has
	// passed since its last renewal.
	LeaseTTL      time.Duration
	RenewInterval time.Duration
	// Version is the replica's build, shown in the registry.
	Version string
	// HealthAddress serves /livez, /readyz, /status and /handover (activeStandby).
	HealthAddress string
	// HandoverTimeout bounds a handover (activeStandby).
	HandoverTimeout time.Duration
}

// ConfigFromEnv reads the configuration; getenv is os.Getenv outside tests.
func ConfigFromEnv(getenv func(string) string, version string) (Config, error) {
	c := Config{
		Mode:            Mode(strings.TrimSpace(getenv("CODER_PLATFORM_HA_MODE"))),
		Cell:            strings.TrimSpace(getenv("CODER_PLATFORM_HA_CELL")),
		PodName:         strings.TrimSpace(getenv("CODER_PLATFORM_HA_POD_NAME")),
		PodIP:           strings.TrimSpace(getenv("CODER_PLATFORM_HA_POD_IP")),
		LeaseTTL:        DefaultLeaseTTL,
		RenewInterval:   DefaultRenewInterval,
		Version:         version,
		HealthAddress:   strings.TrimSpace(getenv("CODER_PLATFORM_HA_HEALTH_ADDRESS")),
		HandoverTimeout: DefaultHandoverTimeout,
	}
	if c.HealthAddress == "" {
		c.HealthAddress = DefaultHealthAddress
	}
	if c.Mode == "" {
		c.Mode = ModeOff
	}
	switch c.Mode {
	case ModeOff, ModeRegistry, ModeActiveStandby:
	default:
		return Config{}, xerrors.Errorf("CODER_PLATFORM_HA_MODE %q: off, registry or activeStandby (activeActive comes in a later phase)", c.Mode)
	}
	if c.Cell == "" {
		c.Cell = DefaultCell
	}
	if c.PodName == "" {
		c.PodName, _ = os.Hostname()
	}
	for name, d := range map[string]*time.Duration{
		"CODER_PLATFORM_HA_LEASE_TTL":        &c.LeaseTTL,
		"CODER_PLATFORM_HA_RENEW_INTERVAL":   &c.RenewInterval,
		"CODER_PLATFORM_HA_HANDOVER_TIMEOUT": &c.HandoverTimeout,
	} {
		v := strings.TrimSpace(getenv(name))
		if v == "" {
			continue
		}
		parsed, err := time.ParseDuration(v)
		if err != nil || parsed <= 0 {
			return Config{}, xerrors.Errorf("%s %q: a positive duration, such as 10s", name, v)
		}
		*d = parsed
	}
	// Two renewals must fit in a lease: one may fail without the replica fencing itself.
	if 2*c.RenewInterval >= c.LeaseTTL {
		return Config{}, xerrors.Errorf("CODER_PLATFORM_HA_RENEW_INTERVAL (%s) must be under half of CODER_PLATFORM_HA_LEASE_TTL (%s)",
			c.RenewInterval, c.LeaseTTL)
	}
	return c, nil
}

// Enabled reports whether any of Platform HA runs.
func (c Config) Enabled() bool {
	return c.Mode != ModeOff
}

// Leadership reports whether replicas take turns serving (one active at a time).
func (c Config) Leadership() bool {
	return c.Mode == ModeActiveStandby
}
