package coderd

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/codersdk"
)

// Delete template version
//
// Platform: a version deleted from its template's history, for good (Coder only archives). Refused for the active
// version, one still building, and one a workspace runs (its latest build); the builds that used it in workspaces'
// history go with it.
//
// @Summary Delete template version
// @ID delete-template-version
// @Security CoderSessionToken
// @Produce json
// @Tags Templates
// @Param templateversion path string true "Template version ID" format(uuid)
// @Success 200 {object} codersdk.Response
// @Router /api/v2/templateversions/{templateversion} [delete]
func (api *API) deleteTemplateVersion(rw http.ResponseWriter, r *http.Request) {
	var (
		ctx               = r.Context()
		templateVersion   = httpmw.TemplateVersionParam(r)
		auditor           = *api.Auditor.Load()
		aReq, commitAudit = audit.InitRequest[database.TemplateVersion](rw, &audit.RequestParams{
			Audit:          auditor,
			Log:            api.Logger,
			Request:        r,
			Action:         database.AuditActionDelete,
			OrganizationID: templateVersion.OrganizationID,
		})
	)
	defer commitAudit()
	aReq.Old = templateVersion

	if templateVersion.TemplateID.Valid {
		template, err := api.Database.GetTemplateByID(ctx, templateVersion.TemplateID.UUID)
		if httpapi.Is404Error(err) {
			httpapi.ResourceNotFound(rw)
			return
		}
		if err != nil {
			httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
				Message: "Internal error fetching the template.",
				Detail:  err.Error(),
			})
			return
		}
		if !api.Authorize(r, policy.ActionUpdate, template) {
			httpapi.ResourceNotFound(rw)
			return
		}
		if template.ActiveVersionID == templateVersion.ID {
			httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{
				Message: "The active version cannot be deleted: promote another version first.",
			})
			return
		}
	}

	job, err := api.Database.GetProvisionerJobByID(ctx, templateVersion.JobID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching the version's job.",
			Detail:  err.Error(),
		})
		return
	}
	if job.JobStatus == database.ProvisionerJobStatusPending || job.JobStatus == database.ProvisionerJobStatusRunning {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{
			Message: "The version is still building: cancel it first.",
		})
		return
	}

	//nolint:gocritic // Every user's workspaces count, not only those the requester can see.
	running, err := api.Database.GetWorkspaceNamesRunningTemplateVersion(dbauthz.AsSystemRestricted(ctx), templateVersion.ID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error checking the workspaces on the version.",
			Detail:  err.Error(),
		})
		return
	}
	if len(running) > 0 {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{
			Message: fmt.Sprintf("%d workspace(s) run this version: update them to another version first.", len(running)),
			Detail:  strings.Join(running, ", "),
		})
		return
	}

	if err := api.Database.DeleteTemplateVersionByID(ctx, templateVersion.ID); err != nil {
		if httpapi.IsUnauthorizedError(err) {
			httpapi.ResourceNotFound(rw)
			return
		}
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error deleting the version.",
			Detail:  err.Error(),
		})
		return
	}
	httpapi.Write(ctx, rw, http.StatusOK, codersdk.Response{
		Message: fmt.Sprintf("Template version %q deleted.", templateVersion.Name),
	})
}
