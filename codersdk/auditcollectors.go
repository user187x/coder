package codersdk

import (
	"time"

	"github.com/google/uuid"
)

// AuditCollector authorizes one external identity to read an organization's logs.
type AuditCollector struct {
	ID             uuid.UUID `json:"id" format:"uuid"`
	OrganizationID uuid.UUID `json:"organization_id" format:"uuid"`
	Name           string    `json:"name"`
	Issuer         string    `json:"issuer"`
	Subject        string    `json:"subject"`
	ClientID       string    `json:"client_id"`
	CreatedBy      uuid.UUID `json:"created_by" format:"uuid"`
	CreatedAt      time.Time `json:"created_at" format:"date-time"`
	ExpiresAt      time.Time `json:"expires_at" format:"date-time"`
}

// CreateAuditCollectorRequest binds a grant to an exact Keycloak identity.
type CreateAuditCollectorRequest struct {
	Name      string `json:"name"`
	Subject   string `json:"subject"`
	ClientID  string `json:"client_id"`
	ValidDays int    `json:"valid_days"`
}

// AuditCollectorConfiguration describes the protected external collection API.
type AuditCollectorConfiguration struct {
	Available     bool             `json:"available"`
	Issuer        string           `json:"issuer"`
	TokenEndpoint string           `json:"token_endpoint"`
	Endpoint      string           `json:"endpoint"`
	Audience      string           `json:"audience"`
	Scope         string           `json:"scope"`
	Collectors    []AuditCollector `json:"collectors"`
}
