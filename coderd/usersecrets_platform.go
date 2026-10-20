package coderd

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/codersdk"
)

// certificateSecretPath is where the dashboard's Account > Certificates keeps a user's PKCS#12 file (base64), which
// Coder's agent writes into their workspaces: ~/.cert/.<name>.p12.b64.
var certificateSecretPath = regexp.MustCompile(`^~/\.cert/\.[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*\.p12\.b64$`)

// User certificate file
//
// Platform: a user's own certificate secret (their .p12, base64, as uploaded in Account > Certificates), for their
// own browser to read the public certificate out of it with their password (the Cloud Drive's encryption with
// "PFX"). The file stays encrypted with that password, which never reaches Coder. Only the user themselves: not an
// admin (Coder's roles keep users' secrets to them; a request for anyone else's is refused here too), and only a
// certificate secret, never another one.
//
// @Summary Get user certificate file
// @ID get-user-certificate-file
// @Security CoderSessionToken
// @Produce json
// @Tags Secrets
// @Param user path string true "User ID, username, or me"
// @Param name path string true "Secret name"
// @Success 200 {object} codersdk.UserCertificateFile
// @Router /api/v2/users/{user}/secrets/{name}/certificate [get]
func (api *API) getUserCertificateFile(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := httpmw.UserParam(r)
	name := chi.URLParam(r, codersdk.UserSecretNameField)

	if httpmw.APIKey(r).UserID != user.ID {
		httpapi.ResourceNotFound(rw)
		return
	}
	secret, err := api.Database.GetUserSecretByUserIDAndName(ctx, database.GetUserSecretByUserIDAndNameParams{
		UserID: user.ID,
		Name:   name,
	})
	if errors.Is(err, sql.ErrNoRows) || httpapi.IsUnauthorizedError(err) {
		httpapi.ResourceNotFound(rw)
		return
	}
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusInternalServerError, codersdk.Response{
			Message: "Internal error fetching the certificate.",
			Detail:  err.Error(),
		})
		return
	}
	if !certificateSecretPath.MatchString(secret.FilePath) {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{
			Message: "Not a certificate secret.",
		})
		return
	}
	rw.Header().Set("Cache-Control", "no-store")
	httpapi.Write(ctx, rw, http.StatusOK, codersdk.UserCertificateFile{
		Name:   secret.Name,
		Base64: secret.Value,
	})
}
