package terraform

import (
	"testing"

	tfjson "github.com/hashicorp/terraform-json"
	"github.com/stretchr/testify/require"
)

func TestSelectAgentResourceVirtualMachine(t *testing.T) {
	t.Parallel()
	const agent = "b87b6e97-7791-46d1-bac7-a135c46e1018"
	for _, tc := range []struct{ name, body, id, want string }{
		{"explicit YAML", "apiVersion: kubevirt.io/v1\nkind: VirtualMachine\nmetadata:\n  annotations:\n    com.coder.agent.id: " + agent, agent, "kubectl_manifest.vm"},
		{"explicit JSON", `{"apiVersion":"kubevirt.io/v1","kind":"VirtualMachine","metadata":{"annotations":{"com.coder.agent.id":"` + agent + `"}}}`, agent, "kubectl_manifest.vm"},
		{"different agent", "apiVersion: kubevirt.io/v1\nkind: VirtualMachine\nmetadata:\n  annotations:\n    com.coder.agent.id: someone-else", agent, "kubernetes_secret_v1.boot"},
		{"preview unknown ID", "apiVersion: kubevirt.io/v1\nkind: VirtualMachine", "", "kubernetes_secret_v1.boot"},
		{"different kind", "apiVersion: kubevirt.io/v1\nkind: VirtualMachineInstance\nmetadata:\n  annotations:\n    com.coder.agent.id: " + agent, agent, "kubernetes_secret_v1.boot"},
		{"invalid manifest", "[broken", agent, "kubernetes_secret_v1.boot"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			candidates := []*graphResource{{Label: "kubectl_manifest.vm", Depth: 1}, {Label: "kubernetes_secret_v1.boot", Depth: 0}}
			resources := map[string]map[string]*tfjson.StateResource{"kubectl_manifest.vm": {"vm": {Type: "kubectl_manifest", AttributeValues: map[string]any{"yaml_body": tc.body}}}}
			selected := selectAgentResource(candidates, resources, tc.id)
			require.Equal(t, tc.want, selected.Label)
		})
	}
}

func TestSelectAgentResourceKeepsNearestInference(t *testing.T) {
	t.Parallel()
	candidates := []*graphResource{{Label: "z", Depth: 0}, {Label: "a", Depth: 0}, {Label: "far", Depth: 1}}
	require.Equal(t, "a", selectAgentResource(candidates, nil, "").Label)
	require.Nil(t, selectAgentResource(nil, nil, ""))
	// Counted instances share one inference label. An explicit annotation on
	// one instance must not move its agent onto every VM in that group.
	resources := map[string]map[string]*tfjson.StateResource{
		"far": {
			"far[0]": {Type: "kubectl_manifest", AttributeValues: map[string]any{"yaml_body": `{"apiVersion":"kubevirt.io/v1","kind":"VirtualMachine","metadata":{"annotations":{"com.coder.agent.id":"agent"}}}`}},
			"far[1]": {Type: "kubectl_manifest", AttributeValues: map[string]any{"yaml_body": `{"apiVersion":"kubevirt.io/v1","kind":"VirtualMachine","metadata":{"annotations":{"com.coder.agent.id":"other-agent"}}}`}},
		},
	}
	require.Equal(t, "a", selectAgentResource(candidates, resources, "agent").Label)
}
