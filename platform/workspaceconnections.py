"""Withdraw managed connections for restricted workspaces, independent of VM reconciliation."""
import contextlib
import secrets
import threading
import time
import uuid


class Restrictions:
    def __init__(self, pool, locks, safe, tunnels, log):
        self.pool, self.locks = pool, locks
        self.safe, self.tunnels, self.log = safe, tunnels, log
        self.has_quarantine = False

    def policies(self, workspace_id=None):
        locks = self.locks()
        full = [str(uuid.UUID(wid)) for wid, state in locks.items()
                if 'freeze' in state.get('modes', []) or {'network', 'sudo'} <= set(state.get('modes', []))]
        pool = self.pool()
        if pool is None:
            raise RuntimeError('Workspace restriction policy is unavailable.')
        if not self.has_quarantine:
            schema = pool.query("SELECT to_regclass('workspace_quarantines') IS NOT NULL")
            if len(schema) != 1 or schema[0][0] not in (True, False, 't', 'f'):
                raise RuntimeError('Workspace restriction schema is unavailable.')
            self.has_quarantine = schema[0][0] is True or schema[0][0] == 't'
        if self.has_quarantine:
            rows = pool.query(
                "SELECT w.id::text, w.organization_id::text, w.owner_id::text, COALESCE(q.enabled, false), "
                "COALESCE(q.revision, '00000000-0000-0000-0000-000000000000'::uuid)::text, "
                "COALESCE(q.manual_start_required, false) FROM workspaces w LEFT JOIN workspace_quarantines q "
                "ON q.workspace_id = w.id AND q.organization_id = w.organization_id WHERE NOT w.deleted "
                "AND ($1::uuid IS NULL OR w.id = $1::uuid) "
                "AND (COALESCE(q.enabled OR q.manual_start_required, false) OR w.id = ANY($2::uuid[]))",
                [str(uuid.UUID(workspace_id)) if workspace_id else None, '{' + ','.join(full) + '}'])
        else:
            rows = pool.query(
                "SELECT id::text, organization_id::text, owner_id::text, false, "
                "'00000000-0000-0000-0000-000000000000', false FROM workspaces WHERE NOT deleted "
                "AND ($1::uuid IS NULL OR id = $1::uuid) AND id = ANY($2::uuid[])",
                [str(uuid.UUID(workspace_id)) if workspace_id else None, '{' + ','.join(full) + '}'])
        result = []
        for row in rows:
            current = dict(zip(('workspace_id', 'organization_id', 'owner_id', 'enabled', 'revision', 'manual_start_required'), row))
            for key in ('enabled', 'manual_start_required'):
                if current[key] not in (True, False, 't', 'f'):
                    raise RuntimeError('Invalid workspace restriction policy.')
                current[key] = current[key] is True or current[key] == 't'
            current['full_lockdown'] = current['workspace_id'] in full
            result.append(current)
        return result

    def restricted(self, workspace_id):
        return bool(self.policies(workspace_id))

    def withdraw(self, current):
        guard = getattr(self.safe, 'QUARANTINE_GUARD', None)
        native = current['enabled'] or current['manual_start_required']
        with guard.restrict(current) if guard and native else contextlib.nullcontext():
            failures = []
            for withdraw in (self.withdraw_drive, self.withdraw_tunnels):
                try:
                    withdraw(current)
                except Exception as error:
                    failures.append(str(error))
            if failures:
                raise RuntimeError('; '.join(failures))

    def withdraw_drive(self, current):
        wid, owner = current['workspace_id'], current['owner_id']
        # Persist the intent even for stopped workspaces; release does not reconnect it.
        with self.safe.local_lock(self.safe.LINKS_FILE):
            links = self.safe.disconnected()
            if wid not in links:
                links[wid] = {'owner': owner, 'by': 'workspace-lockdown', 'at': int(time.time())}
                self.safe._write_json(self.safe.LINKS_FILE, links)
        endpoints = self.safe.source_endpoint_snapshot(owner) if self.safe.sources().get(owner, {}).get('workspace') == wid else []
        with self.safe.local_lock(self.safe.SOURCES_FILE):
            sources = self.safe.sources()
            source = sources.get(owner)
            if source and source.get('workspace') == wid and not source.get('suspended'):
                source.update(suspended=True, generation=self.safe.source_generation(source),
                              accessKey='src' + secrets.token_hex(8), secretKey=secrets.token_urlsafe(32))
                self.safe._write_json(self.safe.SOURCES_FILE, sources)
        self.safe.delete_source_endpoints(endpoints)
        self.safe._wake.set()

    def withdraw_tunnels(self, current):
        wid = current['workspace_id']
        with self.tunnels.state() as data:
            incident = [t for t in data['tunnels'].values() if not t.get('deleted') and wid in
                        (t['source_workspace_id'], t['target_workspace_id'])]
            if incident:
                revision = self.tunnels.changed(data)
                for tunnel in incident:
                    tunnel.update(deleted=True, revision=revision)

    def once(self):
        for current in self.policies():
            try:
                self.withdraw(current)
            except Exception as error:
                self.log(event='workspace-connection-withdrawal', workspace=current['workspace_id'], error=str(error))

    def run(self):
        while True:
            try:
                self.once()
            except Exception as error:
                self.log(event='workspace-connection-policy', error=str(error))
            time.sleep(2)

    def start(self):
        threading.Thread(target=self.run, name='workspace-connection-restrictions', daemon=True).start()
