-- name: GetWorkspaceQuarantineByWorkspaceID :one
SELECT * FROM workspace_quarantines WHERE workspace_id = $1;

-- name: UpsertWorkspaceQuarantine :one
INSERT INTO workspace_quarantines (workspace_id, organization_id, enabled, revision, reason, updated_by, updated_at, manual_start_required)
VALUES ($1, $2, $3, $4, $5, $6, $7, true)
ON CONFLICT (workspace_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    revision = EXCLUDED.revision,
    reason = EXCLUDED.reason,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at,
    manual_start_required = true,
    release_prepared = false
WHERE workspace_quarantines.organization_id = EXCLUDED.organization_id
RETURNING *;

-- name: ConsumeWorkspaceQuarantineManualStart :exec
UPDATE workspace_quarantines SET manual_start_required = false
WHERE workspace_id = $1 AND organization_id = $2 AND enabled = false AND release_prepared = true;

-- name: PrepareWorkspaceQuarantineRelease :execrows
UPDATE workspace_quarantines SET release_prepared = true
WHERE workspace_id = $1 AND organization_id = $2 AND revision = $3
AND enabled = false AND manual_start_required = true;

-- name: TouchWorkspaceQuarantineLock :execrows
-- The unchanged value still updates the MVCC version, making stale
-- RepeatableRead start transactions retry after a concurrent policy change.
UPDATE workspaces SET updated_at = updated_at WHERE id = $1;
