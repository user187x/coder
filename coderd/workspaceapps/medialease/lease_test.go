package medialease

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/pion/stun/v3"
	"github.com/pion/turn/v5"
	"github.com/stretchr/testify/require"
)

var testPorts = struct {
	sync.Mutex
	used map[uint16]bool
}{used: make(map[uint16]bool)}

func portPool(t *testing.T) uint16 {
	t.Helper()
	testPorts.Lock()
	defer testPorts.Unlock()
	for range 100 {
		first, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		require.NoError(t, err)
		port := first.LocalAddr().(*net.UDPAddr).AddrPort().Port()
		sockets := []*net.UDPConn{first}
		available := port <= 65530 && !testPorts.used[port]
		for offset := uint16(1); available && offset < 4; offset++ {
			if testPorts.used[port+offset] {
				available = false
				break
			}
			socket, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: int(port + offset)})
			if err != nil {
				available = false
				break
			}
			sockets = append(sockets, socket)
		}
		for _, socket := range sockets {
			_ = socket.Close()
		}
		if !available {
			continue
		}
		for offset := range uint16(4) {
			testPorts.used[port+offset] = true
		}
		t.Cleanup(func() {
			testPorts.Lock()
			defer testPorts.Unlock()
			for offset := range uint16(4) {
				delete(testPorts.used, port+offset)
			}
		})
		return port
	}
	t.Fatal("no free loopback media test ports")
	return 0
}

func binding() Binding {
	return Binding{OrganizationID: uuid.New(), UserID: uuid.New(), WorkspaceID: uuid.New(), BuildID: uuid.New(), AgentID: uuid.New(), NodeUID: uuid.New(), VMUID: uuid.New(), VMIUID: uuid.New(), SessionID: uuid.New(), AccessRevision: uuid.NewString(), ClientIP: netip.MustParseAddr("127.0.0.1"), Peer: netip.MustParseAddrPort("127.0.0.1:33333")}
}

func fixture(t *testing.T) (Config, *quartz.Mock) {
	t.Helper()
	clock := quartz.NewMock(t)
	port := portPool(t)
	return Config{Enabled: true, BindIP: netip.MustParseAddr("127.0.0.1"), AdvertiseIP: netip.MustParseAddr("127.0.0.1"), ClientPrefixes: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}, PeerPrefixes: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}, PortMin: port, PortMax: port + 1, MaxLeases: 1, Lifetime: 3 * time.Second, PacketsPerSecond: 10000, Clock: clock,
		Guard: func(ctx context.Context, _ Binding) (context.Context, func(), error) {
			guard, cancel := context.WithCancel(ctx)
			return guard, cancel, nil
		},
		Check: func(context.Context, Binding) error { return nil }}, clock
}

func manager(t *testing.T, cfg Config) *Manager {
	t.Helper()
	m, err := New(cfg)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, m.Close()) })
	return m
}

func TestDisabledAndRequiredPolicy(t *testing.T) {
	t.Parallel()
	m, err := New(Config{})
	require.NoError(t, err)
	_, err = m.Create(context.Background(), Binding{})
	require.ErrorIs(t, err, ErrDisabled)
	require.Empty(t, m.slots)
	cfg, _ := fixture(t)
	for _, change := range []func(*Config){
		func(c *Config) { c.Check = nil }, func(c *Config) { c.Guard = nil }, func(c *Config) { c.Clock = nil },
		func(c *Config) { c.Lifetime = 4 * time.Second }, func(c *Config) { c.MaxLeases = 65 }, func(c *Config) { c.PeerPrefixes = []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0")} },
	} {
		invalid := cfg
		change(&invalid)
		_, err := New(invalid)
		require.Error(t, err)
	}
}

func TestBindingAndFreshAuthorizationAreMandatory(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	called := 0
	cfg.Check = func(context.Context, Binding) error { called++; return errors.New("policy unavailable") }
	m := manager(t, cfg)
	b := binding()
	for _, change := range []func(*Binding){
		func(b *Binding) { b.OrganizationID = uuid.Nil }, func(b *Binding) { b.UserID = uuid.Nil }, func(b *Binding) { b.WorkspaceID = uuid.Nil },
		func(b *Binding) { b.BuildID = uuid.Nil }, func(b *Binding) { b.AgentID = uuid.Nil }, func(b *Binding) { b.NodeUID = uuid.Nil }, func(b *Binding) { b.VMUID = uuid.Nil }, func(b *Binding) { b.VMIUID = uuid.Nil }, func(b *Binding) { b.SessionID = uuid.Nil }, func(b *Binding) { b.AccessRevision = "" },
		func(b *Binding) { b.ClientIP = netip.IPv4Unspecified() }, func(b *Binding) { b.Peer = netip.MustParseAddrPort("169.254.169.254:80") },
	} {
		invalid := b
		change(&invalid)
		_, err := m.Create(t.Context(), invalid)
		require.Error(t, err)
	}
	require.Zero(t, called)
	_, err := m.Create(t.Context(), b)
	require.ErrorContains(t, err, "policy unavailable")
	require.Equal(t, 1, called)
	require.Empty(t, m.slots)
	cfg.Check = func(context.Context, Binding) error { return nil }
	cfg.Guard = func(context.Context, Binding) (context.Context, func(), error) {
		return context.Background(), func() {}, nil
	}
	m = manager(t, cfg)
	_, err = m.Create(t.Context(), b)
	require.ErrorContains(t, err, "cancellable")
}

func TestExpiryAndGuardCancellationCloseSockets(t *testing.T) {
	t.Parallel()
	for _, cause := range []string{"expiry", "session-revoked", "manager-stop"} {
		t.Run(cause, func(t *testing.T) {
			t.Parallel()
			cfg, clock := fixture(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			m := manager(t, cfg)
			l, err := m.Create(ctx, binding())
			require.NoError(t, err)
			switch cause {
			case "expiry":
				clock.Advance(3 * time.Second).MustWait(testutil.Context(t, testutil.WaitShort))
			case "session-revoked":
				cancel()
			case "manager-stop":
				require.NoError(t, m.Close())
			}
			testutil.TryReceive(testutil.Context(t, testutil.WaitShort), t, l.Done())
			require.NoError(t, l.Close())
			require.Error(t, l.Renew(t.Context()))
			assertPortsReleased(t, cfg)
		})
	}
}

func assertPortsReleased(t *testing.T, cfg Config) {
	t.Helper()
	for _, port := range []uint16{cfg.PortMin, cfg.PortMin + 1} {
		socket, err := net.ListenUDP("udp4", net.UDPAddrFromAddrPort(netip.AddrPortFrom(cfg.BindIP, port)))
		require.NoError(t, err, "owned socket was not closed")
		require.NoError(t, socket.Close())
	}
}

func TestRenewalCannotChangeBindingOrReviveExpiredLease(t *testing.T) {
	t.Parallel()
	for _, changed := range []string{"organization", "user", "workspace", "build", "agent", "node", "vm", "vmi", "session", "access-revision", "endpoint", "unavailable"} {
		t.Run(changed, func(t *testing.T) {
			t.Parallel()
			cfg, clock := fixture(t)
			current := binding()
			cfg.Check = func(_ context.Context, requested Binding) error {
				if requested != current {
					return errors.New("authoritative binding changed")
				}
				return nil
			}
			m := manager(t, cfg)
			l, err := m.Create(t.Context(), current)
			require.NoError(t, err)
			clock.Advance(time.Second).MustWait(testutil.Context(t, testutil.WaitShort))
			require.NoError(t, l.Renew(t.Context()))
			clock.Advance(2 * time.Second).MustWait(testutil.Context(t, testutil.WaitShort))
			require.True(t, l.active(), "renewed lease should outlive its original expiry")
			switch changed {
			case "organization":
				current.OrganizationID = uuid.New()
			case "user":
				current.UserID = uuid.New()
			case "workspace":
				current.WorkspaceID = uuid.New()
			case "build":
				current.BuildID = uuid.New()
			case "agent":
				current.AgentID = uuid.New()
			case "node":
				current.NodeUID = uuid.New()
			case "vm":
				current.VMUID = uuid.New()
			case "vmi":
				current.VMIUID = uuid.New()
			case "session":
				current.SessionID = uuid.New()
			case "access-revision":
				current.AccessRevision = uuid.NewString()
			case "endpoint":
				current.Peer = netip.MustParseAddrPort("127.0.0.1:33334")
			case "unavailable":
				current = Binding{}
			}
			require.Error(t, l.Renew(t.Context()))
			testutil.TryReceive(testutil.Context(t, testutil.WaitShort), t, l.Done())
			assertPortsReleased(t, cfg)
		})
	}
}

func TestBoundedSlotsAndFreshCredentials(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	m := manager(t, cfg)
	first, err := m.Create(t.Context(), binding())
	require.NoError(t, err)
	_, err = m.Create(t.Context(), binding())
	require.ErrorIs(t, err, ErrCapacity)
	old := first.Credentials()
	require.NoError(t, first.Close())
	next, err := m.Create(t.Context(), binding())
	require.NoError(t, err)
	require.NotEqual(t, old.Username, next.Credentials().Username)
	require.NotEqual(t, old.Password, next.Credentials().Password)
	require.Error(t, first.Renew(t.Context()))
	require.NoError(t, m.Close())
	_, err = m.Create(t.Context(), binding())
	require.ErrorIs(t, err, ErrClosed)
}

func authenticatedClient(t *testing.T, port uint16, creds Credentials) *turn.Client {
	return clientFrom(t, port, creds, "127.0.0.1")
}

func clientFrom(t *testing.T, port uint16, creds Credentials, source string) *turn.Client {
	t.Helper()
	socket, err := net.ListenPacket("udp4", net.JoinHostPort(source, "0"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = socket.Close() })
	client, err := turn.NewClient(&turn.ClientConfig{Conn: socket, TURNServerAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port))), Username: creds.Username, Password: creds.Password, Realm: realm, RTO: 20 * time.Millisecond})
	require.NoError(t, err)
	t.Cleanup(client.Close)
	require.NoError(t, client.Listen())
	return client
}

func turnClient(t *testing.T, l *Lease) (*turn.Client, net.PacketConn) {
	t.Helper()
	client := authenticatedClient(t, l.port, l.Credentials())
	allocated, err := client.Allocate()
	require.NoError(t, err)
	t.Cleanup(func() { _ = allocated.Close() })
	return client, allocated
}

func TestRealTURNDataAndInfrastructureRevocation(t *testing.T) {
	t.Parallel()
	for _, cause := range []string{"guard-revoked", "renewal-expired", "worker-replaced", "policy-unavailable"} {
		t.Run(cause, func(t *testing.T) {
			t.Parallel()
			cfg, clock := fixture(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
			require.NoError(t, err)
			t.Cleanup(func() { _ = peer.Close() })
			b := binding()
			b.Peer = peer.LocalAddr().(*net.UDPAddr).AddrPort()
			current := b
			unavailable := false
			cfg.Check = func(_ context.Context, requested Binding) error {
				if unavailable || requested != current {
					return errors.New("fresh authorization unavailable or changed")
				}
				return nil
			}
			m := manager(t, cfg)
			l, err := m.Create(ctx, b)
			require.NoError(t, err)
			_, allocation := turnClient(t, l)
			require.NoError(t, peer.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
			_, err = allocation.WriteTo([]byte("browser-to-workspace"), peer.LocalAddr())
			require.NoError(t, err)
			buffer := make([]byte, 1500)
			n, source, err := peer.ReadFrom(buffer)
			require.NoError(t, err)
			require.Equal(t, "browser-to-workspace", string(buffer[:n]))
			_, err = peer.WriteTo([]byte("workspace-to-browser"), source)
			require.NoError(t, err)
			require.NoError(t, allocation.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
			n, _, err = allocation.ReadFrom(buffer)
			require.NoError(t, err)
			require.Equal(t, "workspace-to-browser", string(buffer[:n]))
			// The workspace socket stays alive and ignores signaling shutdown.
			switch cause {
			case "guard-revoked":
				cancel()
			case "renewal-expired":
				clock.Advance(3 * time.Second).MustWait(testutil.Context(t, testutil.WaitShort))
			case "worker-replaced":
				current.NodeUID = uuid.New()
				require.Error(t, l.Renew(t.Context()))
			case "policy-unavailable":
				unavailable = true
				require.Error(t, l.Renew(t.Context()))
			}
			testutil.TryReceive(testutil.Context(t, testutil.WaitShort), t, l.Done())
			require.NoError(t, l.Close())
			_, err = peer.WriteTo([]byte("guest-still-sending"), source)
			require.NoError(t, err)
			require.NoError(t, allocation.SetReadDeadline(time.Now().Add(50*time.Millisecond)))
			_, _, err = allocation.ReadFrom(buffer)
			require.Error(t, err)
			assertPortsReleased(t, cfg)
		})
	}
}

func TestTURNExactPortAndSingleAllocation(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = peer.Close() })
	b := binding()
	b.Peer = peer.LocalAddr().(*net.UDPAddr).AddrPort()
	m := manager(t, cfg)
	l, err := m.Create(t.Context(), b)
	require.NoError(t, err)
	_, allocation := turnClient(t, l)
	wrong, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = wrong.Close() })
	_, err = allocation.WriteTo([]byte("denied-port"), wrong.LocalAddr())
	require.Error(t, err, "the permission request must reject an unreviewed port")
	require.NoError(t, wrong.SetReadDeadline(time.Now().Add(50*time.Millisecond)))
	_, _, err = wrong.ReadFrom(make([]byte, 1500))
	require.Error(t, err)
	_, err = l.relay.WriteTo([]byte("denied-port"), wrong.LocalAddr())
	require.ErrorIs(t, err, errDatagramDenied)
	_, _, err = l.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4", UserID: l.credentials.Username, Realm: realm})
	require.ErrorIs(t, err, ErrCapacity)
	_, _, err = l.AllocateListener(turn.AllocateListenerConfig{})
	require.Error(t, err)
	_, err = l.AllocateConn(turn.AllocateConnConfig{})
	require.Error(t, err)
}

func TestPendingAuthorizationIsBoundedAndCannotOutliveManager(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	started, proceed := make(chan struct{}), make(chan struct{})
	cfg.Check = func(ctx context.Context, _ Binding) error {
		close(started)
		select {
		case <-proceed:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	m := manager(t, cfg)
	done := make(chan error, 1)
	go func() { _, err := m.Create(t.Context(), binding()); done <- err }()
	ctx := testutil.Context(t, testutil.WaitShort)
	testutil.TryReceive(ctx, t, started)
	_, err := m.Create(ctx, binding())
	require.ErrorIs(t, err, ErrCapacity)
	require.NoError(t, m.Close())
	close(proceed)
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), ErrClosed)
	assertPortsReleased(t, cfg)
}

func TestExactInboundPeerAndPacketBudget(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	cfg.PacketsPerSecond = 1
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = peer.Close() })
	b := binding()
	b.Peer = peer.LocalAddr().(*net.UDPAddr).AddrPort()
	m := manager(t, cfg)
	l, err := m.Create(t.Context(), b)
	require.NoError(t, err)
	wrong, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = wrong.Close() })
	_, err = wrong.WriteTo([]byte("wrong-peer"), l.relay.LocalAddr())
	require.NoError(t, err)
	_, err = peer.WriteTo([]byte("correct-peer"), l.relay.LocalAddr())
	require.NoError(t, err)
	require.NoError(t, l.relay.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
	buffer := make([]byte, 1500)
	n, _, err := l.relay.ReadFrom(buffer)
	require.NoError(t, err)
	require.Equal(t, "correct-peer", string(buffer[:n]))
	// A fixed exhausted limiter exercises the data-plane denial without sleeping.
	l.limiter.SetLimit(0)
	for l.limiter.Allow() {
	}
	_, err = l.relay.WriteTo([]byte("over-budget"), peer.LocalAddr())
	require.ErrorIs(t, err, errDatagramDenied)
	require.NoError(t, l.Close())
	assertPortsReleased(t, cfg)
}

func TestRevokedCredentialsCannotAllocateOnReusedSlot(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	m := manager(t, cfg)
	first, err := m.Create(t.Context(), binding())
	require.NoError(t, err)
	old := first.Credentials()
	require.NoError(t, first.Close())
	next, err := m.Create(t.Context(), binding())
	require.NoError(t, err)
	replay := authenticatedClient(t, next.port, old)
	_, err = replay.Allocate()
	require.Error(t, err)
	require.Zero(t, next.server.AllocationCount())
	_, allocation := turnClient(t, next)
	require.NotNil(t, allocation)
}

func TestRevocationDoesNotCloseAnotherUsersRelay(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	cfg.MaxLeases = 2
	cfg.PortMax = cfg.PortMin + 3
	m := manager(t, cfg)
	firstCtx, cancel := context.WithCancel(t.Context())
	defer cancel()
	first, err := m.Create(firstCtx, binding())
	require.NoError(t, err)
	other, err := m.Create(t.Context(), binding())
	require.NoError(t, err)
	_, allocation := turnClient(t, other)
	cancel()
	testutil.TryReceive(testutil.Context(t, testutil.WaitShort), t, first.Done())
	require.True(t, other.active())
	require.Equal(t, 1, other.server.AllocationCount())
	select {
	case <-other.Done():
		t.Fatal("another user's media was revoked")
	default:
	}
	require.NotNil(t, allocation)
}

func TestUDPSourceIsPinnedOnlyAfterTURNIntegrityAcrossDifferentHTTPRoute(t *testing.T) {
	t.Parallel()
	cfg, _ := fixture(t)
	cfg.ClientPrefixes = []netip.Prefix{netip.MustParsePrefix("127.0.0.2/32"), netip.MustParsePrefix("127.0.0.3/32")}
	m := manager(t, cfg)
	b := binding()
	b.ClientIP = netip.MustParseAddr("203.0.113.40")
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	defer peer.Close()
	b.Peer = peer.LocalAddr().(*net.UDPAddr).AddrPort()
	l, err := m.Create(t.Context(), b)
	require.NoError(t, err)
	require.False(t, l.client(net.UDPAddrFromAddrPort(netip.MustParseAddrPort("127.0.0.4:12345"))))
	probe, err := net.ListenPacket("udp4", "127.0.0.3:0")
	require.NoError(t, err)
	defer probe.Close()
	request := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	_, err = probe.WriteTo(request.Raw, l.listener.LocalAddr())
	require.NoError(t, err)
	require.NoError(t, probe.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
	_, _, err = probe.ReadFrom(make([]byte, 1500))
	require.NoError(t, err)
	l.mu.Lock()
	pinned := l.clientTuple
	l.mu.Unlock()
	require.False(t, pinned.IsValid(), "unauthenticated STUN cannot choose the media tuple")
	bad := l.Credentials()
	bad.Password = "wrong-password"
	attacker := clientFrom(t, l.port, bad, "127.0.0.3")
	_, err = attacker.Allocate()
	require.Error(t, err)
	l.mu.Lock()
	pinned = l.clientTuple
	l.mu.Unlock()
	require.False(t, pinned.IsValid(), "credential lookup is not proof of integrity")
	client := clientFrom(t, l.port, l.Credentials(), "127.0.0.2")
	allocation, err := client.Allocate()
	require.NoError(t, err)
	defer allocation.Close()
	l.mu.Lock()
	pinned = l.clientTuple
	l.mu.Unlock()
	require.Equal(t, netip.MustParseAddr("127.0.0.2"), pinned.Addr())
	require.NotEqual(t, b.ClientIP, pinned.Addr(), "LAN media does not assume the HTTPS ingress route")
	_, err = allocation.WriteTo([]byte("authenticated-LAN-media"), peer.LocalAddr())
	require.NoError(t, err)
	require.NoError(t, peer.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
	buffer := make([]byte, 1500)
	n, _, err := peer.ReadFrom(buffer)
	require.NoError(t, err)
	require.Equal(t, "authenticated-LAN-media", string(buffer[:n]))
	replay := clientFrom(t, l.port, l.Credentials(), "127.0.0.3")
	_, err = replay.Allocate()
	require.Error(t, err)
	l.mu.Lock()
	after := l.clientTuple
	l.mu.Unlock()
	require.Equal(t, pinned, after)
	require.NoError(t, l.Close())
	assertPortsReleased(t, cfg)
}
