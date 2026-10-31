package provisionerdserver_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/platformagent"
	"github.com/coder/coder/v2/coderd/provisionerdserver"
	sdkproto "github.com/coder/coder/v2/provisionersdk/proto"
)

func TestPlatformAgentRows(t *testing.T) {
	t.Parallel()
	config := &platformagent.Config{
		Scripts:  []*sdkproto.Script{{DisplayName: "Platform", Script: "echo platform", RunOnStart: true, StartBlocksLogin: true}},
		Metadata: []*sdkproto.Agent_Metadata{{Key: "platform", DisplayName: "Platform", Script: "echo metric", Interval: 10, Timeout: 1}},
	}
	for _, tc := range []struct {
		name     string
		platform bool
	}{
		{name: "workspace build", platform: true},
		{name: "template import or dry run"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := t.Context()
			db, _ := dbtestutil.NewDB(t)
			job := dbgen.ProvisionerJob(t, db, nil, database.ProvisionerJob{})
			agentID := uuid.New()
			resource := &sdkproto.Resource{Name: "workspace", Type: "kubernetes_pod_v1", Agents: []*sdkproto.Agent{{Id: agentID.String(), Name: "dev", OperatingSystem: "linux"}}}
			opts := []provisionerdserver.InsertWorkspaceResourceOption{provisionerdserver.InsertWorkspaceResourceWithAgentIDsFromProto()}
			if tc.platform {
				opts = append(opts, provisionerdserver.InsertWorkspaceResourceWithPlatformAgent(config))
			}
			require.NoError(t, provisionerdserver.InsertWorkspaceResource(ctx, db, job.ID, database.WorkspaceTransitionStart, resource, opts...))
			scripts, err := db.GetWorkspaceAgentScriptsByAgentIDs(ctx, []uuid.UUID{agentID})
			require.NoError(t, err)
			metadata, err := db.GetWorkspaceAgentMetadata(ctx, database.GetWorkspaceAgentMetadataParams{WorkspaceAgentID: agentID})
			require.NoError(t, err)
			if tc.platform {
				require.Len(t, scripts, 1)
				require.Equal(t, "echo platform", scripts[0].Script)
				require.True(t, scripts[0].StartBlocksLogin)
				require.NotEqual(t, uuid.Nil, scripts[0].LogSourceID)
				require.Len(t, metadata, 1)
				require.Equal(t, "echo metric", metadata[0].Script)
			} else {
				require.Empty(t, scripts)
				require.Empty(t, metadata)
			}
		})
	}
}
