//go:build linux

package workspacecloud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
	"golang.org/x/xerrors"
)

const (
	configPath = "/etc/platform/cloud-drive-mounts"
	statePath  = "/etc/platform/cloud-drive"
	pushedPath = "/tmp/coder-cloud-drive/pushed"
	peerRoot   = "/mnt/cloud-drive-peers"
	itemRoot   = "/mnt/cloud-drive-items"
)

type (
	grant     struct{ ID, Owner, Item string }
	mountInfo struct {
		Link, Mode, Mount string
		Items             []grant
	}
)

func readConfig(path string) (mountInfo, error) {
	var cfg mountInfo
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	if !filepath.IsAbs(cfg.Link) || cfg.Link == "/" || (cfg.Mount != "" && !filepath.IsAbs(cfg.Mount)) {
		return cfg, xerrors.New("invalid platform mount information")
	}
	return cfg, nil
}

func desiredState(state, push string) (string, error) {
	info, err := os.Stat(state)
	var since int64
	if err == nil {
		since = info.ModTime().Unix()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	raw, err := os.ReadFile(push)
	if err == nil {
		at, want, ok := strings.Cut(strings.TrimSpace(string(raw)), " ")
		t, e := strconv.ParseInt(at, 10, 64)
		if ok && e == nil && t >= since {
			return want, nil
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	raw, err = os.ReadFile(state)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	return strings.TrimSpace(string(raw)), err
}

func (cfg mountInfo) target(want string) string {
	switch {
	case want == "off":
		return ""
	case strings.HasPrefix(want, "source:/"):
		return strings.TrimPrefix(want, "source:")
	default:
		return cfg.Mount
	}
}

func (cfg mountInfo) reconcile(want string) (bool, error) {
	target := cfg.target(want)
	link, err := os.Readlink(cfg.Link)
	if err == nil {
		if link == target {
			return false, nil
		}
		if target == "" {
			return true, os.Remove(cfg.Link)
		}
	} else if !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, unix.EINVAL) {
		return false, err
	}
	if target == "" {
		return false, nil
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return false, err
	}
	if link == "" {
		if i, err := os.Lstat(cfg.Link); err == nil {
			if !i.IsDir() {
				return false, xerrors.Errorf("a local file occupies %s", cfg.Link)
			}
			if err := os.Remove(cfg.Link); err != nil {
				if !errors.Is(err, unix.ENOTEMPTY) {
					return false, err
				}
				dest := cfg.Link + ".local"
				for n := 2; ; n++ {
					_, err := os.Lstat(dest)
					if errors.Is(err, fs.ErrNotExist) {
						break
					}
					if err != nil {
						return false, err
					}
					dest = fmt.Sprintf("%s.local-%d", cfg.Link, n)
				}
				if err := os.Rename(cfg.Link, dest); err != nil {
					return false, err
				}
				_, _ = fmt.Fprintf(os.Stderr, "Preserved local Cloud Drive files in %s\n", dest)
			}
		} else if !errors.Is(err, fs.ErrNotExist) {
			return false, err
		}
	}
	return true, replaceLink(cfg.Link, target)
}

func replaceLink(path, to string) error {
	dir, err := os.MkdirTemp(filepath.Dir(path), ".cloud-link-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	temp := filepath.Join(dir, "link")
	if err := os.Symlink(to, temp); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

func cleanShared(root, peers, items string) error {
	info, err := os.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return xerrors.Errorf("%s must be a directory", root)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		path := filepath.Join(root, e.Name())
		if to, err := os.Readlink(path); err == nil && strings.HasPrefix(to, peers+"/") {
			if err := os.Remove(path); err != nil {
				return err
			}
			continue
		}
		if !e.IsDir() {
			continue
		}
		files, err := os.ReadDir(path)
		if err != nil {
			return err
		}
		cleaned := false
		for _, f := range files {
			p := filepath.Join(path, f.Name())
			if to, err := os.Readlink(p); err == nil && strings.HasPrefix(to, items+"/") {
				if err := os.Remove(p); err != nil {
					return err
				}
				cleaned = true
			}
		}
		if cleaned {
			_ = os.Remove(path)
		}
	}
	return nil
}

func simpleName(v string) bool { return filepath.IsLocal(v) && filepath.Base(v) == v && v != "." }

func (cfg mountInfo) shared(home, peers, items string) error {
	old := filepath.Join(home, "cloud-drive-shared")
	if info, err := os.Lstat(old); err == nil && info.IsDir() {
		if err := cleanShared(old, peers, items); err != nil {
			return err
		}
		_ = os.Remove(old)
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	// A disconnected or isolated workspace must not acquire a new ~/cloud-drive directory.
	if !isDir(cfg.Link) {
		return nil
	}
	shared := filepath.Join(cfg.Link, "Shared")
	if err := cleanShared(shared, peers, items); err != nil {
		return err
	}
	dirs, err := os.ReadDir(peers)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	for _, e := range dirs {
		src := filepath.Join(peers, e.Name())
		if !isDir(src) {
			continue
		}
		if err := os.MkdirAll(shared, 0o755); err != nil {
			return err
		}
		if err := os.Symlink(src, filepath.Join(shared, e.Name())); err != nil && !errors.Is(err, fs.ErrExist) {
			return err
		}
	}
	for _, g := range cfg.Items {
		if !simpleName(g.ID) || !simpleName(g.Owner) || !simpleName(g.Item) {
			return xerrors.New("invalid Cloud Drive share name")
		}
		src := filepath.Join(items, g.ID)
		if _, err := os.Stat(src); errors.Is(err, fs.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		dir := filepath.Join(shared, g.Owner)
		if _, err := os.Readlink(dir); err == nil {
			dir += " (shared items)"
		}
		if i, err := os.Lstat(dir); err == nil && !i.IsDir() {
			return xerrors.Errorf("cannot use %s for a shared item", dir)
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		name := g.Item
		for n := 2; ; n++ {
			if err := os.Symlink(src, filepath.Join(dir, name)); err == nil {
				break
			} else if !errors.Is(err, fs.ErrExist) {
				return err
			}
			name = fmt.Sprintf("%s (%d)", g.Item, n)
		}
	}
	// Remove only empty generated directories.
	if i, err := os.Lstat(shared); err == nil && i.IsDir() {
		_ = os.Remove(shared)
	}
	return nil
}

func filebrowser(ctx context.Context, home, action string) {
	binary := filepath.Join(home, ".local/bin/coder-filebrowser")
	if _, err := os.Stat(binary); err != nil {
		return
	}
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, binary, action)
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "File Browser:", err)
	}
}

// Keep a stalled storage mount from holding up an agent metadata collection or File Browser discovery.
func probe(ctx context.Context, wait time.Duration, bin string, args ...string) (string, bool) {
	c, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	cmd := exec.CommandContext(c, bin, args...)
	cmd.WaitDelay = time.Second
	b, err := cmd.Output()
	return strings.TrimSpace(string(b)), err == nil
}

func (cfg mountInfo) status(ctx context.Context, state string) string {
	target := cfg.target(state)
	to, err := os.Readlink(cfg.Link)
	if target == "" {
		if err == nil {
			return "waiting"
		}
		if state == "off" {
			return "detached"
		}
		if cfg.Mode == "shared" || cfg.Mode == "offline" {
			return cfg.Mode
		}
		return "waiting"
	}
	if to != target {
		return "waiting"
	}
	if _, ok := probe(ctx, 2*time.Second, "test", "-d", cfg.Link+"/"); ok {
		return "attached"
	}
	return "unanswered"
}

func (cfg mountInfo) drives(ctx context.Context, out io.Writer) error {
	enc := json.NewEncoder(out)
	emit := func(link, name string, owner bool) error {
		to, ok := probe(ctx, 10*time.Second, "readlink", "-f", link)
		if !ok {
			return nil
		}
		if _, ok := probe(ctx, 10*time.Second, "test", "-d", to); !ok {
			return nil
		}
		ro := false
		if !owner {
			_, writable := probe(ctx, 10*time.Second, "test", "-w", to)
			ro = !writable
		}
		return enc.Encode(map[string]any{"name": name, "path": to, "readOnly": ro})
	}
	if _, err := os.Readlink(cfg.Link); err == nil {
		if err := emit(cfg.Link, "Cloud Drive", true); err != nil {
			return err
		}
	}
	shared := filepath.Join(cfg.Link, "Shared")
	dirs, err := os.ReadDir(shared)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, d := range dirs {
		p := filepath.Join(shared, d.Name())
		if d.Type()&fs.ModeSymlink != 0 {
			if err := emit(p, d.Name()+"'s Cloud Drive", false); err != nil {
				return err
			}
			continue
		}
		if !d.IsDir() {
			continue
		}
		files, err := os.ReadDir(p)
		if err != nil {
			return err
		}
		for _, f := range files {
			if f.Type()&fs.ModeSymlink != 0 {
				if err := emit(filepath.Join(p, f.Name()), strings.TrimSuffix(d.Name(), " (shared items)")+"'s "+f.Name(), false); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func startWatcher(home string) error {
	cli := filepath.Join(home, ".local/bin/cloud-drive")
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if err := replaceLink(cli, self); err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(filepath.Dir(pushedPath), "watch.log"), os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer log.Close()
	// The watcher belongs to the workspace and survives the startup command.
	cmd := exec.CommandContext(context.Background(), self, "cloud-runtime", "watch")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	cmd.Stderr = log
	cmd.Stdout = log
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// Serialize pushed and projected updates so two reconcilers cannot move the same local folder.
func (cfg mountInfo) refresh(home, action string) (bool, error) {
	f, err := os.OpenFile(filepath.Join(filepath.Dir(pushedPath), "links.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return false, err
	}
	defer f.Close()
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		return false, err
	}
	state, err := desiredState(statePath, pushedPath)
	if err != nil {
		return false, err
	}
	changed, err := cfg.reconcile(state)
	if err == nil && (changed || action == "start") {
		err = cfg.shared(home, peerRoot, itemRoot)
	}
	return changed, err
}

func watch(ctx context.Context, d drive) error {
	f, err := os.OpenFile(filepath.Join(filepath.Dir(pushedPath), "watch.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); errors.Is(err, unix.EWOULDBLOCK) {
		return nil
	} else if err != nil {
		return err
	}
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	var n int
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timer.C:
			cfg, err := readConfig(configPath)
			if err != nil {
				_, _ = fmt.Fprintln(os.Stderr, err)
				continue
			}
			changed, err := cfg.refresh(d.home, "watch")
			if err != nil {
				_, _ = fmt.Fprintln(os.Stderr, err)
			}
			if changed && err == nil {
				filebrowser(ctx, d.home, "restart")
			}
			n++
			if n%10 == 0 {
				if _, err := os.Stat(filepath.Join(d.config, "mounts.json")); err == nil {
					if err := d.transaction(func(s *mounts) error { _, err := d.sync(s); return err }); err != nil {
						_, _ = fmt.Fprintln(os.Stderr, err)
					}
				}
				filebrowser(ctx, d.home, "check")
			}
		}
	}
}

// Runtime manages the primary drive, projected shares and File Browser discovery.
func Runtime(ctx context.Context, args []string, out io.Writer) error {
	if len(args) < 1 {
		return xerrors.New("expected a Cloud Drive command")
	}
	cfg, err := readConfig(configPath)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	switch args[0] {
	case "links":
		if _, err := os.Readlink(cfg.Link); err == nil {
			_, _ = fmt.Fprintln(out, cfg.Link)
		}
		if shared := filepath.Join(cfg.Link, "Shared"); isDir(shared) {
			_, _ = fmt.Fprintln(out, shared)
		}
	case "targets":
		_, _ = fmt.Fprintln(out, "/mnt/cloud-drive")
		_, _ = fmt.Fprintln(out, peerRoot)
		_, _ = fmt.Fprintln(out, itemRoot)
		if to, ok := probe(ctx, 10*time.Second, "readlink", "-f", cfg.Link); ok {
			if _, err := os.Readlink(cfg.Link); err == nil {
				_, _ = fmt.Fprintln(out, to)
			}
		}
	case "drives":
		return cfg.drives(ctx, out)
	case "start", "status", "push", "watch":
		if err := os.MkdirAll(filepath.Dir(pushedPath), 0o700); err != nil {
			return err
		}
		if args[0] == "watch" {
			return watch(ctx, newDrive(home))
		}
		if args[0] == "push" {
			if len(args) != 2 || (args[1] != "on" && args[1] != "off" && !strings.HasPrefix(args[1], "source:/")) {
				return xerrors.New("expected on, off or source:/path")
			}
			if err := atomicFile(pushedPath, fmt.Appendf(nil, "%d %s\n", time.Now().Unix(), args[1])); err != nil {
				return err
			}
		}
		state, err := desiredState(statePath, pushedPath)
		if err != nil {
			return err
		}
		if args[0] == "status" {
			_, _ = fmt.Fprintln(out, cfg.status(ctx, state))
			return nil
		}
		changed, err := cfg.refresh(home, args[0])
		if err != nil {
			return err
		}
		if args[0] == "start" || changed {
			filebrowser(ctx, home, "restart")
		}
		if args[0] == "start" {
			return startWatcher(home)
		}
		_, _ = fmt.Fprintln(out, cfg.status(ctx, state))
	default:
		return xerrors.Errorf("unknown Cloud Drive runtime command %q", args[0])
	}
	return nil
}
