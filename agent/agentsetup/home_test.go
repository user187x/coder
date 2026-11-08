package agentsetup_test

import (
	"bytes"
	"context"
	"io"
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/spf13/afero"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentsetup"
)

const home = "/home/coder"

type fakeCommander struct {
	installed map[string]bool
	ran       []string
}

func (f *fakeCommander) LookPath(name string) (string, error) {
	if f.installed[name] {
		return "/usr/bin/" + name, nil
	}
	return "", os.ErrNotExist
}

func (f *fakeCommander) Run(_ context.Context, _ io.Writer, name string, _ ...string) error {
	f.ran = append(f.ran, name)
	return nil
}

func newEnv(t *testing.T, files map[string]string) (*agentsetup.Env, *bytes.Buffer, *fakeCommander) {
	t.Helper()
	fsys := afero.NewMemMapFs()
	for p, content := range files {
		require.NoError(t, afero.WriteFile(fsys, p, []byte(content), 0o644))
	}
	require.NoError(t, fsys.MkdirAll(home, 0o755))
	var log bytes.Buffer
	cmd := &fakeCommander{installed: map[string]bool{}}
	return &agentsetup.Env{
		Inputs: agentsetup.Inputs{Home: home, OwnerName: "alice", WorkspaceName: "dev", AgentName: "main"},
		FS:     fsys,
		Cmd:    cmd,
		Log:    &log,
		Paths:  agentsetup.DefaultImagePaths,
	}, &log, cmd
}

func read(t *testing.T, env *agentsetup.Env, p string) string {
	t.Helper()
	data, err := afero.ReadFile(env.FS, p)
	require.NoError(t, err)
	return string(data)
}

// runTwice runs the full setup twice: the second run must change nothing.
func runTwice(t *testing.T, env *agentsetup.Env) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, agentsetup.Run(ctx, env, agentsetup.Steps()))
	snapshot := map[string]string{}
	require.NoError(t, afero.Walk(env.FS, "/", func(p string, info os.FileInfo, err error) error {
		if err == nil && info.Mode().IsRegular() {
			snapshot[p] = read(t, env, p)
		}
		return err
	}))
	require.NoError(t, agentsetup.Run(ctx, env, agentsetup.Steps()))
	for p, content := range snapshot {
		require.Equal(t, content, read(t, env, p), "second run changed %s", p)
	}
}

func TestShellDefaults(t *testing.T) {
	t.Parallel()
	image := map[string]string{
		"/usr/share/coder-workspace/bashrc":        "image bashrc",
		"/usr/share/coder-workspace/ubuntu-bashrc": "stock bashrc",
		"/usr/share/coder-workspace/vimrc":         "image vimrc",
		"/etc/skel/.profile":                       "skel profile",
	}
	for _, tc := range []struct {
		name   string
		bashrc string // "" means the user has none
		want   string
	}{
		{name: "Missing", want: "image bashrc"},
		{name: "Stock", bashrc: "stock bashrc", want: "image bashrc"},
		{name: "Edited", bashrc: "my bashrc", want: "my bashrc"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			files := maps.Clone(image)
			if tc.bashrc != "" {
				files[home+"/.bashrc"] = tc.bashrc
			}
			env, _, _ := newEnv(t, files)
			runTwice(t, env)
			require.Equal(t, tc.want, read(t, env, home+"/.bashrc"))
			require.Equal(t, "skel profile", read(t, env, home+"/.profile"))
			require.Equal(t, "image vimrc", read(t, env, home+"/.config/vim/vimrc"))
		})
	}

	t.Run("NoImageDefaults", func(t *testing.T) {
		t.Parallel()
		env, _, _ := newEnv(t, map[string]string{"/etc/skel/.profile": "skel profile"})
		runTwice(t, env)
		_, err := env.FS.Stat(home + "/.bashrc")
		require.ErrorIs(t, err, os.ErrNotExist)
	})
}

func TestImageDotfiles(t *testing.T) {
	t.Parallel()
	env, _, _ := newEnv(t, map[string]string{
		"/usr/share/coder-image/home/.gitconfig":         "image git",
		"/usr/share/coder-image/home/.config/app/a.conf": "image app",
		home + "/.gitconfig":                             "my git",
	})
	runTwice(t, env)
	require.Equal(t, "my git", read(t, env, home+"/.gitconfig"))
	require.Equal(t, "image app", read(t, env, home+"/.config/app/a.conf"))
}

func TestBtopConfig(t *testing.T) {
	t.Parallel()
	t.Run("Missing", func(t *testing.T) {
		t.Parallel()
		env, _, _ := newEnv(t, nil)
		runTwice(t, env)
		require.Equal(t, "update_ms = 100\nuse_fstab = false\nonly_physical = false\ndisks_filter = \"/home/coder\"\n",
			read(t, env, home+"/.config/btop/btop.conf"))
	})
	t.Run("DefaultsReplacedChoicesKept", func(t *testing.T) {
		t.Parallel()
		env, _, _ := newEnv(t, map[string]string{
			home + "/.config/btop/btop.conf": "color_theme = \"nord\"\nupdate_ms = 2000\nuse_fstab = true\nonly_physical = false\ndisks_filter = \"/data\"\n",
		})
		runTwice(t, env)
		require.Equal(t, "color_theme = \"nord\"\nupdate_ms = 100\nuse_fstab = false\nonly_physical = false\ndisks_filter = \"/data\"\n",
			read(t, env, home+"/.config/btop/btop.conf"))
	})
}

func TestTmuxConfig(t *testing.T) {
	t.Parallel()
	t.Run("RunsForNewUsers", func(t *testing.T) {
		t.Parallel()
		env, _, cmd := newEnv(t, nil)
		cmd.installed["tmux-mirror-setup"] = true
		require.NoError(t, agentsetup.Run(context.Background(), env, agentsetup.Steps()))
		require.Equal(t, []string{"tmux-mirror-setup"}, cmd.ran)
	})
	t.Run("LeavesExistingConfig", func(t *testing.T) {
		t.Parallel()
		env, _, cmd := newEnv(t, map[string]string{home + "/.tmux.conf": "mine"})
		cmd.installed["tmux-mirror-setup"] = true
		require.NoError(t, agentsetup.Run(context.Background(), env, agentsetup.Steps()))
		require.Empty(t, cmd.ran)
	})
}

func TestResolveStartFolder(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, folder, want, note string
	}{
		{name: "Empty", folder: "", want: home},
		{name: "MadeUnderHome", folder: "projects/app", want: home + "/projects/app", note: "Start folder: made /home/coder/projects/app"},
		{name: "AbsoluteUnderHome", folder: home + "/src", want: home + "/src", note: "Start folder: made /home/coder/src"},
		{name: "StepsUp", folder: "../etc", want: home},
		{name: "OutsideHomeMissing", folder: "/srv/data", want: home, note: "Start folder /srv/data does not exist: File Browser opens the home"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			env, _, _ := newEnv(t, nil)
			in := env.Inputs
			in.StartFolder = tc.folder
			got, note := agentsetup.ResolveStartFolder(env.FS, in)
			require.Equal(t, tc.want, got)
			require.Equal(t, tc.note, note)
			// Once made, it resolves silently.
			got, note = agentsetup.ResolveStartFolder(env.FS, in)
			require.Equal(t, tc.want, got)
			if strings.HasPrefix(tc.note, "Start folder: made") {
				require.Empty(t, note)
			}
		})
	}
}

func TestAppsPrefix(t *testing.T) {
	t.Parallel()
	in := agentsetup.Inputs{OwnerName: "alice", WorkspaceName: "dev", AgentName: "main"}
	require.Equal(t, "/@alice/dev.main/apps", in.AppsPrefix())
}
