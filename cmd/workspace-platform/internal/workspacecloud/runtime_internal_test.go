//go:build linux

package workspacecloud

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSharedDirectories(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	home, mount, peers, items := filepath.Join(root, "home"), filepath.Join(root, "drive"), filepath.Join(root, "peers"), filepath.Join(root, "items")
	for _, d := range []string{home, mount, filepath.Join(peers, "other"), items} {
		require.NoError(t, os.MkdirAll(d, 0o700))
	}
	cfg := mountInfo{Link: filepath.Join(home, "cloud-drive"), Mount: mount, Mode: "mount", Items: []grant{{"grant", "other", "report"}, {"grant2", "other", "report"}}}
	for _, i := range cfg.Items {
		require.NoError(t, os.WriteFile(filepath.Join(items, i.ID), []byte(i.ID), 0o600))
	}
	require.NoError(t, os.Mkdir(cfg.Link, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(cfg.Link, "local"), []byte("keep me"), 0o600))
	changed, err := cfg.reconcile("on")
	require.NoError(t, err)
	require.True(t, changed)
	require.FileExists(t, filepath.Join(cfg.Link+".local", "local"))
	old := filepath.Join(home, "cloud-drive-shared", "other")
	require.NoError(t, os.MkdirAll(old, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(old, "keep"), nil, 0o600))
	require.NoError(t, os.Symlink(filepath.Join(items, "grant"), filepath.Join(old, "old")))
	for range 2 {
		require.NoError(t, cfg.shared(home, peers, items))
		require.FileExists(t, filepath.Join(old, "keep"))
		require.NoFileExists(t, filepath.Join(old, "old"))
		require.FileExists(t, filepath.Join(cfg.Link, "Shared", "other (shared items)", "report"))
		require.FileExists(t, filepath.Join(cfg.Link, "Shared", "other (shared items)", "report (2)"))
	}
	changed, err = cfg.reconcile("off")
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, "detached", cfg.status(t.Context(), "off"))
	require.NoError(t, cfg.shared(home, peers, items))
	_, err = os.Lstat(cfg.Link)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestProjectedState(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	state, push := filepath.Join(root, "projected"), filepath.Join(root, "push")
	require.NoError(t, os.WriteFile(state, []byte("on"), 0o600))
	require.NoError(t, os.WriteFile(push, []byte("100 off"), 0o600))
	for _, tc := range []struct {
		unix int64
		want string
	}{{99, "off"}, {100, "off"}, {101, "on"}} {
		at := time.Unix(tc.unix, 0)
		require.NoError(t, os.Chtimes(state, at, at))
		got, err := desiredState(state, push)
		require.NoError(t, err)
		require.Equal(t, tc.want, got)
	}
}

func TestRename(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, want string }{{"data.csv", "data-(cloud_drive).csv"}, {"file.tar.gz", "file-(cloud_drive).tar.gz"}, {".bashrc", ".bashrc-(cloud_drive)"}, {"Makefile", "Makefile-(cloud_drive)"}} {
		require.Equal(t, tc.want, renamed(tc.name, 1))
	}
	require.Equal(t, "data-(cloud_drive)-2.csv", renamed("data.csv", 2))
}

func TestMountPreservesReplacedLinks(t *testing.T) {
	t.Parallel()
	d := newDrive(t.TempDir())
	require.NoError(t, os.Mkdir(d.cloud, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(d.cloud, "one"), nil, 0o600))
	target := filepath.Join(d.home, "data")
	require.NoError(t, d.transaction(func(s *mounts) error { _, err := d.apply(s, target, "keep-both", nil, "keep-both"); return err }))
	first := filepath.Join(target, "one")
	other := filepath.Join(d.home, "other")
	require.NoError(t, os.Remove(first))
	require.NoError(t, os.Symlink(other, first))
	require.NoError(t, os.Remove(filepath.Join(d.cloud, "one")))
	require.NoError(t, d.transaction(func(s *mounts) error { _, err := d.sync(s); return err }))
	require.NoError(t, d.transaction(func(s *mounts) error { _, err := d.unmount(s, target); return err }))
	v, err := os.Readlink(first)
	require.NoError(t, err)
	require.Equal(t, other, v)
}
