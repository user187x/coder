//go:build linux

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWaitReady(t *testing.T) {
	t.Parallel()
	nonce := strings.Repeat("a", 64)
	for _, value := range []string{"", "false\n", "true\n", nonce, nonce + "\nextra", nonce + "\n"} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "ready")
			if err := os.WriteFile(path, []byte(value), 0o400); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			err := waitReady(ctx, path, nonce, time.Hour)
			if (err == nil) != (value == nonce+"\n") {
				t.Fatalf("waitReady returned %v", err)
			}
		})
	}
}
