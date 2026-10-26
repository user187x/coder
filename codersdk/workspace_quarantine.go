package codersdk

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// WorkspaceQuarantine is containment intent, not a claim of physical enforcement.
type WorkspaceQuarantine struct {
	OrganizationID      uuid.UUID `json:"organization_id" format:"uuid"`
	WorkspaceID         uuid.UUID `json:"workspace_id" format:"uuid"`
	Enabled             bool      `json:"enabled"`
	Revision            uuid.UUID `json:"revision" format:"uuid"`
	Reason              string    `json:"reason"`
	UpdatedBy           uuid.UUID `json:"updated_by" format:"uuid"`
	UpdatedAt           time.Time `json:"updated_at" format:"date-time"`
	ManualStartRequired bool      `json:"manual_start_required"`
}

// UpdateWorkspaceQuarantineRequest changes policy without starting the workspace.
type UpdateWorkspaceQuarantineRequest struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason"`
}

// WorkspaceQuarantine reads one organization's workspace containment policy.
func (c *Client) WorkspaceQuarantine(ctx context.Context, organizationID, workspaceID uuid.UUID) (WorkspaceQuarantine, error) {
	return c.workspaceQuarantine(ctx, http.MethodGet, organizationID, workspaceID, nil)
}

// UpdateWorkspaceQuarantine changes policy. Release requires a fresh explicit Start.
func (c *Client) UpdateWorkspaceQuarantine(ctx context.Context, organizationID, workspaceID uuid.UUID, request UpdateWorkspaceQuarantineRequest) (WorkspaceQuarantine, error) {
	return c.workspaceQuarantine(ctx, http.MethodPut, organizationID, workspaceID, request)
}

func (c *Client) workspaceQuarantine(ctx context.Context, method string, organizationID, workspaceID uuid.UUID, body any) (WorkspaceQuarantine, error) {
	response, err := c.Request(ctx, method, fmt.Sprintf("/api/v2/organizations/%s/workspaces/%s/quarantine", organizationID, workspaceID), body)
	if err != nil {
		return WorkspaceQuarantine{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return WorkspaceQuarantine{}, ReadBodyAsError(response)
	}
	var out WorkspaceQuarantine
	err = json.NewDecoder(response.Body).Decode(&out)
	return out, err
}
