package agentsdk

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/coder/coder/v2/codersdk"
)

// WorkspaceAccessPolicy is enforced inside the workspace agent's WireGuard map.
type WorkspaceAccessPolicy struct {
	Enabled      bool        `json:"enabled"`
	Revision     string      `json:"revision"`
	Fingerprint  string      `json:"fingerprint"`
	AllowedPeers []uuid.UUID `json:"allowed_peers"`
}

// SyncWorkspaceAccessRequest acknowledges a policy after successful enforcement.
type SyncWorkspaceAccessRequest struct {
	AppliedPolicy string `json:"applied_policy"`
	Session       string `json:"session"`
}

// SyncWorkspaceAccess advertises policy support and acknowledges the last
// successfully installed policy while retrieving the current one.
func (c *Client) SyncWorkspaceAccess(ctx context.Context, req SyncWorkspaceAccessRequest) (WorkspaceAccessPolicy, error) {
	req.Session = c.workspaceAccessSession
	res, err := c.SDK.Request(ctx, http.MethodPost, "/api/v2/workspaceagents/me/global-lockdown", req)
	if err != nil {
		return WorkspaceAccessPolicy{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return WorkspaceAccessPolicy{}, codersdk.ReadBodyAsError(res)
	}
	var policy WorkspaceAccessPolicy
	err = codersdk.ReadBodyAsJSON(res, &policy)
	return policy, err
}
