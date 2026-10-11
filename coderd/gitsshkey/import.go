package gitsshkey

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"

	"golang.org/x/crypto/ssh"
	"golang.org/x/xerrors"
)

// MinImportRSABits is the smallest RSA key Import accepts.
const MinImportRSABits = 2048

// Import turns a PEM private key (PKCS#8 "PRIVATE KEY", PKCS#1 "RSA PRIVATE
// KEY", SEC 1 "EC PRIVATE KEY" or "OPENSSH PRIVATE KEY", unencrypted) into a
// key pair in the formats Generate returns: RSA (2048 bits or more), ECDSA on
// P-256, P-384 or P-521, or Ed25519. Platform: users bring the key of their
// PKCS#12 certificate.
func Import(privateKeyPEM []byte) (privateKey string, publicKey string, err error) {
	if block, _ := pem.Decode(privateKeyPEM); block == nil {
		return "", "", xerrors.New("no PEM private key found")
	}
	raw, err := ssh.ParseRawPrivateKey(privateKeyPEM)
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return "", "", xerrors.New("the private key is encrypted; decrypt it first")
		}
		return "", "", xerrors.Errorf("parse private key: %w", err)
	}
	switch key := raw.(type) {
	case *rsa.PrivateKey:
		if key.N.BitLen() < MinImportRSABits {
			return "", "", xerrors.Errorf("RSA keys must have at least %d bits (this one has %d)", MinImportRSABits, key.N.BitLen())
		}
		if err := key.Validate(); err != nil {
			return "", "", xerrors.Errorf("invalid RSA key: %w", err)
		}
		return generateKeys(pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}, key)
	case *ecdsa.PrivateKey:
		switch key.Curve {
		case elliptic.P256(), elliptic.P384(), elliptic.P521():
		default:
			return "", "", xerrors.New("ECDSA keys must be on P-256, P-384 or P-521")
		}
		byt, err := x509.MarshalECPrivateKey(key)
		if err != nil {
			return "", "", xerrors.Errorf("marshal private key: %w", err)
		}
		return generateKeys(pem.Block{Type: "EC PRIVATE KEY", Bytes: byt}, key)
	case ed25519.PrivateKey:
		return importEd25519(key)
	case *ed25519.PrivateKey:
		return importEd25519(*key)
	default:
		return "", "", xerrors.Errorf("unsupported key type %T: RSA, ECDSA or Ed25519 expected", raw)
	}
}

func importEd25519(key ed25519.PrivateKey) (string, string, error) {
	byt, err := MarshalED25519PrivateKey(key)
	if err != nil {
		return "", "", xerrors.Errorf("marshal ed25519 private key: %w", err)
	}
	return generateKeys(pem.Block{Type: "OPENSSH PRIVATE KEY", Bytes: byt}, crypto.Signer(key))
}
