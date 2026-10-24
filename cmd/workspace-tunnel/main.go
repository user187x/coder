//go:build linux

// workspace-tunnel runs the leased workspace overlay sidecar.
package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/coder/coder/v2/workspaceoverlay"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	service := os.Getenv("WORKSPACE_TUNNEL_URL")
	parsed, err := url.Parse(service)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return fmt.Errorf("WORKSPACE_TUNNEL_URL must use HTTPS")
	}
	token := os.Getenv("CODER_AGENT_TOKEN")
	podIP := os.Getenv("POD_IP")
	if token == "" || podIP == "" {
		return fmt.Errorf("CODER_AGENT_TOKEN and POD_IP are required")
	}
	key, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		return err
	}
	device := &workspaceoverlay.KernelDevice{Name: "coderwg", PrivateKey: key, Port: 51871}
	if err = device.Clear(); err != nil {
		return fmt.Errorf("clear previous overlay: %w", err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	runtime := &workspaceoverlay.Runtime{Client: &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, URL: service, Token: token, PublicKey: key.PublicKey().String(), Endpoint: podIP + ":51871", Device: device}
	return runtime.Run(ctx, func(err error) { fmt.Fprintln(os.Stderr, err) })
}
