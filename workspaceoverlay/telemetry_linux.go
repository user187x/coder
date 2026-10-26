//go:build linux

package workspaceoverlay

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
	"golang.zx2c4.com/wireguard/wgctrl"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

// SocketScope identifies a guest supervisor's verified application process.
type SocketScope struct {
	PID       int
	Namespace string
	Address   netip.Addr
}

// ParseSocketScope validates an optional root-provided application socket scope.
func ParseSocketScope(pid, namespace, address string) (*SocketScope, error) {
	if pid == "" && namespace == "" && address == "" {
		return nil, nil
	}
	process, err := strconv.ParseInt(pid, 10, 32)
	if err != nil || process <= 1 || strconv.FormatInt(process, 10) != pid {
		return nil, fmt.Errorf("invalid application socket process")
	}
	inode := strings.TrimSuffix(strings.TrimPrefix(namespace, "net:["), "]")
	number, err := strconv.ParseUint(inode, 10, 64)
	if err != nil || number == 0 || namespace != "net:["+strconv.FormatUint(number, 10)+"]" {
		return nil, fmt.Errorf("invalid application network namespace")
	}
	ip, err := netip.ParseAddr(address)
	if err != nil || !ip.Is4() || !ip.IsPrivate() || ip.IsLoopback() || ip.String() != address {
		return nil, fmt.Errorf("invalid application socket address")
	}
	return &SocketScope{PID: int(process), Namespace: namespace, Address: ip}, nil
}

func (s *SocketScope) current() bool {
	actual, err := os.Readlink(fmt.Sprintf("/proc/%d/ns/net", s.PID))
	return err == nil && actual == s.Namespace
}

// ObservedPort describes an established TCP socket or recently observed UDP flow.
type ObservedPort struct {
	Protocol   string `json:"protocol"`
	LocalPort  uint16 `json:"local_port"`
	RemotePort uint16 `json:"remote_port"`
}

// PeerStats contains cumulative encrypted transport counters and observed ports.
// Counters restart at zero whenever the interface or peer key is replaced.
type PeerStats struct {
	WorkspaceID    string         `json:"workspace_id"`
	RXBytes        int64          `json:"rx_bytes"`
	TXBytes        int64          `json:"tx_bytes"`
	Ports          []ObservedPort `json:"ports"`
	PortsAvailable bool           `json:"ports_available"`
}

// PeerStats reads only installed authorized peers. Nil means statistics are not
// available; an empty slice means the device currently has no configured peers.
func (d *KernelDevice) PeerStats() []PeerStats {
	if len(d.peers) == 0 {
		return []PeerStats{}
	}
	client, err := wgctrl.New()
	if err != nil {
		return nil
	}
	defer client.Close()
	device, err := client.Device(d.Name)
	if err != nil {
		return nil
	}
	ports := map[string]map[ObservedPort]bool{}
	portsAvailable := true
	base, own := "/proc/net", d.address
	if d.SocketScope != nil {
		if !d.SocketScope.current() {
			return peerSnapshots(device.Peers, d.peers, nil, false)
		}
		base, own = fmt.Sprintf("/proc/%d/net", d.SocketScope.PID), d.SocketScope.Address
	}
	for _, table := range []struct{ path, protocol string }{{base + "/tcp", "tcp"}, {base + "/udp", "udp"}} {
		file, err := os.Open(table.path)
		if err != nil {
			portsAvailable = false
			continue
		}
		mergePorts(ports, socketPorts(file, table.protocol, own, d.peerAddresses))
		_ = file.Close()
	}
	if d.SocketScope != nil && !d.SocketScope.current() {
		return peerSnapshots(device.Peers, d.peers, nil, false)
	}
	// Conntrack observes UDP sendto/recvfrom, which have no remote socket address
	// in /proc/net/udp. Entries remain visible until the kernel flow timeout.
	if flows, err := conntrackFlows(); err == nil {
		for _, flow := range flows {
			addUDPConntrackFlow(ports, flow, d.address, d.peerAddresses)
		}
	} else {
		portsAvailable = false
	}
	return peerSnapshots(device.Peers, d.peers, ports, portsAvailable)
}

func addUDPConntrackFlow(ports map[string]map[ObservedPort]bool, flow *netlink.ConntrackFlow, own netip.Addr, peers map[netip.Addr]string) {
	if flow == nil || flow.Forward.Protocol != 17 || flow.TimeOut == 0 {
		return
	}
	// A VM's outbound flow has the application address before source NAT;
	// the reverse tuple contains its overlay address and authorized peer.
	for _, reverse := range []bool{false, true} {
		tuple := flow.Forward
		if reverse {
			tuple = flow.Reverse
		}
		src, srcOK := netip.AddrFromSlice(tuple.SrcIP)
		dst, dstOK := netip.AddrFromSlice(tuple.DstIP)
		if srcOK && dstOK {
			addFlow(ports, "udp", src.Unmap(), dst.Unmap(), tuple.SrcPort, tuple.DstPort, own, peers)
		}
	}
}

func peerSnapshots(peers []wgtypes.Peer, authorized map[wgtypes.Key]string, ports map[string]map[ObservedPort]bool, portsAvailable bool) []PeerStats {
	result := make([]PeerStats, 0, min(len(peers), 64))
	for _, peer := range peers {
		id, ok := authorized[peer.PublicKey]
		if !ok {
			continue
		}
		if peer.ReceiveBytes < 0 || peer.TransmitBytes < 0 {
			continue
		}
		result = append(result, PeerStats{WorkspaceID: id, RXBytes: peer.ReceiveBytes, TXBytes: peer.TransmitBytes, Ports: sortedPorts(ports[id]), PortsAvailable: portsAvailable})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].WorkspaceID < result[j].WorkspaceID })
	if len(result) > 64 {
		result = result[:64]
	}
	return result
}

func socketPorts(r io.Reader, protocol string, own netip.Addr, peers map[netip.Addr]string) map[string]map[ObservedPort]bool {
	result := map[string]map[ObservedPort]bool{}
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 4 || (protocol == "tcp" && fields[3] != "01") {
			continue
		}
		local, localPort, ok := socketEndpoint(fields[1])
		if !ok {
			continue
		}
		remote, remotePort, ok := socketEndpoint(fields[2])
		if !ok {
			continue
		}
		addFlow(result, protocol, local, remote, localPort, remotePort, own, peers)
	}
	return result
}

func socketEndpoint(value string) (netip.Addr, uint16, bool) {
	host, port, ok := strings.Cut(value, ":")
	if !ok || len(host) != 8 {
		return netip.Addr{}, 0, false
	}
	ip, e := strconv.ParseUint(host, 16, 32)
	if e != nil {
		return netip.Addr{}, 0, false
	}
	p, e := strconv.ParseUint(port, 16, 16)
	if e != nil || p == 0 {
		return netip.Addr{}, 0, false
	}
	// Linux prints IPv4 socket addresses as a native-endian 32-bit integer.
	var b [4]byte
	if binary.NativeEndian.Uint16([]byte{1, 0}) == 1 {
		b = [4]byte{byte(ip), byte(ip >> 8), byte(ip >> 16), byte(ip >> 24)}
	} else {
		b = [4]byte{byte(ip >> 24), byte(ip >> 16), byte(ip >> 8), byte(ip)}
	}
	return netip.AddrFrom4(b), uint16(p), true
}

func addFlow(result map[string]map[ObservedPort]bool, protocol string, src, dst netip.Addr, srcPort, dstPort uint16, own netip.Addr, peers map[netip.Addr]string) {
	if srcPort == 0 || dstPort == 0 {
		return
	}
	id, localPort, remotePort := "", srcPort, dstPort
	if src == own {
		id = peers[dst]
	} else if dst == own {
		id = peers[src]
		localPort, remotePort = dstPort, srcPort
	}
	if id == "" {
		return
	}
	if result[id] == nil {
		result[id] = map[ObservedPort]bool{}
	}
	// Bound collection as well as the serialized response.
	if len(result[id]) < 64 {
		result[id][ObservedPort{Protocol: protocol, LocalPort: localPort, RemotePort: remotePort}] = true
	}
}

func mergePorts(dst, src map[string]map[ObservedPort]bool) {
	for id, ports := range src {
		if dst[id] == nil {
			dst[id] = map[ObservedPort]bool{}
		}
		for port := range ports {
			if len(dst[id]) < 64 {
				dst[id][port] = true
			}
		}
	}
}

func sortedPorts(ports map[ObservedPort]bool) []ObservedPort {
	result := make([]ObservedPort, 0, len(ports))
	for port := range ports {
		result = append(result, port)
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if a.Protocol != b.Protocol {
			return a.Protocol < b.Protocol
		}
		if a.LocalPort != b.LocalPort {
			return a.LocalPort < b.LocalPort
		}
		return a.RemotePort < b.RemotePort
	})
	return result
}

func conntrackFlows() ([]*netlink.ConntrackFlow, error) {
	handle, err := netlink.NewHandle(unix.NETLINK_NETFILTER)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	if err = handle.SetSocketTimeout(time.Second); err != nil {
		return nil, err
	}
	return handle.ConntrackTableList(netlink.ConntrackTable, netlink.FAMILY_V4)
}
