package workspacesdk

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	neturl "net/url"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-multierror"
	"golang.org/x/crypto/ssh"
	"golang.org/x/xerrors"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/speedtest"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/coderd/tracing"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/healthsdk"
	"github.com/coder/coder/v2/codersdk/wsjson"
	"github.com/coder/coder/v2/tailnet"
	"github.com/coder/websocket"
)

// NewAgentConn creates a new WorkspaceAgentConn. `conn` may be unique
// to the WorkspaceAgentConn, or it may be shared in the case of coderd. If the
// conn is shared and closing it is undesirable, you may return ErrNoClose from
// opts.CloseFunc. This will ensure the underlying conn is not closed.
func NewAgentConn(conn *tailnet.Conn, opts AgentConnOptions) AgentConn {
	return &agentConn{
		Conn: conn,
		opts: opts,
	}
}

// WrapAgentConn returns an AgentConn that delegates every operation to conn and
// applies closeFunc exactly once when the logical session is closed.
//
// If conn is nil, any provided closeFunc is invoked immediately so logical
// session cleanup is not silently dropped.
func WrapAgentConn(conn AgentConn, closeFunc func() error) AgentConn {
	if conn == nil {
		if closeFunc != nil {
			_ = closeFunc()
		}
		return nil
	}
	if closeFunc == nil {
		closeFunc = func() error { return nil }
	}
	return &wrappedAgentConn{AgentConn: conn, closeFunc: closeFunc}
}

type wrappedAgentConn struct {
	AgentConn
	closeFunc func() error
	closeOnce sync.Once
	closeErr  error
}

func (c *wrappedAgentConn) Close() error {
	c.closeOnce.Do(func() {
		// Close the underlying connection before releasing the logical session so
		// the lease remains held until teardown is complete.
		c.closeErr = errors.Join(c.AgentConn.Close(), c.closeFunc())
	})
	return c.closeErr
}

const (
	// CoderChatIDHeader is the HTTP header containing the current
	// chat ID. Set by coderd on agentconn requests originating
	// from chatd.
	CoderChatIDHeader = "Coder-Chat-Id"
	// CoderAncestorChatIDsHeader is the HTTP header containing a
	// JSON array of ancestor chat UUIDs.
	CoderAncestorChatIDsHeader = "Coder-Ancestor-Chat-Ids"
)

// AgentConn represents a connection to a workspace agent.
// @typescript-ignore AgentConn
type AgentConn interface {
	TailnetConn() *tailnet.Conn
	SetExtraHeaders(h http.Header)

	AwaitReachable(ctx context.Context) bool
	Close() error
	BundleFiles(ctx context.Context, req BundleFilesRequest) ([]byte, error)
	DebugLogs(ctx context.Context, opts ...DebugLogsOption) ([]byte, error)
	DebugMagicsock(ctx context.Context) ([]byte, error)
	DebugManifest(ctx context.Context) ([]byte, error)
	DialContext(ctx context.Context, network string, addr string) (net.Conn, error)
	AppHTTPClient() *http.Client
	GetPeerDiagnostics() tailnet.PeerDiagnostics
	ListContainers(ctx context.Context) (codersdk.WorkspaceAgentListContainersResponse, error)
	ListeningPorts(ctx context.Context) (codersdk.WorkspaceAgentListeningPortsResponse, error)
	Netcheck(ctx context.Context) (healthsdk.AgentNetcheckReport, error)
	Ping(ctx context.Context) (time.Duration, bool, *ipnstate.PingResult, error)
	PrometheusMetrics(ctx context.Context) ([]byte, error)
	ReconnectingPTY(ctx context.Context, id uuid.UUID, height uint16, width uint16, command string, initOpts ...AgentReconnectingPTYInitOption) (net.Conn, error)
	DeleteDevcontainer(ctx context.Context, devcontainerID string) error
	RecreateDevcontainer(ctx context.Context, devcontainerID string) (codersdk.Response, error)
	// Deprecated: Use SSHTCPConn instead.
	SSH(ctx context.Context) (*gonet.TCPConn, error)
	SSHTCPConn(ctx context.Context) (TCPConn, error)
	SSHClient(ctx context.Context) (*ssh.Client, error)
	SSHClientOnPort(ctx context.Context, port uint16) (*ssh.Client, error)
	SSHOnPort(ctx context.Context, port uint16) (*gonet.TCPConn, error)
	Speedtest(ctx context.Context, direction speedtest.Direction, duration time.Duration) ([]speedtest.Result, error)
	WatchContainers(ctx context.Context, logger slog.Logger) (<-chan codersdk.WorkspaceAgentListContainersResponse, io.Closer, error)
}

// AgentConn represents a connection to a workspace agent.
// @typescript-ignore AgentConn
type agentConn struct {
	*tailnet.Conn
	opts         AgentConnOptions
	headersMu    sync.RWMutex
	extraHeaders http.Header
}

func (c *agentConn) TailnetConn() *tailnet.Conn {
	return c.Conn
}

func (c *agentConn) SetExtraHeaders(h http.Header) {
	c.headersMu.Lock()
	c.extraHeaders = h
	c.headersMu.Unlock()
}

// @typescript-ignore AgentConnOptions
type AgentConnOptions struct {
	AgentID   uuid.UUID
	CloseFunc func() error
	Logger    slog.Logger
}

func (c *agentConn) agentAddress() netip.Addr {
	return tailnet.TailscaleServicePrefix.AddrFromUUID(c.opts.AgentID)
}

// AwaitReachable waits for the agent to be reachable.
func (c *agentConn) AwaitReachable(ctx context.Context) bool {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	return c.Conn.AwaitReachable(ctx, c.agentAddress())
}

// Ping pings the agent and returns the round-trip time.
// The bool returns true if the ping was made P2P.
func (c *agentConn) Ping(ctx context.Context) (time.Duration, bool, *ipnstate.PingResult, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	return c.Conn.Ping(ctx, c.agentAddress())
}

// Close ends the connection to the workspace agent.
func (c *agentConn) Close() error {
	var cerr error
	if c.opts.CloseFunc != nil {
		cerr = c.opts.CloseFunc()
		if xerrors.Is(cerr, ErrSkipClose) {
			return nil
		}
	}
	if cerr != nil {
		return multierror.Append(cerr, c.Conn.Close())
	}
	return c.Conn.Close()
}

// AgentReconnectingPTYInit initializes a new reconnecting PTY session.
// @typescript-ignore AgentReconnectingPTYInit
type AgentReconnectingPTYInit struct {
	ID      uuid.UUID
	Height  uint16
	Width   uint16
	Command string
	// Container, if set, will attempt to exec into a running container visible to the agent.
	// This should be a unique container ID (implementation-dependent).
	Container string
	// ContainerUser, if set, will set the target user when execing into a container.
	// This can be a username or UID, depending on the underlying implementation.
	// This is ignored if Container is not set.
	ContainerUser string

	BackendType string
}

// AgentReconnectingPTYInitOption is a functional option for AgentReconnectingPTYInit.
type AgentReconnectingPTYInitOption func(*AgentReconnectingPTYInit)

// AgentReconnectingPTYInitWithContainer sets the container and container user for the reconnecting PTY session.
func AgentReconnectingPTYInitWithContainer(container, containerUser string) AgentReconnectingPTYInitOption {
	return func(init *AgentReconnectingPTYInit) {
		init.Container = container
		init.ContainerUser = containerUser
	}
}

// ReconnectingPTYRequest is sent from the client to the server
// to pipe data to a PTY.
// @typescript-ignore ReconnectingPTYRequest
type ReconnectingPTYRequest struct {
	Data   string `json:"data,omitempty"`
	Height uint16 `json:"height,omitempty"`
	Width  uint16 `json:"width,omitempty"`
}

// ReconnectingPTY spawns a new reconnecting terminal session.
// `ReconnectingPTYRequest` should be JSON marshaled and written to the returned net.Conn.
// Raw terminal output will be read from the returned net.Conn.
func (c *agentConn) ReconnectingPTY(ctx context.Context, id uuid.UUID, height, width uint16, command string, initOpts ...AgentReconnectingPTYInitOption) (net.Conn, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	if !c.AwaitReachable(ctx) {
		return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
	}

	c.headersMu.RLock()
	extraHeaders := c.extraHeaders.Clone()
	c.headersMu.RUnlock()

	addr := netip.AddrPortFrom(c.agentAddress(), AgentHTTPAPIServerPort)
	conn, err := DialTCPUpgrade(ctx, addr.String(), c.apiClient(ctx), extraHeaders, AgentReconnectingPTYPort)
	if errors.Is(err, ErrAgentTCPUpgradeUnsupported) {
		// Fall back to dialing the port directly.
		conn, err = c.DialContextTCP(ctx, netip.AddrPortFrom(c.agentAddress(), AgentReconnectingPTYPort))
	}
	if err != nil {
		return nil, err
	}
	rptyInit := AgentReconnectingPTYInit{
		ID:      id,
		Height:  height,
		Width:   width,
		Command: command,
	}
	for _, o := range initOpts {
		o(&rptyInit)
	}
	data, err := json.Marshal(rptyInit)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	data = append(make([]byte, 2), data...)
	// #nosec G115 - Safe conversion as the data length is expected to be within uint16 range for PTY initialization
	binary.LittleEndian.PutUint16(data, uint16(len(data)-2))

	_, err = conn.Write(data)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

// SSH pipes the SSH protocol over the returned gonet.TCPConn.
// This connects to the built-in SSH server in the workspace agent.
func (c *agentConn) SSH(ctx context.Context) (*gonet.TCPConn, error) {
	return c.SSHOnPort(ctx, AgentSSHPort)
}

// SSHTCPConn makes an HTTP request with the client session ID that then
// upgrades into an SSH connection.  If the agent does not support the endpoint,
// falls back to dialing the port directly.
func (c *agentConn) SSHTCPConn(ctx context.Context) (TCPConn, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	if !c.AwaitReachable(ctx) {
		return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
	}

	c.SendConnectedTelemetry(c.agentAddress(), tailnet.TelemetryApplicationSSH)

	c.headersMu.RLock()
	extraHeaders := c.extraHeaders.Clone()
	c.headersMu.RUnlock()

	addr := netip.AddrPortFrom(c.agentAddress(), AgentHTTPAPIServerPort)
	conn, err := DialTCPUpgrade(ctx, addr.String(), c.apiClient(ctx), extraHeaders, AgentStandardSSHPort)
	if errors.Is(err, ErrAgentTCPUpgradeUnsupported) {
		// Fall back to dialing the port directly.
		return c.DialContextTCP(ctx, netip.AddrPortFrom(c.agentAddress(), AgentStandardSSHPort))
	}
	return conn, err
}

// SSHOnPort pipes the SSH protocol over the returned net.Conn.
// This connects to the built-in SSH server in the workspace agent on the specified port.
func (c *agentConn) SSHOnPort(ctx context.Context, port uint16) (*gonet.TCPConn, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	if !c.AwaitReachable(ctx) {
		return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
	}

	c.SendConnectedTelemetry(c.agentAddress(), tailnet.TelemetryApplicationSSH)
	return c.DialContextTCP(ctx, netip.AddrPortFrom(c.agentAddress(), port))
}

// SSHClient makes an HTTP request with the client session ID that then upgrades
// into an SSH client connection.  If the agent does not support the endpoint,
// falls back to dialing the port directly.
func (c *agentConn) SSHClient(ctx context.Context) (*ssh.Client, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	netConn, err := c.SSHTCPConn(ctx)
	if err != nil {
		return nil, xerrors.Errorf("ssh: %w", err)
	}

	sshConn, channels, requests, err := ssh.NewClientConn(netConn, "localhost:22", &ssh.ClientConfig{
		// SSH host validation isn't helpful, because obtaining a peer
		// connection already signifies user-intent to dial a workspace.
		// #nosec
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		return nil, xerrors.Errorf("ssh conn: %w", err)
	}

	return ssh.NewClient(sshConn, channels, requests), nil
}

// SSHClientOnPort calls SSH to create a client on a specific port
func (c *agentConn) SSHClientOnPort(ctx context.Context, port uint16) (*ssh.Client, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	netConn, err := c.SSHOnPort(ctx, port)
	if err != nil {
		return nil, xerrors.Errorf("ssh: %w", err)
	}

	sshConn, channels, requests, err := ssh.NewClientConn(netConn, "localhost:22", &ssh.ClientConfig{
		// SSH host validation isn't helpful, because obtaining a peer
		// connection already signifies user-intent to dial a workspace.
		// #nosec
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		return nil, xerrors.Errorf("ssh conn: %w", err)
	}

	return ssh.NewClient(sshConn, channels, requests), nil
}

type TCPConn interface {
	net.Conn
	CloseWrite() error
}

var ErrAgentTCPUpgradeUnsupported = xerrors.New("agent does not support the tcp upgrade endpoint")

// DialTCPUpgrade dials the agent's /tcp HTTP endpoint which allows sending
// extra data to the agent via headers.  These must include the client session
// ID or the connection will be refused.  The agent will then upgrade the
// connection based on the port.  Returns ErrAgentTCPUpgradeUnsupported if the
// agent does not support the endpoint.
func DialTCPUpgrade(ctx context.Context, addr string, client *http.Client, headers http.Header, port uint16) (TCPConn, error) {
	apiURL := fmt.Sprintf("http://%s/api/v0/tcp/%d", addr, port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, xerrors.Errorf("new http api request to %q: %w", apiURL, err)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "tcp")

	// The client session ID baggage is found in the extra headers.
	for k, v := range headers {
		req.Header[k] = v
	}

	//nolint:bodyclose // On success the caller is responsible for closing.
	resp, err := client.Do(req)
	if err != nil {
		return nil, xerrors.Errorf("do upgrade request to %q: %w", apiURL, err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		_ = resp.Body.Close()
		return nil, ErrAgentTCPUpgradeUnsupported
	}

	respBody := resp.Body
	conn, ok := respBody.(rawConn)
	if !ok {
		_ = respBody.Close()
		return nil, xerrors.Errorf("response body is not a rawConn: %T", respBody)
	}

	return &upgradedConn{
		rawConn:    conn,
		remoteAddr: upgradeAddr{"tcp", addr},
		// For now setting a fake local address.
		localAddr: upgradeAddr{"ssh", "ssh"},
	}, nil
}

type rawConn interface {
	io.ReadWriteCloser
	CloseWrite() error
}

type upgradedConn struct {
	rawConn
	remoteAddr net.Addr
	localAddr  net.Addr
}

func (u *upgradedConn) LocalAddr() net.Addr              { return u.localAddr }
func (u *upgradedConn) RemoteAddr() net.Addr             { return u.remoteAddr }
func (*upgradedConn) SetDeadline(_ time.Time) error      { return nil }
func (*upgradedConn) SetReadDeadline(_ time.Time) error  { return nil }
func (*upgradedConn) SetWriteDeadline(_ time.Time) error { return nil }

type upgradeAddr struct {
	network string
	addr    string
}

func (u upgradeAddr) Network() string { return u.network }
func (u upgradeAddr) String() string  { return u.addr }

// Speedtest runs a speedtest against the workspace agent.
func (c *agentConn) Speedtest(ctx context.Context, direction speedtest.Direction, duration time.Duration) ([]speedtest.Result, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	if !c.AwaitReachable(ctx) {
		return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
	}

	c.SendConnectedTelemetry(c.agentAddress(), tailnet.TelemetryApplicationSpeedtest)
	speedConn, err := c.DialContextTCP(ctx, netip.AddrPortFrom(c.agentAddress(), AgentSpeedtestPort))
	if err != nil {
		return nil, xerrors.Errorf("dial speedtest: %w", err)
	}

	results, err := speedtest.RunClientWithConn(direction, duration, speedConn)
	if err != nil {
		return nil, xerrors.Errorf("run speedtest: %w", err)
	}

	return results, err
}

// DialContext dials the address provided in the workspace agent.
// The network must be "tcp" or "udp".
func (c *agentConn) DialContext(ctx context.Context, network string, addr string) (net.Conn, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	if !c.AwaitReachable(ctx) {
		return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
	}

	_, rawPort, _ := net.SplitHostPort(addr)
	port, _ := strconv.ParseUint(rawPort, 10, 16)
	ipp := netip.AddrPortFrom(c.agentAddress(), uint16(port))

	switch network {
	case "tcp":
		return c.DialContextTCP(ctx, ipp)
	case "udp":
		return c.DialContextUDP(ctx, ipp)
	default:
		return nil, xerrors.Errorf("unknown network %q", network)
	}
}

// AppHTTPClient returns an HTTP client for reaching HTTP apps served by this
// workspace agent. Redirects are blocked to prevent misuse.
func (c *agentConn) AppHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			// Disable keep-alives so these short-lived clients don't leave
			// idle connections (and their goroutines) lingering after they're
			// discarded.
			DisableKeepAlives: true,
			// Host locked to agent, port from URL.
			DialContext: c.DialContext,
		},
	}
}

// ListeningPorts lists the ports that are currently in use by the workspace.
func (c *agentConn) ListeningPorts(ctx context.Context) (codersdk.WorkspaceAgentListeningPortsResponse, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/api/v0/listening-ports", nil)
	if err != nil {
		return codersdk.WorkspaceAgentListeningPortsResponse{}, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return codersdk.WorkspaceAgentListeningPortsResponse{}, codersdk.ReadBodyAsError(res)
	}

	var resp codersdk.WorkspaceAgentListeningPortsResponse
	return resp, decodeAgentJSON(res, &resp)
}

// Netcheck returns a network check report from the workspace agent.
func (c *agentConn) Netcheck(ctx context.Context) (healthsdk.AgentNetcheckReport, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/api/v0/netcheck", nil)
	if err != nil {
		return healthsdk.AgentNetcheckReport{}, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return healthsdk.AgentNetcheckReport{}, codersdk.ReadBodyAsError(res)
	}

	var resp healthsdk.AgentNetcheckReport
	return resp, decodeAgentJSON(res, &resp)
}

// DebugMagicsock makes a request to the workspace agent's magicsock debug endpoint.
func (c *agentConn) DebugMagicsock(ctx context.Context) ([]byte, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/debug/magicsock", nil)
	if err != nil {
		return nil, xerrors.Errorf("do request: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		return nil, codersdk.ReadBodyAsError(res)
	}
	defer res.Body.Close()
	bs, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, xerrors.Errorf("read response body: %w", err)
	}
	return bs, nil
}

// DebugManifest returns the agent's in-memory manifest. Unfortunately this must
// be returns as a []byte to avoid an import cycle.
func (c *agentConn) DebugManifest(ctx context.Context) ([]byte, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/debug/manifest", nil)
	if err != nil {
		return nil, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, codersdk.ReadBodyAsError(res)
	}
	bs, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, xerrors.Errorf("read response body: %w", err)
	}
	return bs, nil
}

// BundleFilesRequest configures a workspace-side file collection.
type BundleFilesRequest struct {
	Paths []string `json:"paths"`
}

// BundleFilesManifest is the manifest.json of the archive returned by
// BundleFiles.
type BundleFilesManifest struct {
	Requested []string                   `json:"requested"`
	Files     []BundleFilesManifestEntry `json:"files"`
	Errors    []BundleFilesManifestError `json:"errors"`
	Truncated bool                       `json:"truncated"`
	Limits    BundleFilesLimits          `json:"limits"`
}

// BundleFilesManifestEntry describes one file collected into the archive.
type BundleFilesManifestEntry struct {
	Requested    string    `json:"requested"`
	Path         string    `json:"path"`
	ArchivePath  string    `json:"archive_path"`
	Size         int64     `json:"size"`
	ModTime      time.Time `json:"mod_time"`
	BytesWritten int64     `json:"bytes_written"`
	Truncated    bool      `json:"truncated"`
}

// BundleFilesManifestError records a path that could not be collected.
type BundleFilesManifestError struct {
	Requested string `json:"requested"`
	Path      string `json:"path,omitempty"`
	Reason    string `json:"reason"`
}

// BundleFilesLimits are the collection limits the agent applied.
type BundleFilesLimits struct {
	MaxFiles        int   `json:"max_files"`
	MaxBytesPerFile int64 `json:"max_bytes_per_file"`
	MaxTotalBytes   int64 `json:"max_total_bytes"`
}

// bundleFilesResponseMaxBytes guards against a misbehaving agent; the
// agent itself caps collection at 100 MiB.
const bundleFilesResponseMaxBytes int64 = 110 * 1024 * 1024

// BundleFiles returns a tar archive of explicitly requested workspace
// files.
func (c *agentConn) BundleFiles(ctx context.Context, req BundleFilesRequest) ([]byte, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodPost, "/api/v0/bundle-files", req)
	if err != nil {
		return nil, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, codersdk.ReadBodyAsError(res)
	}
	bs, err := io.ReadAll(io.LimitReader(res.Body, bundleFilesResponseMaxBytes+1))
	if err != nil {
		return nil, xerrors.Errorf("read response body: %w", err)
	}
	if int64(len(bs)) > bundleFilesResponseMaxBytes {
		return nil, xerrors.Errorf("response exceeds %d bytes", bundleFilesResponseMaxBytes)
	}
	return bs, nil
}

// DebugLogsOption configures a DebugLogs request.
type DebugLogsOption func(*debugLogsConfig)

type debugLogsConfig struct {
	after time.Time
}

// WithLogsAfter also returns rotated logs modified at or after t, separated by
// boundary markers (100 MiB combined cap).
func WithLogsAfter(t time.Time) DebugLogsOption {
	return func(c *debugLogsConfig) { c.after = t }
}

// DebugLogs returns up to 10 MiB of the active agent log. Pass WithLogsAfter to
// also include rotated logs.
func (c *agentConn) DebugLogs(ctx context.Context, opts ...DebugLogsOption) ([]byte, error) {
	var cfg debugLogsConfig
	for _, opt := range opts {
		opt(&cfg)
	}
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, debugLogsPath(cfg.after), nil)
	if err != nil {
		return nil, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, codersdk.ReadBodyAsError(res)
	}
	bs, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, xerrors.Errorf("read response body: %w", err)
	}
	return bs, nil
}

func debugLogsPath(after time.Time) string {
	query := neturl.Values{}
	if !after.IsZero() {
		query.Set("after", after.UTC().Format(time.RFC3339Nano))
	}
	return agentAPIPath("/debug/logs", query)
}

// PrometheusMetrics returns a response from the agent's prometheus metrics endpoint
func (c *agentConn) PrometheusMetrics(ctx context.Context) ([]byte, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/debug/prometheus", nil)
	if err != nil {
		return nil, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, codersdk.ReadBodyAsError(res)
	}
	bs, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, xerrors.Errorf("read response body: %w", err)
	}
	return bs, nil
}

// ListContainers returns a response from the agent's containers endpoint
func (c *agentConn) ListContainers(ctx context.Context) (codersdk.WorkspaceAgentListContainersResponse, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodGet, "/api/v0/containers", nil)
	if err != nil {
		return codersdk.WorkspaceAgentListContainersResponse{}, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return codersdk.WorkspaceAgentListContainersResponse{}, codersdk.ReadBodyAsError(res)
	}
	var resp codersdk.WorkspaceAgentListContainersResponse
	return resp, decodeAgentJSON(res, &resp)
}

func (c *agentConn) WatchContainers(ctx context.Context, logger slog.Logger) (<-chan codersdk.WorkspaceAgentListContainersResponse, io.Closer, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	host := net.JoinHostPort(c.agentAddress().String(), strconv.Itoa(AgentHTTPAPIServerPort))
	url := fmt.Sprintf("http://%s%s", host, "/api/v0/containers/watch")

	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPClient: c.apiClient(ctx),

		// We want `NoContextTakeover` compression to balance improving
		// bandwidth cost/latency with minimal memory usage overhead.
		CompressionMode: websocket.CompressionNoContextTakeover,
	})
	if err != nil {
		if res == nil {
			return nil, nil, err
		}
		return nil, nil, codersdk.ReadBodyAsError(res)
	}
	if res != nil && res.Body != nil {
		defer res.Body.Close()
	}

	// When a workspace has a few devcontainers running, or a single devcontainer
	// has a large amount of apps, then each payload can easily exceed 32KiB.
	// We up the limit to 4MiB to give us plenty of headroom for workspaces that
	// have lots of dev containers with lots of apps.
	conn.SetReadLimit(1 << 22) // 4MiB

	d := wsjson.NewDecoder[codersdk.WorkspaceAgentListContainersResponse](conn, websocket.MessageText, logger)
	return d.Chan(), d, nil
}

// DeleteDevcontainer deletes the provided devcontainer.
// This is a blocking call and will wait for the container to be deleted.
func (c *agentConn) DeleteDevcontainer(ctx context.Context, devcontainerID string) error {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodDelete, "/api/v0/containers/devcontainers/"+devcontainerID, nil)
	if err != nil {
		return xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return codersdk.ReadBodyAsError(res)
	}
	return nil
}

// RecreateDevcontainer recreates a devcontainer with the given container.
// This is a blocking call and will wait for the container to be recreated.
func (c *agentConn) RecreateDevcontainer(ctx context.Context, devcontainerID string) (codersdk.Response, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()
	res, err := c.apiRequest(ctx, http.MethodPost, "/api/v0/containers/devcontainers/"+devcontainerID+"/recreate", nil)
	if err != nil {
		return codersdk.Response{}, xerrors.Errorf("do request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		return codersdk.Response{}, codersdk.ReadBodyAsError(res)
	}
	var m codersdk.Response
	if err := decodeAgentJSON(res, &m); err != nil {
		return codersdk.Response{}, xerrors.Errorf("decode response body: %w", err)
	}
	return m, nil
}

func agentAPIPath(path string, query neturl.Values) string {
	if len(query) == 0 {
		return path
	}

	return path + "?" + query.Encode()
}

// apiRequest makes a request to the workspace agent's HTTP API server.
func (c *agentConn) apiRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	return c.apiRequestWithHeader(ctx, method, path, body, nil)
}

func (c *agentConn) apiRequestWithHeader(ctx context.Context, method, path string, body interface{}, header http.Header) (*http.Response, error) {
	ctx, span := tracing.StartSpan(ctx)
	defer span.End()

	host := net.JoinHostPort(c.agentAddress().String(), strconv.Itoa(AgentHTTPAPIServerPort))
	url := fmt.Sprintf("http://%s%s", host, path)

	var r io.Reader
	if body != nil {
		switch data := body.(type) {
		case io.Reader:
			r = data
		case []byte:
			r = bytes.NewReader(data)
		default:
			// Assume JSON in all other cases.
			buf := bytes.NewBuffer(nil)
			enc := json.NewEncoder(buf)
			enc.SetEscapeHTML(false)
			err := enc.Encode(body)
			if err != nil {
				return nil, xerrors.Errorf("encode body: %w", err)
			}
			r = buf
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, url, r)
	if err != nil {
		return nil, xerrors.Errorf("new http api request to %q: %w", url, err)
	}

	c.headersMu.RLock()
	extraHeaders := c.extraHeaders.Clone()
	c.headersMu.RUnlock()
	for key, values := range extraHeaders {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	for key, values := range header {
		req.Header[key] = values
	}

	return c.apiClient(ctx).Do(req)
}

// decodeAgentJSON decodes an agent-direct HTTP response body. Agent
// endpoints are served by the workspace agent over tailnet, not the
// Coder control plane, so no reverse proxy or SSO portal can intercept
// the response and codersdk.ReadBodyAsJSON's proxy/SSO-oriented error
// guidance would be misleading here.
//
//nolint:gocritic // See doc comment.
func decodeAgentJSON(res *http.Response, v any) error {
	return json.NewDecoder(res.Body).Decode(v)
}

// apiClient returns an HTTP client that can be used to make
// requests to the workspace agent's HTTP API server. The client is
// scoped to a single request: its transport cancels in-flight dials
// once reqCtx ends.
func (c *agentConn) apiClient(reqCtx context.Context) *http.Client {
	agentAddr := netip.AddrPortFrom(c.agentAddress(), AgentHTTPAPIServerPort)
	return &http.Client{
		// Redirects are blocked to prevent misuse.
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			// Disable keep alives as we're usually only making a single
			// request, and this triggers goleak in tests
			DisableKeepAlives: true,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				if network != "tcp" {
					return nil, xerrors.Errorf("network must be tcp")
				}

				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, xerrors.Errorf("split host port %q: %w", addr, err)
				}
				if port != strconv.Itoa(AgentHTTPAPIServerPort) {
					return nil, xerrors.Errorf("request %q does not appear to be for http api", addr)
				}
				if reqAddr, err := netip.ParseAddr(host); err != nil || reqAddr != agentAddr.Addr() {
					c.opts.Logger.Warn(ctx, "blocked workspace agent API request to unintended host",
						slog.F("agent_id", c.opts.AgentID),
						slog.F("request_host", host),
						slog.F("intended_agent_addr", agentAddr.Addr()),
					)
					return nil, xerrors.Errorf("request host %q does not match intended agent %q", host, agentAddr.Addr())
				}

				// http.Transport detaches ctx from the request context so
				// a pending dial can outlive its request and serve future
				// requests. This client is request-scoped with keep-alives
				// disabled, so a detached dial can never be reused. Without
				// re-linking cancellation, a canceled request would leave
				// the dial blocked in AwaitReachable until the agent becomes
				// reachable, which may be never.
				ctx, cancel := context.WithCancel(ctx)
				defer cancel()
				stop := context.AfterFunc(reqCtx, cancel)
				defer stop()

				if !c.AwaitReachable(ctx) {
					return nil, xerrors.Errorf("workspace agent not reachable in time: %v", ctx.Err())
				}

				// Always dial the pinned agent address, never the request host.
				conn, err := c.DialContextTCP(ctx, agentAddr)
				if err != nil {
					return nil, xerrors.Errorf("dial http api: %w", err)
				}

				return conn, nil
			},
		},
	}
}

func (c *agentConn) GetPeerDiagnostics() tailnet.PeerDiagnostics {
	return c.Conn.GetPeerDiagnostics(c.opts.AgentID)
}
