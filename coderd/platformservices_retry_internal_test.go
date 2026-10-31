package coderd

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"cdr.dev/slog/v3"
)

type platformTransportFunc func(*http.Request) (*http.Response, error)

func (f platformTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPlatformNetworkReadRecovery(t *testing.T) {
	t.Parallel()
	calls := 0
	transport := platformReadTransport{base: platformTransportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, "session", r.Header.Get("Coder-Session-Token"))
		status := http.StatusOK
		if calls == 1 {
			status = http.StatusServiceUnavailable
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("snapshot"))}, nil
	})}
	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://service/__coder-ui/api/network", nil)
	require.NoError(t, err)
	r.Header.Set("Coder-Session-Token", "session")
	response, err := transport.RoundTrip(r)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, 2, calls)
}

func TestPlatformNetworkReadDoesNotReplayOtherRequests(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		method, path, upgrade string
		status                int
	}{
		{http.MethodPost, "/__coder-ui/api/network", "", 503},
		{http.MethodGet, "/__coder-ui/api/chat/poll", "", 503},
		{http.MethodGet, "/__coder-ui/api/network", "websocket", 503},
		{http.MethodGet, "/__coder-ui/api/network", "", 401},
		{http.MethodGet, "/__coder-ui/api/network", "", 403},
		{http.MethodGet, "/__coder-ui/api/network", "", 500},
	} {
		t.Run(tc.method+tc.path+tc.upgrade+http.StatusText(tc.status), func(t *testing.T) {
			t.Parallel()
			calls := 0
			transport := platformReadTransport{base: platformTransportFunc(func(*http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: tc.status, Body: http.NoBody}, nil
			})}
			r, err := http.NewRequestWithContext(t.Context(), tc.method, "https://service"+tc.path, nil)
			require.NoError(t, err)
			r.Header.Set("Upgrade", tc.upgrade)
			response, err := transport.RoundTrip(r)
			require.NoError(t, err)
			defer response.Body.Close()
			require.Equal(t, tc.status, response.StatusCode)
			require.Equal(t, 1, calls)
		})
	}
}

func TestPlatformNetworkReadCancellation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	calls := 0
	transport := platformReadTransport{base: platformTransportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		cancel()
		return nil, ctx.Err()
	})}
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://service/__coder-ui/api/network", nil)
	require.NoError(t, err)
	response, err := transport.RoundTrip(r)
	if response != nil {
		defer response.Body.Close()
	}
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, calls)
}

func TestPlatformNetworkReadHTTP2(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("snapshot"))
	}))
	t.Cleanup(upstream.Close)
	target, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	proxy := platformServiceProxy(slog.Make(), target)
	frontend := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Body wrappers must not turn an empty HTTP/2 GET into a non-retryable request.
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		proxy.ServeHTTP(w, r)
	}))
	frontend.EnableHTTP2 = true
	frontend.StartTLS()
	t.Cleanup(frontend.Close)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, frontend.URL+"/__coder-ui/api/network", nil)
	require.NoError(t, err)
	res, err := frontend.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, 2, res.ProtoMajor)
	require.Equal(t, http.StatusOK, res.StatusCode)
	require.EqualValues(t, 2, calls.Load())
}

func TestPlatformNetworkReadBodyFraming(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		length   int64
		encoding []string
		want     bool
	}{
		{name: "wrapped empty", want: true},
		{name: "known body", length: 1},
		{name: "unknown body", length: -1},
		{name: "chunked body", encoding: []string{"chunked"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/__coder-ui/api/network", nil)
			r.Body = http.MaxBytesReader(httptest.NewRecorder(), r.Body, 1024)
			r.ContentLength = tc.length
			r.TransferEncoding = tc.encoding
			require.Equal(t, tc.want, isPlatformNetworkRead(r))
		})
	}
}
