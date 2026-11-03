package coderd

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/codersdk"
)

func TestPlatformStartQuotaSkipsNonUserAllocations(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		transition codersdk.WorkspaceTransition
		owner      uuid.UUID
		token      string
	}{
		{"stop", codersdk.WorkspaceTransitionStop, uuid.New(), "token"},
		{"delete", codersdk.WorkspaceTransitionDelete, uuid.New(), "token"},
		{"prebuild", codersdk.WorkspaceTransitionStart, database.PrebuildsSystemUserID, "token"},
		{"system", codersdk.WorkspaceTransitionStart, uuid.New(), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			api := &API{}
			require.NoError(t, api.checkPlatformStartQuota(context.Background(), nil, tc.token, uuid.New(), database.Workspace{OwnerID: tc.owner}, codersdk.CreateWorkspaceBuildRequest{Transition: tc.transition}, nil))
		})
	}
}
