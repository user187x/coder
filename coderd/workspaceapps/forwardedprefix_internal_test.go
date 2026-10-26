package workspaceapps

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// Platform: a path-based app is told its base path (X-Forwarded-Prefix), without the trailing slash.
func TestForwardedPrefix(t *testing.T) {
	t.Parallel()
	require.Equal(t, "/@admin/skibbity.main/apps/nifi", forwardedPrefix("/@admin/skibbity.main/apps/nifi/"))
	require.Equal(t, "/@admin/skibbity.main/apps/nifi", forwardedPrefix("/@admin/skibbity.main/apps/nifi"))
	require.Equal(t, "X-Forwarded-Prefix", forwardedPrefixHeader)
}

func TestAppProxyHeaders(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, host, scheme, port string
		valid                    bool
	}{
		{"https", "nifi--main--ws--user.apps.example.com", "https", "443", true},
		{"http", "airflow--main--ws--user.apps.example.com:8080", "http", "8080", true},
		{"default_http", "airflow--main--ws--user.apps.example.com", "http", "80", true},
		{"empty_port", "apps.example.com:", "https", "", false},
		{"path", "apps.example.com/path", "https", "", false},
		{"credentials", "user@apps.example.com", "https", "", false},
		{"header", "apps.example.com\r\nX-Evil: yes", "https", "", false},
		{"port", "apps.example.com:99999", "https", "", false},
		{"scheme", "apps.example.com", "javascript", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest("GET", "https://dashboard.example.com/", nil)
			request.Host = tc.host
			for _, key := range []string{"X-ProxyHost", "X-ProxyScheme", "X-ProxyPort", "X-ProxyContextPath", "X-Forwarded-Context", forwardedPrefixHeader, "Forwarded"} {
				request.Header.Set(key, "attacker")
			}
			require.Equal(t, tc.valid, setAppProxyHeaders(request, tc.scheme))
			if !tc.valid {
				return
			}
			require.Equal(t, tc.scheme, request.Header.Get("X-ProxyScheme"))
			require.Equal(t, tc.port, request.Header.Get("X-ProxyPort"))
			require.NotContains(t, request.Header.Get("X-ProxyHost"), "attacker")
			require.Equal(t, tc.host, request.Header.Get("X-Forwarded-Host"))
			for _, key := range []string{"X-ProxyContextPath", "X-Forwarded-Context", forwardedPrefixHeader, "Forwarded"} {
				require.Empty(t, request.Header.Get(key))
			}
		})
	}
}
