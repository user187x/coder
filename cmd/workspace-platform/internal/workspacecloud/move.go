//go:build linux

package workspacecloud

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
	"golang.org/x/xerrors"
)

// moveLocal never replaces a file created since the collision was detected. When the
// destination is on another volume, publish a complete copy before removing the original.
func moveLocal(from, to string) error {
	err := unix.Renameat2(unix.AT_FDCWD, from, unix.AT_FDCWD, to, unix.RENAME_NOREPLACE)
	if !errors.Is(err, unix.EXDEV) {
		return err
	}
	temp, err := os.MkdirTemp(filepath.Dir(to), ".cloud-drive-copy-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	stage := filepath.Join(temp, "saved")
	if err := copyLocal(from, stage); err != nil {
		return err
	}
	if err := unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, to, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	return os.RemoveAll(from)
}

func copyLocal(src, dst string) error {
	i, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case i.Mode()&os.ModeSymlink != 0:
		to, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(to, dst)
	case i.IsDir():
		if err := os.Mkdir(dst, 0o700); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if err := copyLocal(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
	case i.Mode().IsRegular():
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		if err := errors.Join(copyErr, out.Sync(), out.Close()); err != nil {
			return err
		}
	default:
		return xerrors.Errorf("cannot back up special file %s across volumes", src)
	}
	if err := os.Chmod(dst, i.Mode().Perm()); err != nil {
		return err
	}
	return os.Chtimes(dst, i.ModTime(), i.ModTime())
}
