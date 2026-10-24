package agentsdk

import "github.com/google/uuid"

// TunnelIdentity identifies the current build authenticated by an agent token.
type TunnelIdentity struct {
	AgentID        uuid.UUID `json:"agent_id" format:"uuid"`
	WorkspaceID    uuid.UUID `json:"workspace_id" format:"uuid"`
	OrganizationID uuid.UUID `json:"organization_id" format:"uuid"`
	BuildID        uuid.UUID `json:"build_id" format:"uuid"`
}
