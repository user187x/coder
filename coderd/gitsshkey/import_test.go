package gitsshkey_test

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"

	"github.com/coder/coder/v2/coderd/gitsshkey"
)

func pkcs8PEM(t *testing.T, key any) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func TestImport(t *testing.T) {
	t.Parallel()

	same := func(t *testing.T, want any, private, public string) {
		t.Helper()
		signer, err := ssh.ParsePrivateKey([]byte(private))
		require.NoError(t, err)
		require.Equal(t, public, string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
		wantPublic, err := ssh.NewPublicKey(want)
		require.NoError(t, err)
		require.Equal(t, string(ssh.MarshalAuthorizedKey(wantPublic)), public)
	}

	t.Run("RSA", func(t *testing.T) {
		t.Parallel()
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		require.NoError(t, err)
		pv, pb, err := gitsshkey.Import(pkcs8PEM(t, key))
		require.NoError(t, err)
		same(t, &key.PublicKey, pv, pb)
	})
	t.Run("ECDSA", func(t *testing.T) {
		t.Parallel()
		key, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
		require.NoError(t, err)
		pv, pb, err := gitsshkey.Import(pkcs8PEM(t, key))
		require.NoError(t, err)
		same(t, &key.PublicKey, pv, pb)
	})
	t.Run("Ed25519", func(t *testing.T) {
		t.Parallel()
		public, key, err := ed25519.GenerateKey(rand.Reader)
		require.NoError(t, err)
		pv, pb, err := gitsshkey.Import(pkcs8PEM(t, key))
		require.NoError(t, err)
		same(t, public, pv, pb)
	})
	t.Run("SmallRSA", func(t *testing.T) {
		t.Parallel()
		key, err := rsa.GenerateKey(rand.Reader, 1024)
		require.NoError(t, err)
		_, _, err = gitsshkey.Import(pkcs8PEM(t, key))
		require.ErrorContains(t, err, "at least 2048")
	})
	t.Run("P224", func(t *testing.T) {
		t.Parallel()
		key, err := ecdsa.GenerateKey(elliptic.P224(), rand.Reader)
		require.NoError(t, err)
		_, _, err = gitsshkey.Import(pkcs8PEM(t, key))
		require.Error(t, err)
	})
	t.Run("NotPEM", func(t *testing.T) {
		t.Parallel()
		_, _, err := gitsshkey.Import([]byte("ssh-ed25519 AAAA"))
		require.ErrorContains(t, err, "no PEM")
	})
}
