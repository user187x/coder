package agentsetup

import (
	"bytes"
	"context"
	"io/fs"
	"path"
	"path/filepath"
	"strings"

	"github.com/spf13/afero"

	"github.com/coder/coder/v2/agent/agentsetup/homestatfs"
)

// btopDisk makes btop show the home volume's size where the cluster's volumes
// are folders of the node's disk: a wrapper in ~/.local/bin preloads the
// home-statfs library, which answers for the home with the size the Disk
// metric measured. On a real volume the library changes nothing.
func btopDisk(_ context.Context, env *Env) error {
	library := homestatfs.Library()
	if len(library) == 0 {
		return nil
	}
	home := env.Inputs.Home
	wrapperDir := path.Join(home, ".local", "bin")
	btop := findExecutable(env.FS, env.Inputs.Path, "btop", wrapperDir)
	if btop == "" {
		return nil
	}
	so := path.Join(home, ".cache", "coder", "home-statfs.so")
	changed, err := writeIfChanged(env.FS, so, library, 0o644)
	if err != nil {
		return err
	}
	wrapper := strings.Join([]string{
		"#!/bin/sh",
		"# btop answering for the home volume, not the whole node disk (written by the Coder agent at every start)",
		`so="$HOME/.cache/coder/home-statfs.so"`,
		`[ -r "$so" ] && export LD_PRELOAD="$so${LD_PRELOAD:+:$LD_PRELOAD}"`,
		"exec " + shellWord(btop) + ` "$@"`,
	}, "\n") + "\n"
	wrote, err := writeIfChanged(env.FS, path.Join(wrapperDir, "btop"), []byte(wrapper), 0o755)
	if err != nil {
		return err
	}
	if changed || wrote {
		env.Logf("btop: answers for the home volume")
	}
	return nil
}

// findExecutable is the first name on the PATH list that is an executable
// file, skipping the directory skip (where the wrapper itself lives).
func findExecutable(fsys afero.Fs, pathList, name, skip string) string {
	for _, dir := range filepath.SplitList(pathList) {
		if dir == "" || filepath.Clean(dir) == filepath.Clean(skip) {
			continue
		}
		candidate := filepath.Join(dir, name)
		info, err := fsys.Stat(candidate)
		if err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate
		}
	}
	return ""
}

// writeIfChanged writes data to p unless it already holds it, through a
// temporary file so a program using the old one keeps it intact.
func writeIfChanged(fsys afero.Fs, p string, data []byte, mode fs.FileMode) (bool, error) {
	if current, err := afero.ReadFile(fsys, p); err == nil && bytes.Equal(current, data) {
		return false, nil
	}
	if err := fsys.MkdirAll(path.Dir(p), 0o755); err != nil {
		return false, err
	}
	tmp := p + ".new"
	if err := afero.WriteFile(fsys, tmp, data, mode); err != nil {
		return false, err
	}
	if err := fsys.Chmod(tmp, mode); err != nil {
		return false, err
	}
	return true, fsys.Rename(tmp, p)
}

// shellWord quotes s as one POSIX shell word.
func shellWord(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}
