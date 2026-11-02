package agentcontainers

import (
	"context"
	"os/exec"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentexec"
	"github.com/coder/coder/v2/testutil"
)

func TestRunDockerInspectRemovedContainer(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("the command fixture requires a POSIX shell")
	}
	for _, tt := range []struct {
		name    string
		message string
		wantErr bool
	}{
		{name: "OlderDocker", message: "Error: No such object: removed"},
		{name: "CurrentDocker", message: "error: no such object: removed"},
		{name: "PermissionDenied", message: "permission denied while trying to connect to the Docker daemon socket", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			execer := inspectErrorExecer{Execer: agentexec.DefaultExecer, message: tt.message}
			stdout, stderr, err := runDockerInspect(testutil.Context(t, testutil.WaitShort), execer, "removed")
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.JSONEq(t, "[]", string(stdout))
			require.Equal(t, tt.message, string(stderr))
		})
	}
}

type inspectErrorExecer struct {
	agentexec.Execer
	message string
}

func (e inspectErrorExecer) CommandContext(ctx context.Context, _ string, _ ...string) *exec.Cmd {
	return e.Execer.CommandContext(ctx, "sh", "-c", `printf '[]'; printf '%s' "$1" >&2; exit 1`, "inspect", e.message)
}
