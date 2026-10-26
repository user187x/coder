// Package medialease owns revocable, bounded TURN media paths outside workspaces.
package medialease

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"sync"
	"time"

	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/pion/turn/v5"
	"golang.org/x/time/rate"
)

var (
	// ErrDisabled means media relay support has not been enabled by an operator.
	ErrDisabled = errors.New("workspace media relay is disabled")
	// ErrClosed means the lease cannot carry traffic or be renewed.
	ErrClosed = errors.New("workspace media lease is closed")
	// ErrCapacity means no bounded relay slot is available.
	ErrCapacity       = errors.New("workspace media relay capacity is exhausted")
	errDatagramDenied = errors.New("media datagram denied by endpoint or rate policy")
)

// Binding must be resolved from trusted authentication and runtime state, never
// accepted from workspace signaling. Check must verify every field on renewal.
type Binding struct {
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	WorkspaceID    uuid.UUID
	BuildID        uuid.UUID
	AgentID        uuid.UUID
	NodeUID        uuid.UUID
	VMUID          uuid.UUID
	VMIUID         uuid.UUID
	SessionID      uuid.UUID
	// AccessRevision combines the authoritative deployment and workspace policies.
	// A release must not revive credentials issued before a restrictive revision.
	AccessRevision string
	// ClientIP is the trusted signaling address. LAN/VPN UDP may take a
	// different route; its tuple is pinned only after TURN integrity verification.
	ClientIP netip.Addr
	Peer     netip.AddrPort
}

// Guard registers immediate policy cancellation for the authenticated Coder
// signaling session. Its context must end on access revocation or session loss.
type Guard func(context.Context, Binding) (context.Context, func(), error)

// Check verifies fresh authoritative authorization and all runtime identities.
// Errors, including unavailable policy, revoke the lease. It must honor ctx.
type Check func(context.Context, Binding) error

// Config is explicit operator policy. The zero value creates no sockets.
type Config struct {
	Enabled          bool
	BindIP           netip.Addr
	AdvertiseIP      netip.Addr
	ClientPrefixes   []netip.Prefix
	PeerPrefixes     []netip.Prefix
	PortMin          uint16
	PortMax          uint16
	MaxLeases        int
	Lifetime         time.Duration
	PacketsPerSecond int
	Clock            quartz.Clock
	Guard            Guard
	Check            Check
}

// Manager reserves two UDP sockets per lease and never starts TCP relays.
type Manager struct {
	cfg     Config
	mu      sync.Mutex
	closed  bool
	pending int
	slots   map[uint16]*Lease
}

// Credentials are browser TURN credentials, not permission to renew a lease.
// Keep them out of logs and workspace-facing configuration.
type Credentials struct {
	URL      string
	Username string
	Password string
}

// Lease is a trusted control-plane handle. Never expose it through a guest
// renewal route; only Credentials may be returned to the authenticated browser.
type Lease struct {
	manager     *Manager
	binding     Binding
	credentials Credentials
	guard       context.Context
	release     func()
	stopGuard   func() bool
	mu          sync.Mutex
	deadline    time.Time
	closed      bool
	listener    *filteredConn
	relay       *filteredConn
	server      *turn.Server
	allocated   bool
	clientTuple netip.AddrPort
	timer       *quartz.Timer
	once        sync.Once
	done        chan struct{}
	closeErr    error
	limiter     *rate.Limiter
	port        uint16
}

// New validates the relay policy without opening any sockets.
func New(cfg Config) (*Manager, error) {
	m := &Manager{cfg: cfg, slots: make(map[uint16]*Lease)}
	if !cfg.Enabled {
		return m, nil
	}
	if cfg.Guard == nil || cfg.Check == nil || cfg.Clock == nil {
		return nil, errors.New("media relay requires authoritative guards, checks, and a clock")
	}
	if !unicast4(cfg.BindIP) || !unicast4(cfg.AdvertiseIP) || cfg.BindIP.IsLoopback() != cfg.AdvertiseIP.IsLoopback() {
		return nil, errors.New("media relay requires explicit IPv4 bind and advertised addresses")
	}
	ports := int(cfg.PortMax) - int(cfg.PortMin) + 1
	if cfg.PortMin < 1024 || cfg.PortMax <= cfg.PortMin || cfg.MaxLeases < 1 || cfg.MaxLeases > 64 || ports < cfg.MaxLeases*2 || ports > 128 {
		return nil, errors.New("media relay requires a bounded unprivileged port pool for at most 64 leases")
	}
	if cfg.Lifetime < time.Second || cfg.Lifetime > 3*time.Second || cfg.PacketsPerSecond < 1 || cfg.PacketsPerSecond > 10000 {
		return nil, errors.New("media relay requires a one to three second lease and bounded packet rate")
	}
	for _, prefixes := range [][]netip.Prefix{cfg.ClientPrefixes, cfg.PeerPrefixes} {
		if len(prefixes) == 0 || len(prefixes) > 16 {
			return nil, errors.New("media relay requires bounded client and peer networks")
		}
		for _, p := range prefixes {
			if !p.IsValid() || !p.Addr().Is4() || p.Bits() < 8 {
				return nil, errors.New("media relay network is invalid or too broad")
			}
		}
	}
	m.cfg.ClientPrefixes = append([]netip.Prefix(nil), cfg.ClientPrefixes...)
	m.cfg.PeerPrefixes = append([]netip.Prefix(nil), cfg.PeerPrefixes...)
	return m, nil
}

func unicast4(ip netip.Addr) bool {
	return ip.Is4() && !ip.IsUnspecified() && !ip.IsMulticast() && !ip.IsLinkLocalUnicast() && ip != netip.MustParseAddr("255.255.255.255")
}

func contains(prefixes []netip.Prefix, ip netip.Addr) bool {
	for _, p := range prefixes {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

func (m *Manager) validate(b Binding) error {
	for _, id := range []uuid.UUID{b.OrganizationID, b.UserID, b.WorkspaceID, b.BuildID, b.AgentID, b.NodeUID, b.VMUID, b.VMIUID, b.SessionID} {
		if id == uuid.Nil {
			return errors.New("media lease identity is incomplete")
		}
	}
	if len(b.AccessRevision) == 0 || len(b.AccessRevision) > 256 {
		return errors.New("media lease access revision is incomplete")
	}
	if !b.ClientIP.IsValid() || b.ClientIP.IsUnspecified() || b.ClientIP.IsMulticast() || b.ClientIP.Zone() != "" || !unicast4(b.Peer.Addr()) || b.Peer.Port() == 0 || !contains(m.cfg.PeerPrefixes, b.Peer.Addr()) || (b.Peer.Addr().IsLoopback() && !m.cfg.BindIP.IsLoopback()) {
		return errors.New("media lease endpoint is outside approved networks")
	}
	return nil
}

// Lifetime returns the maximum unrenewed authorization duration.
func (m *Manager) Lifetime() time.Duration { return m.cfg.Lifetime }

// Create accepts a trusted binding and an already authenticated signaling
// context. No media is authorized after that context or its guard is canceled.
func (m *Manager) Create(ctx context.Context, b Binding) (*Lease, error) {
	if !m.cfg.Enabled {
		return nil, ErrDisabled
	}
	if err := m.validate(b); err != nil {
		return nil, err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, ErrClosed
	}
	if len(m.slots)+m.pending >= m.cfg.MaxLeases {
		m.mu.Unlock()
		return nil, ErrCapacity
	}
	m.pending++
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.pending--; m.mu.Unlock() }()
	guarded, release, err := m.cfg.Guard(ctx, b)
	if err != nil {
		if release != nil {
			release()
		}
		return nil, fmt.Errorf("guard media lease: %w", err)
	}
	if guarded == nil || guarded.Done() == nil || release == nil {
		if release != nil {
			release()
		}
		return nil, errors.New("media lease requires a cancellable authoritative guard")
	}
	l := &Lease{manager: m, binding: b, guard: guarded, release: release, done: make(chan struct{}), limiter: newLimiter(m.cfg.PacketsPerSecond)}
	l.credentials = Credentials{Username: uuid.NewString(), Password: rand.Text()}
	if err := l.check(ctx); err != nil {
		release()
		return nil, err
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		release()
		return nil, ErrClosed
	}
	if len(m.slots) >= m.cfg.MaxLeases {
		m.mu.Unlock()
		release()
		return nil, ErrCapacity
	}
	for port := int(m.cfg.PortMin); port+1 <= int(m.cfg.PortMax); port += 2 {
		p := uint16(port)
		if _, used := m.slots[p]; used {
			continue
		}
		listener, e := net.ListenUDP("udp4", net.UDPAddrFromAddrPort(netip.AddrPortFrom(m.cfg.BindIP, p)))
		if e != nil {
			continue
		}
		relay, e := net.ListenUDP("udp4", net.UDPAddrFromAddrPort(netip.AddrPortFrom(m.cfg.BindIP, p+1)))
		if e != nil {
			_ = listener.Close()
			continue
		}
		l.port = p
		l.listener, e = newFilteredConn(listener, l, false)
		if e == nil {
			l.relay, e = newFilteredConn(relay, l, true)
		}
		if e != nil {
			_ = listener.Close()
			_ = relay.Close()
			m.mu.Unlock()
			release()
			return nil, fmt.Errorf("bound media socket buffers: %w", e)
		}
		m.slots[p] = l
		break
	}
	if l.listener == nil {
		m.mu.Unlock()
		release()
		return nil, ErrCapacity
	}
	l.deadline = m.cfg.Clock.Now().Add(m.cfg.Lifetime)
	l.credentials.URL = "turn:" + net.JoinHostPort(m.cfg.AdvertiseIP.String(), fmt.Sprint(l.port)) + "?transport=udp"
	l.server, err = turn.NewServer(turn.ServerConfig{
		Realm: realm,
		AuthHandler: func(a *turn.RequestAttributes) (string, []byte, bool) {
			if a.Username != l.credentials.Username || a.Realm != realm || !l.active() || !l.client(a.SrcAddr) {
				return "", nil, false
			}
			return a.Username, turn.GenerateAuthKey(a.Username, realm, l.credentials.Password), true
		},
		// Pion invokes this only after MESSAGE-INTEGRITY authentication, not
		// during credential lookup or an unauthenticated STUN challenge.
		QuotaHandler: l.pinClient,
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: l.listener, RelayAddressGenerator: l,
			PermissionHandler: func(client net.Addr, peer net.IP) bool {
				ip, ok := netip.AddrFromSlice(peer)
				return ok && ip.Unmap() == b.Peer.Addr() && l.client(client) && l.active()
			}}},
		// TURN refresh timers retain their RFC defaults. Authorization expires
		// independently at each datagram gate and closes both owned sockets.
		InboundMTU: 1500,
	})
	if err != nil {
		m.mu.Unlock()
		_ = l.Close()
		return nil, fmt.Errorf("start media TURN relay: %w", err)
	}
	l.mu.Lock()
	l.timer = m.cfg.Clock.AfterFunc(m.cfg.Lifetime, l.expire, "media-lease-expiry")
	l.stopGuard = context.AfterFunc(guarded, func() { _ = l.Close() })
	l.mu.Unlock()
	m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		_ = l.Close()
		return nil, err
	}
	if !l.active() {
		_ = l.Close()
		return nil, ErrClosed
	}
	return l, nil
}

const realm = "coder-workspace-media"

func (l *Lease) check(ctx context.Context) error {
	checkCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := l.guard.Err(); err != nil {
		return err
	}
	if err := l.manager.cfg.Check(checkCtx, l.binding); err != nil {
		return fmt.Errorf("verify media lease: %w", err)
	}
	if err := checkCtx.Err(); err != nil {
		return err
	}
	return l.guard.Err()
}

func (l *Lease) expire() {
	l.mu.Lock()
	expired := !l.manager.cfg.Clock.Now().Before(l.deadline)
	l.mu.Unlock()
	if expired {
		_ = l.Close()
	}
}

func (l *Lease) active() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return !l.closed && l.guard.Err() == nil && l.manager.cfg.Clock.Now().Before(l.deadline)
}

func (l *Lease) client(addr net.Addr) bool {
	endpoint, ok := udpEndpoint(addr)
	if !ok || !contains(l.manager.cfg.ClientPrefixes, endpoint.Addr()) {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return !l.clientTuple.IsValid() || l.clientTuple == endpoint
}

func (l *Lease) pinClient(username, authRealm string, addr net.Addr) bool {
	endpoint, ok := udpEndpoint(addr)
	if !ok || username != l.credentials.Username || authRealm != realm || !contains(l.manager.cfg.ClientPrefixes, endpoint.Addr()) {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || l.allocated || l.guard.Err() != nil || !l.manager.cfg.Clock.Now().Before(l.deadline) {
		return false
	}
	if l.clientTuple.IsValid() {
		return l.clientTuple == endpoint
	}
	l.clientTuple = endpoint
	return true
}

// Credentials returns the browser's allocation credentials. It never extends
// authorization and must only be delivered through authenticated HTTPS.
func (l *Lease) Credentials() Credentials { return l.credentials }

// Renew performs a fresh authoritative check. A browser or guest must never be
// able to call this method through a public renewal endpoint.
func (l *Lease) Renew(ctx context.Context) error {
	if err := l.check(ctx); err != nil {
		_ = l.Close()
		return err
	}
	l.mu.Lock()
	if l.closed || l.guard.Err() != nil || !l.manager.cfg.Clock.Now().Before(l.deadline) {
		l.mu.Unlock()
		_ = l.Close()
		return ErrClosed
	}
	l.deadline = l.manager.cfg.Clock.Now().Add(l.manager.cfg.Lifetime)
	l.timer.Reset(l.manager.cfg.Lifetime)
	l.mu.Unlock()
	return nil
}

// RelayAddress returns the sole advertised browser allocation endpoint.
func (l *Lease) RelayAddress() netip.AddrPort {
	return netip.AddrPortFrom(l.manager.cfg.AdvertiseIP, l.port+1)
}

// Done closes after owned socket shutdown has finished. Call Close to inspect
// any close error before reporting confirmed revocation.
func (l *Lease) Done() <-chan struct{} { return l.done }

// Close synchronously closes the listener and the allocation socket, rather
// than treating Pion's asynchronous allocation cleanup as shutdown evidence.
func (l *Lease) Close() error {
	l.once.Do(func() {
		l.mu.Lock()
		l.closed = true
		if l.timer != nil {
			l.timer.Stop()
		}
		if l.stopGuard != nil {
			l.stopGuard()
		}
		l.mu.Unlock()
		var errs []error
		for _, conn := range []*filteredConn{l.listener, l.relay} {
			if conn != nil {
				if err := conn.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
					errs = append(errs, err)
				}
			}
		}
		if l.server != nil {
			if err := l.server.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
				errs = append(errs, err)
			}
		}
		l.release()
		l.manager.mu.Lock()
		delete(l.manager.slots, l.port)
		l.manager.mu.Unlock()
		l.closeErr = errors.Join(errs...)
		close(l.done)
	})
	return l.closeErr
}

// Close stops all relays and rejects future leases.
func (m *Manager) Close() error {
	m.mu.Lock()
	m.closed = true
	leases := make([]*Lease, 0, len(m.slots))
	for _, l := range m.slots {
		leases = append(leases, l)
	}
	m.mu.Unlock()
	var errs []error
	for _, l := range leases {
		if err := l.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Validate implements the TURN allocator contract.
func (l *Lease) Validate() error { return nil }

// AllocatePacketConn permits one exact pre-reserved UDP allocation per lease.
func (l *Lease) AllocatePacketConn(info turn.AllocateListenerConfig) (net.PacketConn, net.Addr, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || l.guard.Err() != nil || !l.manager.cfg.Clock.Now().Before(l.deadline) {
		return nil, nil, ErrClosed
	}
	if l.allocated || info.Network != "udp4" || info.RequestedPort != 0 || info.UserID != l.credentials.Username || info.Realm != realm {
		return nil, nil, ErrCapacity
	}
	l.allocated = true
	return l.relay, net.UDPAddrFromAddrPort(netip.AddrPortFrom(l.manager.cfg.AdvertiseIP, l.port+1)), nil
}

// AllocateListener rejects TURN TCP allocations.
func (l *Lease) AllocateListener(turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return nil, nil, errors.New("TCP media allocation is disabled")
}

// AllocateConn rejects TURN TCP peer connections.
func (l *Lease) AllocateConn(turn.AllocateConnConfig) (net.Conn, error) {
	return nil, errors.New("TCP media allocation is disabled")
}
