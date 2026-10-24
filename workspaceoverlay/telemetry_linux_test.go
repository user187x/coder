//go:build linux

package workspaceoverlay

import (
	"net/netip"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func TestSocketPortsExcludeListenersClosedAndOtherNetworks(t *testing.T) {
	t.Parallel()
	own := netip.MustParseAddr("10.253.0.1")
	peers := map[netip.Addr]string{netip.MustParseAddr("10.253.0.2"): "peer"}
	// Addresses are /proc's native little-endian IPv4 values on this fixture.
	if addr, _, _ := socketEndpoint("0100FD0A:2710"); addr != own {
		t.Skip("little-endian proc fixture")
	}
	table := `sl local_address rem_address st
0: 0100FD0A:2710 0200FD0A:4E20 01
1: 0100FD0A:2710 0200FD0A:4E20 01
2: 00000000:0035 00000000:0000 0A
3: 0100FD0A:2711 0200FD0A:4E21 06
4: 0100FD0A:2712 01010101:4E22 01
5: not-an-endpoint malformed 01
`
	result := socketPorts(strings.NewReader(table), "tcp", own, peers)
	require.Equal(t, []ObservedPort{{Protocol: "tcp", LocalPort: 10000, RemotePort: 20000}}, sortedPorts(result["peer"]))
	require.Len(t, result, 1)
}

func TestObservedUDPFlowDirectionAndBounds(t *testing.T) {
	t.Parallel()
	own := netip.MustParseAddr("10.253.0.1")
	peer := netip.MustParseAddr("10.253.0.2")
	peers := map[netip.Addr]string{peer: "peer"}
	result := map[string]map[ObservedPort]bool{}
	addFlow(result, "udp", peer, own, 53, 20000, own, peers)
	require.True(t, result["peer"][ObservedPort{Protocol: "udp", LocalPort: 20000, RemotePort: 53}])
	addFlow(result, "udp", own, netip.MustParseAddr("10.253.0.3"), 10000, 53, own, peers)
	addFlow(result, "udp", own, peer, 0, 53, own, peers)
	require.Len(t, result["peer"], 1)
	for port := uint16(1); port < 1000; port++ {
		addFlow(result, "udp", own, peer, port, 53, own, peers)
	}
	require.Len(t, result["peer"], 64)
}

func TestSocketEndpointRejectsMalformedAndWildcardRemotes(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"garbage", "0100FD0A:0000", "GGGGGGGG:0035", "0100FD0A:10000", "00000000000000000000000000000000:0035"} {
		_, _, ok := socketEndpoint(input)
		require.False(t, ok, input)
	}
}

func TestPeerCountersFollowInstalledIdentityAndReset(t *testing.T) {
	t.Parallel()
	current, err := wgtypes.GeneratePrivateKey()
	require.NoError(t, err)
	removed, err := wgtypes.GeneratePrivateKey()
	require.NoError(t, err)
	authorized := map[wgtypes.Key]string{current.PublicKey(): "current"}
	peers := []wgtypes.Peer{{PublicKey: current.PublicKey(), ReceiveBytes: 1234, TransmitBytes: 5678}, {PublicKey: removed.PublicKey(), ReceiveBytes: 99999, TransmitBytes: 99999}}
	stats := peerSnapshots(peers, authorized, nil, false)
	require.Equal(t, []PeerStats{{WorkspaceID: "current", RXBytes: 1234, TXBytes: 5678, Ports: []ObservedPort{}, PortsAvailable: false}}, stats)
	peers[0].ReceiveBytes = 0
	peers[0].TransmitBytes = 0
	stats = peerSnapshots(peers, authorized, nil, true)
	require.Zero(t, stats[0].RXBytes)
	require.Zero(t, stats[0].TXBytes)
	require.True(t, stats[0].PortsAvailable)
	require.Empty(t, peerSnapshots(peers, nil, nil, true))
}
