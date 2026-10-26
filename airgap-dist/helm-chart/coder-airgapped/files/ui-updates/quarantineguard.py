"""Serialize connection intent commits with the authoritative Go quarantine transaction."""
from contextlib import contextmanager
import uuid
import pgwire

POLICY = ("SELECT w.id::text, w.organization_id::text, w.owner_id::text, COALESCE(q.enabled, false), "
          "COALESCE(q.revision, '00000000-0000-0000-0000-000000000000'::uuid)::text, "
          "COALESCE(q.manual_start_required, false) FROM workspaces w "
          "LEFT JOIN workspace_quarantines q ON q.workspace_id = w.id AND q.organization_id = w.organization_id "
          "WHERE w.id = $1::uuid AND NOT w.deleted")
FIELDS = ('workspace_id', 'organization_id', 'owner_id', 'enabled', 'revision', 'manual_start_required')


def policy_row(row, fields=FIELDS):
    """Decode PostgreSQL text booleans without accepting unknown policy values."""
    if len(row) != len(fields):
        raise RuntimeError('Workspace quarantine policy is incomplete.')
    current = dict(zip(fields, row))
    for key in ('enabled', 'manual_start_required', 'release_prepared'):
        if key not in current:
            continue
        value = current[key]
        if type(value) is bool:
            continue
        if value not in ('t', 'f'):
            raise RuntimeError('Workspace quarantine policy is incomplete.')
        current[key] = value == 't'
    return current


def identifier(value):
    canonical = str(uuid.UUID(str(value)))
    if canonical != value:
        raise ValueError('Invalid workspace quarantine identity.')
    return canonical


def lock_key(workspace_id):
    """Match database.GenLockID's FNV-1 uint64-to-int64 conversion exactly."""
    value = 14695981039346656037
    for byte in ('workspace-quarantine-' + identifier(workspace_id)).encode():
        value = ((value * 1099511628211) & ((1 << 64) - 1)) ^ byte
    return value if value < (1 << 63) else value - (1 << 64)


class Guard:
    """Fence local connection writes and bounded per-workspace endpoint withdrawal."""

    def __init__(self, pool):
        self.pool = pool

    @contextmanager
    def transaction(self, workspace_ids, restriction=None):
        ids = sorted({identifier(value) for value in workspace_ids})
        if not ids or len(ids) > 16:
            raise ValueError('Invalid workspace quarantine guard targets.')
        connection = None
        pool = self.pool() if callable(self.pool) else self.pool
        if pool is None:
            raise RuntimeError('Workspace quarantine policy is unavailable.')
        try:
            connection = pgwire.Connection(pool.url, pool.cafile, timeout=5)
            connection.query('BEGIN')
            connection.query("SET LOCAL lock_timeout = '5s'")
            connection.query("SET LOCAL statement_timeout = '5s'")
            connection.query("SET LOCAL idle_in_transaction_session_timeout = '60s'")
            for workspace_id in ids:
                connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock_key(workspace_id)])
            policies = {}
            for workspace_id in ids:
                rows = connection.query(POLICY if restriction is None else POLICY.replace(" AND NOT w.deleted", ""), [workspace_id])
                if len(rows) != 1 or len(rows[0]) != len(FIELDS):
                    raise RuntimeError('Workspace quarantine identity is unavailable.')
                current = policy_row(rows[0])
                if current['workspace_id'] != workspace_id or any(type(current[key]) is not bool for key in ('enabled', 'manual_start_required')):
                    raise RuntimeError('Workspace quarantine policy is incomplete.')
                if restriction is None:
                    if current['enabled'] or current['manual_start_required']:
                        raise PermissionError('Quarantined workspaces cannot reconnect.')
                elif any(current[key] != restriction.get(key) for key in FIELDS) or not (current['enabled'] or current['manual_start_required']):
                    raise PermissionError('Workspace quarantine restriction changed.')
                policies[workspace_id] = current
            yield policies
            connection.query('COMMIT')
        except BaseException:
            if connection is not None:
                try:
                    connection.query('ROLLBACK')
                except Exception:
                    pass
            raise
        finally:
            if connection is not None:
                connection.close()

    @contextmanager
    def many(self, workspace_ids):
        with self.transaction(workspace_ids) as policies:
            yield policies

    @contextmanager
    def restrict(self, current):
        workspace_id = identifier(current['workspace_id'])
        with self.transaction([workspace_id], restriction=current) as policies:
            yield policies[workspace_id]

    @contextmanager
    def __call__(self, workspace_id):
        workspace_id = identifier(workspace_id)
        with self.many([workspace_id]) as policies:
            yield policies[workspace_id]
