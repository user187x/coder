// Package shorttermlease enforces temporary browser account restrictions.
package shorttermlease

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/google/uuid"
	"golang.org/x/xerrors"
)

// Load returns nil for an ordinary account. Read failures must deny access.
func Load(ctx context.Context, db database.Store, user uuid.UUID) (*database.ShortTermLease, error) {
	//nolint:gocritic // Authentication must read restrictions independently of the caller's roles.
	row, err := db.GetShortTermLeaseByUserID(dbauthz.AsSystemRestricted(ctx), user)
	if xerrors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Active excludes both expired and explicitly revoked credentials.
func Active(row database.ShortTermLease, now time.Time) bool {
	return !row.RevokedAt.Valid && now.Before(row.ExpiresAt)
}

// Allowed limits temporary accounts to their dashboard and browser app. RBAC still checks each resource.
func Allowed(row database.ShortTermLease, r *http.Request) bool {
	p := r.URL.Path
	if strings.HasPrefix(p, "/@") {
		return strings.Contains(p, "/apps/neko-browser/")
	}
	if !strings.HasPrefix(p, "/api/") && !strings.HasPrefix(p, "/__") {
		return r.Method == http.MethodGet
	}
	if p == "/api/v2/short-term-lease" {
		return r.Method == http.MethodGet
	}
	if p == "/api/v2/short-term-lease/extension" || p == "/api/v2/users/logout" || p == "/api/v2/authcheck" {
		return r.Method == http.MethodPost
	}
	if r.Method != http.MethodGet {
		return false
	}
	switch p {
	case "/api/v2/users/first", "/api/v2/users/authmethods", "/api/v2/users/me/appearance", "/api/v2/users/me/preferences", "/__coder-ui/boot.js", "/__coder-ui/logo", "/api/v2/users/me", "/api/v2/workspaces", "/api/v2/buildinfo", "/api/v2/appearance", "/api/v2/experiments", "/api/v2/entitlements", "/api/v2/organizations", "/api/v2/deployment/stats", "/api/v2/users/me/roles":
		return true
	}
	if strings.HasPrefix(p, "/__coder-ui/icons/") || strings.HasPrefix(p, "/__coder-ui/background/") || strings.HasPrefix(p, "/__coder-ui/banner-picture/") {
		return true
	}
	if strings.HasPrefix(p, "/__banner/") {
		return true
	}
	if strings.HasPrefix(p, "/__coder-ui/api/login-page") || strings.HasPrefix(p, "/__coder-ui/api/background") || strings.HasPrefix(p, "/__coder-ui/api/logo") {
		return true
	}
	if row.WorkspaceID.Valid && (p == "/api/v2/workspaces/"+row.WorkspaceID.UUID.String() || p == "/api/v2/workspaces/"+row.WorkspaceID.UUID.String()+"/watch") {
		return true
	}
	if p == "/api/v2/users/"+row.UserID.String()+"/workspace/browser" || p == "/api/v2/users/me/workspace/browser" {
		return true
	}
	return false
}

// AllowedResource permits metadata needed to render only the leased workspace.
func AllowedResource(ctx context.Context, db database.Store, row database.ShortTermLease, r *http.Request) (bool, error) {
	if Allowed(row, r) {
		return true, nil
	}
	if r.Method != http.MethodGet || !row.WorkspaceID.Valid {
		return false, nil
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "v2" {
		return false, nil
	}
	id, err := uuid.Parse(parts[3])
	if err != nil {
		return false, nil
	}
	//nolint:gocritic // Resolve only the resource bound to this temporary account.
	ctx = dbauthz.AsSystemRestricted(ctx)
	switch parts[2] {
	case "templates":
		if len(parts) != 4 {
			return false, nil
		}
		ws, err := db.GetWorkspaceByID(ctx, row.WorkspaceID.UUID)
		return err == nil && ws.TemplateID == id, err
	case "workspacebuilds":
		if len(parts) != 4 && !(len(parts) == 5 && parts[4] == "resources") {
			return false, nil
		}
		build, err := db.GetWorkspaceBuildByID(ctx, id)
		if xerrors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil && build.WorkspaceID == row.WorkspaceID.UUID, err
	case "templateversions":
		if len(parts) != 4 {
			return false, nil
		}
		build, err := db.GetLatestWorkspaceBuildByWorkspaceID(ctx, row.WorkspaceID.UUID)
		return err == nil && build.TemplateVersionID == id, err
	default:
		return false, nil
	}
}
