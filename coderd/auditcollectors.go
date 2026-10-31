package coderd

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/searchquery"
	"github.com/coder/coder/v2/codersdk"
)

const (
	auditCollectorAudience = "coder-audit"
	auditCollectorScope    = "coder:audit:read"
)

func (api *API) auditCollectorIssuer() string {
	if api.OIDCConfig == nil || api.OIDCConfig.Provider == nil {
		return ""
	}
	var claims struct {
		Issuer string `json:"issuer"`
	}
	if api.OIDCConfig.Provider.Claims(&claims) != nil {
		return ""
	}
	return claims.Issuer
}

func (api *API) authorizeAuditCollectors(rw http.ResponseWriter, r *http.Request) bool {
	org := httpmw.OrganizationParam(r)
	if !api.Authorize(r, policy.ActionUpdate, rbac.ResourceDeploymentConfig) ||
		!api.Authorize(r, policy.ActionRead, rbac.ResourceAuditLog.InOrg(org.ID)) ||
		!api.Authorize(r, policy.ActionCreate, rbac.ResourceAuditLog) {
		httpapi.Forbidden(rw)
		return false
	}
	return true
}

func convertAuditCollector(c database.AuditCollector) codersdk.AuditCollector {
	return codersdk.AuditCollector{
		ID: c.ID, OrganizationID: c.OrganizationID, Name: c.Name,
		Issuer: c.Issuer, Subject: c.Subject, ClientID: c.ClientID, CreatedBy: c.CreatedBy,
		CreatedAt: c.CreatedAt, ExpiresAt: c.ExpiresAt,
	}
}

// @Summary Get external audit collector configuration
// @ID get-external-audit-collector-configuration
// @Security CoderSessionToken
// @Tags Audit
// @Produce json
// @Param organization path string true "Organization ID"
// @Success 200 {object} codersdk.AuditCollectorConfiguration
// @Router /api/v2/organizations/{organization}/audit-collectors [get]
func (api *API) auditCollectors(rw http.ResponseWriter, r *http.Request) {
	if !api.authorizeAuditCollectors(rw, r) {
		return
	}
	org := httpmw.OrganizationParam(r)
	rows, err := api.Database.GetAuditCollectors(r.Context(), org.ID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	out := codersdk.AuditCollectorConfiguration{
		Issuer: api.auditCollectorIssuer(), Audience: auditCollectorAudience, Scope: auditCollectorScope,
		Endpoint:   api.AccessURL.JoinPath("api/v2/audit-export", org.ID.String()).String(),
		Collectors: make([]codersdk.AuditCollector, 0, len(rows)),
	}
	out.Available = out.Issuer != "" && api.AccessURL.Scheme == "https"
	if out.Issuer != "" {
		out.TokenEndpoint = api.OIDCConfig.Provider.Endpoint().TokenURL
	}
	for _, row := range rows {
		out.Collectors = append(out.Collectors, convertAuditCollector(row))
	}
	httpapi.Write(r.Context(), rw, http.StatusOK, out)
}

// @Summary Grant external audit access
// @ID grant-external-audit-access
// @Security CoderSessionToken
// @Tags Audit
// @Accept json
// @Produce json
// @Param organization path string true "Organization ID"
// @Param request body codersdk.CreateAuditCollectorRequest true "Collector grant"
// @Success 201 {object} codersdk.AuditCollector
// @Router /api/v2/organizations/{organization}/audit-collectors [post]
func (api *API) postAuditCollector(rw http.ResponseWriter, r *http.Request) {
	if !api.authorizeAuditCollectors(rw, r) {
		return
	}
	issuer := api.auditCollectorIssuer()
	if issuer == "" || api.AccessURL.Scheme != "https" {
		httpapi.Write(r.Context(), rw, http.StatusConflict, codersdk.Response{Message: "Configure HTTPS and Keycloak before granting external audit access."})
		return
	}
	var req codersdk.CreateAuditCollectorRequest
	if !httpapi.Read(r.Context(), rw, r, &req) {
		return
	}
	if req.ValidDays < 1 || req.ValidDays > 365 || strings.TrimSpace(req.Name) == "" || len(req.Name) > 100 ||
		strings.TrimSpace(req.Subject) == "" || len(req.Subject) > 255 || strings.TrimSpace(req.ClientID) == "" || len(req.ClientID) > 255 {
		httpapi.Write(r.Context(), rw, http.StatusBadRequest, codersdk.Response{Message: "Provide a name, exact subject and client ID, and a lifetime of 1 to 365 days."})
		return
	}
	org := httpmw.OrganizationParam(r)
	now := dbtime.Now()
	var row database.AuditCollector
	err := api.Database.InTx(func(tx database.Store) error {
		var err error
		row, err = tx.InsertAuditCollector(r.Context(), database.InsertAuditCollectorParams{
			ID: uuid.New(), OrganizationID: org.ID, Name: strings.TrimSpace(req.Name), Issuer: issuer,
			Subject: req.Subject, ClientID: req.ClientID, CreatedBy: httpmw.APIKey(r).UserID,
			CreatedAt: now, ExpiresAt: now.Add(time.Duration(req.ValidDays) * 24 * time.Hour),
		})
		if err != nil {
			return err
		}
		return recordAuditCollectorChange(r, tx, row, database.AuditActionCreate)
	}, nil)
	if database.IsUniqueViolation(err) {
		httpapi.Write(r.Context(), rw, http.StatusConflict, codersdk.Response{Message: "This collector already has a grant. Revoke it before replacing it."})
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(r.Context(), rw, http.StatusCreated, convertAuditCollector(row))
}

// @Summary Revoke external audit access
// @ID revoke-external-audit-access
// @Security CoderSessionToken
// @Tags Audit
// @Param organization path string true "Organization ID"
// @Param collector path string true "Collector ID"
// @Success 204
// @Router /api/v2/organizations/{organization}/audit-collectors/{collector} [delete]
func (api *API) deleteAuditCollector(rw http.ResponseWriter, r *http.Request) {
	if !api.authorizeAuditCollectors(rw, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "collector"))
	if err != nil {
		httpapi.ResourceNotFound(rw)
		return
	}
	err = api.Database.InTx(func(tx database.Store) error {
		row, err := tx.DeleteAuditCollector(r.Context(), database.DeleteAuditCollectorParams{OrganizationID: httpmw.OrganizationParam(r).ID, ID: id})
		if err != nil {
			return err
		}
		return recordAuditCollectorChange(r, tx, row, database.AuditActionDelete)
	}, nil)
	if xerrors.Is(err, sql.ErrNoRows) {
		httpapi.ResourceNotFound(rw)
		return
	}
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	rw.WriteHeader(http.StatusNoContent)
}

func recordAuditCollectorChange(r *http.Request, db database.Store, row database.AuditCollector, action database.AuditAction) error {
	fields, err := json.Marshal(map[string]any{"audit_collector": convertAuditCollector(row), "collector_action": action})
	if err != nil {
		return err
	}
	// Collector grants change the organization's audit access configuration.
	// Commit the organization event atomically with the grant change.
	_, err = db.InsertAuditLog(r.Context(), database.InsertAuditLogParams{
		ID: uuid.New(), Time: dbtime.Now(), UserID: httpmw.APIKey(r).UserID, OrganizationID: row.OrganizationID,
		ResourceType: database.ResourceTypeOrganization, ResourceID: row.OrganizationID,
		ResourceTarget: httpmw.OrganizationParam(r).Name, Action: database.AuditActionWrite, StatusCode: http.StatusOK,
		Ip: database.ParseIP(r.RemoteAddr), UserAgent: sql.NullString{String: r.UserAgent(), Valid: true}, RequestID: httpmw.RequestID(r),
		Diff: json.RawMessage(`{}`), AdditionalFields: fields, ResourceIcon: "",
	})
	return err
}

// @Summary Collect organization audit logs with a Keycloak access token
// @ID collect-organization-audit-logs-with-a-keycloak-access-token
// @Security Authorization
// @Tags Audit
// @Produce json
// @Param organization path string true "Organization ID"
// @Param Authorization header string true "Bearer access token with coder-audit audience and coder:audit:read scope"
// @Param q query string false "Audit filter; organization is always enforced"
// @Param limit query int false "Page size, 1 to 500 (default 100)"
// @Param offset query int false "Page offset"
// @Success 200 {object} codersdk.AuditLogResponse
// @Failure 401 {object} codersdk.OAuth2Error
// @Failure 403 {object} codersdk.OAuth2Error
// @Router /api/v2/audit-export/{organization} [get]
func (api *API) externalAuditLogs(rw http.ResponseWriter, r *http.Request) {
	rw.Header().Set("Cache-Control", "no-store")
	deny := func(status int, code codersdk.OAuth2ErrorCode, message string) {
		// RFC 6750 section 3 requires the Bearer authentication challenge.
		rw.Header().Set("WWW-Authenticate", `Bearer realm="coder-audit", error="`+string(code)+`"`)
		httpapi.WriteOAuth2Error(r.Context(), rw, status, code, message)
	}
	if r.Header.Get("Authorization") == "" && !r.URL.Query().Has("access_token") {
		rw.Header().Set("WWW-Authenticate", `Bearer realm="coder-audit"`)
		httpapi.Write(r.Context(), rw, http.StatusUnauthorized, codersdk.Response{Message: "A Keycloak audit access token is required."})
		return
	}
	issuer := api.auditCollectorIssuer()
	parts := strings.Fields(r.Header.Get("Authorization"))
	if issuer == "" || api.AccessURL.Scheme != "https" || len(r.Header.Values("Authorization")) != 1 ||
		len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) > 16384 || r.URL.Query().Has("access_token") {
		deny(http.StatusUnauthorized, codersdk.OAuth2ErrorCodeInvalidToken, "A Keycloak audit access token is required.")
		return
	}
	token, err := api.OIDCConfig.Provider.Verifier(&oidc.Config{ClientID: auditCollectorAudience}).Verify(r.Context(), parts[1])
	var claims struct {
		Type         string          `json:"typ"`
		ClientID     string          `json:"azp"`
		Scope        string          `json:"scope"`
		NotBefore    int64           `json:"nbf"`
		Confirmation json.RawMessage `json:"cnf"`
	}
	now := dbtime.Now()
	if err != nil || token.Claims(&claims) != nil || claims.Type != "Bearer" || token.Subject == "" || claims.ClientID == "" ||
		token.IssuedAt.IsZero() || token.IssuedAt.After(now.Add(30*time.Second)) || token.Expiry.Sub(token.IssuedAt) > 15*time.Minute ||
		now.Sub(token.IssuedAt) > 15*time.Minute || claims.NotBefore > now.Unix() || len(claims.Confirmation) != 0 {
		deny(http.StatusUnauthorized, codersdk.OAuth2ErrorCodeInvalidToken, "The audit access token is invalid or expired.")
		return
	}
	if !slices.Contains(strings.Fields(claims.Scope), auditCollectorScope) {
		deny(http.StatusForbidden, codersdk.OAuth2ErrorCodeInsufficientScope, "The token does not permit audit collection.")
		return
	}
	orgID, err := uuid.Parse(chi.URLParam(r, "organization"))
	if err != nil || orgID == uuid.Nil {
		httpapi.ResourceNotFound(rw)
		return
	}
	// The external identity is checked against an explicit, expiring grant.
	// No API key, cookie, forwarded identity header or token role grants access.
	//nolint:gocritic // Read this organization's collector grants before exporting.
	ctx := dbauthz.AsSystemRestricted(r.Context())
	org, err := api.Database.GetOrganizationByID(ctx, orgID)
	if err != nil || org.Deleted {
		httpapi.ResourceNotFound(rw)
		return
	}
	grants, err := api.Database.GetAuditCollectors(ctx, orgID)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	allowed := slices.ContainsFunc(grants, func(g database.AuditCollector) bool {
		return g.Issuer == token.Issuer && g.Subject == token.Subject && g.ClientID == claims.ClientID && g.ExpiresAt.After(now)
	})
	if !allowed {
		deny(http.StatusForbidden, codersdk.OAuth2ErrorCodeInsufficientScope, "No active collector grant for this organization.")
		return
	}
	page, ok := ParsePagination(rw, r)
	if !ok {
		return
	}
	if !r.URL.Query().Has("limit") {
		page.Limit = 100
	}
	if page.Limit < 1 || page.Limit > 500 || page.Offset < 0 || page.Offset > 1000000 {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "Use a page size of 1 to 500 and an offset up to 1000000."})
		return
	}
	filter, countFilter, errs := searchquery.AuditLogs(ctx, api.Database, r.URL.Query().Get("q"))
	if len(errs) > 0 {
		httpapi.Write(ctx, rw, http.StatusBadRequest, codersdk.Response{Message: "Invalid audit filter.", Validations: errs})
		return
	}
	filter.OrganizationID, countFilter.OrganizationID = orgID, orgID
	// Pagination is bounded above before converting to SQL parameters.
	//nolint:gosec // Both values are range-checked above, below the int32 maximum.
	filter.LimitOpt, filter.OffsetOpt = int32(page.Limit), int32(page.Offset)
	countFilter.CountCap = auditLogCountCap
	count, err := api.Database.CountAuditLogs(ctx, countFilter)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	rows, err := api.Database.GetAuditLogsOffset(ctx, filter)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}
	httpapi.Write(ctx, rw, http.StatusOK, codersdk.AuditLogResponse{AuditLogs: api.convertAuditLogs(ctx, rows), Count: count, CountCap: auditLogCountCap})
}
