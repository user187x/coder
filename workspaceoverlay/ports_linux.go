//go:build linux

package workspaceoverlay

import (
	"fmt"
	"strconv"
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
				return fmt.Errorf("inspect tunnel port chain: %w", err)
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
				port := strconv.Itoa(int(rule.Port))
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
