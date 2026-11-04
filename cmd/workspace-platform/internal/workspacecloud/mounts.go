//go:build linux

// Package workspacecloud manages a workspace owner's Cloud Drive links.
package workspacecloud

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"golang.org/x/xerrors"
)

type mount struct {
	Target      string            `json:"target"`
	Mode        string            `json:"mode"`
	Created     float64           `json:"created"`
	Links       map[string]string `json:"links"`
	Overwritten map[string]string `json:"overwritten"`
}

type mounts struct {
	Mounts []*mount `json:"mounts"`
}

type drive struct {
	home, cloud, config, backups string
}

func newDrive(home string) drive {
	return drive{home, filepath.Join(home, "cloud-drive"), filepath.Join(home, ".config/cloud-drive"), filepath.Join(home, ".local/share/cloud-drive/overwritten")}
}

func (d drive) transaction(fn func(*mounts) error) error {
	if err := os.MkdirAll(d.config, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(d.config, "mounts.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		return err
	}
	state := mounts{Mounts: []*mount{}}
	raw, err := os.ReadFile(filepath.Join(d.config, "mounts.json"))
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &state); err != nil {
			return xerrors.Errorf("read mount state: %w", err)
		}
	case !errors.Is(err, fs.ErrNotExist):
		return err
	}
	for _, m := range state.Mounts {
		if m == nil || !filepath.IsAbs(m.Target) {
			return xerrors.New("invalid mount target in saved state")
		}
		if m.Links == nil {
			m.Links = map[string]string{}
		}
		if m.Overwritten == nil {
			m.Overwritten = map[string]string{}
		}
	}
	return fn(&state)
}

func atomicFile(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".cloud-drive-")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func (d drive) save(s *mounts) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return atomicFile(filepath.Join(d.config, "mounts.json"), raw)
}

func (s *mounts) find(target string) *mount {
	for _, m := range s.Mounts {
		if m.Target == target {
			return m
		}
	}
	return nil
}

func isDir(path string) bool { i, err := os.Stat(path); return err == nil && i.IsDir() }

func within(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, dir+string(os.PathSeparator))
}

// Resolve the existing prefix too, so a link cannot redirect a new subdirectory into a protected tree.
func resolved(path string) (string, error) {
	var tail []string
	for {
		current, err := filepath.EvalSymlinks(path)
		if err == nil {
			return filepath.Join(append([]string{current}, tail...)...), nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		if _, err := os.Lstat(path); err == nil {
			return "", xerrors.Errorf("dangling link at %s", path)
		}
		tail = append([]string{filepath.Base(path)}, tail...)
		path = filepath.Dir(path)
	}
}

func (d drive) target(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", xerrors.New("choose a folder to mount into")
	}
	if path == "~" {
		path = d.home
	} else if after, ok := strings.CutPrefix(path, "~/"); ok {
		path = filepath.Join(d.home, after)
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(d.home, path)
	}
	path = filepath.Clean(path)
	canonical, err := resolved(path)
	if err != nil {
		return "", err
	}
	cloud, _ := filepath.EvalSymlinks(d.cloud)
	for _, p := range []string{path, canonical} {
		if p == "/" || slices.Contains([]string{"/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var", "/mnt", "/mnt/cloud-drive"}, p) {
			return "", xerrors.Errorf("%s is a system folder", p)
		}
		for _, dir := range []string{"/dev", "/boot", "/proc", "/sys", "/etc", "/usr", d.config, d.backups, d.cloud, cloud} {
			if dir != "" && within(p, dir) {
				return "", xerrors.Errorf("choose a workspace folder outside %s", dir)
			}
		}
	}
	i, err := os.Stat(path)
	if err == nil && !i.IsDir() {
		return "", xerrors.Errorf("%s is a file", path)
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	return path, nil
}

func renamed(name string, n int) string {
	ext := filepath.Ext(name)
	if strings.TrimLeft(name, ".") == "" || len(name)-len(ext) == 0 {
		ext = ""
	}
	for _, end := range []string{".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tar.lz4"} {
		if len(name) > len(end) && strings.HasSuffix(strings.ToLower(name), end) {
			ext = name[len(name)-len(end):]
			break
		}
	}
	tag := "-(cloud_drive)"
	if n > 1 {
		tag += fmt.Sprintf("-%d", n)
	}
	return strings.TrimSuffix(name, ext) + tag + ext
}

type link struct {
	Path string `json:"path"`
	To   string `json:"to"`
}
type collision struct {
	Path       string `json:"path"`
	Local      string `json:"local"`
	Cloud      string `json:"cloud"`
	LocalSize  *int64 `json:"localSize"`
	CloudSize  *int64 `json:"cloudSize"`
	KeepBothAs string `json:"keepBothAs"`
}
type plan struct {
	Target     string      `json:"target"`
	Exists     bool        `json:"exists"`
	Cloud      bool        `json:"cloud"`
	Links      []link      `json:"links"`
	Collisions []collision `json:"collisions"`
	Merged     []string    `json:"merged"`
	Linked     int         `json:"linked"`
}

func freeName(target, rel string) (string, error) {
	for n := 1; ; n++ {
		name := filepath.Join(filepath.Dir(rel), renamed(filepath.Base(rel), n))
		_, err := os.Lstat(filepath.Join(target, name))
		if errors.Is(err, fs.ErrNotExist) {
			return name, nil
		}
		if err != nil {
			return "", err
		}
	}
}

func describe(i fs.FileInfo) (string, *int64) {
	if i.IsDir() {
		return "folder", nil
	}
	size := i.Size()
	if i.Mode()&fs.ModeSymlink != 0 {
		return "link", &size
	}
	return "file", &size
}

func (d drive) plan(target string, m *mount) (plan, error) {
	p := plan{Target: target, Exists: isDir(target), Cloud: isDir(d.cloud), Links: []link{}, Collisions: []collision{}, Merged: []string{}}
	if !p.Cloud {
		return p, nil
	}
	linked := map[string]bool{}
	if m != nil {
		for r, c := range m.Links {
			if !filepath.IsLocal(r) || !filepath.IsLocal(c) {
				return p, xerrors.New("invalid relative link in saved state")
			}
			if actual, err := os.Readlink(filepath.Join(target, r)); err == nil && actual == filepath.Join(d.cloud, c) {
				linked[c] = true
			}
		}
	}
	var walk func(string) error
	walk = func(rel string) error {
		entries, err := os.ReadDir(filepath.Join(d.cloud, rel))
		if err != nil {
			return err
		}
		for _, e := range entries {
			r := filepath.Join(rel, e.Name())
			src, dst := filepath.Join(d.cloud, r), filepath.Join(target, r)
			if linked[r] {
				p.Linked++
				continue
			}
			if dst == d.cloud || within(dst, d.config) || within(dst, d.backups) {
				return xerrors.Errorf("Cloud Drive entry %q overlaps a workspace control path", r)
			}
			i, err := os.Lstat(dst)
			if errors.Is(err, fs.ErrNotExist) {
				p.Links = append(p.Links, link{r, r})
				continue
			}
			if err != nil {
				return err
			}
			if to, _ := os.Readlink(dst); to == src {
				p.Linked++
				continue
			}
			si, err := e.Info()
			if err != nil {
				return err
			}
			if i.IsDir() && si.IsDir() {
				p.Merged = append(p.Merged, r)
				if err := walk(r); err != nil {
					return err
				}
				continue
			}
			name, err := freeName(target, r)
			if err != nil {
				return err
			}
			l, ls := describe(i)
			c, cs := describe(si)
			if c == "link" {
				if isDir(src) {
					c = "folder"
				} else {
					c = "file"
				}
			}
			p.Collisions = append(p.Collisions, collision{r, l, c, ls, cs, name})
		}
		return nil
	}
	err := walk("")
	return p, err
}

type result struct {
	Target      string              `json:"target"`
	Mode        string              `json:"mode"`
	Linked      int                 `json:"linked"`
	KeptBoth    []map[string]string `json:"keptBoth"`
	Overwritten []string            `json:"overwritten"`
	MovedTo     *string             `json:"movedTo"`
	Total       int                 `json:"total"`
}

type unresolved []string

func (unresolved) ExitCode() int { return 3 }

func (u unresolved) Error() string { return "choose how to handle: " + strings.Join(u, ", ") }

func (d drive) apply(s *mounts, target, mode string, decisions map[string]string, savedMode string) (result, error) {
	res := result{Target: target, Mode: mode, KeptBoth: []map[string]string{}, Overwritten: []string{}}
	if !slices.Contains([]string{"ask", "keep-both", "overwrite-all"}, mode) {
		return res, xerrors.Errorf("unknown collision mode %q", mode)
	}
	m := s.find(target)
	p, err := d.plan(target, m)
	if err != nil {
		return res, err
	}
	if !p.Cloud {
		return res, xerrors.New("the Cloud Drive is not connected to this workspace")
	}
	var missing unresolved
	for _, c := range p.Collisions {
		if mode == "ask" && decisions[c.Path] != "keep" && decisions[c.Path] != "overwrite" {
			missing = append(missing, c.Path)
		}
	}
	if len(missing) > 0 {
		return res, missing
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return res, err
	}
	root, err := os.OpenRoot(target)
	if err != nil {
		return res, err
	}
	defer root.Close()
	if m == nil {
		m = &mount{Target: target, Mode: mode, Created: float64(time.Now().UnixMilli()) / 1000, Links: map[string]string{}, Overwritten: map[string]string{}}
		s.Mounts = append(s.Mounts, m)
	}
	m.Mode = savedMode
	// Persist each intended link before changing the filesystem. A retry can finish an interrupted link
	// creation, and unmount can recover a file moved aside even if the process stopped before linking it.
	for _, l := range p.Links {
		m.Links[l.Path] = l.To
	}
	if err := d.save(s); err != nil {
		return res, err
	}
	for _, l := range p.Links {
		if err := root.Symlink(filepath.Join(d.cloud, l.To), l.Path); err != nil {
			return res, err
		}
		res.Linked++
	}
	for _, c := range p.Collisions {
		rel := c.Path
		if decisions[rel] == "overwrite" || (mode == "overwrite-all" && decisions[rel] != "keep") {
			if _, found := m.Overwritten[rel]; found {
				return res, xerrors.Errorf("a file at %s was already backed up; unmount before overwriting it again", rel)
			}
			if res.MovedTo == nil {
				if err := os.MkdirAll(d.backups, 0o700); err != nil {
					return res, err
				}
				dir, err := os.MkdirTemp(d.backups, time.Now().Format("20060102-150405-"))
				if err != nil {
					return res, err
				}
				res.MovedTo = &dir
			}
			dst := filepath.Join(target, rel)
			key := strings.TrimPrefix(dst, "/")
			if within(dst, d.home) {
				key, _ = filepath.Rel(d.home, dst)
			}
			aside := filepath.Join(*res.MovedTo, key)
			if err := os.MkdirAll(filepath.Dir(aside), 0o700); err != nil {
				return res, err
			}
			m.Overwritten[rel] = aside
			m.Links[rel] = rel
			if err := d.save(s); err != nil {
				return res, err
			}
			if err := moveLocal(dst, aside); err != nil {
				if _, statErr := os.Lstat(aside); errors.Is(statErr, fs.ErrNotExist) {
					delete(m.Overwritten, rel)
					delete(m.Links, rel)
					return res, errors.Join(err, d.save(s))
				}
				return res, err
			}
			res.Overwritten = append(res.Overwritten, rel)
		} else {
			rel, err = freeName(target, c.Path)
			if err != nil {
				return res, err
			}
			m.Links[rel] = c.Path
			if err := d.save(s); err != nil {
				return res, err
			}
			res.KeptBoth = append(res.KeptBoth, map[string]string{"path": c.Path, "as": rel})
		}
		if err := root.Symlink(filepath.Join(d.cloud, c.Path), rel); err != nil {
			return res, err
		}
	}
	res.Total = len(m.Links)
	return res, nil
}

func (d drive) removeLink(root *os.Root, rel, cloudRel string) (bool, error) {
	if !filepath.IsLocal(rel) || !filepath.IsLocal(cloudRel) {
		return false, xerrors.New("invalid path in saved mount")
	}
	dest, err := root.Readlink(rel)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, unix.EINVAL) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if dest != filepath.Join(d.cloud, cloudRel) {
		return false, nil
	}
	return true, root.Remove(rel)
}

func (d drive) unmount(s *mounts, target string) (any, error) {
	m := s.find(target)
	if m == nil {
		return nil, xerrors.Errorf("no Cloud Drive mount at %s", target)
	}
	root, err := os.OpenRoot(target)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	removed, restored, left := 0, 0, []string{}
	if root != nil {
		defer root.Close()
		for r, c := range m.Links {
			gone, err := d.removeLink(root, r, c)
			if err != nil {
				return nil, err
			}
			if gone {
				removed++
			}
		}
	}
	for r, aside := range m.Overwritten {
		if !filepath.IsLocal(r) || !within(aside, d.backups) {
			return nil, xerrors.New("invalid backup path in saved mount")
		}
		if _, err := os.Lstat(aside); errors.Is(err, fs.ErrNotExist) {
			continue
		} else if err != nil {
			return nil, err
		}
		if root == nil {
			left = append(left, aside)
			continue
		}
		if _, err := root.Lstat(r); errors.Is(err, fs.ErrNotExist) {
			if err := moveLocal(aside, filepath.Join(target, r)); err != nil {
				return nil, err
			}
			restored++
		} else if err != nil {
			return nil, err
		} else {
			left = append(left, aside)
		}
	}
	s.Mounts = slices.DeleteFunc(s.Mounts, func(a *mount) bool { return a == m })
	return map[string]any{"target": target, "removed": removed, "restored": restored, "left": left}, d.save(s)
}

func (d drive) sync(s *mounts) ([]any, error) {
	out := []any{}
	if !isDir(d.cloud) {
		return out, nil
	}
	var errs []error
	for _, m := range s.Mounts {
		target, err := d.target(m.Target)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		root, err := os.OpenRoot(target)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			errs = append(errs, err)
			continue
		}
		gone := 0
		for r, c := range m.Links {
			if !filepath.IsLocal(c) {
				errs = append(errs, xerrors.New("invalid mount link"))
				continue
			}
			if _, err := os.Lstat(filepath.Join(d.cloud, c)); errors.Is(err, fs.ErrNotExist) {
				if _, err := d.removeLink(root, r, c); err != nil {
					errs = append(errs, err)
					continue
				}
				delete(m.Links, r)
				gone++
			}
		}
		_ = root.Close()
		if gone > 0 {
			if err := d.save(s); err != nil {
				return out, err
			}
		}
		p, err := d.plan(target, m)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if len(p.Collisions)+len(p.Links) > 0 {
			mode := "keep-both"
			if m.Mode == "overwrite-all" {
				mode = m.Mode
			}
			r, err := d.apply(s, target, mode, nil, m.Mode)
			if err != nil {
				errs = append(errs, err)
				continue
			}
			out = append(out, r)
		} else if gone > 0 {
			out = append(out, map[string]any{"target": target, "removed": gone})
		}
	}
	return out, errors.Join(errs...)
}
