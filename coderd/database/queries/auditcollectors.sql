-- name: GetAuditCollectors :many
SELECT * FROM audit_collectors WHERE organization_id = @organization_id AND kind = @kind ORDER BY created_at, id;

-- name: InsertAuditCollector :one
INSERT INTO audit_collectors (id, organization_id, kind, name, issuer, subject, client_id, created_by, created_at, expires_at)
VALUES (@id, @organization_id, @kind, @name, @issuer, @subject, @client_id, @created_by, @created_at, @expires_at)
RETURNING *;

-- name: DeleteAuditCollector :one
DELETE FROM audit_collectors WHERE organization_id = @organization_id AND kind = @kind AND id = @id RETURNING *;
