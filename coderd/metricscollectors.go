package coderd

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/codersdk"
)

// @Summary Collect organization metrics with a Keycloak access token
// @ID collect-organization-metrics-with-a-keycloak-access-token
// @Security Authorization
// @Tags Audit
// @Produce json
// @Param organization path string true "Organization ID"
// @Param Authorization header string true "Bearer access token with coder-metrics audience and coder:metrics:read scope"
// @Param format query string false "prometheus answers in the Prometheus text exposition format (text/plain); JSON otherwise" Enums(json,prometheus)
// @Success 200 {object} codersdk.OrganizationMetrics
// @Failure 401 {object} codersdk.OAuth2Error
// @Failure 403 {object} codersdk.OAuth2Error
// @Router /api/v2/metrics-export/{organization} [get]
func (api *API) externalMetrics(rw http.ResponseWriter, r *http.Request) {
	ctx, orgID, ok := api.verifyCollector(rw, r, metricsCollectorKind)
	if !ok {
		return
	}
	format := r.URL.Query().Get("format")
	if format != "" && format != "json" && format != "prometheus" {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "Use format=json or format=prometheus."})
		return
	}
	org, err := api.Database.GetOrganizationByID(ctx, orgID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	members, err := api.Database.OrganizationMembers(ctx, database.OrganizationMembersParams{
		OrganizationID: orgID, UserID: uuid.Nil, IncludeSystem: false, GithubUserID: 0,
	})
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	templates, err := api.Database.GetTemplatesWithFilter(ctx, database.GetTemplatesWithFilterParams{OrganizationID: orgID})
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	workspaces, err := api.Database.GetWorkspaces(ctx, database.GetWorkspacesParams{OrganizationID: orgID})
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	out := codersdk.OrganizationMetrics{
		OrganizationID: orgID, Organization: org.Name, CollectedAt: dbtime.Now(),
		Members: int64(len(members)), Templates: int64(len(templates)), WorkspaceStates: []codersdk.WorkspaceStateCount{},
	}
	states := map[[2]string]int64{}
	for _, w := range workspaces {
		out.Workspaces++
		states[[2]string{string(w.LatestBuildTransition), string(w.LatestBuildStatus)}]++
	}
	for key, count := range states {
		out.WorkspaceStates = append(out.WorkspaceStates, codersdk.WorkspaceStateCount{
			Transition: codersdk.WorkspaceTransition(key[0]), Status: codersdk.ProvisionerJobStatus(key[1]), Count: count,
		})
	}
	sort.Slice(out.WorkspaceStates, func(i, j int) bool {
		a, b := out.WorkspaceStates[i], out.WorkspaceStates[j]
		if a.Transition != b.Transition {
			return a.Transition < b.Transition
		}
		return a.Status < b.Status
	})
	if format != "prometheus" {
		httpapi.Write(ctx, rw, http.StatusOK, out)
		return
	}
	rw.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write([]byte(prometheusOrganizationMetrics(out)))
}

// prometheusOrganizationMetrics writes the metrics in the Prometheus text
// exposition format (version 0.0.4), each labeled with the organization.
func prometheusOrganizationMetrics(m codersdk.OrganizationMetrics) string {
	var b strings.Builder
	org := `organization="` + prometheusLabel(m.Organization) + `"`
	gauge := func(name, help string) {
		_, _ = fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s gauge\n", name, help, name)
	}
	gauge("coder_organization_members", "Members of the organization.")
	_, _ = fmt.Fprintf(&b, "coder_organization_members{%s} %d\n", org, m.Members)
	gauge("coder_organization_templates", "Templates of the organization.")
	_, _ = fmt.Fprintf(&b, "coder_organization_templates{%s} %d\n", org, m.Templates)
	gauge("coder_organization_workspaces", "Workspaces of the organization.")
	_, _ = fmt.Fprintf(&b, "coder_organization_workspaces{%s} %d\n", org, m.Workspaces)
	gauge("coder_organization_workspace_states", "Workspaces of the organization by their latest build's transition and status.")
	for _, s := range m.WorkspaceStates {
		_, _ = fmt.Fprintf(&b, "coder_organization_workspace_states{%s,transition=\"%s\",status=\"%s\"} %d\n",
			org, prometheusLabel(string(s.Transition)), prometheusLabel(string(s.Status)), s.Count)
	}
	return b.String()
}

// prometheusLabel escapes a label value: backslash, double quote and newline.
func prometheusLabel(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(s)
}
