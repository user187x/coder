//go:build linux

package workspaceoverlay

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os/exec"
	"time"

	"github.com/vishvananda/netlink"
	"golang.zx2c4.com/wireguard/wgctrl"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

// KernelDevice owns one WireGuard interface inside the workspace pod namespace.
type KernelDevice struct {
	Name       string
	PrivateKey wgtypes.Key
	Port       int
	// ForwardChain is a root-owned adapter chain evaluated before transit guards.
	// An empty value permits only traffic terminating in this network namespace.
	ForwardChain string
	// SocketScope selects the supervisor-verified application network namespace.
	// Nil uses this process's namespace for ordinary workspace sidecars.
	SocketScope   *SocketScope
	peers         map[wgtypes.Key]string
	address       netip.Addr
	peerAddresses map[netip.Addr]string
}

// Clear deletes the interface, its keys, peers and routes. Forwarding guards stay
// installed until pod destruction so crashes cannot leave a transit path.
func (d *KernelDevice) Clear() error {
	d.peers = nil
	d.peerAddresses = nil
	d.address = netip.Addr{}
	link, err := netlink.LinkByName(d.Name)
	if _, missing := err.(netlink.LinkNotFoundError); missing {
		return nil
	}
	if err != nil {
		return err
	}
	return netlink.LinkDel(link)
}

// Apply replaces the complete interface, preventing stale peers or flows from
// surviving a grant revision. Only explicitly authorized /32 routes are added.
func (d *KernelDevice) Apply(ctx context.Context, p Policy) (err error) {
	if err = p.Validate(); err != nil {
		return err
	}
	if err = d.Clear(); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = d.Clear()
		}
	}()
	addresses := []string{p.Address}
	for _, peer := range p.Peers {
		addresses = append(addresses, peer.AllowedIP)
	}
	routes, e := netlink.RouteList(nil, netlink.FAMILY_V4)
	if e != nil {
		return fmt.Errorf("inspect existing routes: %w", e)
	}
	for _, route := range routes {
		if route.Dst == nil {
			continue
		}
		bits, _ := route.Dst.Mask.Size()
		if bits == 0 {
			continue
		}
		for _, address := range addresses {
			prefix, _ := hostPrefix(address)
			if route.Dst.Contains(net.IP(prefix.Addr().AsSlice())) {
				return fmt.Errorf("overlay address overlaps existing route %s", route.Dst)
			}
		}
	}
	if err = d.forwardingGuards(func(args ...string) error {
		output, runErr := exec.CommandContext(ctx, "iptables", args...).CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("%w: %s", runErr, output)
		}
		return nil
	}); err != nil {
		return err
	}
	if err = d.portPolicy(p, func(args ...string) error {
		output, runErr := exec.CommandContext(ctx, "iptables", args...).CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("%w: %s", runErr, output)
		}
		return nil
	}); err != nil {
		return err
	}
	// Installing a conntrack match activates UDP flow observation, including
	// sendto sockets. Returning from a dedicated chain preserves later rules.
	// Observation is optional; lack of conntrack must not break transport.
	_ = d.observeUDP(ctx)
	link := &netlink.GenericLink{LinkAttrs: netlink.LinkAttrs{Name: d.Name, MTU: 1380}, LinkType: "wireguard"}
	if err = netlink.LinkAdd(link); err != nil {
		return fmt.Errorf("create WireGuard interface: %w", err)
	}
	own, _ := hostPrefix(p.Address)
	address := ipNet(own)
	if err = netlink.AddrAdd(link, &netlink.Addr{IPNet: &address}); err != nil {
		return fmt.Errorf("assign overlay address: %w", err)
	}
	peers := make([]wgtypes.PeerConfig, 0, len(p.Peers))
	keepalive := 5 * time.Second
	for _, peer := range p.Peers {
		key, _ := wgtypes.ParseKey(peer.PublicKey)
		endpoint, e := net.ResolveUDPAddr("udp4", peer.Endpoint)
		if e != nil {
			return e
		}
		prefix, _ := hostPrefix(peer.AllowedIP)
		peers = append(peers, wgtypes.PeerConfig{PublicKey: key, Endpoint: endpoint, ReplaceAllowedIPs: true, AllowedIPs: []net.IPNet{ipNet(prefix)}, PersistentKeepaliveInterval: &keepalive})
	}
	client, e := wgctrl.New()
	if e != nil {
		return e
	}
	defer client.Close()
	if err = client.ConfigureDevice(d.Name, wgtypes.Config{PrivateKey: &d.PrivateKey, ListenPort: &d.Port, ReplacePeers: true, Peers: peers}); err != nil {
		return fmt.Errorf("configure WireGuard: %w", err)
	}
	if err = netlink.LinkSetUp(link); err != nil {
		return err
	}
	for _, peer := range p.Peers {
		prefix, _ := hostPrefix(peer.AllowedIP)
		destination := ipNet(prefix)
		if err = netlink.RouteAdd(&netlink.Route{LinkIndex: link.Attrs().Index, Dst: &destination, Src: address.IP, Scope: netlink.SCOPE_LINK}); err != nil {
			return fmt.Errorf("route workspace peer: %w", err)
		}
	}
	d.peers = make(map[wgtypes.Key]string, len(p.Peers))
	d.address = own.Addr()
	d.peerAddresses = make(map[netip.Addr]string, len(p.Peers))
	for _, peer := range p.Peers {
		key, _ := wgtypes.ParseKey(peer.PublicKey)
		d.peers[key] = peer.WorkspaceID
		prefix, _ := hostPrefix(peer.AllowedIP)
		d.peerAddresses[prefix.Addr()] = peer.WorkspaceID
	}
	return nil
}

// EstablishedPeers reports recent authenticated handshakes for installed peers.
func (d *KernelDevice) EstablishedPeers() []string {
	result := []string{}
	if len(d.peers) == 0 {
		return result
	}
	client, err := wgctrl.New()
	if err != nil {
		return result
	}
	defer client.Close()
	device, err := client.Device(d.Name)
	if err != nil {
		return result
	}
	for _, peer := range device.Peers {
		id, ok := d.peers[peer.PublicKey]
		age := time.Since(peer.LastHandshakeTime)
		if ok && !peer.LastHandshakeTime.IsZero() && age >= 0 && age <= 180*time.Second {
			result = append(result, id)
		}
	}
	return result
}

func (d *KernelDevice) observeUDP(ctx context.Context) error {
	const chain = "CODERWG_OBSERVE"
	if exec.CommandContext(ctx, "iptables", "-w", "5", "-L", chain).Run() != nil {
		if err := exec.CommandContext(ctx, "iptables", "-w", "5", "-N", chain).Run(); err != nil {
			return err
		}
	}
	for _, rule := range []struct{ chain, direction string }{{"INPUT", "-i"}, {"OUTPUT", "-o"}} {
		args := []string{"-w", "5", "-C", rule.chain, rule.direction, d.Name, "-p", "udp", "-m", "conntrack", "--ctstate", "NEW,ESTABLISHED", "-j", chain}
		if exec.CommandContext(ctx, "iptables", args...).Run() != nil {
			args[2] = "-I"
			if err := exec.CommandContext(ctx, "iptables", args...).Run(); err != nil {
				return err
			}
		}
	}
	return nil
}

// forwardingGuards keeps unmatched traffic behind unconditional transit guards.
// The optional root-owned adapter is installed first and must already exist.
func (d *KernelDevice) forwardingGuards(run func(...string) error) error {
	if d.ForwardChain != "" && (d.ForwardChain != "CODER_VM_TUNNEL") {
		return fmt.Errorf("invalid overlay adapter chain")
	}
	if d.ForwardChain != "" {
		if err := run("-w", "5", "-S", d.ForwardChain); err != nil {
			return fmt.Errorf("inspect overlay adapter chain: %w", err)
		}
	}
	for _, direction := range []string{"-i", "-o"} {
		args := []string{"-w", "5", "-C", "FORWARD", direction, d.Name, "-j", "DROP"}
		if run(args...) != nil {
			args[2] = "-I"
			if err := run(args...); err != nil {
				return fmt.Errorf("install overlay forwarding guard: %w", err)
			}
		}
	}
	if d.ForwardChain == "" {
		return nil
	}
	args := []string{"-w", "5", "-C", "FORWARD", "-j", d.ForwardChain}
	if run(args...) == nil {
		args[2] = "-D"
		if err := run(args...); err != nil {
			return fmt.Errorf("reorder overlay adapter: %w", err)
		}
	}
	args[2] = "-I"
	if err := run(args...); err != nil {
		return fmt.Errorf("install overlay adapter: %w", err)
	}
	return nil
}
