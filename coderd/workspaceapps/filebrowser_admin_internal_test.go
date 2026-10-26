package workspaceapps

import (
	"testing"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/testutil"
)

func TestFileBrowserDeploymentOwnerAccess(t *testing.T) {
	t.Parallel()
	ownerID, otherID, orgID := uuid.New(), uuid.New(), uuid.New()
	provider := &DBTokenProvider{
		Authorizer:       rbac.NewAuthorizer(prometheus.NewRegistry()),
		DeploymentValues: &codersdk.DeploymentValues{},
	}
	for _, tc := range []struct {
		name          string
		userID        uuid.UUID
		roles         rbac.RoleIdentifiers
		scope         rbac.ExpandableScope
		app           string
		authenticated bool
		want          bool
	}{
		{"workspace owner", ownerID, rbac.RoleIdentifiers{rbac.RoleMember(), rbac.ScopedRoleOrgWorkspaceAccess(orgID)}, rbac.ScopeAll, "filebrowser", true, true},
		{"deployment owner", otherID, rbac.RoleIdentifiers{rbac.RoleOwner()}, rbac.ScopeAll, "filebrowser", true, true},
		{"unrelated member", otherID, rbac.RoleIdentifiers{rbac.RoleMember(), rbac.ScopedRoleOrgWorkspaceAccess(orgID)}, rbac.ScopeAll, "filebrowser", true, false},
		{"organization admin", otherID, rbac.RoleIdentifiers{rbac.ScopedRoleOrgAdmin(orgID), rbac.RoleMember()}, rbac.ScopeAll, "filebrowser", true, false},
		{"read only token", otherID, rbac.RoleIdentifiers{rbac.RoleOwner()}, rbac.ScopeWorkspaceRead, "filebrowser", true, false},
		{"other owner only app", otherID, rbac.RoleIdentifiers{rbac.RoleOwner()}, rbac.ScopeAll, "code-server", true, false},
		{"unauthenticated", otherID, nil, rbac.ScopeAll, "filebrowser", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var subject *rbac.Subject
			if tc.authenticated {
				subject = &rbac.Subject{ID: tc.userID.String(), Roles: tc.roles, Scope: tc.scope}
			}
			allowed, _, err := provider.authorizeRequest(testutil.Context(t, testutil.WaitShort), subject, &databaseRequest{
				Request:         Request{AccessMethod: AccessMethodPath, AppSlugOrPort: tc.app},
				Workspace:       database.WorkspaceTable{ID: uuid.New(), OwnerID: ownerID, OrganizationID: orgID},
				App:             database.WorkspaceApp{Slug: tc.app},
				AppSharingLevel: database.AppSharingLevelOwner,
			})
			require.NoError(t, err)
			require.Equal(t, tc.want, allowed)
			if tc.app == "filebrowser" {
				allowed, _, err = provider.authorizeRequest(testutil.Context(t, testutil.WaitShort), subject, &databaseRequest{
					Request:         Request{AccessMethod: AccessMethodSubdomain, AppSlugOrPort: tc.app},
					Workspace:       database.WorkspaceTable{ID: uuid.New(), OwnerID: ownerID, OrganizationID: orgID},
					App:             database.WorkspaceApp{Slug: tc.app},
					AppSharingLevel: database.AppSharingLevelOwner,
				})
				require.NoError(t, err)
				require.Equal(t, tc.want, allowed)
			}
		})
	}
}
