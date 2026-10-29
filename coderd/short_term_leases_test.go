package coderd_test

import (
	"github.com/coder/coder/v2/coderd"
	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/workspacequarantine"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"
)

func TestShortTermLeaseAuthorization(t *testing.T) {
	t.Parallel()
	client := coderdtest.New(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	ctx := testutil.Context(t, testutil.WaitLong)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	path := "/api/v2/organizations/" + owner.OrganizationID.String() + "/short-term-leases"
	res, err := member.Request(ctx, http.MethodGet, path, nil)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusForbidden, res.StatusCode)
	res, err = client.Request(ctx, http.MethodGet, path, nil)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res, err = client.Request(ctx, http.MethodPost, path, codersdk.CreateShortTermLeaseRequest{Minutes: -1})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusBadRequest, res.StatusCode)
	res, err = member.Request(ctx, http.MethodPost, "/api/v2/short-term-lease/extension", nil)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)
}

func TestShortTermLeaseLifecycle(t *testing.T) {
	t.Parallel()
	var scheduleChecks atomic.Int32
	scheduler := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/scheduler/check" {
			scheduleChecks.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"allowed":false,"message":"Recurring schedule required"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(scheduler.Close)
	target, err := url.Parse(scheduler.URL)
	require.NoError(t, err)
	client := coderdtest.New(t, &coderdtest.Options{IncludeProvisionerDaemon: true, PlatformServiceRoutes: []coderd.PlatformServiceRoute{{PathPrefix: "/__coder-ui", Target: target}}})
	owner := coderdtest.CreateFirstUser(t, client)
	ctx := testutil.Context(t, testutil.WaitLong)
	version := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
	template := coderdtest.CreateTemplate(t, client, owner.OrganizationID, version.ID, func(r *codersdk.CreateTemplateRequest) { r.Name = "browser" })
	path := "/api/v2/organizations/" + owner.OrganizationID.String() + "/short-term-leases"
	res, err := client.Request(ctx, http.MethodPost, path, codersdk.CreateShortTermLeaseRequest{TemplateID: template.ID})
	require.NoError(t, err)
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatal(codersdk.ReadBodyAsError(res))
	}
	var lease codersdk.ShortTermLease
	require.NoError(t, codersdk.ReadBodyAsJSON(res, &lease))
	require.NotEmpty(t, lease.Token)
	require.NotNil(t, lease.WorkspaceID)
	require.Equal(t, 15*time.Minute, lease.ExpiresAt.Sub(lease.IssuedAt))
	guest := codersdk.New(client.URL)
	guest.SetSessionToken(lease.Token)
	_, err = guest.Template(ctx, template.ID)
	require.NoError(t, err)
	otherVersion := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, otherVersion.ID)
	otherTemplate := coderdtest.CreateTemplate(t, client, owner.OrganizationID, otherVersion.ID)
	_, err = guest.Template(ctx, otherTemplate.ID)
	require.Error(t, err)
	leasedWorkspace, err := guest.Workspace(ctx, *lease.WorkspaceID)
	require.NoError(t, err)
	require.Nil(t, leasedWorkspace.TTLMillis, "the extendable lease clock owns shutdown")
	require.Nil(t, leasedWorkspace.AutostartSchedule)
	require.Zero(t, scheduleChecks.Load(), "leases must not receive a recurring scheduler policy")

	_, err = guest.User(ctx, codersdk.Me)
	require.NoError(t, err)
	_, err = guest.CreateAPIKey(ctx, codersdk.Me)
	require.Error(t, err)
	res, err = guest.Request(ctx, http.MethodPost, "/api/v2/short-term-lease/extension", nil)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res, err = client.Request(ctx, http.MethodPatch, path+"/"+lease.UserID.String(), codersdk.UpdateShortTermLeaseRequest{Minutes: 5})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res, err = client.Request(ctx, http.MethodPatch, path+"/"+lease.UserID.String(), codersdk.UpdateShortTermLeaseRequest{Revoke: true})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	_, err = guest.User(ctx, codersdk.Me)
	require.Error(t, err)
	res, err = client.Request(ctx, http.MethodPatch, path+"/"+lease.UserID.String(), codersdk.UpdateShortTermLeaseRequest{Minutes: 5})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)
}

func TestShortTermLeaseExpiryClosesSession(t *testing.T) {
	t.Parallel()
	client, db := coderdtest.NewWithDatabase(t, &coderdtest.Options{IncludeProvisionerDaemon: true})
	owner := coderdtest.CreateFirstUser(t, client)
	guest, user := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	ctx := testutil.Context(t, testutil.WaitLong)
	version := coderdtest.CreateTemplateVersion(t, client, owner.OrganizationID, nil)
	coderdtest.AwaitTemplateVersionJobCompleted(t, client, version.ID)
	template := coderdtest.CreateTemplate(t, client, owner.OrganizationID, version.ID)
	ws := coderdtest.CreateWorkspace(t, guest, template.ID)
	coderdtest.AwaitWorkspaceBuildJobCompleted(t, client, ws.LatestBuild.ID)
	//nolint:gocritic // Seed the precise deadline independently of the admin duration input.
	system := dbauthz.AsSystemRestricted(ctx)
	now := time.Now()
	_, err := db.InsertShortTermLease(system, database.InsertShortTermLeaseParams{UserID: user.ID, OrganizationID: owner.OrganizationID, IssuedBy: owner.UserID, IssuedAt: now.Add(-time.Minute), ExpiresAt: now.Add(3 * time.Second)})
	require.NoError(t, err)
	_, err = db.BindShortTermLease(system, database.BindShortTermLeaseParams{UserID: user.ID, OrganizationID: owner.OrganizationID, WorkspaceID: uuid.NullUUID{UUID: ws.ID, Valid: true}})
	require.NoError(t, err)
	manager := workspacequarantine.New(db, quartz.NewReal())
	go manager.Run(ctx)
	session, release, err := manager.Guard(ctx, ws.ID)
	require.NoError(t, err)
	defer release()
	_, err = guest.User(ctx, codersdk.Me)
	require.NoError(t, err)
	select {
	case <-session.Done():
	case <-ctx.Done():
		t.Fatal("expired lease did not close its existing session")
	}
	_, err = guest.User(ctx, codersdk.Me)
	require.Error(t, err)
	_, _, err = manager.Guard(ctx, ws.ID)
	require.Error(t, err)
	require.Eventually(t, func() bool {
		current, err := client.Workspace(ctx, ws.ID)
		return err == nil && current.LatestBuild.Status == codersdk.WorkspaceStatusStopped
	}, testutil.WaitLong, testutil.IntervalFast)
	_, err = client.CreateWorkspaceBuild(ctx, ws.ID, codersdk.CreateWorkspaceBuildRequest{Transition: codersdk.WorkspaceTransitionDelete})
	require.NoError(t, err, "an administrator can clean up an expired lease")
}

func TestShortTermLeasePlatformProxy(t *testing.T) {
	t.Parallel()
	var forwarded atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)
	target, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	client, db := coderdtest.NewWithDatabase(t, &coderdtest.Options{PlatformServiceRoutes: []coderd.PlatformServiceRoute{{PathPrefix: "/__coder-ui", Target: target}}})
	owner := coderdtest.CreateFirstUser(t, client)
	guest, user := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	ctx := testutil.Context(t, testutil.WaitLong)
	//nolint:gocritic // Seed the account restriction independently of provisioning.
	_, err = db.InsertShortTermLease(dbauthz.AsSystemRestricted(ctx), database.InsertShortTermLeaseParams{UserID: user.ID, OrganizationID: owner.OrganizationID, IssuedBy: owner.UserID, IssuedAt: time.Now(), ExpiresAt: time.Now().Add(time.Minute)})
	require.NoError(t, err)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		res, err := guest.Request(ctx, method, "/__coder-ui/api/cloud-drive", nil)
		require.NoError(t, err)
		res.Body.Close()
		require.Equal(t, http.StatusForbidden, res.StatusCode)
	}
	require.Zero(t, forwarded.Load(), "denied requests must not reach the service")
	for _, caller := range []*codersdk.Client{guest, client, codersdk.New(client.URL)} {
		res, err := caller.Request(ctx, http.MethodGet, "/__coder-ui/api/login-page", nil)
		require.NoError(t, err)
		res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
	}
	require.EqualValues(t, 3, forwarded.Load())
}
