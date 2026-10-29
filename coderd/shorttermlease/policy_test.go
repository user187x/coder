package shorttermlease_test

import (
	"database/sql"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/shorttermlease"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAccountScope(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	now := time.Now()
	row := database.ShortTermLease{WorkspaceID: uuid.NullUUID{UUID: id, Valid: true}, ExpiresAt: now.Add(time.Minute)}
	for _, test := range []struct {
		method, path string
		allowed      bool
	}{
		{"GET", "/api/v2/users/me", true},
		{"GET", "/api/v2/users/first", true},
		{"POST", "/api/v2/users/first", false},
		{"GET", "/__coder-ui/boot.js", true},
		{"GET", "/__coder-ui/logo", true},
		{"PUT", "/api/v2/users/me/appearance", false},
		{"GET", "/api/v2/workspaces/" + id.String(), true},
		{"GET", "/api/v2/workspaces/" + uuid.NewString(), false},
		{"POST", "/api/v2/short-term-lease/extension", true},
		{"POST", "/api/v2/users/me/keys", false},
		{"POST", "/api/v2/users/me/workspaces", false},
		{"PATCH", "/api/v2/users/me", false},
		{"GET", "/api/v2/workspaceagents/" + uuid.NewString() + "/pty", false},
		{"POST", "/@lease/browser/apps/neko-browser/sessions/test", true},
		{"GET", "/@lease/browser/apps/file-browser/", false},
		{"POST", "/__coder-ui/api/quota", false},
		{"GET", "/__coder-ui/api/cloud-drive", false},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, test.allowed, shorttermlease.Allowed(row, httptest.NewRequest(test.method, test.path, nil)))
		})
	}
	require.True(t, shorttermlease.Active(row, now))
	require.False(t, shorttermlease.Active(row, row.ExpiresAt))
	row.RevokedAt = sql.NullTime{Time: now, Valid: true}
	require.False(t, shorttermlease.Active(row, now))
}
