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

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/coderdtest/oidctest"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

//nolint:paralleltest,tparallel // Subtests share and revoke one collector grant in sequence.
func TestAuditCollectors(t *testing.T) {
	t.Parallel()
	fake := oidctest.NewFakeIDP(t, oidctest.WithServing())
	cfg := fake.OIDCConfig(t, nil)
	client, db := coderdtest.NewWithDatabase(t, &coderdtest.Options{
		OIDCConfig: cfg, AccessURL: &url.URL{Scheme: "https", Host: "coder.example.test"},
	})
	owner := coderdtest.CreateFirstUser(t, client)
	member, _ := coderdtest.CreateAnotherUser(t, client, owner.OrganizationID)
	otherOrg := dbgen.Organization(t, db, database.Organization{})
	ctx := testutil.Context(t, testutil.WaitLong)
	request := func(t *testing.T, session, method, path string, body any, bearer string) (int, []byte, http.Header) {
		t.Helper()
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
	base := "/api/v2/organizations/" + owner.OrganizationID.String() + "/audit-collectors"
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		path := base
		if method == http.MethodDelete {
			path += "/" + uuid.NewString()
		}
		code, raw, _ := request(t, member.SessionToken(), method, path, nil, "")
		require.Equal(t, http.StatusForbidden, code, string(raw))
	}
	code, raw, _ := request(t, client.SessionToken(), http.MethodGet, base, nil, "")
	require.Equal(t, http.StatusOK, code, string(raw))
	var config codersdk.AuditCollectorConfiguration
	require.NoError(t, json.Unmarshal(raw, &config))
	require.True(t, config.Available)
	require.Equal(t, "coder-audit", config.Audience)
	require.Empty(t, config.Collectors)
	grant := codersdk.CreateAuditCollectorRequest{Name: "Security collector", Subject: "collector-subject", ClientID: "collector-client", ValidDays: 30}
	code, raw, _ = request(t, client.SessionToken(), http.MethodPost, base, grant, "")
	require.Equal(t, http.StatusCreated, code, string(raw))
	var created codersdk.AuditCollector
	require.NoError(t, json.Unmarshal(raw, &created))
	require.Equal(t, owner.OrganizationID, created.OrganizationID)
	code, _, _ = request(t, client.SessionToken(), http.MethodPost, base, grant, "")
	require.Equal(t, http.StatusConflict, code)

	key, err := oidctest.FakeIDPKey()
	require.NoError(t, err)
	sign := func(t *testing.T, changes jwt.MapClaims) string {
		t.Helper()
		now := time.Now()
		claims := jwt.MapClaims{
			"iss": fake.IssuerURL().String(), "aud": "coder-audit", "sub": grant.Subject,
			"azp": grant.ClientID, "scope": "coder:audit:read", "typ": "Bearer", "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
		}
		for k, v := range changes {
			claims[k] = v
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
		require.NoError(t, err)
		return token
	}
	valid := sign(t, nil)
	_, err = cfg.Provider.Verifier(&oidc.Config{ClientID: "coder-audit"}).Verify(ctx, valid)
	require.NoError(t, err)
	export := "/api/v2/audit-export/" + owner.OrganizationID.String()
	for _, tc := range []struct {
		name   string
		claims jwt.MapClaims
		status int
	}{
		{"wrong audience", jwt.MapClaims{"aud": "coder"}, 401},
		{"wrong issuer", jwt.MapClaims{"iss": "https://attacker.invalid"}, 401},
		{"expired", jwt.MapClaims{"exp": time.Now().Add(-time.Minute).Unix()}, 401},
		{"long lived", jwt.MapClaims{"exp": time.Now().Add(time.Hour).Unix()}, 401},
		{"missing issue time", jwt.MapClaims{"iat": 0}, 401},
		{"not yet valid", jwt.MapClaims{"nbf": time.Now().Add(time.Minute).Unix()}, 401},
		{"ID token", jwt.MapClaims{"typ": "ID"}, 401},
		{"bound token without proof", jwt.MapClaims{"cnf": map[string]string{"x5t#S256": "fingerprint"}}, 401},
		{"missing scope", jwt.MapClaims{"scope": "openid"}, 403},
		{"wrong subject", jwt.MapClaims{"sub": "unapproved-subject"}, 403},
		{"wrong client", jwt.MapClaims{"azp": "unapproved-client"}, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, raw, headers := request(t, "", http.MethodGet, export, nil, sign(t, tc.claims))
			require.Equal(t, tc.status, code, string(raw))
			require.Contains(t, headers.Get("WWW-Authenticate"), "Bearer")
		})
	}
	for _, session := range []string{"", client.SessionToken()} {
		code, _, _ = request(t, session, http.MethodGet, export, nil, "")
		require.Equal(t, 401, code, "session cookies and API keys cannot replace a collector token")
	}
	for _, suffix := range []string{"?limit=0", "?limit=501", "?offset=-1", "?offset=1000001", "?access_token=" + valid} {
		code, _, _ = request(t, "", http.MethodGet, export+suffix, nil, valid)
		require.NotEqual(t, http.StatusOK, code)
	}
	code, _, _ = request(t, "", http.MethodGet, strings.Replace(export, owner.OrganizationID.String(), otherOrg.ID.String(), 1), nil, valid)
	require.Equal(t, 403, code)
	dbgen.AuditLog(t, db, database.AuditLog{OrganizationID: otherOrg.ID})
	for _, filter := range []string{"", "?q=" + url.QueryEscape("organization:"+otherOrg.ID.String())} {
		code, raw, headers := request(t, "", http.MethodGet, export+filter, nil, valid)
		require.Equal(t, http.StatusOK, code, string(raw))
		require.Equal(t, "no-store", headers.Get("Cache-Control"))
		var logs codersdk.AuditLogResponse
		require.NoError(t, json.Unmarshal(raw, &logs))
		require.NotEmpty(t, logs.AuditLogs)
		for _, log := range logs.AuditLogs {
			require.Equal(t, owner.OrganizationID, log.Organization.ID)
		}
	}
	code, raw, _ = request(t, client.SessionToken(), http.MethodDelete, base+"/"+created.ID.String(), nil, "")
	require.Equal(t, http.StatusNoContent, code, string(raw))
	code, _, _ = request(t, "", http.MethodGet, export, nil, valid)
	require.Equal(t, http.StatusForbidden, code, "revocation invalidates previously issued tokens")
	_, err = db.InsertAuditCollector(dbauthz.AsSystemRestricted(ctx), database.InsertAuditCollectorParams{
		ID: uuid.New(), OrganizationID: owner.OrganizationID, Kind: "audit", Name: "Expired", Issuer: config.Issuer,
		Subject: grant.Subject, ClientID: grant.ClientID, CreatedBy: owner.UserID, CreatedAt: time.Now().Add(-time.Hour), ExpiresAt: time.Now().Add(-time.Minute),
	})
	require.NoError(t, err)
	code, _, _ = request(t, "", http.MethodGet, export, nil, valid)
	require.Equal(t, http.StatusForbidden, code)
}
