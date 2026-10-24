package tailnet

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/dns"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/types/netmap"
	"tailscale.com/wgengine"
	"tailscale.com/wgengine/filter"
	"tailscale.com/wgengine/router"
	"tailscale.com/wgengine/wgcfg"

	"cdr.dev/slog/v3"
	"cdr.dev/slog/v3/sloggers/slogtest"
	"github.com/coder/coder/v2/tailnet/proto"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
)

type allowlistReconfig struct {
	config *wgcfg.Config
	result chan error
}

type allowlistEngine struct {
	calls     chan allowlistReconfig
	closed    chan struct{}
	mu        sync.Mutex
	installed []key.NodePublic
}

func (*allowlistEngine) UpdateStatus(*ipnstate.StatusBuilder) {}
func (*allowlistEngine) SetNetworkMap(*netmap.NetworkMap)     {}
func (*allowlistEngine) SetDERPMap(*tailcfg.DERPMap)          {}
func (*allowlistEngine) SetFilter(*filter.Filter)             {}

func (e *allowlistEngine) Reconfig(config *wgcfg.Config, _ *router.Config, _ *dns.Config, _ *tailcfg.Debug) error {
	call := allowlistReconfig{config: config, result: make(chan error, 1)}
	select {
	case e.calls <- call:
	case <-e.closed:
		return ErrConnClosed
	}
	select {
	case err := <-call.result:
		if err == nil {
			e.mu.Lock()
			e.installed = peerKeys(config)
			e.mu.Unlock()
		}
		return err
	case <-e.closed:
		return ErrConnClosed
	}
}

func peerKeys(config *wgcfg.Config) []key.NodePublic {
	keys := make([]key.NodePublic, 0, len(config.Peers))
	for _, peer := range config.Peers {
		keys = append(keys, peer.PublicKey)
	}
	return keys
}

func (e *allowlistEngine) installedKeys() []key.NodePublic {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.installed)
}

func newAllowlistTestConn(t *testing.T) (*Conn, *allowlistEngine) {
	t.Helper()
	engine := &allowlistEngine{calls: make(chan allowlistReconfig, 16), closed: make(chan struct{})}
	config := newConfigMaps(testutil.Logger(t), engine, 1, key.NewNode(), key.NewDisco().Public(), CoderDNSSuffixFQDN)
	config.L.Lock()
	config.clock = quartz.NewMock(t)
	config.L.Unlock()
	t.Cleanup(func() {
		close(engine.closed)
		config.close()
	})
	return &Conn{configMaps: config, closed: make(chan struct{})}, engine
}

func allowlistNode(t *testing.T, id uuid.UUID, number int) (*proto.CoordinateResponse_PeerUpdate, key.NodePublic) {
	t.Helper()
	node := newTestNode(number)
	p, err := NodeToProto(node)
	require.NoError(t, err)
	return &proto.CoordinateResponse_PeerUpdate{Id: id[:], Kind: proto.CoordinateResponse_PeerUpdate_NODE, Node: p}, node.Key
}

func applyAllowlist(ctx context.Context, conn *Conn, enabled bool, allowed ...uuid.UUID) <-chan error {
	done := make(chan error, 1)
	go func() { done <- conn.SetPeerAllowlist(ctx, enabled, allowed) }()
	return done
}

func requireAllowlistPending(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("restriction returned before engine acknowledgement: %v", err)
	default:
	}
}

func TestPeerAllowlistPurgesActiveAndLost(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	conn, engine := newAllowlistTestConn(t)
	member, lost, owner, system := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	memberNode, _ := allowlistNode(t, member, 2)
	lostNode, _ := allowlistNode(t, lost, 3)
	ownerNode, ownerKey := allowlistNode(t, owner, 4)
	systemNode, systemKey := allowlistNode(t, system, 5)
	require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{memberNode, lostNode, ownerNode, systemNode}))
	first := testutil.TryReceive(ctx, t, engine.calls)
	require.Len(t, first.config.Peers, 4)
	first.result <- nil
	require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{{Id: lost[:], Kind: proto.CoordinateResponse_PeerUpdate_LOST}}))
	done := applyAllowlist(ctx, conn, true, owner, system)
	removed := testutil.TryReceive(ctx, t, engine.calls)
	require.ElementsMatch(t, []key.NodePublic{ownerKey, systemKey}, peerKeys(removed.config))
	requireAllowlistPending(t, done)
	removed.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
	require.ElementsMatch(t, []uuid.UUID{owner, system}, conn.configMaps.knownPeerIDs())
	conn.configMaps.L.Lock()
	blockedLost := conn.configMaps.blockedPeers[lost]
	wasLost, timerCleared := blockedLost != nil && blockedLost.lost, blockedLost != nil && blockedLost.lostTimer == nil
	conn.configMaps.L.Unlock()
	require.True(t, wasLost)
	require.True(t, timerCleared)
}

func TestPeerAllowlistDefersOwnerGrantAndPreservesUnlockReconnect(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	conn, engine := newAllowlistTestConn(t)
	done := applyAllowlist(ctx, conn, true)
	initial := testutil.TryReceive(ctx, t, engine.calls)
	require.Empty(t, initial.config.Peers)
	initial.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
	owner, member := uuid.New(), uuid.New()
	ownerNode, ownerKey := allowlistNode(t, owner, 2)
	memberNode, memberKey := allowlistNode(t, member, 3)
	conn.configMaps.setTunnelDestination(owner)
	require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{
		{Id: owner[:], Kind: proto.CoordinateResponse_PeerUpdate_READY_FOR_HANDSHAKE}, ownerNode, memberNode,
	}))
	require.Empty(t, conn.configMaps.knownPeerIDs())
	done = applyAllowlist(ctx, conn, true, owner)
	granted := testutil.TryReceive(ctx, t, engine.calls)
	require.Equal(t, []key.NodePublic{ownerKey}, peerKeys(granted.config))
	granted.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
	done = applyAllowlist(ctx, conn, false)
	unlocked := testutil.TryReceive(ctx, t, engine.calls)
	require.ElementsMatch(t, []key.NodePublic{ownerKey, memberKey}, peerKeys(unlocked.config))
	unlocked.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
	conn.configMaps.L.Lock()
	blockedCount := len(conn.configMaps.blockedPeers)
	conn.configMaps.L.Unlock()
	require.Zero(t, blockedCount)
	conn.SetAllPeersLost()
	require.ElementsMatch(t, []uuid.UUID{owner, member}, conn.configMaps.knownPeerIDs())
}

func TestPeerAllowlistUnlockDoesNotRestoreStalePeers(t *testing.T) {
	t.Parallel()
	for _, loss := range []string{"none", "peer", "coordinator", "disconnected"} {
		t.Run(loss, func(t *testing.T) {
			t.Parallel()
			ctx := testutil.Context(t, testutil.WaitShort)
			conn, engine := newAllowlistTestConn(t)
			stale, detached, fresh := uuid.New(), uuid.New(), uuid.New()
			staleNode, _ := allowlistNode(t, stale, 2)
			detachedNode, _ := allowlistNode(t, detached, 3)
			freshNode, freshKey := allowlistNode(t, fresh, 4)
			require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{staleNode, detachedNode}))
			initial := testutil.TryReceive(ctx, t, engine.calls)
			initial.result <- nil
			require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{{Id: detached[:], Kind: proto.CoordinateResponse_PeerUpdate_LOST}}))
			done := applyAllowlist(ctx, conn, true)
			locked := testutil.TryReceive(ctx, t, engine.calls)
			require.Empty(t, locked.config.Peers)
			locked.result <- nil
			require.NoError(t, testutil.TryReceive(ctx, t, done))

			// The coordinator accepts this new connection after server unlock,
			// before the agent's policy poll has lifted its local restriction.
			require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{freshNode}))
			switch loss {
			case "peer":
				require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{{Id: fresh[:], Kind: proto.CoordinateResponse_PeerUpdate_LOST}}))
			case "coordinator":
				conn.SetAllPeersLost()
			case "disconnected":
				require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{{Id: fresh[:], Kind: proto.CoordinateResponse_PeerUpdate_DISCONNECTED}}))
			}
			done = applyAllowlist(ctx, conn, false)
			unlocked := testutil.TryReceive(ctx, t, engine.calls)
			if loss == "none" {
				require.Equal(t, []key.NodePublic{freshKey}, peerKeys(unlocked.config))
			} else {
				require.Empty(t, unlocked.config.Peers)
			}
			unlocked.result <- nil
			require.NoError(t, testutil.TryReceive(ctx, t, done))
			if loss == "none" {
				// Once unlocked, ordinary coordinator loss retains direct peers.
				conn.SetAllPeersLost()
				require.Equal(t, []uuid.UUID{fresh}, conn.configMaps.knownPeerIDs())
			}
		})
	}
}

func TestPeerAllowlistWaitsForRemovalReconfig(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	conn, engine := newAllowlistTestConn(t)
	member := uuid.New()
	node, _ := allowlistNode(t, member, 2)
	require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{node}))
	stale := testutil.TryReceive(ctx, t, engine.calls)
	require.Len(t, stale.config.Peers, 1)
	done := applyAllowlist(ctx, conn, true)
	requireAllowlistPending(t, done)
	stale.result <- nil
	removed := testutil.TryReceive(ctx, t, engine.calls)
	require.Empty(t, removed.config.Peers)
	requireAllowlistPending(t, done)
	removed.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
}

func TestPeerAllowlistReconfigErrorRequiresEngineRestart(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	conn, engine := newAllowlistTestConn(t)
	conn.configMaps.L.Lock()
	conn.configMaps.logger = slogtest.Make(t, &slogtest.Options{
		IgnoreErrorFn: func(entry slog.SinkEntry) bool {
			return entry.Message == "failed to reconfigure wireguard engine"
		},
	})
	conn.configMaps.L.Unlock()
	member := uuid.New()
	node, memberKey := allowlistNode(t, member, 2)
	require.NoError(t, conn.UpdatePeers([]*proto.CoordinateResponse_PeerUpdate{node}))
	installed := testutil.TryReceive(ctx, t, engine.calls)
	installed.result <- nil
	done := applyAllowlist(ctx, conn, true)
	failed := testutil.TryReceive(ctx, t, engine.calls)
	wantErr := errors.New("wireguard update rejected")
	failed.result <- wantErr
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), wantErr)
	require.Equal(t, []key.NodePublic{memberKey}, engine.installedKeys())
	done = applyAllowlist(ctx, conn, true)
	retry := testutil.TryReceive(ctx, t, engine.calls)
	retry.result <- wgengine.ErrNoChanges
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), wantErr)
	require.Equal(t, []key.NodePublic{memberKey}, engine.installedKeys())
	done = applyAllowlist(ctx, conn, true)
	recovered := testutil.TryReceive(ctx, t, engine.calls)
	recovered.result <- nil
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), wantErr)
	require.Empty(t, engine.installedKeys())
	done = applyAllowlist(ctx, conn, true)
	unchanged := testutil.TryReceive(ctx, t, engine.calls)
	unchanged.result <- wgengine.ErrNoChanges
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), wantErr)
	fresh, freshEngine := newAllowlistTestConn(t)
	done = applyAllowlist(ctx, fresh, true)
	confirmed := testutil.TryReceive(ctx, t, freshEngine.calls)
	confirmed.result <- nil
	require.NoError(t, testutil.TryReceive(ctx, t, done))
	done = applyAllowlist(ctx, fresh, true)
	stillConfirmed := testutil.TryReceive(ctx, t, freshEngine.calls)
	stillConfirmed.result <- wgengine.ErrNoChanges
	require.NoError(t, testutil.TryReceive(ctx, t, done))
}

func TestPeerAllowlistCancellationAndClosed(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitShort)
	conn, engine := newAllowlistTestConn(t)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.ErrorIs(t, conn.SetPeerAllowlist(canceled, true, nil), context.Canceled)
	applying, cancelApplying := context.WithCancel(ctx)
	done := applyAllowlist(applying, conn, true)
	inflight := testutil.TryReceive(ctx, t, engine.calls)
	queued, cancelQueued := context.WithCancel(ctx)
	queuedDone := applyAllowlist(queued, conn, false)
	cancelQueued()
	require.ErrorIs(t, testutil.TryReceive(ctx, t, queuedDone), context.Canceled)
	cancelApplying()
	require.ErrorIs(t, testutil.TryReceive(ctx, t, done), context.Canceled)
	inflight.result <- nil
	conn.configMaps.close()
	require.ErrorIs(t, conn.SetPeerAllowlist(ctx, true, nil), ErrConnClosed)
	close(conn.closed)
	require.ErrorIs(t, conn.SetPeerAllowlist(ctx, false, nil), ErrConnClosed)
}
