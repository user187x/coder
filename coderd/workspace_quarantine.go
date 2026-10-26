package coderd

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/workspacequarantine"
	"github.com/coder/coder/v2/coderd/wspubsub"
	"github.com/coder/coder/v2/codersdk"
	"github.com/google/uuid"
	"golang.org/x/xerrors"
)

func quarantineSDK(row database.WorkspaceQuarantine) codersdk.WorkspaceQuarantine {
	return codersdk.WorkspaceQuarantine{OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Enabled: row.Enabled, Revision: row.Revision, Reason: row.Reason, UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt, ManualStartRequired: row.ManualStartRequired}
}

// @Summary Get workspace quarantine policy
// @ID get-workspace-quarantine
// @Security CoderSessionToken
// @Produce json
// @Tags Workspaces
// @Param organization path string true "Organization ID" format(uuid)
// @Param workspace path string true "Workspace ID" format(uuid)
// @Success 200 {object} codersdk.WorkspaceQuarantine
// @Router /api/v2/organizations/{organization}/workspaces/{workspace}/quarantine [get]
func (api *API) getWorkspaceQuarantine(rw http.ResponseWriter, r *http.Request) {
	ws := httpmw.WorkspaceParam(r)
	if httpmw.OrganizationParam(r).ID != ws.OrganizationID {
		httpapi.ResourceNotFound(rw)
		return
	}
	row, err := workspacequarantine.Load(r.Context(), api.Database, ws.ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	if row.OrganizationID != uuid.Nil && row.OrganizationID != ws.OrganizationID {
		httpapi.InternalServerError(rw, xerrors.New("quarantine organization mismatch"))
		return
	}
	row.OrganizationID = ws.OrganizationID
	httpapi.Write(r.Context(), rw, http.StatusOK, quarantineSDK(row))
}

// @Summary Change workspace quarantine policy
// @ID update-workspace-quarantine
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Workspaces
// @Param organization path string true "Organization ID" format(uuid)
// @Param workspace path string true "Workspace ID" format(uuid)
// @Param request body codersdk.UpdateWorkspaceQuarantineRequest true "Containment policy. Release never starts runtime."
// @Success 200 {object} codersdk.WorkspaceQuarantine
// @Router /api/v2/organizations/{organization}/workspaces/{workspace}/quarantine [put]
func (api *API) putWorkspaceQuarantine(rw http.ResponseWriter, r *http.Request) {
	ws := httpmw.WorkspaceParam(r)
	if httpmw.OrganizationParam(r).ID != ws.OrganizationID {
		httpapi.ResourceNotFound(rw)
		return
	}
	key := httpmw.APIKey(r)
	if !api.globalLockdown.Admin(r.Context(), key.UserID) || !api.HTTPAuth.Authorize(r, policy.ActionUpdate, ws) {
		httpapi.Write(r.Context(), rw, http.StatusForbidden, codersdk.Response{Message: "Only deployment owners with workspace update access may change quarantine."})
		return
	}
	var req struct {
		Enabled *bool  `json:"enabled"`
		Reason  string `json:"reason"`
	}
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if req.Enabled == nil || len(reason) > 1000 || (*req.Enabled && reason == "") {
		httpapi.Write(r.Context(), rw, http.StatusBadRequest, codersdk.Response{Message: "Specify enabled and a reason of at most 1000 bytes; activation requires a reason."})
		return
	}
	auditReq, commit := audit.InitRequest[database.WorkspaceQuarantine](rw, &audit.RequestParams{Audit: *api.Auditor.Load(), Log: api.Logger, Request: r, Action: database.AuditActionWrite, OrganizationID: ws.OrganizationID})
	defer commit()
	var out database.WorkspaceQuarantine
	var canceled bool
	err := api.Database.InTx(func(tx database.Store) error {
		if err := workspacequarantine.Acquire(r.Context(), tx, ws.ID); err != nil {
			return err
		}
		old, err := tx.GetWorkspaceQuarantineByWorkspaceID(r.Context(), ws.ID)
		if xerrors.Is(err, sql.ErrNoRows) {
			old = database.WorkspaceQuarantine{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID}
		} else if err != nil {
			return err
		}
		if old.OrganizationID != ws.OrganizationID {
			return xerrors.New("quarantine organization mismatch")
		}
		auditReq.Old = old
		if old.Enabled == *req.Enabled {
			out = old
			auditReq.New = old
			return nil
		}
		out, err = tx.UpsertWorkspaceQuarantine(r.Context(), database.UpsertWorkspaceQuarantineParams{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID, Enabled: *req.Enabled, Revision: uuid.New(), Reason: reason, UpdatedBy: key.UserID, UpdatedAt: api.Clock.Now()})
		if err != nil {
			return err
		}
		auditReq.New = out
		if *req.Enabled {
			build, err := tx.GetLatestWorkspaceBuildByWorkspaceID(r.Context(), ws.ID)
			if xerrors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			if build.Transition == database.WorkspaceTransitionStart || build.Transition == database.WorkspaceTransitionDelete {
				job, err := tx.GetProvisionerJobByIDWithLock(r.Context(), build.JobID)
				if err != nil {
					return err
				}
				if !job.CompletedAt.Valid && !job.CanceledAt.Valid {
					err = tx.UpdateProvisionerJobWithCancelByID(r.Context(), database.UpdateProvisionerJobWithCancelByIDParams{ID: job.ID, CanceledAt: sql.NullTime{Time: api.Clock.Now(), Valid: true}, CompletedAt: sql.NullTime{Time: api.Clock.Now(), Valid: !job.WorkerID.Valid}})
					if err != nil {
						return err
					}
					canceled = true
				}
			}
		}
		return nil
	}, nil)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	if canceled {
		api.publishWorkspaceUpdate(r.Context(), ws.OwnerID, wspubsub.WorkspaceEvent{Kind: wspubsub.WorkspaceEventKindStateChange, WorkspaceID: ws.ID})
		_ = wspubsub.PublishWorkspaceBuildOrchestrationWake(r.Context(), api.Pubsub)
	}
	if workspacequarantine.Blocked(out) {
		api.workspaceQuarantine.Revoke(ws.ID)
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, quarantineSDK(out))
}

func (api *API) guardWorkspaceQuarantineSession(ctx context.Context, workspaceID uuid.UUID) (context.Context, func(), error) {
	return api.workspaceQuarantine.Guard(ctx, workspaceID)
}

func (api *API) workspaceQuarantineAgentMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if !strings.HasSuffix(path, "/coordinate") && !strings.HasSuffix(path, "/listening-ports") && !strings.Contains(path, "/containers") {
			next.ServeHTTP(rw, r)
			return
		}
		workspace := httpmw.WorkspaceAgentAndWorkspaceParam(r).WorkspaceTable
		ctx, end, err := api.workspaceQuarantine.Guard(r.Context(), workspace.ID)
		if err != nil {
			httpapi.Write(r.Context(), rw, http.StatusLocked, codersdk.Response{Message: "Workspace access is restricted."})
			return
		}
		defer end()
		next.ServeHTTP(rw, r.WithContext(ctx))
	})
}
