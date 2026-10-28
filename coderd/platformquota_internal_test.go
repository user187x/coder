package coderd

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/codersdk"
)

func TestPlatformAllocationIncreased(t *testing.T) {
	t.Parallel()
	params := func(cpu, memory string) []codersdk.WorkspaceBuildParameter {
		return []codersdk.WorkspaceBuildParameter{{Name: "cpu", Value: cpu}, {Name: "memory", Value: memory}}
	}
	for _, tc := range []struct {
		name, cpu, memory string
		want              bool
	}{
		{"unchanged", "2", "4", false}, {"smaller", "1", "2", false}, {"cpu larger memory smaller", "3", "2", true}, {"memory larger", "2", "8", true}, {"nonfinite", "NaN", "4", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tc.want, platformAllocationIncreased(params("2", "4"), params(tc.cpu, tc.memory)))
		})
	}
	require.True(t, platformAllocationIncreased(nil, params("1", "2")))
}

func TestPlatformDiskAllocationIncreased(t *testing.T) {
	t.Parallel()
	previous := []codersdk.WorkspaceBuildParameter{{Name: "home_disk_size", Value: "10"}}
	require.True(t, platformAllocationIncreased(previous, []codersdk.WorkspaceBuildParameter{{Name: "home_disk_size", Value: "20"}}))
	require.False(t, platformAllocationIncreased(previous, previous))
	require.False(t, platformAllocationIncreased(previous, []codersdk.WorkspaceBuildParameter{{Name: "home_disk_size", Value: "5"}}))
}

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
			require.NoError(t, api.checkPlatformStartQuota(context.Background(), tc.token, uuid.New(), database.Workspace{OwnerID: tc.owner}, codersdk.CreateWorkspaceBuildRequest{Transition: tc.transition}, nil))
		})
	}
}
