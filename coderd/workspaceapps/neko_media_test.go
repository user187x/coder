package workspaceapps

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/quartz"
	"github.com/coder/websocket"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"
	"github.com/pion/turn/v5"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/jwtutils"
	"github.com/coder/coder/v2/coderd/workspaceapps/appurl"
	"github.com/coder/coder/v2/coderd/workspaceapps/medialease"
	"github.com/coder/coder/v2/testutil"
)

func trustedNekoClient(t *testing.T) (fstest.MapFS, string) {
	t.Helper()
	index := []byte("<html>trusted client</html>")
	assetSHA := sha256.Sum256(index)
	manifest, err := json.Marshal(map[string]any{"version": 1, "protocol": "neko-v3.1.6-legacy", "relay_only": true, "files": map[string]string{"index.html": hex.EncodeToString(assetSHA[:])}})
	require.NoError(t, err)
	manifestSHA := sha256.Sum256(manifest)
	return fstest.MapFS{"index.html": &fstest.MapFile{Data: index}, nekoClientManifest: &fstest.MapFile{Data: manifest}}, hex.EncodeToString(manifestSHA[:])
}

func TestNekoClientIsPinnedAndSnapshotsWorkspaceIndependentAssets(t *testing.T) {
	t.Parallel()
	files, pin := trustedNekoClient(t)
	handler, err := LoadNekoClient(files, pin)
	require.NoError(t, err)
	files["index.html"].Data = []byte("tampered after load")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "https://neko.test/", nil))
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, "<html>trusted client</html>", response.Body.String())
	require.Contains(t, response.Header().Get("Content-Security-Policy"), "connect-src 'self'")
	_, err = LoadNekoClient(files, pin)
	require.ErrorContains(t, err, "asset digest")
	_, err = LoadNekoClient(files, strings.Repeat("0", 64))
	require.ErrorContains(t, err, "manifest digest")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "https://neko.test/api/ws", nil))
	require.Equal(t, http.StatusNotFound, response.Code)
}

type nekoAgentDirectorKey struct{}
type nekoTestAgent struct {
	AgentProvider
	target   *url.URL
	directed chan bool
}
type nekoAgentTransport struct{ directed chan bool }

func (a nekoAgentTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	a.directed <- r.Context().Value(nekoAgentDirectorKey{}) == true
	return http.DefaultTransport.RoundTrip(r)
}
func (a nekoTestAgent) ReverseProxy(_, _ *url.URL, _ uuid.UUID, _ appurl.ApplicationURL, _ string) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(a.target)
	original := proxy.Director
	proxy.Director = func(r *http.Request) {
		*r = *r.WithContext(context.WithValue(r.Context(), nekoAgentDirectorKey{}, true))
		original(r)
	}
	proxy.Transport = nekoAgentTransport{a.directed}
	return proxy
}

func nekoRelayConfig(t *testing.T) medialease.Config {
	t.Helper()
	conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
	require.NoError(t, err)
	port := conn.LocalAddr().(*net.UDPAddr).AddrPort().Port()
	require.NoError(t, conn.Close())
	if port > 65520 {
		port = 50000
	}
	return medialease.Config{Enabled: true, BindIP: netip.MustParseAddr("127.0.0.1"), AdvertiseIP: netip.MustParseAddr("127.0.0.1"), ClientPrefixes: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}, PeerPrefixes: []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}, PortMin: port, PortMax: port + 7, MaxLeases: 1, Lifetime: 3 * time.Second, PacketsPerSecond: 10000, Clock: quartz.NewReal(),
		Guard: func(ctx context.Context, _ medialease.Binding) (context.Context, func(), error) {
			guard, cancel := context.WithCancel(ctx)
			return guard, cancel, nil
		},
		Check: func(context.Context, medialease.Binding) error { return nil }}
}

func TestNekoProxyRewritesTrustedICEAndRevokesActualMedia(t *testing.T) {
	t.Parallel()
	for _, cause := range []string{"guard-revoked", "fresh-policy-denied"} {
		t.Run(cause, func(t *testing.T) {
			t.Parallel()
			ctx := testutil.Context(t, testutil.WaitLong)
			peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
			require.NoError(t, err)
			defer peer.Close()
			peerAddr := peer.LocalAddr().(*net.UDPAddr).AddrPort()
			backendMessage := make(chan []byte, 1)
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/ws", r.URL.Path)
				require.Empty(t, r.Header.Get("X-Coder-Media-Descriptor-Key"))
				require.Empty(t, r.Header.Get("Coder-Session-Token"))
				require.Empty(t, r.Header.Get("Cookie"))
				connection, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer connection.CloseNow()
				message := map[string]any{"event": "signal/provide", "id": "guest-session", "lite": true, "ice": []map[string]string{{"urls": "stun:untrusted.example"}}, "sdp": "v=0\r\nm=audio 45678 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 203.0.113.5\r\na=candidate:1 1 udp 1 " + peerAddr.Addr().String() + " " + strconv.Itoa(int(peerAddr.Port())) + " typ host\r\na=candidate:2 1 udp 1 203.0.113.5 45678 typ host\r\n"}
				raw, err := json.Marshal(message)
				require.NoError(t, err)
				if connection.Write(ctx, websocket.MessageText, raw) != nil {
					return
				}
				_, raw, err = connection.Read(ctx)
				if err == nil {
					backendMessage <- raw
				}
				_, _, _ = connection.Read(ctx)
			}))
			defer backend.Close()
			backendURL, err := url.Parse(backend.URL)
			require.NoError(t, err)
			cfg := nekoRelayConfig(t)
			clock := quartz.NewMock(t)
			cfg.Clock = clock
			tickerTrap := clock.Trap().NewTicker("neko-media-renewal")
			var denied atomic.Bool
			cfg.Check = func(context.Context, medialease.Binding) error {
				if denied.Load() {
					return errors.New("policy unavailable or denied")
				}
				return nil
			}
			relay, err := medialease.New(cfg)
			require.NoError(t, err)
			files, pin := trustedNekoClient(t)
			client, err := LoadNekoClient(files, pin)
			require.NoError(t, err)
			token := SignedToken{UserID: uuid.New(), WorkspaceID: uuid.New(), AgentID: uuid.New(), AppURL: "http://127.0.0.1:9080", RegisteredClaims: jwtutils.RegisteredClaims{Expiry: jwt.NewNumericDate(time.Now().Add(time.Minute))}, Request: Request{AccessMethod: AccessMethodSubdomain, AppSlugOrPort: "neko"}}
			gateway, err := NewNekoMedia(NekoMediaOptions{Relay: relay, Clock: clock, Client: client,
				Resolve: func(_ context.Context, got SignedToken, ip netip.Addr, session uuid.UUID) (medialease.Binding, error) {
					require.Equal(t, token.UserID, got.UserID)
					require.Equal(t, token.WorkspaceID, got.WorkspaceID)
					return medialease.Binding{OrganizationID: uuid.New(), UserID: got.UserID, WorkspaceID: got.WorkspaceID, AgentID: got.AgentID, BuildID: uuid.New(), NodeUID: uuid.New(), VMUID: uuid.New(), VMIUID: uuid.New(), SessionID: session, AccessRevision: "reviewed-revision", ClientIP: ip, Peer: peerAddr}, nil
				}})
			require.NoError(t, err)
			defer gateway.Close()
			directed := make(chan bool, 2)
			revoked := make(chan context.CancelFunc, 1)
			s := NewServer(ServerOptions{Logger: testutil.Logger(t), DashboardURL: backendURL, AccessURL: backendURL, RealIPConfig: &httpmw.RealIPConfig{}, AgentProvider: nekoTestAgent{target: backendURL, directed: directed}, NekoMedia: gateway,
				GuardSession: func(ctx context.Context, user uuid.UUID) (context.Context, func(), error) {
					require.Equal(t, token.UserID, user)
					guard, cancel := context.WithCancel(ctx)
					revoked <- cancel
					return guard, cancel, nil
				}})
			handlerDone := make(chan struct{})
			proxy := httptest.NewServer(httpmw.ExtractRealIP(&httpmw.RealIPConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(handlerDone)
				s.proxyWorkspaceApp(w, r, token, "/ws", appurl.ApplicationURL{})
			})))
			defer proxy.Close()
			browser, _, err := websocket.Dial(ctx, strings.Replace(proxy.URL, "http://", "ws://", 1), &websocket.DialOptions{HTTPHeader: http.Header{"Coder-Session-Token": []string{"never-forward"}, "X-Coder-Media-Descriptor-Key": []string{"never-forward"}, "Cookie": []string{"NEKO_SESSION=never-forward"}}})
			require.NoError(t, err)
			defer browser.CloseNow()
			tickerTrap.MustWait(ctx).MustRelease(ctx)
			require.True(t, testutil.TryReceive(ctx, t, directed), "backend must retain the existing private agent transport context")
			_, raw, err := browser.Read(ctx)
			require.NoError(t, err)
			var offer struct {
				Event string `json:"event"`
				Lite  bool   `json:"lite"`
				SDP   string `json:"sdp"`
				ICE   []struct {
					URLs       []string `json:"urls"`
					Username   string   `json:"username"`
					Credential string   `json:"credential"`
				} `json:"ice"`
			}
			require.NoError(t, json.Unmarshal(raw, &offer))
			require.Len(t, offer.ICE, 1)
			require.False(t, offer.Lite)
			require.NotContains(t, string(raw), "untrusted.example")
			require.NotContains(t, offer.SDP, "203.0.113.5")
			require.Contains(t, offer.SDP, peerAddr.Addr().String())
			socket, err := net.ListenPacket("udp4", "127.0.0.1:0")
			require.NoError(t, err)
			defer socket.Close()
			turnAddress := strings.TrimSuffix(strings.TrimPrefix(offer.ICE[0].URLs[0], "turn:"), "?transport=udp")
			turnClient, err := turn.NewClient(&turn.ClientConfig{Conn: socket, TURNServerAddr: turnAddress, Username: offer.ICE[0].Username, Password: offer.ICE[0].Credential, RTO: 20 * time.Millisecond})
			require.NoError(t, err)
			defer turnClient.Close()
			require.NoError(t, turnClient.Listen())
			allocation, err := turnClient.Allocate()
			require.NoError(t, err)
			defer allocation.Close()
			candidate := map[string]any{"candidate": "candidate:1 1 udp 1 " + allocation.LocalAddr().(*net.UDPAddr).IP.String() + " " + strconv.Itoa(allocation.LocalAddr().(*net.UDPAddr).Port) + " typ relay", "sdpMid": "0", "sdpMLineIndex": 0}
			encoded, err := json.Marshal(candidate)
			require.NoError(t, err)
			answer, err := json.Marshal(map[string]string{"event": "signal/candidate", "data": string(encoded)})
			require.NoError(t, err)
			require.NoError(t, browser.Write(ctx, websocket.MessageText, answer))
			require.JSONEq(t, string(answer), string(testutil.TryReceive(ctx, t, backendMessage)))
			_, err = allocation.WriteTo([]byte("live-media"), peer.LocalAddr())
			require.NoError(t, err)
			require.NoError(t, peer.SetReadDeadline(time.Now().Add(testutil.WaitShort)))
			buffer := make([]byte, 1500)
			n, source, err := peer.ReadFrom(buffer)
			require.NoError(t, err)
			require.Equal(t, "live-media", string(buffer[:n]))
			cancel := testutil.TryReceive(ctx, t, revoked)
			if cause == "guard-revoked" {
				cancel()
			} else {
				denied.Store(true)
				clock.Advance(time.Second).MustWait(ctx)
			}
			testutil.TryReceive(ctx, t, handlerDone)
			_, err = peer.WriteTo([]byte("rogue-guest-ignores-revocation"), source)
			require.NoError(t, err)
			require.NoError(t, allocation.SetReadDeadline(time.Now().Add(50*time.Millisecond)))
			_, _, err = allocation.ReadFrom(buffer)
			require.Error(t, err)
			_, _, err = browser.Read(ctx)
			require.Error(t, err)
		})
	}
}

func TestNekoReservedAppDoesNotFallThroughWhenDisabled(t *testing.T) {
	t.Parallel()
	backend := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("disabled Neko reached guest HTTP") }))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	require.NoError(t, err)
	s := NewServer(ServerOptions{Logger: testutil.Logger(t), DashboardURL: target, AccessURL: target, RealIPConfig: &httpmw.RealIPConfig{}, AgentProvider: lockdownProxyAgent{}})
	token := SignedToken{AppURL: "http://127.0.0.1:9080", Request: Request{AppSlugOrPort: "neko", AccessMethod: AccessMethodSubdomain}}
	response := httptest.NewRecorder()
	httpmw.ExtractRealIP(&httpmw.RealIPConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.proxyWorkspaceApp(w, r, token, "/", appurl.ApplicationURL{})
	})).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://neko.test/", nil))
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
}

func TestNekoSignalDropsBypassCandidatesAndRejectsUnknownSignaling(t *testing.T) {
	t.Parallel()
	relay := netip.MustParseAddrPort("127.0.0.1:30001")
	peer := netip.MustParseAddrPort("10.0.0.5:59000")
	for _, candidate := range []string{"candidate:1 1 udp 1 192.168.1.2 12345 typ host", "candidate:1 1 udp 1 127.0.0.1 30002 typ relay", "candidate:1 1 tcp 1 127.0.0.1 30001 typ relay"} {
		payload, _ := json.Marshal(map[string]string{"candidate": candidate})
		raw, _ := json.Marshal(map[string]string{"event": "signal/candidate", "data": string(payload)})
		_, forward, err := rewriteNekoSignal(raw, medialease.Credentials{}, relay, peer, false)
		require.NoError(t, err)
		require.False(t, forward)
	}
	_, _, err := rewriteNekoSignal([]byte(`{"event":"signal/restart"}`), medialease.Credentials{}, relay, peer, true)
	require.Error(t, err)
}
