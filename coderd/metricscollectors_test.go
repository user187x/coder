package coderd_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/coderdtest/oidctest"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestMetricsCollectors(t *testing.T) {
	t.Parallel()
	fake := oidctest.NewFakeIDP(t, oidctest.WithServing())
	client := coderdtest.New(t, &coderdtest.Options{
		OIDCConfig: fake.OIDCConfig(t, nil), AccessURL: &url.URL{Scheme: "https", Host: "coder.example.test"},
	})
	owner := coderdtest.CreateFirstUser(t, client)
	ctx := testutil.Context(t, testutil.WaitLong)
	request := func(method, path string, body any, session, bearer string) (int, []byte, http.Header) {
		encoded, err := json.Marshal(body)
		require.NoError(t, err)
		req, err := http.NewRequestWithContext(ctx, method, client.URL.String()+path, bytes.NewReader(encoded))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		if session != "" {
			req.Header.Set(codersdk.SessionTokenHeader, session)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		res, err := client.HTTPClient.Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		return res.StatusCode, raw, res.Header
	}
	org := owner.OrganizationID.String()
	code, raw, _ := request(http.MethodGet, "/api/v2/organizations/"+org+"/metrics-collectors", nil, client.SessionToken(), "")
	require.Equal(t, http.StatusOK, code, string(raw))
	var config codersdk.AuditCollectorConfiguration
	require.NoError(t, json.Unmarshal(raw, &config))
	require.Equal(t, "coder-metrics", config.Audience)
	require.Equal(t, "coder:metrics:read", config.Scope)
	require.True(t, strings.HasSuffix(config.Endpoint, "/api/v2/metrics-export/"+org))

	grant := codersdk.CreateAuditCollectorRequest{Name: "Prometheus", Subject: "metrics-subject", ClientID: "metrics-client", ValidDays: 7}
	code, raw, _ = request(http.MethodPost, "/api/v2/organizations/"+org+"/metrics-collectors", grant, client.SessionToken(), "")
	require.Equal(t, http.StatusCreated, code, string(raw))
	// A metrics grant is not an audit grant.
	code, raw, _ = request(http.MethodGet, "/api/v2/organizations/"+org+"/audit-collectors", nil, client.SessionToken(), "")
	require.Equal(t, http.StatusOK, code, string(raw))
	var audit codersdk.AuditCollectorConfiguration
	require.NoError(t, json.Unmarshal(raw, &audit))
	require.Empty(t, audit.Collectors)

	key, err := oidctest.FakeIDPKey()
	require.NoError(t, err)
	sign := func(audience, scope string) string {
		now := time.Now()
		token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": fake.IssuerURL().String(), "aud": audience, "sub": grant.Subject, "azp": grant.ClientID,
			"scope": scope, "typ": "Bearer", "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
		}).SignedString(key)
		require.NoError(t, err)
		return token
	}
	export := "/api/v2/metrics-export/" + org
	code, _, _ = request(http.MethodGet, export, nil, "", sign("coder-audit", "coder:audit:read"))
	require.Equal(t, http.StatusUnauthorized, code, "an audit token does not read metrics")
	code, _, _ = request(http.MethodGet, "/api/v2/audit-export/"+org, nil, "", sign("coder-audit", "coder:audit:read"))
	require.Equal(t, http.StatusForbidden, code, "a metrics grant does not read audit logs")
	code, _, _ = request(http.MethodGet, export, nil, client.SessionToken(), "")
	require.Equal(t, http.StatusUnauthorized, code)

	valid := sign("coder-metrics", "coder:metrics:read")
	code, raw, _ = request(http.MethodGet, export, nil, "", valid)
	require.Equal(t, http.StatusOK, code, string(raw))
	var metrics codersdk.OrganizationMetrics
	require.NoError(t, json.Unmarshal(raw, &metrics))
	require.Equal(t, owner.OrganizationID, metrics.OrganizationID)
	require.EqualValues(t, 1, metrics.Members)

	code, raw, headers := request(http.MethodGet, export+"?format=prometheus", nil, "", valid)
	require.Equal(t, http.StatusOK, code, string(raw))
	require.Contains(t, headers.Get("Content-Type"), "text/plain; version=0.0.4")
	require.Contains(t, string(raw), "# TYPE coder_organization_members gauge\n")
	require.Contains(t, string(raw), `coder_organization_members{organization="`+metrics.Organization+`"} 1`)

	code, _, _ = request(http.MethodGet, export+"?format=xml", nil, "", valid)
	require.Equal(t, http.StatusBadRequest, code)
}
