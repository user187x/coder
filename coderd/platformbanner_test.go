package coderd_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/websocket"
)

// bannerCall is a request to /__banner as the dashboard makes it: its own
// header and JSON for a change, the session in Coder-Session-Token.
func bannerCall(ctx context.Context, t *testing.T, c *codersdk.Client, method, path string, body any, edit func(*http.Request)) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.URL.String()+"/__banner"+path, rd)
	require.NoError(t, err)
	if method == http.MethodPost {
		req.Header.Set("X-Requested-With", "coder-banner-admin")
		req.Header.Set("Content-Type", "application/json")
	}
	if tok := c.SessionToken(); tok != "" {
		req.Header.Set(codersdk.SessionTokenHeader, tok)
	}
	if edit != nil {
		edit(req)
	}
	res, err := c.HTTPClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func bannerOf(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	b, ok := m["banner"].(map[string]any)
	require.True(t, ok, "%v", m)
	return b
}

// The announcement banner, served by coderd itself (it was a service of its
// own behind Traefik body rewrites): public banner.json and live socket, admin
// calls for those who may edit the deployment's settings.
func TestPlatformBanner(t *testing.T) {
	t.Parallel()
	client := coderdtest.New(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	anon := codersdk.New(client.URL)
	ctx := testutil.Context(t, testutil.WaitLong)

	// before anything is published: no banner, an id all the same
	code, b := bannerCall(ctx, t, anon, http.MethodGet, "/banner.json", nil, nil)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, false, b["enabled"])
	require.Len(t, b["id"], 12)

	// the live socket: the banner at once
	wsURL := strings.Replace(client.URL.String(), "http", "ws", 1) + "/__banner/live"
	conn, _, err := websocket.Dial(ctx, wsURL, nil) //nolint:bodyclose
	require.NoError(t, err)
	defer conn.Close(websocket.StatusNormalClosure, "")
	next := func() map[string]any {
		t.Helper()
		for {
			_, raw, err := conn.Read(ctx)
			require.NoError(t, err)
			var m map[string]any
			require.NoError(t, json.Unmarshal(raw, &m))
			if m["type"] == "banner" {
				return bannerOf(t, m)
			}
		}
	}
	require.Equal(t, b["id"], next()["id"])

	// who may do what
	code, out := bannerCall(ctx, t, anon, http.MethodGet, "/api/state", nil, nil)
	require.Equal(t, http.StatusUnauthorized, code)
	require.Equal(t, "Sign in to Coder first.", out["error"])
	code, out = bannerCall(ctx, t, member, http.MethodGet, "/api/state", nil, nil)
	require.Equal(t, http.StatusForbidden, code)
	require.Equal(t, "Only Coder admins can change the banner.", out["error"])
	code, out = bannerCall(ctx, t, member, http.MethodPost, "/api/banner", map[string]any{"message": "x"}, nil)
	require.Equal(t, http.StatusForbidden, code, out)
	code, out = bannerCall(ctx, t, client, http.MethodGet, "/api/state", nil, nil)
	require.Equal(t, http.StatusOK, code, out)
	require.Equal(t, false, out["overrideActive"])
	require.Contains(t, out["user"].(map[string]any)["roles"], "owner")

	// cross-site requests are refused before anything else
	for _, edit := range []func(*http.Request){
		func(r *http.Request) { r.Header.Del("X-Requested-With") },
		func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") },
		func(r *http.Request) { r.Header.Set("Origin", "https://evil.test") },
		func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
	} {
		code, out = bannerCall(ctx, t, client, http.MethodPost, "/api/banner", map[string]any{"message": "x"}, edit)
		require.Equal(t, http.StatusForbidden, code)
		require.Equal(t, "Request rejected (cross-site protection).", out["error"])
	}

	// publish: every page and the open tab get it
	code, out = bannerCall(ctx, t, client, http.MethodPost, "/api/banner", map[string]any{"message": "Maintenance at 02:00", "level": "warning"}, nil)
	require.Equal(t, http.StatusOK, code, out)
	require.Equal(t, true, out["overrideActive"])
	require.Equal(t, "Maintenance at 02:00", bannerOf(t, out)["message"])
	require.NotNil(t, out["updatedBy"])
	published := bannerOf(t, out)["id"]
	live := next()
	require.Equal(t, "Maintenance at 02:00", live["message"])
	require.Equal(t, published, live["id"])
	code, b = bannerCall(ctx, t, anon, http.MethodGet, "/banner.json", nil, nil)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, published, b["id"])

	// an invalid payload: the message an admin must act on
	code, out = bannerCall(ctx, t, client, http.MethodPost, "/api/banner", map[string]any{"message": "x", "level": "loud"}, nil)
	require.Equal(t, http.StatusBadRequest, code)
	require.Equal(t, "Style must be one of: info, success, warning, critical.", out["error"])

	// show again: a new revision, a new id
	code, out = bannerCall(ctx, t, client, http.MethodPost, "/api/reappear", map[string]any{}, nil)
	require.Equal(t, http.StatusOK, code, out)
	require.EqualValues(t, 1, out["revision"])
	require.NotEqual(t, published, bannerOf(t, out)["id"])
	require.Equal(t, bannerOf(t, out)["id"], next()["id"])

	// reset: no banner again
	code, out = bannerCall(ctx, t, client, http.MethodPost, "/api/reset", map[string]any{}, nil)
	require.Equal(t, http.StatusOK, code, out)
	require.Equal(t, false, out["overrideActive"])
	require.Equal(t, false, next()["enabled"])

	// the banner service's other files are gone
	code, _ = bannerCall(ctx, t, anon, http.MethodGet, "/banner.js", nil, nil)
	require.Equal(t, http.StatusNotFound, code)
}
