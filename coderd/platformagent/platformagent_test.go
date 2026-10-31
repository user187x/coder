package platformagent_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/platformagent"
	sdkproto "github.com/coder/coder/v2/provisionersdk/proto"
)

func TestLoad(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, body string
		wantError  bool
	}{
		{name: "valid", body: `{"scripts":[{"display_name":"Lock Down","script":"echo locked","run_on_start":true,"start_blocks_login":true}],"metadata":[{"key":"cpu","script":"coder stat cpu","interval":10,"timeout":5}]}`},
		{name: "unknown field", body: `{"script":[]}`, wantError: true},
		{name: "null script", body: `{"scripts":[null]}`, wantError: true},
		{name: "empty script", body: `{"scripts":[{"display_name":"Lock Down"}]}`, wantError: true},
		{name: "duplicate script", body: `{"scripts":[{"display_name":"x","script":"true"},{"display_name":"x","script":"false"}]}`, wantError: true},
		{name: "duplicate metadata", body: `{"metadata":[{"key":"x","script":"true"},{"key":"x","script":"false"}]}`, wantError: true},
		{name: "negative timing", body: `{"metadata":[{"key":"x","script":"true","timeout":-1}]}`, wantError: true},
		{name: "trailing json", body: `{} {}`, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			require.NoError(t, os.WriteFile(filepath.Join(dir, "agent.json"), []byte(tc.body), 0o600))
			config, err := platformagent.Load(dir)
			if tc.wantError {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Len(t, config.Scripts, 1)
			require.True(t, config.Scripts[0].StartBlocksLogin)
			require.EqualValues(t, 10, config.Metadata[0].Interval)
		})
	}
	t.Run("disabled", func(t *testing.T) {
		t.Parallel()
		config, err := platformagent.Load("")
		require.NoError(t, err)
		require.Empty(t, config.Scripts)
	})
	t.Run("missing bundle refuses build", func(t *testing.T) {
		t.Parallel()
		_, err := platformagent.Load(t.TempDir())
		require.ErrorContains(t, err, "open platform agent configuration")
	})
	t.Run("projected update", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		for _, revision := range []string{"first", "second"} {
			path := filepath.Join(dir, revision)
			require.NoError(t, os.Mkdir(path, 0o700))
			require.NoError(t, os.WriteFile(filepath.Join(path, "agent.json"), []byte(`{"scripts":[{"display_name":"`+revision+`","script":"true"}]}`), 0o600))
			require.NoError(t, os.Symlink(filepath.Join(path, "agent.json"), filepath.Join(dir, "next")))
			require.NoError(t, os.Rename(filepath.Join(dir, "next"), filepath.Join(dir, "agent.json")))
			config, err := platformagent.Load(dir)
			require.NoError(t, err)
			require.Equal(t, revision, config.Scripts[0].DisplayName)
		}
	})
}

func TestAgent(t *testing.T) {
	t.Parallel()
	config := &platformagent.Config{
		Scripts:  []*sdkproto.Script{{DisplayName: "Existing", Script: "platform"}, {DisplayName: "Added", Script: "native"}},
		Metadata: []*sdkproto.Agent_Metadata{{Key: "existing", Script: "platform"}, {Key: "added", Script: "native"}},
	}
	for _, tc := range []struct {
		resource, os string
		applied      bool
	}{
		{resource: "kubernetes_pod_v1", os: "linux", applied: true},
		{resource: "kubernetes_deployment", os: "linux", applied: true},
		{resource: "aws_instance", os: "linux"},
		{resource: "kubernetes_pod_v1", os: "windows"},
		{resource: "kubernetes_service", os: "linux"},
	} {
		t.Run(tc.resource+"/"+tc.os, func(t *testing.T) {
			t.Parallel()
			agent := &sdkproto.Agent{OperatingSystem: tc.os, Scripts: []*sdkproto.Script{{DisplayName: "Existing", Script: "authored"}}, Metadata: []*sdkproto.Agent_Metadata{{Key: "existing", Script: "authored"}}}
			result := config.Agent(tc.resource, agent)
			require.Equal(t, "authored", result.Scripts[0].Script)
			require.Equal(t, "authored", result.Metadata[0].Script)
			if tc.applied {
				require.Len(t, result.Scripts, 2)
				require.Len(t, result.Metadata, 2)
				result.Scripts[1].Script = "changed"
				require.Equal(t, "native", config.Scripts[1].Script)
			}
			require.Len(t, agent.Scripts, 1)
			require.Len(t, agent.Metadata, 1)
		})
	}
}
