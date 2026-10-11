package codersdk

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"
)

type GitSSHKey struct {
	UserID    uuid.UUID `json:"user_id" format:"uuid"`
	CreatedAt time.Time `json:"created_at" format:"date-time"`
	UpdatedAt time.Time `json:"updated_at" format:"date-time"`
	// PublicKey is the SSH public key in OpenSSH format.
	// Example: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID3OmYJvT7q1cF1azbybYy0OZ9yrXfA+M6Lr4vzX5zlp\n"
	// Note: The key includes a trailing newline (\n).
	PublicKey string `json:"public_key"`
}

// GitSSHKey returns the user's git SSH public key.
func (c *Client) GitSSHKey(ctx context.Context, user string) (GitSSHKey, error) {
	res, err := c.Request(ctx, http.MethodGet, fmt.Sprintf("/api/v2/users/%s/gitsshkey", user), nil)
	if err != nil {
		return GitSSHKey{}, xerrors.Errorf("execute request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return GitSSHKey{}, ReadBodyAsError(res)
	}

	var gitsshkey GitSSHKey
	return gitsshkey, ReadBodyAsJSON(res, &gitsshkey)
}

// RegenerateGitSSHKey will create a new SSH key pair for the user and return it.
func (c *Client) RegenerateGitSSHKey(ctx context.Context, user string) (GitSSHKey, error) {
	res, err := c.Request(ctx, http.MethodPut, fmt.Sprintf("/api/v2/users/%s/gitsshkey", user), nil)
	if err != nil {
		return GitSSHKey{}, xerrors.Errorf("execute request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return GitSSHKey{}, ReadBodyAsError(res)
	}

	var gitsshkey GitSSHKey
	return gitsshkey, ReadBodyAsJSON(res, &gitsshkey)
}

// ImportGitSSHKeyRequest is a private key the user brings as their Git SSH key
// (platform: the key of their PKCS#12 certificate).
type ImportGitSSHKeyRequest struct {
	// PrivateKey is an unencrypted PEM private key (PKCS#8, PKCS#1, SEC 1 or
	// OpenSSH): RSA of 2048 bits or more, ECDSA on P-256/384/521, or Ed25519.
	PrivateKey string `json:"private_key" validate:"required"`
}

// ImportGitSSHKey replaces the user's SSH key pair with the given private key's.
func (c *Client) ImportGitSSHKey(ctx context.Context, user string, req ImportGitSSHKeyRequest) (GitSSHKey, error) {
	res, err := c.Request(ctx, http.MethodPut, fmt.Sprintf("/api/v2/users/%s/gitsshkey/import", user), req)
	if err != nil {
		return GitSSHKey{}, xerrors.Errorf("execute request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return GitSSHKey{}, ReadBodyAsError(res)
	}

	var gitsshkey GitSSHKey
	return gitsshkey, ReadBodyAsJSON(res, &gitsshkey)
}
