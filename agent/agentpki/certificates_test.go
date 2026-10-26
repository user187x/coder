package agentpki_test

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/afero"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentpki"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

func TestCertificateLifecycle(t *testing.T) {
	t.Parallel()
	files := afero.NewMemMapFs()
	require.NoError(t, files.MkdirAll("/home/coder", 0o700))
	secret := agentsdk.WorkspaceSecret{FilePath: "~/.cert/.alice.p12.b64", Value: []byte(base64.StdEncoding.EncodeToString([]byte("certificate one")))}
	result, err := agentpki.Sync(files, "/home/coder", "alice", []agentsdk.WorkspaceSecret{secret})
	require.NoError(t, err)
	require.True(t, result.Installed)
	require.Equal(t, []string{secret.FilePath}, result.Handled)
	data, err := afero.ReadFile(files, "/home/coder/.cert/alice.p12")
	require.NoError(t, err)
	require.Equal(t, "certificate one", string(data))
	info, err := files.Stat("/home/coder/.cert/alice.p12")
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	secret.Value = []byte("invalid-base64")
	_, err = agentpki.Sync(files, "/home/coder", "alice", []agentsdk.WorkspaceSecret{secret})
	require.Error(t, err)
	data, err = afero.ReadFile(files, "/home/coder/.cert/alice.p12")
	require.NoError(t, err)
	require.Equal(t, "certificate one", string(data))
	require.NoError(t, afero.WriteFile(files, "/home/coder/.cert/manual.p12", []byte("manual"), 0o600))
	_, err = agentpki.Sync(files, "/home/coder", "alice", nil)
	require.NoError(t, err)
	_, err = files.Stat("/home/coder/.cert/alice.p12")
	require.True(t, os.IsNotExist(err))
	data, err = afero.ReadFile(files, "/home/coder/.cert/manual.p12")
	require.NoError(t, err)
	require.Equal(t, "manual", string(data))
}

func TestRenameAndPreferCurrentOwner(t *testing.T) {
	t.Parallel()
	files := afero.NewMemMapFs()
	require.NoError(t, files.MkdirAll("/home/coder", 0o700))
	old := agentsdk.WorkspaceSecret{FilePath: "~/.cert/.alice.p12.b64", Value: []byte(base64.StdEncoding.EncodeToString([]byte("old")))}
	_, err := agentpki.Sync(files, "/home/coder", "alice", []agentsdk.WorkspaceSecret{old})
	require.NoError(t, err)
	current := agentsdk.WorkspaceSecret{FilePath: "~/.cert/.bob.p12.b64", Value: []byte(base64.StdEncoding.EncodeToString([]byte("new")))}
	_, err = agentpki.Sync(files, "/home/coder", "bob", []agentsdk.WorkspaceSecret{old, current})
	require.NoError(t, err)
	data, err := afero.ReadFile(files, "/home/coder/.cert/bob.p12")
	require.NoError(t, err)
	require.Equal(t, "new", string(data))
	_, err = files.Stat("/home/coder/.cert/alice.p12")
	require.True(t, os.IsNotExist(err))
}

func TestRejectSymlinkDirectory(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	outside := t.TempDir()
	require.NoError(t, os.Symlink(outside, filepath.Join(home, ".cert")))
	secret := agentsdk.WorkspaceSecret{FilePath: "~/.cert/.alice.p12.b64", Value: []byte(base64.StdEncoding.EncodeToString([]byte("private")))}
	_, err := agentpki.Sync(afero.NewOsFs(), home, "alice", []agentsdk.WorkspaceSecret{secret})
	require.Error(t, err)
	entries, err := os.ReadDir(outside)
	require.NoError(t, err)
	require.Empty(t, entries)
}
