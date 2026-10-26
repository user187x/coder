//go:build linux

// The workspace VM launch gate runs before any code from the selected image.
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"syscall"
	"time"
)

func waitReady(ctx context.Context, path, nonce string, interval time.Duration) error {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		data, err := os.ReadFile(path)
		if err == nil && string(data) == nonce+"\n" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func main() {
	// This binary is statically linked and bound read-only by the guest root.
	// The image's shell and dynamic loader run only after private setup succeeds.
	if len(os.Args) != 3 || os.Args[1] != "--authorization" || len(os.Args[2]) != 64 {
		fmt.Fprintln(os.Stderr, "workspace authorization is invalid")
		os.Exit(1)
	}
	if _, err := hex.DecodeString(os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "workspace authorization is invalid")
		os.Exit(1)
	}
	if err := waitReady(context.Background(), "/etc/platform/private-authorization", os.Args[2], time.Second); err != nil {
		fmt.Fprintln(os.Stderr, "workspace initialization is unavailable")
		os.Exit(1)
	}
	if err := syscall.Exec("/bin/sh", []string{"/bin/sh", "/run/coder-vm/launch-user.sh"}, os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, "start workspace process:", err)
		os.Exit(1)
	}
}
