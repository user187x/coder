//go:build linux

package workspacelockdown

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProjectedPolicy(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "modes")
	mode, err := readPolicy("file:" + path)
	require.NoError(t, err)
	require.Equal(t, "off", mode)
	require.NoError(t, os.WriteFile(path, []byte("network,sudo,freeze\n"), 0o600))
	mode, err = readPolicy("file:" + path)
	require.NoError(t, err)
	modes, err := parseModes(mode)
	require.NoError(t, err)
	require.Equal(t, map[string]bool{"network": true, "sudo": true, "freeze": true}, modes)
	_, err = parseModes("unexpected")
	require.Error(t, err)
}

func TestSudoPolicy(t *testing.T) {
	t.Parallel()
	root, err := os.OpenRoot(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { _ = root.Close() })
	require.NoError(t, root.MkdirAll("etc/sudoers.d", 0o755))
	for range 2 {
		require.NoError(t, setSudo(root, map[string]bool{"sudo": true}))
		data, err := root.ReadFile(sudoRule)
		require.NoError(t, err)
		require.Equal(t, sudoDeny, string(data))
		info, err := root.Stat(sudoRule)
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0o440), info.Mode().Perm())
	}
	require.NoError(t, setSudo(root, nil))
	_, err = root.Stat(sudoRule)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestPeerAddresses(t *testing.T) {
	t.Parallel()
	got, err := addresses("192.0.2.3/24 10.0.0.1 10.0.0.1")
	require.NoError(t, err)
	require.Equal(t, []string{"10.0.0.1", "192.0.2.0/24"}, got)
	for _, invalid := range []string{"-j ACCEPT", "0.0.0.0/33", "not-an-ip"} {
		_, err = addresses(invalid)
		require.Error(t, err)
	}
}
