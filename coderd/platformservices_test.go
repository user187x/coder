package coderd_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestParsePlatformServiceRoutes(t *testing.T) {
	t.Parallel()

	routes, err := coderd.ParsePlatformServiceRoutes(" /__coder-ui/=http://ui.ns.svc, /__banner/live=http://banner:8081 ,")
	require.NoError(t, err)
	require.Len(t, routes, 2)
	require.Equal(t, "/__coder-ui", routes[0].PathPrefix)
	require.Equal(t, "http://ui.ns.svc", routes[0].Target.String())
	require.Equal(t, "/__banner/live", routes[1].PathPrefix)

	empty, err := coderd.ParsePlatformServiceRoutes("")
	require.NoError(t, err)
	require.Empty(t, empty)

	for _, bad := range []string{
		"/__coder-ui",                       // no target
		"/api=http://ui",                    // would shadow Coder's API
		"/__x/*=http://ui",                  // a pattern
		"/__x=ftp://ui",                     // not http(s)
		"/__x=http://",                      // no host
		"/__x=http://a,/__x/=http://b",      // listed twice
		"__coder-ui=http://ui.ns.svc:80/",   // not an absolute path
		"/__coder-ui=http://ui ns.svc:80/x", // not a URL
	} {
		_, err := coderd.ParsePlatformServiceRoutes(bad)
		require.Error(t, err, bad)
	}
}

func TestPlatformServiceRoutes(t *testing.T) {
	t.Parallel()

	type seen struct{ service, method, path, host, body string }
	requests := make(chan seen, 10)
	upstream := func(service string) *url.URL {
		srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			requests <- seen{service: service, method: r.Method, path: r.URL.Path, host: r.Host, body: string(body)}
			_, _ = rw.Write([]byte(service))
		}))
		t.Cleanup(srv.Close)
		u, err := url.Parse(srv.URL)
		require.NoError(t, err)
		return u
	}
	down, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)

	client := coderdtest.New(t, &coderdtest.Options{
		PlatformServiceRoutes: []coderd.PlatformServiceRoute{
			{PathPrefix: "/__coder-ui", Target: upstream("ui")},
			{PathPrefix: "/__banner", Target: upstream("banner")},
			{PathPrefix: "/__banner/live", Target: upstream("live")},
			{PathPrefix: "/__down", Target: down},
		},
	})
	_ = coderdtest.CreateFirstUser(t, client)

	send := func(method, path, body string) (int, string) {
		t.Helper()
		ctx := testutil.Context(t, testutil.WaitShort)
		req, err := http.NewRequestWithContext(ctx, method, client.URL.String()+path, strings.NewReader(body))
		require.NoError(t, err)
		// A browser's session cookie without a CSRF token: the services do
		// their own CSRF checks, so Coder must pass the request on.
		req.AddCookie(&http.Cookie{Name: codersdk.SessionTokenCookie, Value: client.SessionToken()})
		res, err := client.HTTPClient.Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		got, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		return res.StatusCode, string(got)
	}

	status, body := send(http.MethodGet, "/__coder-ui/boot.js", "")
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, "ui", body)
	got := <-requests
	require.Equal(t, seen{service: "ui", method: http.MethodGet, path: "/__coder-ui/boot.js", host: client.URL.Host}, got)

	status, _ = send(http.MethodPost, "/__coder-ui/api/logo", `{"dataUrl":"x"}`)
	require.Equal(t, http.StatusOK, status)
	got = <-requests
	require.Equal(t, http.MethodPost, got.method)
	require.Equal(t, `{"dataUrl":"x"}`, got.body)

	// The more specific prefix wins.
	_, body = send(http.MethodGet, "/__banner/live", "")
	require.Equal(t, "live", body)
	<-requests
	_, body = send(http.MethodGet, "/__banner/banner.json", "")
	require.Equal(t, "banner", body)
	<-requests

	status, _ = send(http.MethodGet, "/__down/x", "")
	require.Equal(t, http.StatusBadGateway, status)
}

func TestPlatformWorkspaceQuota(t *testing.T) {
	t.Parallel()

	type check struct {
		token string
		body  map[string]any
	}
	checks := make(chan check, 10)
	answer := make(chan func(rw http.ResponseWriter), 10)
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__coder-ui/api/quota/check" || r.Header.Get("X-Requested-With") != "coder-ui" {
			rw.WriteHeader(http.StatusNotFound)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		checks <- check{token: r.Header.Get(codersdk.SessionTokenHeader), body: body}
		(<-answer)(rw)
	}))
	t.Cleanup(srv.Close)
	target, err := url.Parse(srv.URL)
	require.NoError(t, err)

	client := coderdtest.New(t, &coderdtest.Options{
		IncludeProvisionerDaemon: true,
		PlatformServiceRoutes:    []coderd.PlatformServiceRoute{{PathPrefix: "/__coder-ui", Target: target}},
	})
	first := coderdtest.CreateFirstUser(t, client)
	version := coderdtest.CreateTemplateVersion(t, client, first.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
	template := coderdtest.CreateTemplate(t, client, first.OrganizationID, version.ID)

	create := func() error {
		ctx := testutil.Context(t, testutil.WaitLong)
		_, err := client.CreateUserWorkspace(ctx, codersdk.Me, codersdk.CreateWorkspaceRequest{
			TemplateID: template.ID,
			Name:       coderdtest.RandomUsername(t),
		})
		return err
	}
	reply := func(status int, body string) {
		answer <- func(rw http.ResponseWriter) {
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(status)
			_, _ = rw.Write([]byte(body))
		}
	}

	// Refused: the service's message reaches the requester.
	reply(http.StatusOK, `{"allowed": false, "message": "Your workspace quota is reached (workspaces: 1 of 1 already)."}`)
	err = create()
	var sdkErr *codersdk.Error
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusForbidden, sdkErr.StatusCode())
	require.Contains(t, sdkErr.Message, "quota is reached")
	got := <-checks
	require.Equal(t, client.SessionToken(), got.token)
	require.Equal(t, template.ID.String(), got.body["template_id"])
	require.Equal(t, version.ID.String(), got.body["template_version_id"])

	// Allowed.
	reply(http.StatusOK, `{"allowed": true}`)
	require.NoError(t, create())
	<-checks

	// The check itself failing lets the workspace through.
	reply(http.StatusServiceUnavailable, `{"error": "down"}`)
	require.NoError(t, create())
	<-checks
}
