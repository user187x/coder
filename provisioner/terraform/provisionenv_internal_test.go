package terraform

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/provisionersdk/proto"
)

func TestProvisionEnvWorkspaceVMBuildID(t *testing.T) {
	t.Parallel()

	for _, buildID := range []string{uuid.NewString(), ""} {
		t.Run("BuildID="+buildID, func(t *testing.T) {
			t.Parallel()
			env, err := provisionEnv(&proto.Config{}, &proto.Metadata{
				WorkspaceBuildId: buildID,
			}, nil, nil, nil)
			require.NoError(t, err)
			require.Equal(t, buildID, safeEnvironValue(env, "TF_VAR_workspace_vm_build_id"))
		})
	}
}
