//go:build linux

package workspaceoverlay

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPortPolicyLimitsBothDirectionsWithoutBypassingFirewall(t *testing.T) {
	t.Parallel()
	var rules []string
	run := func(args ...string) error {
		if args[2] == "-C" {
			return errors.New("not installed")
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
	require.Error(t, d.portPolicy(Policy{}, func(...string) error { return errors.New("denied") }))
}
