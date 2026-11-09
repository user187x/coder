//go:build linux

package workspaceoverlay

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/xerrors"
)

func TestPortPolicyLimitsBothDirectionsWithoutBypassingFirewall(t *testing.T) {
	t.Parallel()
	var rules []string
	run := func(args ...string) error {
		if args[2] == "-C" {
			return xerrors.New("not installed")
		}
		rules = append(rules, strings.Join(args, " "))
		return nil
	}
	d := &KernelDevice{Name: "coderwg"}
	err := d.portPolicy(Policy{Peers: []Peer{{AllowedIP: "10.253.0.2/32", Ports: []PortRule{{Protocol: "tcp", Port: 27182}}}}}, run)
	require.NoError(t, err)
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_IN -s 10.253.0.2/32 -p tcp --dport 27182 -j RETURN")
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_OUT -d 10.253.0.2/32 -p tcp --dport 27182 -j RETURN")
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_IN -s 10.253.0.2/32 -p tcp --sport 27182 -m conntrack --ctstate ESTABLISHED -j RETURN")
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_IN -j DROP")
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_OUT -j DROP")
	require.NotContains(t, strings.Join(rules, "\n"), "ACCEPT")
	require.NotContains(t, strings.Join(rules, "\n"), "FORWARD")
}

func TestPortPolicyKeepsLegacyPeersAndFailsOnRuleErrors(t *testing.T) {
	t.Parallel()
	var rules []string
	d := &KernelDevice{Name: "coderwg"}
	require.NoError(t, d.portPolicy(Policy{Peers: []Peer{{AllowedIP: "10.253.0.2/32"}}}, func(args ...string) error { rules = append(rules, strings.Join(args, " ")); return nil }))
	require.Contains(t, rules, "-w 5 -A CODER_WS_PORT_IN -s 10.253.0.2/32 -j RETURN")
	require.Error(t, d.portPolicy(Policy{}, func(...string) error { return xerrors.New("denied") }))
}

func TestNATPolicyRedirectsMappedPortsFromTheirPeerOnly(t *testing.T) {
	t.Parallel()
	var rules []string
	run := func(args ...string) error {
		if args[4] == "-C" {
			return xerrors.New("not installed")
		}
		rules = append(rules, strings.Join(args, " "))
		return nil
	}
	d := &KernelDevice{Name: "coderwg"}
	p := Policy{PortPolicyVersion: 2, Peers: []Peer{{AllowedIP: "10.253.0.2/32", Ports: []PortRule{
		{Protocol: "tcp", Port: 8080, TargetPort: 8000},
		{Protocol: "tcp", Port: 7777},
	}}}}
	require.NoError(t, d.natPolicy(p, run))
	require.Contains(t, rules, "-w 5 -t nat -I PREROUTING 1 -i coderwg -j CODER_WS_PORT_NAT")
	require.Contains(t, rules, "-w 5 -t nat -A CODER_WS_PORT_NAT -s 10.253.0.2/32 -p tcp --dport 8080 -j REDIRECT --to-ports 8000")
	require.NotContains(t, strings.Join(rules, "\n"), "--dport 7777")

	var filter []string
	require.NoError(t, d.portPolicy(p, func(args ...string) error {
		if args[2] == "-C" {
			return xerrors.New("not installed")
		}
		filter = append(filter, strings.Join(args, " "))
		return nil
	}))
	// The mapped connection is filtered as the service sees it, after the redirect.
	require.Contains(t, filter, "-w 5 -A CODER_WS_PORT_IN -s 10.253.0.2/32 -p tcp --dport 8000 -j RETURN")
	require.Contains(t, filter, "-w 5 -A CODER_WS_PORT_IN -s 10.253.0.2/32 -p tcp --dport 7777 -j RETURN")
}
