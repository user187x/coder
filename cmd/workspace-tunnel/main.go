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

	"golang.org/x/xerrors"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"

	"github.com/coder/coder/v2/workspaceoverlay"
)

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	service := os.Getenv("WORKSPACE_TUNNEL_URL")
	parsed, err := url.Parse(service)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return xerrors.New("WORKSPACE_TUNNEL_URL must use HTTPS")
	}
	token := os.Getenv("CODER_AGENT_TOKEN")
	podIP := os.Getenv("POD_IP")
	if token == "" || podIP == "" {
		return xerrors.New("CODER_AGENT_TOKEN and POD_IP are required")
	}
	key, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		return err
	}
	device := &workspaceoverlay.KernelDevice{Name: "coderwg", PrivateKey: key, Port: 51871, ForwardChain: os.Getenv("WORKSPACE_TUNNEL_FORWARD_CHAIN")}
	device.SocketScope, err = workspaceoverlay.ParseSocketScope(os.Getenv("WORKSPACE_TUNNEL_APP_PID"), os.Getenv("WORKSPACE_TUNNEL_APP_NETNS"), os.Getenv("WORKSPACE_TUNNEL_APP_ADDRESS"))
	if err != nil || device.SocketScope != nil && device.ForwardChain != "CODER_VM_TUNNEL" {
		return xerrors.New("invalid root-provided application socket scope")
	}
	if err = device.Clear(); err != nil {
		return xerrors.Errorf("clear previous overlay: %w", err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	runtime := &workspaceoverlay.Runtime{Client: &http.Client{Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, URL: service, Token: token, PublicKey: key.PublicKey().String(), Endpoint: podIP + ":51871", Device: device}
	if device.SocketScope == nil {
		// 2: ports may be mapped (PortRule.TargetPort)
		runtime.PortPolicyVersion = 2
	}
	return runtime.Run(ctx, func(err error) { _, _ = fmt.Fprintln(os.Stderr, err) })
}
