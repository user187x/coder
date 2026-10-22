package workspaceapps

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Platform: a path-based app is told its base path (X-Forwarded-Prefix), without the trailing slash.
func TestForwardedPrefix(t *testing.T) {
	t.Parallel()
	require.Equal(t, "/@admin/skibbity.main/apps/nifi", forwardedPrefix("/@admin/skibbity.main/apps/nifi/"))
	require.Equal(t, "/@admin/skibbity.main/apps/nifi", forwardedPrefix("/@admin/skibbity.main/apps/nifi"))
	require.Equal(t, "X-Forwarded-Prefix", forwardedPrefixHeader)
}
