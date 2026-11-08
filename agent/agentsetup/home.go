package agentsetup

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/spf13/afero"
)

// ImagePaths are the workspace image's own files the setup copies from.
type ImagePaths struct {
	// ShellDefaults holds the image's bashrc, its copy of Ubuntu's stock
	// bashrc (ubuntu-bashrc) and its vimrc.
	ShellDefaults string
	// Skeleton is the system's default home files (.profile).
	Skeleton string
	// ImageHome holds the dotfiles of an image built in Templates > Images.
	ImageHome string
}

// DefaultImagePaths are where the workspace images keep those files.
var DefaultImagePaths = ImagePaths{
	ShellDefaults: "/usr/share/coder-workspace",
	Skeleton:      "/etc/skel",
	ImageHome:     "/usr/share/coder-image/home",
}

// ResolveStartFolder is the Start folder setup uses: StartFolder when it is
// a clean path under Home (made when missing), otherwise Home. The second
// result says what happened, for the Logs panel ("" when nothing did).
func ResolveStartFolder(fsys afero.Fs, in Inputs) (folder string, note string) {
	folder = strings.TrimSpace(in.StartFolder)
	if folder == "" {
		return in.Home, ""
	}
	for part := range strings.SplitSeq(folder, "/") {
		if part == ".." || part == "." {
			return in.Home, ""
		}
	}
	if !filepath.IsAbs(folder) {
		folder = filepath.Join(in.Home, folder)
	}
	if info, err := fsys.Stat(folder); err == nil && info.IsDir() {
		return folder, ""
	}
	if !within(in.Home, folder) {
		return in.Home, "Start folder " + folder + " does not exist: File Browser opens the home"
	}
	if err := fsys.MkdirAll(folder, 0o755); err != nil {
		return in.Home, "Start folder " + folder + " could not be made: File Browser opens the home"
	}
	return folder, "Start folder: made " + folder
}

func startFolder(_ context.Context, env *Env) error {
	if _, note := ResolveStartFolder(env.FS, env.Inputs); note != "" {
		env.Logf("%s", note)
	}
	return nil
}

// shellDefaults gives users the image's ~/.bashrc when they have none or still
// Ubuntu's stock one (an edited one is left alone), a ~/.profile so login
// shells read it, and the vimrc that ~/.bashrc points Vim at.
func shellDefaults(_ context.Context, env *Env) error {
	defaults := env.Paths.ShellDefaults
	bashrc := path.Join(defaults, "bashrc")
	if !exists(env.FS, bashrc) {
		return nil
	}
	home := env.Inputs.Home
	userBashrc := path.Join(home, ".bashrc")
	stock, err := sameContent(env.FS, userBashrc, path.Join(defaults, "ubuntu-bashrc"))
	if err != nil {
		return err
	}
	if !exists(env.FS, userBashrc) || stock {
		if err := copyFile(env.FS, bashrc, userBashrc); err != nil {
			return err
		}
	}
	if err := copyIfMissing(env.FS, path.Join(env.Paths.Skeleton, ".profile"), path.Join(home, ".profile")); err != nil {
		return err
	}
	return copyIfMissing(env.FS, path.Join(defaults, "vimrc"), path.Join(home, ".config", "vim", "vimrc"))
}

// imageDotfiles copies the dotfiles of an image built in Templates > Images
// into the home, where it has none of its own.
func imageDotfiles(_ context.Context, env *Env) error {
	src := env.Paths.ImageHome
	if info, err := env.FS.Stat(src); err != nil || !info.IsDir() {
		return nil
	}
	return afero.Walk(env.FS, src, func(p string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil || rel == "." {
			return err
		}
		dst := filepath.Join(env.Inputs.Home, rel)
		if info.IsDir() {
			return env.FS.MkdirAll(dst, info.Mode().Perm()|0o700)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyIfMissing(env.FS, p, dst)
	})
}

// btopConfig makes btop refresh every 100 ms and show the home's disk: btop's
// defaults read disks from /etc/fstab (empty in a container) and count only
// physical filesystems. A value the user chose is left alone.
func btopConfig(_ context.Context, env *Env) error {
	home := env.Inputs.Home
	conf := path.Join(home, ".config", "btop", "btop.conf")
	data, err := afero.ReadFile(env.FS, conf)
	if errors.Is(err, os.ErrNotExist) {
		if err := env.FS.MkdirAll(path.Dir(conf), 0o755); err != nil {
			return err
		}
		return afero.WriteFile(env.FS, conf, []byte(strings.Join([]string{
			"update_ms = 100",
			"use_fstab = false",
			"only_physical = false",
			`disks_filter = "` + home + `"`,
		}, "\n")+"\n"), 0o644)
	}
	if err != nil {
		return err
	}
	defaults := map[string]string{
		"update_ms = 2000":     "update_ms = 100",
		"use_fstab = true":     "use_fstab = false",
		"only_physical = true": "only_physical = false",
		`disks_filter = ""`:    `disks_filter = "` + home + `"`,
	}
	lines := strings.Split(string(data), "\n")
	changed := false
	for i, line := range lines {
		if replacement, ok := defaults[line]; ok {
			lines[i] = replacement
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return afero.WriteFile(env.FS, conf, []byte(strings.Join(lines, "\n")), 0o644)
}

// tmuxConfig runs the image's tmux setup for users who have no tmux
// configuration yet.
func tmuxConfig(ctx context.Context, env *Env) error {
	home := env.Inputs.Home
	if exists(env.FS, path.Join(home, ".config", "tmux")) || exists(env.FS, path.Join(home, ".tmux.conf")) {
		return nil
	}
	if _, err := env.Cmd.LookPath("tmux-mirror-setup"); err != nil {
		return nil
	}
	var out bytes.Buffer
	if err := env.Cmd.Run(ctx, &out, "tmux-mirror-setup"); err != nil {
		// The image's own helper failing is not the workspace's problem.
		env.Logf("tmux setup did not finish: %v", err)
	}
	return nil
}

func exists(fsys afero.Fs, p string) bool {
	_, err := fsys.Stat(p)
	return err == nil
}

func sameContent(fsys afero.Fs, a, b string) (bool, error) {
	left, err := afero.ReadFile(fsys, a)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	right, err := afero.ReadFile(fsys, b)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return bytes.Equal(left, right), nil
}

func copyIfMissing(fsys afero.Fs, src, dst string) error {
	if exists(fsys, dst) || !exists(fsys, src) {
		return nil
	}
	return copyFile(fsys, src, dst)
}

func copyFile(fsys afero.Fs, src, dst string) error {
	data, err := afero.ReadFile(fsys, src)
	if err != nil {
		return err
	}
	info, err := fsys.Stat(src)
	if err != nil {
		return err
	}
	if err := fsys.MkdirAll(path.Dir(dst), 0o755); err != nil {
		return err
	}
	return afero.WriteFile(fsys, dst, data, info.Mode().Perm())
}
