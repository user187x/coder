package workspaceapps

import (
	"context"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"strings"
	"sync"

	"github.com/coder/quartz"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/workspaceapps/medialease"
)

// NekoMediaOptions accepts only infrastructure-authenticated runtime resolution.
// Client must be loaded by LoadNekoClient, never served from the workspace.
type NekoMediaOptions struct {
	Relay   *medialease.Manager
	Clock   quartz.Clock
	Client  *NekoClient
	Resolve func(context.Context, SignedToken, netip.Addr, uuid.UUID) (medialease.Binding, error)
	Cleanup func()
}

// NekoMedia owns trusted legacy signaling and relay lifecycle for the Neko app.
// Its session is the authenticated signaling WebSocket. Dashboard and API-key
// lifetimes remain governed by existing Coder app authentication; policy and
// runtime identities are checked independently on each media lease renewal.
type NekoMedia struct {
	options  NekoMediaOptions
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	closing  bool
	sessions sync.WaitGroup
}

// NewNekoMedia requires all trusted dependencies. Merely constructing a gateway
// opens no UDP socket; each authenticated signaling session owns its own lease.
func NewNekoMedia(options NekoMediaOptions) (*NekoMedia, error) {
	if options.Relay == nil || options.Clock == nil || options.Client == nil || options.Client.handler == nil || options.Resolve == nil {
		return nil, errors.New("neko media requires a relay, pinned client, clock, and trusted resolver")
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &NekoMedia{options: options, ctx: ctx, cancel: cancel}, nil
}

// Close revokes media before waiting for its authenticated signaling handlers.
func (n *NekoMedia) Close() error {
	n.mu.Lock()
	n.closing = true
	n.mu.Unlock()
	n.cancel()
	err := n.options.Relay.Close()
	n.sessions.Wait()
	if n.options.Cleanup != nil {
		n.options.Cleanup()
	}
	return err
}

func (s *Server) serveNeko(rw http.ResponseWriter, r *http.Request, token SignedToken, proxy *httputil.ReverseProxy) {
	// The generic proxy preserves selected wire header casing. Our WebSocket
	// endpoint parses headers itself and requires their canonical map keys.
	r = r.Clone(r.Context())
	headers := make(http.Header, len(r.Header))
	for name, values := range r.Header {
		key := http.CanonicalHeaderKey(name)
		headers[key] = append(headers[key], values...)
	}
	r.Header = headers
	n := s.NekoMedia
	if n == nil {
		http.Error(rw, "Trusted Neko media is disabled.", http.StatusServiceUnavailable)
		return
	}
	if token.AccessMethod != AccessMethodSubdomain || token.AppURL != "http://127.0.0.1:9080" {
		http.Error(rw, "Neko requires its reviewed owner-only subdomain app.", http.StatusForbidden)
		return
	}
	if r.URL.Path != "/ws" {
		// The supported pinned legacy client uses only its signaling socket. Do not
		// expose a second guest HTTP/WebSocket route around the signaling gateway.
		n.options.Client.ServeHTTP(rw, r)
		return
	}
	if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || token.Expiry == nil || len(r.URL.RawQuery) > 4096 {
		http.Error(rw, "Neko requires an authenticated WebSocket session.", http.StatusBadRequest)
		return
	}
	n.mu.Lock()
	if n.closing {
		n.mu.Unlock()
		http.Error(rw, "Neko media is stopping.", http.StatusServiceUnavailable)
		return
	}
	n.sessions.Add(1)
	n.mu.Unlock()
	defer n.sessions.Done()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(n.ctx, cancel)
	defer stop()
	var ip netip.Addr
	var err error
	if httpmw.RealIP(r.Context()) != nil {
		// Middleware already resolved the proxy chain. Reinterpreting its
		// forwarding headers against the final client would change the trust root.
		ip, err = netip.ParseAddr(r.RemoteAddr)
	} else {
		clientIP, extractErr := httpmw.ExtractRealIPAddress(s.RealIPConfig, r)
		var valid bool
		ip, valid = netip.AddrFromSlice(clientIP)
		err = extractErr
		if !valid {
			err = errors.New("neko client address is invalid")
		}
	}
	if err != nil {
		http.Error(rw, "Neko client address could not be verified.", http.StatusForbidden)
		return
	}
	sessionID := uuid.New()
	binding, err := n.options.Resolve(ctx, token, ip.Unmap(), sessionID)
	if err != nil {
		http.Error(rw, "Neko runtime and access could not be verified.", http.StatusServiceUnavailable)
		return
	}
	if binding.UserID != token.UserID || binding.WorkspaceID != token.WorkspaceID || binding.AgentID != token.AgentID || binding.ClientIP != ip.Unmap() || binding.SessionID != sessionID {
		http.Error(rw, "Neko runtime identity differs from authentication.", http.StatusForbidden)
		return
	}
	lease, err := n.options.Relay.Create(ctx, binding)
	if err != nil {
		http.Error(rw, "Neko relay could not be authorized.", http.StatusServiceUnavailable)
		return
	}
	defer lease.Close()
	// Apply the existing agent director, including its private agent identity
	// context, then use exactly that transport for the backend handshake.
	backendRequest := r.Clone(ctx)
	backendRequest.URL.Path = "/ws"
	proxy.Director(backendRequest)
	backendURL := *backendRequest.URL
	backendURL.Scheme = "ws"
	// The legacy endpoint authenticates through Coder and its query, not an
	// HTTP cookie or bearer token. Never forward Coder or internal credentials.
	headers = make(http.Header)
	for _, name := range []string{"User-Agent", "Origin", "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host"} {
		if value := backendRequest.Header.Get(name); value != "" {
			headers.Set(name, value)
		}
	}
	backend, resp, err := websocket.Dial(backendRequest.Context(), backendURL.String(), &websocket.DialOptions{
		HTTPClient: &http.Client{Transport: proxy.Transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, HTTPHeader: headers,
	})
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		http.Error(rw, "Neko signaling backend is unavailable.", http.StatusBadGateway)
		return
	}
	defer backend.CloseNow()
	browser, err := websocket.Accept(rw, r, nil)
	if err != nil {
		return
	}
	defer browser.CloseNow()
	backend.SetReadLimit(128 * 1024)
	browser.SetReadLimit(128 * 1024)
	group, sessionCtx := errgroup.WithContext(ctx)
	group.Go(func() error { return forwardNekoSignals(sessionCtx, backend, browser, lease, binding.Peer, true) })
	group.Go(func() error { return forwardNekoSignals(sessionCtx, browser, backend, lease, binding.Peer, false) })
	group.Go(func() error {
		ticker := n.options.Clock.NewTicker(n.options.Relay.Lifetime()/3, "neko-media-renewal")
		defer ticker.Stop()
		for {
			select {
			case <-sessionCtx.Done():
				return sessionCtx.Err()
			case <-lease.Done():
				return medialease.ErrClosed
			case <-ticker.C:
				if err := lease.Renew(sessionCtx); err != nil {
					return err
				}
			}
		}
	})
	_ = group.Wait()
}

func forwardNekoSignals(ctx context.Context, source, destination *websocket.Conn, lease *medialease.Lease, peer netip.AddrPort, toBrowser bool) error {
	for {
		kind, raw, err := source.Read(ctx)
		if err != nil {
			return err
		}
		if kind != websocket.MessageText {
			return errors.New("neko signaling requires JSON text")
		}
		rewritten, forward, err := rewriteNekoSignal(raw, lease.Credentials(), lease.RelayAddress(), peer, toBrowser)
		if err != nil {
			return err
		}
		if forward {
			if err := destination.Write(ctx, websocket.MessageText, rewritten); err != nil {
				return err
			}
		}
	}
}
