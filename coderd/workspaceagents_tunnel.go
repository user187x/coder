package coderd

import (
	"net/http"

	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

// @Summary Get authenticated workspace tunnel identity
// @ID get-workspace-agent-tunnel-identity
// @Security CoderSessionToken
// @Produce json
// @Tags Agents
// @Success 200 {object} agentsdk.TunnelIdentity
// @Router /api/v2/workspaceagents/me/tunnel-identity [get]
// @x-apidocgen {"skip": true}
func (api *API) workspaceAgentTunnelIdentity(rw http.ResponseWriter, r *http.Request) {
	build := httpmw.LatestBuild(r)
	workspace, err := api.Database.GetWorkspaceByID(r.Context(), build.WorkspaceID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, agentsdk.TunnelIdentity{
		AgentID: httpmw.WorkspaceAgent(r).ID, WorkspaceID: workspace.ID,
		OrganizationID: workspace.OrganizationID, BuildID: build.ID,
	})
}
