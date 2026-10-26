//go:build linux

package workspaceoverlay_test

import (
	"github.com/coder/coder/v2/workspaceoverlay"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestPolicyRejectsUnsupportedOrInvalidPortRules(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		version int
		ports   []workspaceoverlay.PortRule
	}{
		{"old protocol", 0, []workspaceoverlay.PortRule{{Protocol: "tcp", Port: 80}}},
		{"zero port", 1, []workspaceoverlay.PortRule{{Protocol: "tcp", Port: 0}}},
		{"unknown transport", 1, []workspaceoverlay.PortRule{{Protocol: "sctp", Port: 80}}},
		{"duplicates", 1, []workspaceoverlay.PortRule{{Protocol: "tcp", Port: 80}, {Protocol: "tcp", Port: 80}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			p := policy(t)
			p.PortPolicyVersion = test.version
			p.Peers[0].Ports = test.ports
			require.Error(t, p.Validate())
		})
	}
	p := policy(t)
	p.PortPolicyVersion = 1
	p.Peers[0].Ports = []workspaceoverlay.PortRule{{Protocol: "tcp", Port: 27182}, {Protocol: "udp", Port: 5353}}
	require.NoError(t, p.Validate())
}
