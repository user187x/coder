//go:build linux

package workspaceoverlay

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestForwardingGuards(t *testing.T) {
	t.Parallel()
	for _, chain := range []string{"", "CODER_VM_TUNNEL"} {
		t.Run(chain, func(t *testing.T) {
			t.Parallel()
			var rules []string
			run := func(args ...string) error {
				command := strings.Join(args, " ")
				if args[2] == "-C" {
					return errors.New("absent")
				}
				if args[2] == "-I" {
					rules = append([]string{command}, rules...)
				}
				return nil
			}
			device := KernelDevice{Name: "coderwg", ForwardChain: chain}
			require.NoError(t, device.forwardingGuards(run))
			require.Contains(t, strings.Join(rules, "\n"), "-i coderwg -j DROP")
			require.Contains(t, strings.Join(rules, "\n"), "-o coderwg -j DROP")
			if chain != "" {
				require.Equal(t, "-w 5 -I FORWARD -j CODER_VM_TUNNEL", rules[0])
			} else {
				require.Len(t, rules, 2)
			}
		})
	}
}

func TestForwardingAdapterFailure(t *testing.T) {
	t.Parallel()
	for _, chain := range []string{"invalid-chain!", "ACCEPT", "DROP", "CODER_VM_TUNNEL"} {
		t.Run(chain, func(t *testing.T) {
			t.Parallel()
			device := KernelDevice{Name: "coderwg", ForwardChain: chain}
			require.Error(t, device.forwardingGuards(func(...string) error { return errors.New("unavailable") }))
		})
	}
}

func TestForwardingAdapterReorderedAfterPolicyChange(t *testing.T) {
	t.Parallel()
	var commands []string
	device := KernelDevice{Name: "coderwg", ForwardChain: "CODER_VM_TUNNEL"}
	require.NoError(t, device.forwardingGuards(func(args ...string) error { commands = append(commands, strings.Join(args, " ")); return nil }))
	require.Equal(t, "-w 5 -S CODER_VM_TUNNEL", commands[0])
	require.Equal(t, []string{"-w 5 -D FORWARD -j CODER_VM_TUNNEL", "-w 5 -I FORWARD -j CODER_VM_TUNNEL"}, commands[len(commands)-2:])
	for _, command := range commands {
		require.NotContains(t, command, "-D FORWARD -i")
		require.NotContains(t, command, "-D FORWARD -o")
	}
}
