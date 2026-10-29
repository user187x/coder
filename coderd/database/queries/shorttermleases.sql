-- name: GetShortTermLeaseByUserID :one
SELECT * FROM short_term_leases WHERE user_id = $1;

-- name: GetShortTermLeaseByWorkspaceID :one
SELECT * FROM short_term_leases WHERE workspace_id = $1;

-- name: GetShortTermLeasesByOrganization :many
SELECT * FROM short_term_leases WHERE organization_id = $1 ORDER BY issued_at DESC;

-- name: InsertShortTermLease :one
INSERT INTO short_term_leases (user_id, organization_id, issued_by, issued_at, expires_at)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: BindShortTermLease :one
UPDATE short_term_leases SET workspace_id = $3, token_id = $4
WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL AND expires_at > now()
RETURNING *;

-- name: ExtendShortTermLease :one
UPDATE short_term_leases SET expires_at = $3, extension_requested_at = NULL
WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL AND expires_at > now() AND $3 > expires_at
RETURNING *;

-- name: RequestShortTermLeaseExtension :one
UPDATE short_term_leases SET extension_requested_at = now()
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
RETURNING *;

-- name: RevokeShortTermLease :one
UPDATE short_term_leases SET revoked_at = now()
WHERE user_id = $1 AND organization_id = $2 RETURNING *;

-- name: GetExpiredShortTermLeases :many
SELECT * FROM short_term_leases WHERE expires_at <= now() OR revoked_at IS NOT NULL;
