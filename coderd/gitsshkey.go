package coderd

import (
	"database/sql"
	"net/http"

	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/gitsshkey"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

// @Summary Regenerate user SSH key
// @ID regenerate-user-ssh-key
// @Security CoderSessionToken
// @Produce json
// @Tags Users
// @Param user path string true "User ID, name, or me"
// @Success 200 {object} codersdk.GitSSHKey
// @Router /api/v2/users/{user}/gitsshkey [put]
func (api *API) regenerateGitSSHKey(rw http.ResponseWriter, r *http.Request) {
	var (
		ctx               = r.Context()
		user              = httpmw.UserParam(r)
		auditor           = api.Auditor.Load()
		aReq, commitAudit = audit.InitRequest[database.GitSSHKey](rw, &audit.RequestParams{
			Audit:   *auditor,
			Log:     api.Logger,
			Request: r,
			Action:  database.AuditActionWrite,
		})
	)
	defer commitAudit()

	oldKey, err := api.Database.GetGitSSHKey(ctx, user.ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}

	aReq.Old = oldKey

	privateKey, publicKey, err := gitsshkey.Generate(api.SSHKeygenAlgorithm)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error generating a new SSH keypair.",
			Detail:  err.Error(),
		})
		return
	}

	newKey, err := api.Database.UpdateGitSSHKey(ctx, database.UpdateGitSSHKeyParams{
		UserID:          user.ID,
		UpdatedAt:       dbtime.Now(),
		PrivateKey:      privateKey,
		PrivateKeyKeyID: sql.NullString{}, // dbcrypt will update as required
		PublicKey:       publicKey,
	})
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error updating user's git SSH key.",
			Detail:  err.Error(),
		})
		return
	}

	aReq.New = newKey

	httpapi.Write(ctx, rw, http.StatusOK, codersdk.GitSSHKey{
		UserID:    newKey.UserID,
		CreatedAt: newKey.CreatedAt,
		UpdatedAt: newKey.UpdatedAt,
		// No need to return the private key to the user
		PublicKey: newKey.PublicKey,
	})
}

// @Summary Import user SSH key
// @Description Platform: replaces the user's Git SSH key with one they bring (the key of their PKCS#12
// @Description certificate, extracted in their browser): an unencrypted PEM private key, RSA (2048+ bits),
// @Description ECDSA (P-256/384/521) or Ed25519. Like regenerating, workspaces use it from then on.
// @ID import-user-ssh-key
// @Security CoderSessionToken
// @Accept json
// @Produce json
// @Tags Users
// @Param user path string true "User ID, name, or me"
// @Param request body codersdk.ImportGitSSHKeyRequest true "Private key"
// @Success 200 {object} codersdk.GitSSHKey
// @Router /api/v2/users/{user}/gitsshkey/import [put]
func (api *API) importGitSSHKey(rw http.ResponseWriter, r *http.Request) {
	var (
		ctx               = r.Context()
		user              = httpmw.UserParam(r)
		auditor           = api.Auditor.Load()
		aReq, commitAudit = audit.InitRequest[database.GitSSHKey](rw, &audit.RequestParams{
			Audit:   *auditor,
			Log:     api.Logger,
			Request: r,
			Action:  database.AuditActionWrite,
		})
	)
	defer commitAudit()

	var req codersdk.ImportGitSSHKeyRequest
	if !httpapi.Read(ctx, rw, r, &req) {
		return
	}
	// The key itself is never logged or echoed back, not even in errors.
	privateKey, publicKey, err := gitsshkey.Import([]byte(req.PrivateKey))
	req.PrivateKey = ""
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{
			Message: "This private key cannot be used as an SSH key.",
			Detail:  err.Error(),
		})
		return
	}

	oldKey, err := api.Database.GetGitSSHKey(ctx, user.ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	aReq.Old = oldKey

	newKey, err := api.Database.UpdateGitSSHKey(ctx, database.UpdateGitSSHKeyParams{
		UserID:          user.ID,
		UpdatedAt:       dbtime.Now(),
		PrivateKey:      privateKey,
		PrivateKeyKeyID: sql.NullString{}, // dbcrypt will update as required
		PublicKey:       publicKey,
	})
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error updating user's git SSH key.",
			Detail:  err.Error(),
		})
		return
	}
	aReq.New = newKey

	httpapi.Write(ctx, rw, http.StatusOK, codersdk.GitSSHKey{
		UserID:    newKey.UserID,
		CreatedAt: newKey.CreatedAt,
		UpdatedAt: newKey.UpdatedAt,
		PublicKey: newKey.PublicKey,
	})
}

// @Summary Get user Git SSH key
// @ID get-user-git-ssh-key
// @Security CoderSessionToken
// @Produce json
// @Tags Users
// @Param user path string true "User ID, name, or me"
// @Success 200 {object} codersdk.GitSSHKey
// @Router /api/v2/users/{user}/gitsshkey [get]
func (api *API) gitSSHKey(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := httpmw.UserParam(r)

	gitSSHKey, err := api.Database.GetGitSSHKey(ctx, user.ID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching user's SSH key.",
			Detail:  err.Error(),
		})
		return
	}

	httpapi.Write(ctx, rw, http.StatusOK, codersdk.GitSSHKey{
		UserID:    gitSSHKey.UserID,
		CreatedAt: gitSSHKey.CreatedAt,
		UpdatedAt: gitSSHKey.UpdatedAt,
		// No need to return the private key to the user
		PublicKey: gitSSHKey.PublicKey,
	})
}

// @Summary Get workspace agent Git SSH key
// @ID get-workspace-agent-git-ssh-key
// @Security CoderSessionToken
// @Produce json
// @Tags Agents
// @Success 200 {object} agentsdk.GitSSHKey
// @Router /api/v2/workspaceagents/me/gitsshkey [get]
func (api *API) agentGitSSHKey(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	agent := httpmw.WorkspaceAgent(r)
	resource, err := api.Database.GetWorkspaceResourceByID(ctx, agent.ResourceID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching workspace resource.",
			Detail:  err.Error(),
		})
		return
	}

	job, err := api.Database.GetWorkspaceBuildByJobID(ctx, resource.JobID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching workspace build.",
			Detail:  err.Error(),
		})
		return
	}

	workspace, err := api.Database.GetWorkspaceByID(ctx, job.WorkspaceID)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching workspace.",
			Detail:  err.Error(),
		})
		return
	}

	gitSSHKey, err := api.Database.GetGitSSHKey(ctx, workspace.OwnerID)
	if httpapi.IsUnauthorizedError(err) {
		httpapi.Forbidden(rw)
		return
	}
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching git SSH key.",
			Detail:  err.Error(),
		})
		return
	}

	httpapi.Write(ctx, rw, http.StatusOK, agentsdk.GitSSHKey{
		PublicKey:  gitSSHKey.PublicKey,
		PrivateKey: gitSSHKey.PrivateKey,
	})
}
