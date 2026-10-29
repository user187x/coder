package codersdk

import (
	"github.com/google/uuid"
	"time"
)

// ShortTermLease describes an organization-scoped temporary browser account.
type ShortTermLease struct {
	UserID               uuid.UUID  `json:"user_id"`
	OrganizationID       uuid.UUID  `json:"organization_id"`
	WorkspaceID          *uuid.UUID `json:"workspace_id"`
	IssuedAt             time.Time  `json:"issued_at"`
	ExpiresAt            time.Time  `json:"expires_at"`
	RevokedAt            *time.Time `json:"revoked_at"`
	ExtensionRequestedAt *time.Time `json:"extension_requested_at"`
	TokenID              string     `json:"token_id"`
	// Token is returned only at creation; the database stores its hash.
	Token string `json:"token,omitempty"`
}

// CreateShortTermLeaseRequest selects the Browser template and lifetime.
type CreateShortTermLeaseRequest struct {
	TemplateID uuid.UUID `json:"template_id"`
	Minutes    int       `json:"minutes"`
}

// UpdateShortTermLeaseRequest extends an active lease or revokes it.
type UpdateShortTermLeaseRequest struct {
	Minutes int  `json:"minutes"`
	Revoke  bool `json:"revoke"`
}

// LeaseTokenLoginRequest exchanges a temporary token for a browser session.
type LeaseTokenLoginRequest struct {
	Token string `json:"token"`
}
