package coderd

import (
	"net/http"

	"github.com/coder/coder/v2/buildinfo"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/codersdk"
)

// updateCheck reports the running version as current. Coder never contacts an
// external service to look for newer releases.
//
// @Summary Update check
// @ID update-check
// @Produce json
// @Tags General
// @Success 200 {object} codersdk.UpdateCheckResponse
// @Router /api/v2/updatecheck [get]
func (*API) updateCheck(rw http.ResponseWriter, r *http.Request) {
	httpapi.Write(r.Context(), rw, http.StatusOK, codersdk.UpdateCheckResponse{
		Current: true,
		Version: buildinfo.Version(),
		URL:     buildinfo.ExternalURL(),
	})
}
