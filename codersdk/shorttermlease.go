package codersdk

import (
	"time"

	"github.com/google/uuid"
)

// ShortTermLease describes an organization-scoped temporary browser account.
type ShortTermLease struct {
	UserID               uuid.UUID            `json:"user_id" format:"uuid"`
	OrganizationID       uuid.UUID            `json:"organization_id" format:"uuid"`
	WorkspaceID          *uuid.UUID           `json:"workspace_id" format:"uuid"`
	IssuedAt             time.Time            `json:"issued_at" format:"date-time"`
	ExpiresAt            time.Time            `json:"expires_at" format:"date-time"`
	RevokedAt            *time.Time           `json:"revoked_at" format:"date-time"`
	ExtensionRequestedAt *time.Time           `json:"extension_requested_at" format:"date-time"`
	Terms                *ShortTermLeaseTerms `json:"terms,omitempty"`
	AutoRemoveHistory    bool                 `json:"auto_remove_history"`
	TokenID              string               `json:"token_id"`
	// Token is returned at creation or by the administrator token endpoint.
	Token string `json:"token,omitempty"`
}

// CreateShortTermLeaseRequest selects the Browser template and lifetime.
type CreateShortTermLeaseRequest struct {
	TemplateID        uuid.UUID            `json:"template_id" format:"uuid"`
	Minutes           int                  `json:"minutes"`
	Terms             *ShortTermLeaseTerms `json:"terms,omitempty"`
	AutoRemoveHistory bool                 `json:"auto_remove_history"`
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

// ShortTermLeaseTerms are enforced by the Browser template's immutable lease policy.
type ShortTermLeaseTerms struct {
	NoRoot      bool     `json:"no_root"`
	SandboxOnly bool     `json:"sandbox_only"`
	Firewall    bool     `json:"firewall"`
	WebsiteMode string   `json:"website_mode"`
	Websites    []string `json:"websites"`
}
