package coderd_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/provisioner/echo"
	"github.com/coder/coder/v2/provisionersdk/proto"
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
	// A service that hangs (overloaded): its boot script must not hold the dashboard up.
	hang := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(hang.Close)
	slow, err := url.Parse(hang.URL)
	require.NoError(t, err)

	client := coderdtest.New(t, &coderdtest.Options{
		PlatformServiceRoutes: []coderd.PlatformServiceRoute{
			{PathPrefix: "/__coder-ui", Target: upstream("ui")},
			{PathPrefix: "/__banner", Target: upstream("banner")},
			{PathPrefix: "/__banner/live", Target: upstream("live")},
			{PathPrefix: "/__down", Target: down},
			{PathPrefix: "/__slow", Target: slow},
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

	// The boot script of a service that is down or hangs: an empty script at once (down) or within the limit
	// (hangs), so every dashboard page still starts.
	status, body = send(http.MethodGet, "/__down/boot.js", "")
	require.Equal(t, http.StatusOK, status)
	require.Contains(t, body, "platform service unavailable")
	start := time.Now()
	status, body = send(http.MethodGet, "/__slow/boot.js", "")
	require.Equal(t, http.StatusOK, status)
	require.Contains(t, body, "platform service unavailable")
	require.Less(t, time.Since(start), 6*time.Second)
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
	require.Equal(t, first.UserID.String(), got.body["owner_id"])
	require.Equal(t, first.OrganizationID.String(), got.body["organization_id"])
	require.NotContains(t, got.body, "current_workspace_id")

	// Allowed.
	reply(http.StatusOK, `{"allowed": true}`)
	require.NoError(t, create())
	<-checks

	// The check itself failing lets the workspace through.
	reply(http.StatusServiceUnavailable, `{"error": "down"}`)
	require.NoError(t, create())
	<-checks
}

func TestPlatformWorkspaceScheduler(t *testing.T) {
	t.Parallel()

	type check struct {
		token string
		body  map[string]any
	}
	checks := make(chan check, 10)
	answer := make(chan func(rw http.ResponseWriter), 10)
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Requested-With") != "coder-ui" {
			rw.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.URL.Path {
		case "/__coder-ui/api/quota/check":
			rw.Header().Set("Content-Type", "application/json")
			_, _ = rw.Write([]byte(`{"allowed": true}`))
		case "/__coder-ui/api/scheduler/check":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			checks <- check{token: r.Header.Get(codersdk.SessionTokenHeader), body: body}
			(<-answer)(rw)
		default:
			rw.WriteHeader(http.StatusNotFound)
		}
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

	reply := func(status int, body string) {
		answer <- func(rw http.ResponseWriter) {
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(status)
			_, _ = rw.Write([]byte(body))
		}
	}
	requireRefused := func(err error, message string) {
		t.Helper()
		var sdkErr *codersdk.Error
		require.ErrorAs(t, err, &sdkErr)
		require.Equal(t, http.StatusForbidden, sdkErr.StatusCode())
		require.Contains(t, sdkErr.Message, message)
	}
	ctx := testutil.Context(t, testutil.WaitLong)

	// Create without a schedule: refused with the service's message.
	reply(http.StatusOK, `{"allowed": false, "message": "Every workspace needs a start time and a stop time: it has no start time."}`)
	_, err = client.CreateUserWorkspace(ctx, codersdk.Me, codersdk.CreateWorkspaceRequest{TemplateID: template.ID, Name: "nosched"})
	requireRefused(err, "needs a start time")
	got := <-checks
	require.Equal(t, client.SessionToken(), got.token)
	require.Equal(t, "create", got.body["action"])
	require.Nil(t, got.body["autostart_schedule"])

	// The administrator's schedule is applied on create.
	reply(http.StatusOK, `{"allowed": true, "apply": {"autostart_schedule": "CRON_TZ=UTC 30 8 * * 1-5", "ttl_ms": 30600000}}`)
	ws, err := client.CreateUserWorkspace(ctx, codersdk.Me, codersdk.CreateWorkspaceRequest{TemplateID: template.ID, Name: "fixed"})
	require.NoError(t, err)
	<-checks
	require.NotNil(t, ws.AutostartSchedule)
	require.Equal(t, "CRON_TZ=UTC 30 8 * * 1-5", *ws.AutostartSchedule)
	require.NotNil(t, ws.TTLMillis)
	require.Equal(t, int64(30600000), *ws.TTLMillis)

	// Removing the start time: refused; the check sees the workspace's stop time.
	reply(http.StatusOK, `{"allowed": false, "message": "Every workspace needs a start time and a stop time: it has no start time."}`)
	err = client.UpdateWorkspaceAutostart(ctx, ws.ID, codersdk.UpdateWorkspaceAutostartRequest{Schedule: nil})
	requireRefused(err, "needs a start time")
	got = <-checks
	require.Equal(t, "autostart", got.body["action"])
	require.Equal(t, "fixed", ws.Name)
	require.EqualValues(t, 30600000, got.body["ttl_ms"])

	// A new start time that complies: saved.
	reply(http.StatusOK, `{"allowed": true}`)
	sched := "CRON_TZ=UTC 0 9 * * 1-5"
	require.NoError(t, client.UpdateWorkspaceAutostart(ctx, ws.ID, codersdk.UpdateWorkspaceAutostartRequest{Schedule: &sched}))
	<-checks

	// A stop time over the maximum: refused; the check sees the start time.
	reply(http.StatusOK, `{"allowed": false, "message": "it stays up 20 h, more than the 10 h allowed"}`)
	long := int64(20 * 3600 * 1000)
	err = client.UpdateWorkspaceTTL(ctx, ws.ID, codersdk.UpdateWorkspaceTTLRequest{TTLMillis: &long})
	requireRefused(err, "more than the 10 h allowed")
	got = <-checks
	require.Equal(t, "ttl", got.body["action"])
	require.Equal(t, sched, got.body["autostart_schedule"])

	// The check itself failing changes nothing: the request goes through.
	reply(http.StatusServiceUnavailable, `{"error": "down"}`)
	short := int64(4 * 3600 * 1000)
	require.NoError(t, client.UpdateWorkspaceTTL(ctx, ws.ID, codersdk.UpdateWorkspaceTTLRequest{TTLMillis: &short}))
	<-checks
}

func TestPlatformWorkspaceQuotaStartResize(t *testing.T) {
	t.Parallel()
	var allowed atomic.Bool
	allowed.Store(true)
	checks := make(chan map[string]any, 20)
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__coder-ui/api/quota/check" {
			http.NotFound(rw, r)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			rw.WriteHeader(http.StatusBadRequest)
			return
		}
		checks <- body
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(map[string]any{"allowed": allowed.Load(), "message": "Allocation exceeds the remaining quota"})
	}))
	t.Cleanup(srv.Close)
	target, err := url.Parse(srv.URL)
	require.NoError(t, err)
	client := coderdtest.New(t, &coderdtest.Options{IncludeProvisionerDaemon: true, PlatformServiceRoutes: []coderd.PlatformServiceRoute{{PathPrefix: "/__coder-ui", Target: target}}})
	first := coderdtest.CreateFirstUser(t, client)
	response := func(cpu, memory string) *echo.Responses {
		return &echo.Responses{Parse: echo.ParseComplete, ProvisionInit: echo.InitComplete, ProvisionGraph: []*proto.Response{{Type: &proto.Response_Graph{Graph: &proto.GraphComplete{Parameters: []*proto.RichParameter{{Name: "cpu", Type: "number", DefaultValue: cpu, Mutable: true}, {Name: "memory", Type: "number", DefaultValue: memory, Mutable: true}}}}}}, ProvisionPlan: echo.PlanComplete, ProvisionApply: echo.ApplyComplete}
	}
	version := coderdtest.CreateTemplateVersion(t, client, first.OrganizationID, response("2", "4"))
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
	template := coderdtest.CreateTemplate(t, client, first.OrganizationID, version.ID)
	ctx := testutil.Context(t, testutil.WaitLong)
	workspace, err := client.CreateUserWorkspace(ctx, codersdk.Me, codersdk.CreateWorkspaceRequest{TemplateID: template.ID, Name: coderdtest.RandomUsername(t), RichParameterValues: []codersdk.WorkspaceBuildParameter{{Name: "cpu", Value: "3"}}})
	require.NoError(t, err)
	<-checks
	coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, workspace.LatestBuild.ID)
	updated := coderdtest.CreateTemplateVersion(t, client, first.OrganizationID, response("6", "16"), func(r *codersdk.CreateTemplateVersionRequest) { r.TemplateID = template.ID })
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, updated.ID)
	require.NoError(t, client.UpdateActiveTemplateVersion(ctx, template.ID, codersdk.UpdateActiveTemplateVersion{ID: updated.ID}))
	allowed.Store(false)
	_, err = client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, RichParameterValues: []codersdk.WorkspaceBuildParameter{{Name: "cpu", Value: "4"}}})
	var sdkErr *codersdk.Error
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusForbidden, sdkErr.StatusCode())
	check := <-checks
	require.Equal(t, workspace.ID.String(), check["current_workspace_id"])
	require.Equal(t, first.UserID.String(), check["owner_id"])
	require.Equal(t, first.OrganizationID.String(), check["organization_id"])
	require.Equal(t, version.ID.String(), check["template_version_id"], "an unpinned start uses the previous build version")
	require.ElementsMatch(t, []any{map[string]any{"name": "cpu", "value": "4"}, map[string]any{"name": "memory", "value": "4"}}, check["rich_parameter_values"])
	for _, params := range [][]codersdk.WorkspaceBuildParameter{nil, {{Name: "cpu", Value: "2"}}} {
		build, err := client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, RichParameterValues: params})
		require.NoError(t, err)
		coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, build.ID)
	}
	require.Empty(t, checks, "unchanged and reduced allocations must remain restartable")
	allowed.Store(true)
	build, err := client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, RichParameterValues: []codersdk.WorkspaceBuildParameter{{Name: "cpu", Value: "4"}}})
	require.NoError(t, err)
	coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, build.ID)
	<-checks
	allowed.Store(false)
	_, err = client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, TemplateVersionID: updated.ID, RichParameterValues: []codersdk.WorkspaceBuildParameter{{Name: "memory", Value: "8"}}})
	require.ErrorAs(t, err, &sdkErr)
	require.Equal(t, http.StatusForbidden, sdkErr.StatusCode())
	check = <-checks
	require.Equal(t, updated.ID.String(), check["template_version_id"])
	other, _ := coderdtest.CreateAnotherUser(t, client, first.OrganizationID)
	_, err = other.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionStart, RichParameterValues: []codersdk.WorkspaceBuildParameter{{Name: "cpu", Value: "100"}}})
	require.Error(t, err)
	for _, transition := range []codersdk.WorkspaceTransition{codersdk.WorkspaceTransitionStop, codersdk.WorkspaceTransitionDelete} {
		build, err := client.CreateWorkspaceBuild(ctx, workspace.ID, codersdk.CreateWorkspaceBuildRequest{Transition: transition})
		require.NoError(t, err)
		coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, build.ID)
	}
	require.Empty(t, checks, "unauthorized starts, stop and delete must not call the quota service")
}
