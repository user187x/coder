//go:build linux

package workspacestats

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMetrics(t *testing.T) {
	t.Parallel()
	network, err := networkTotals(" lo: 500 0 0 0 0 0 0 0 800\n eth0: 3000 0 0 0 0 0 0 0 200\n tun0: 51 0 0 0 0 0 0 0 42\n")
	require.NoError(t, err)
	require.Equal(t, "3051 242", network)
	require.Equal(t, float64(25<<30), volumeBytes("25Gi"))
	require.Equal(t, float64(1.5e9), volumeBytes("1.5G"))
	require.Equal(t, 0.0, volumeBytes("broken"))
	require.Equal(t, "0.80 / 2 cores (40%)", formatLoad(0.8, 2))
	home := t.TempDir()
	p := filepath.Join(home, "data")
	require.NoError(t, os.WriteFile(p, make([]byte, 8192), 0o600))
	before, err := allocatedBytes(context.Background(), home)
	require.NoError(t, err)
	require.NoError(t, os.Link(p, filepath.Join(home, "alias")))
	after, err := allocatedBytes(context.Background(), home)
	require.NoError(t, err)
	require.Equal(t, before, after)
}
