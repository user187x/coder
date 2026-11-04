//go:build linux

// The workspace-platform binary runs deployment-managed commands in a workspace pod.
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"golang.org/x/xerrors"

	workspacelockdown "github.com/coder/coder/v2/cmd/workspace-platform/internal/lockdown"
)

const toolsDir = "/opt/coder-platform"

func install() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	src, err := os.Open(self)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp, err := os.CreateTemp(toolsDir, ".install-")
	if err != nil {
		return err
	}
	path := tmp.Name()
	defer func() { _ = os.Remove(path) }()
	if _, err := io.Copy(tmp, src); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(path, filepath.Join(toolsDir, "workspace-platform"))
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return xerrors.New("expected a workspace platform command")
	}
	switch args[0] {
	case "install":
		return install()
	case "init-lockdown":
		if err := install(); err != nil {
			return err
		}
		return workspacelockdown.Run(ctx, args[1:], os.Stdout)
	case "lockdown":
		return workspacelockdown.Run(ctx, args[1:], os.Stdout)
	default:
		return xerrors.Errorf("unknown workspace platform command %q", args[0])
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	err := run(ctx, os.Args[1:])
	stop()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
