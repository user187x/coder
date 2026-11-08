package agentsetup_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/spf13/afero"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentsetup"
	"github.com/coder/coder/v2/agent/agentsetup/homestatfs"
)

func TestBtopDisk(t *testing.T) {
	t.Parallel()
	if len(homestatfs.Library()) == 0 {
		t.Skip("no home-statfs library for this platform")
	}
	t.Run("WrapsTheImagesBtop", func(t *testing.T) {
		t.Parallel()
		env, log, _ := newEnv(t, nil)
		require.NoError(t, afero.WriteFile(env.FS, "/usr/bin/btop", []byte("elf"), 0o755))
		// The wrapper's own folder comes first on the PATH and is skipped.
		env.Inputs.Path = home + "/.local/bin:/usr/local/bin:/usr/bin"
		runTwice(t, env)
		wrapper := read(t, env, home+"/.local/bin/btop")
		require.Contains(t, wrapper, `exec '/usr/bin/btop' "$@"`)
		require.Contains(t, wrapper, `export LD_PRELOAD="$so${LD_PRELOAD:+:$LD_PRELOAD}"`)
		info, err := env.FS.Stat(home + "/.local/bin/btop")
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0o755), info.Mode().Perm())
		require.Equal(t, string(homestatfs.Library()), read(t, env, home+"/.cache/coder/home-statfs.so"))
		// Logged once: the second run found everything current.
		require.Equal(t, 1, countLines(log.String(), "btop: answers for the home volume"))
	})
	t.Run("NoBtop", func(t *testing.T) {
		t.Parallel()
		env, _, _ := newEnv(t, nil)
		env.Inputs.Path = "/usr/bin"
		require.NoError(t, agentsetup.Run(context.Background(), env, agentsetup.Steps()))
		_, err := env.FS.Stat(home + "/.local/bin/btop")
		require.ErrorIs(t, err, os.ErrNotExist)
	})
}

func countLines(text, line string) int {
	n := 0
	for l := range strings.SplitSeq(text, "\n") {
		if l == line {
			n++
		}
	}
	return n
}
