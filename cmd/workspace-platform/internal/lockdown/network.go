//go:build linux

// Package workspacelockdown applies workspace network, sudo and process controls in the pod's namespaces.
package workspacelockdown

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"slices"
	"strings"
	"time"

	"golang.org/x/xerrors"
)

type table struct {
	ctx context.Context
	bin string
}

func (t table) run(args ...string) error {
	// #nosec G204 -- the table binary is fixed; all IP and CIDR arguments are parsed above.
	cmd := exec.CommandContext(t.ctx, t.bin, append([]string{"-w", "5"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return xerrors.Errorf("%s %s: %s: %w", t.bin, strings.Join(args, " "), strings.TrimSpace(string(out)), err)
	}
	return nil
}

// iptables returns status one for a missing rule or chain.
func (t table) exists(args ...string) (bool, error) {
	err := t.run(args...)
	if err == nil {
		return true, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return false, nil
	}
	return false, err
}

var chains = []struct{ base, chain string }{{"OUTPUT", "CODER-LOCKDOWN"}, {"INPUT", "CODER-LOCKDOWN-IN"}, {"FORWARD", "CODER-LOCKDOWN-FWD"}}

const hold = "CODER-LOCKDOWN-HOLD"

func (t table) ensureRule(chain string, position string, rule ...string) error {
	ok, err := t.exists(append([]string{"-C", chain}, rule...)...)
	if err != nil || ok {
		return err
	}
	args := []string{"-A", chain}
	if position != "" {
		args = []string{"-I", chain, position}
	}
	return t.run(append(args, rule...)...)
}

func (t table) barrier() error {
	ok, err := t.exists("-S", hold)
	if err != nil {
		return err
	}
	if !ok {
		if err := t.run("-N", hold); err != nil {
			return err
		}
	}
	if err := t.ensureRule(hold, "", "-j", "DROP"); err != nil {
		return err
	}
	for _, c := range chains {
		if err := t.ensureRule(c.base, "1", "-j", hold); err != nil {
			return err
		}
	}
	return nil
}

func (t table) detach(chain, jump string) error {
	for {
		ok, err := t.exists("-C", chain, "-j", jump)
		if err != nil || !ok {
			return err
		}
		if err := t.run("-D", chain, "-j", jump); err != nil {
			return err
		}
	}
}

func (t table) clear() error {
	for _, c := range chains {
		ok, err := t.exists("-S", c.chain)
		if err != nil {
			return err
		}
		if ok {
			if err := t.detach(c.base, c.chain); err != nil {
				return err
			}
			if err = t.run("-F", c.chain); err != nil {
				return err
			}
			if err = t.run("-X", c.chain); err != nil {
				return err
			}
		}
	}
	return nil
}

func (t table) release() error {
	for _, c := range chains {
		if err := t.detach(c.base, hold); err != nil {
			return err
		}
	}
	if err := t.run("-F", hold); err != nil {
		return err
	}
	return t.run("-X", hold)
}

func (t table) install(modes map[string]bool, dns, peers, control []string) error {
	for _, c := range chains {
		if err := t.run("-N", c.chain); err != nil {
			return err
		}
	}
	out, in, fwd := chains[0].chain, chains[1].chain, chains[2].chain
	rules := [][]string{{out, "-o", "lo", "-j", "ACCEPT"}, {in, "-i", "lo", "-j", "ACCEPT"}}
	if t.bin == "iptables" {
		if !modes["sandbox"] {
			for _, ns := range dns {
				for _, proto := range []string{"udp", "tcp"} {
					rules = append(rules, []string{out, "-d", ns, "-p", proto, "--dport", "53", "-j", "ACCEPT"}, []string{in, "-s", ns, "-p", proto, "--sport", "53", "-j", "ACCEPT"})
				}
			}
		}
		for _, p := range peers {
			rules = append(rules, []string{out, "-d", p, "-j", "ACCEPT"}, []string{in, "-s", p, "-j", "ACCEPT"})
			for _, q := range peers {
				rules = append(rules, []string{fwd, "-s", p, "-d", q, "-j", "ACCEPT"})
			}
		}
		for _, ip := range control {
			send, receive := []string{out, "-d", ip, "-p", "tcp"}, []string{in, "-s", ip, "-p", "tcp"}
			if modes["sandbox"] {
				send = append(send, "-m", "multiport", "--dports", "80,443,8080")
				receive = append(receive, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED")
			}
			rules = append(rules, append(send, "-j", "ACCEPT"), append(receive, "-j", "ACCEPT"))
		}
		rules = append(rules, []string{out, "-p", "tcp", "-j", "REJECT", "--reject-with", "tcp-reset"})
	}
	rules = append(rules, []string{out, "-j", "REJECT"}, []string{in, "-j", "DROP"}, []string{fwd, "-j", "DROP"})
	for _, rule := range rules {
		if err := t.run(append([]string{"-A"}, rule...)...); err != nil {
			return err
		}
	}
	for _, c := range chains {
		// Append the jump immediately behind the barrier, before any existing rules.
		if err := t.run("-I", c.base, "2", "-j", c.chain); err != nil {
			return err
		}
	}
	return nil
}

func addresses(input string) ([]string, error) {
	var out []string
	for _, s := range strings.Fields(input) {
		if p, err := netip.ParsePrefix(s); err == nil && p.Addr().Is4() {
			out = append(out, p.Masked().String())
			continue
		}
		ip, err := netip.ParseAddr(s)
		if err != nil || !ip.Is4() {
			return nil, xerrors.Errorf("invalid IPv4 address %q", s)
		}
		out = append(out, ip.String())
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}

func controlIPs(ctx context.Context, host string, control []string) ([]string, error) {
	if host == "" || strings.ContainsAny(host, "\r\n\t #") {
		return nil, xerrors.New("invalid control host")
	}
	for attempt := range 10 {
		found, _ := net.DefaultResolver.LookupNetIP(ctx, "ip4", host)
		for _, addr := range found {
			if ip := addr.Unmap(); ip.Is4() {
				control = append(control, ip.String())
			}
		}
		if len(control) > 0 || attempt == 9 {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	slices.Sort(control)
	return slices.Compact(control), nil
}

func pinControlHost(root *os.Root, host string, ips []string) error {
	if root == nil {
		r, err := os.OpenRoot("/")
		if err != nil {
			return err
		}
		defer r.Close()
		root = r
	}
	hosts, err := root.ReadFile("etc/hosts")
	if err != nil {
		return err
	}
	marker := "# coder-sandbox-control:" + host
	if strings.Contains(string(hosts), marker) {
		return nil
	}
	f, err := root.OpenFile("etc/hosts", os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, ip := range ips {
		if strings.Contains(ip, "/") {
			continue
		}
		if _, err := fmt.Fprintf(f, "%s %s %s\n", ip, host, marker); err != nil {
			return err
		}
	}
	return nil
}

func nameservers() ([]string, error) {
	b, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil, err
	}
	var dns []string
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || f[0] != "nameserver" {
			continue
		}
		if ip, err := netip.ParseAddr(f[1]); err == nil && ip.Is4() {
			dns = append(dns, ip.String())
		}
	}
	return dns, nil
}

func applyNetwork(ctx context.Context, modes map[string]bool, host, explicit, peers string, root *os.Root) error {
	control, err := addresses(explicit)
	if err != nil {
		return err
	}
	allowedPeers, err := addresses(peers)
	if err != nil {
		return err
	}
	locked := modes["network"] || modes["sandbox"]
	var dns []string
	if locked {
		control, err = controlIPs(ctx, host, control)
		if err != nil {
			return err
		}
		if modes["sandbox"] && len(control) > 0 {
			err = pinControlHost(root, host, control)
		} else if !modes["sandbox"] {
			dns, err = nameservers()
		}
		if err != nil {
			return err
		}
	}
	tables := []table{{ctx, "iptables"}, {ctx, "ip6tables"}}
	for _, t := range tables {
		if err := t.barrier(); err != nil {
			return err
		}
	}
	for _, t := range tables {
		if err := t.clear(); err != nil {
			return err
		}
		if locked {
			if err := t.install(modes, dns, allowedPeers, control); err != nil {
				return err
			}
		}
	}
	for _, t := range tables {
		if err := t.release(); err != nil {
			return err
		}
	}
	return nil
}
