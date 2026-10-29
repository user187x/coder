package templatedecorator_test

import (
	"strings"
	"testing"

	"github.com/coder/coder/v2/coderd/templatedecorator"
	"github.com/stretchr/testify/require"
)

func TestManagedRuntime(t *testing.T) {
	t.Parallel()
	for _, old := range []string{"", `dynamic "container" {
 for_each = []
 content {
  name = "workspace-tunnel"
  image = "old:1"
 }
}`} {
		t.Run(old, func(t *testing.T) {
			t.Parallel()
			source := strings.Replace(prototype, "        container {", old+"\n        container {", 1)
			p := &templatedecorator.Payload{RuntimeImage: "runtime:1.6.0", AccessURL: "https://coder.example.com"}
			result, err := p.Decorate(map[string][]byte{"main.tf": []byte(source)})
			require.NoError(t, err)
			parses(t, result.Files["main.tf"])
			text := string(result.Files["main.tf"])
			require.Contains(t, text, `"runtime:1.6.0"`)
			require.NotContains(t, text, `"old:1"`)
			require.Equal(t, 1, strings.Count(text, `"workspace-tunnel"`))
			require.Contains(t, text, "coder_agent.main.token")
			require.Contains(t, text, "https://coder.example.com/__coder-ui/api/workspace-tunnels/agent/sync")
			require.Empty(t, result.Added)
			repeated, err := p.Decorate(result.Files)
			require.NoError(t, err)
			require.Equal(t, result.Files, repeated.Files)
			require.Empty(t, repeated.Injected)
		})
	}
}
