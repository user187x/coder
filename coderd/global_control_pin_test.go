package coderd_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"

	"github.com/coder/coder/v2/coderd"
	"testing"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/stretchr/testify/require"
)

func TestGlobalControlHTTPAuthorization(t *testing.T) {
	t.Parallel()
	client := coderdtest.New(t, nil)
	owner := coderdtest.CreateFirstUser(t, client)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	ctx := testutil.Context(t, testutil.WaitLong)
	request := func(c *codersdk.Client, method, path string, body interface{}, token string, status int) codersdk.GlobalControlStatus {
		t.Helper()
		res, err := c.Request(ctx, method, "/api/v2/global-lockdown"+path, body, func(r *http.Request) { r.Header.Set("X-Coder-Global-Control-Token", token) })
		require.NoError(t, err)
		defer res.Body.Close()
		require.Equal(t, status, res.StatusCode)
		var out codersdk.GlobalControlStatus
		if status == http.StatusOK {
			require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
		}
		return out
	}
	request(member, "GET", "/controls", nil, "", http.StatusForbidden)
	request(member, "PUT", "/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "482619"}, "", http.StatusForbidden)
	require.False(t, request(client, "GET", "/controls", nil, "", http.StatusOK).Configured)
	request(client, "POST", "/controls/unlock", codersdk.GlobalControlPINRequest{PIN: "482619"}, "", http.StatusConflict)
	request(client, "PUT", "/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "0000"}, "", http.StatusBadRequest)
	grant := request(client, "PUT", "/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "482619"}, "", http.StatusOK)
	require.NotEmpty(t, grant.Token)
	require.NotEmpty(t, grant.ExpiresAt)
	status := request(client, "GET", "/controls", nil, "", http.StatusOK)
	require.True(t, status.Configured)
	require.Empty(t, status.Token)
	request(client, "POST", "", codersdk.UpdateGlobalLockdownRequest{Enabled: false}, "", http.StatusForbidden)
	request(client, "POST", "/organizations/"+owner.OrganizationID.String()+"/workspace-power", nil, "", http.StatusForbidden)
	request(member, "POST", "/controls/unlock", codersdk.GlobalControlPINRequest{PIN: "482619"}, "", http.StatusForbidden)
	request(client, "POST", "", codersdk.UpdateGlobalLockdownRequest{Enabled: false}, grant.Token, http.StatusOK)
	request(client, "POST", "/controls/close", nil, "", http.StatusOK)
	request(client, "POST", "", codersdk.UpdateGlobalLockdownRequest{Enabled: false}, grant.Token, http.StatusForbidden)
	request(client, "PUT", "/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "619482", CurrentPIN: "111111"}, "", http.StatusForbidden)
	next := request(client, "PUT", "/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "619482", CurrentPIN: "482619"}, "", http.StatusOK)
	require.NotEqual(t, grant.Token, next.Token)
	request(client, "POST", "/controls/unlock", codersdk.GlobalControlPINRequest{PIN: "482619"}, "", http.StatusForbidden)
	final := request(client, "POST", "/controls/unlock", codersdk.GlobalControlPINRequest{PIN: "619482"}, "", http.StatusOK)
	request(client, "POST", "", codersdk.UpdateGlobalLockdownRequest{Enabled: false}, next.Token, http.StatusForbidden)
	request(client, "POST", "", codersdk.UpdateGlobalLockdownRequest{Enabled: false}, final.Token, http.StatusOK)
}

func TestGlobalControlPowerProxy(t *testing.T) {
	t.Parallel()
	type observed struct{ path, token, grant, requested string }
	seen := make(chan observed, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- observed{r.URL.Path, r.Header.Get(codersdk.SessionTokenHeader), r.Header.Get("X-Coder-Global-Control-Token"), r.Header.Get("X-Requested-With")}
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(upstream.Close)
	target, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	client := coderdtest.New(t, &coderdtest.Options{PlatformServiceRoutes: []coderd.PlatformServiceRoute{{PathPrefix: "/__coder-ui", Target: target}}})
	owner := coderdtest.CreateFirstUser(t, client)
	ctx := testutil.Context(t, testutil.WaitLong)
	res, err := client.Request(ctx, http.MethodPut, "/api/v2/global-lockdown/controls", codersdk.ConfigureGlobalControlPINRequest{PIN: "482619"})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var grant codersdk.GlobalControlStatus
	require.NoError(t, json.NewDecoder(res.Body).Decode(&grant))
	res, err = client.Request(ctx, http.MethodPost, "/api/v2/global-lockdown/organizations/"+owner.OrganizationID.String()+"/workspace-power", map[string]interface{}{"action": "stop", "workspace_ids": []string{}, "confirmation": "stop"}, func(r *http.Request) {
		r.Header.Set("X-Coder-Global-Control-Token", grant.Token)
		r.Header.Set("X-Requested-With", "coder-ui")
	})
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusAccepted, res.StatusCode)
	select {
	case got := <-seen:
		require.Equal(t, "/__coder-ui/api/organizations/"+owner.OrganizationID.String()+"/workspace-power", got.path)
		require.NotEmpty(t, got.token)
		require.Empty(t, got.grant, "the PIN grant must not escape to the platform service")
		require.Equal(t, "coder-ui", got.requested)
	case <-ctx.Done():
		t.Fatal("power request did not reach the service")
	}
}
