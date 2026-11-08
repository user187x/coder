package agent

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/codersdk"
)

func TestNativeSetupScripts(t *testing.T) {
	t.Parallel()
	source := uuid.New()
	scripts := []codersdk.WorkspaceAgentScript{
		{LogSourceID: source, DisplayName: "Workspace setup", Script: " coder-platform-setup\n", StartBlocksLogin: true, RunOnStart: true},
		{DisplayName: "Other", Script: "echo coder-platform-setup"},
	}
	got := nativeSetupScripts(scripts, "/tmp/coder.agent/coder", "/home/coder/it's here")
	require.Equal(t, `exec '/tmp/coder.agent/coder' agent-setup --start-folder '/home/coder/it'"'"'s here'`, got[0].Script)
	// The entry keeps its log source and lifecycle flags.
	require.Equal(t, source, got[0].LogSourceID)
	require.True(t, got[0].StartBlocksLogin)
	require.True(t, got[0].RunOnStart)
	// Only the exact marker is replaced.
	require.Equal(t, "echo coder-platform-setup", got[1].Script)
	// The caller's slice is not modified.
	require.Equal(t, " coder-platform-setup\n", scripts[0].Script)
}
