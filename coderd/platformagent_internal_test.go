package coderd

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestPlatformAgentDisablesTemplateScripts(t *testing.T) {
	t.Parallel()
	api := &API{Options: &Options{PlatformAgentDirectory: "/etc/coder-platform-agent"}}
	payload, version, err := api.templateDecoratorPayload(t.Context())
	require.NoError(t, err)
	require.Nil(t, payload)
	require.Equal(t, uuid.Nil, version)
}
