//go:build linux

package workspaceoverlay

import (
	"strconv"

	"golang.org/x/xerrors"
)

// portPolicy returns permitted flows to the pod's existing firewall. It never
// accepts traffic ahead of lockdown rules, and never grants transit forwarding.
func (d *KernelDevice) portPolicy(p Policy, run func(...string) error) error {
	for _, direction := range []struct{ chain, hook, iface, address string }{
		{"CODER_WS_PORT_IN", "INPUT", "-i", "-s"},
		{"CODER_WS_PORT_OUT", "OUTPUT", "-o", "-d"},
	} {
		chain := direction.chain
		if err := run("-w", "5", "-N", chain); err != nil {
			if err := run("-w", "5", "-S", chain); err != nil {
				return xerrors.Errorf("inspect tunnel port chain: %w", err)
			}
		}
		if err := run("-w", "5", "-F", chain); err != nil {
			return err
		}
		if err := run("-w", "5", "-C", direction.hook, direction.iface, d.Name, "-j", chain); err != nil {
			if err := run("-w", "5", "-I", direction.hook, "1", direction.iface, d.Name, "-j", chain); err != nil {
				return err
			}
		}
		for _, peer := range p.Peers {
			base := []string{"-w", "5", "-A", chain, direction.address, peer.AllowedIP}
			if peer.Ports == nil {
				if err := run(append(base, "-j", "RETURN")...); err != nil {
					return err
				}
				continue
			}
			for _, rule := range peer.Ports {
				// A mapped port is filtered as the service sees it, after natPolicy redirected it.
				port := strconv.Itoa(int(rule.Port))
				if rule.TargetPort != 0 {
					port = strconv.Itoa(int(rule.TargetPort))
				}
				request := append(append([]string{}, base...), "-p", rule.Protocol, "--dport", port, "-j", "RETURN")
				if err := run(request...); err != nil {
					return err
				}
				reply := append(append([]string{}, base...), "-p", rule.Protocol, "--sport", port, "-m", "conntrack", "--ctstate", "ESTABLISHED", "-j", "RETURN")
				if err := run(reply...); err != nil {
					return err
				}
			}
		}
		if err := run("-w", "5", "-A", chain, "-j", "DROP"); err != nil {
			return err
		}
	}
	return nil
}

// natPolicy redirects a mapped port (PortRule.TargetPort) on the tunnel's
// target: a peer connecting to Port reaches the local service on TargetPort.
// Only connections arriving on the overlay from that peer are redirected.
func (d *KernelDevice) natPolicy(p Policy, run func(...string) error) error {
	const chain = "CODER_WS_PORT_NAT"
	if err := run("-w", "5", "-t", "nat", "-N", chain); err != nil {
		if err := run("-w", "5", "-t", "nat", "-S", chain); err != nil {
			return xerrors.Errorf("inspect tunnel port mapping chain: %w", err)
		}
	}
	if err := run("-w", "5", "-t", "nat", "-F", chain); err != nil {
		return err
	}
	if err := run("-w", "5", "-t", "nat", "-C", "PREROUTING", "-i", d.Name, "-j", chain); err != nil {
		if err := run("-w", "5", "-t", "nat", "-I", "PREROUTING", "1", "-i", d.Name, "-j", chain); err != nil {
			return err
		}
	}
	for _, peer := range p.Peers {
		for _, rule := range peer.Ports {
			if rule.TargetPort == 0 || rule.TargetPort == rule.Port {
				continue
			}
			if err := run("-w", "5", "-t", "nat", "-A", chain, "-s", peer.AllowedIP, "-p", rule.Protocol,
				"--dport", strconv.Itoa(int(rule.Port)), "-j", "REDIRECT", "--to-ports", strconv.Itoa(int(rule.TargetPort))); err != nil {
				return err
			}
		}
	}
	return nil
}
