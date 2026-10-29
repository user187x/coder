"""Shared UI preferences and continuously collected resource history in Postgres."""
import json
from datetime import datetime
import math
import re
import threading
import time
import uuid

METRICS = {'cpu_usage': 'cpu', 'mem_usage': 'ram', 'ram_usage': 'ram', 'home_disk': 'disk', 'disk_usage': 'disk', 'load': 'load'}
RESOURCE_RETENTION = 14400
PERCENT = re.compile(r'(-?\d+(?:\.\d+)?)\s*%')
READINGS = """SELECT w.organization_id::text, w.id::text, a.id::text, m.key, m.value,
    (extract(epoch FROM m.collected_at) * 1000)::bigint
    FROM workspaces w
    JOIN LATERAL (SELECT wb.job_id, wb.transition FROM workspace_builds wb
        WHERE wb.workspace_id = w.id ORDER BY wb.build_number DESC LIMIT 1) b ON true
    JOIN workspace_resources r ON r.job_id = b.job_id
    JOIN workspace_agents a ON a.resource_id = r.id AND a.parent_id IS NULL AND NOT a.deleted
    JOIN workspace_agent_metadata m ON m.workspace_agent_id = a.id
    WHERE NOT w.deleted AND b.transition = 'start'
        AND m.key ~ '(^|_)(cpu_usage|mem_usage|ram_usage|home_disk|disk_usage|load)$'
        AND coalesce(m.error, '') = ''
        AND m.collected_at > now() - interval '5 minutes'"""


class UIState(threading.Thread):
    def __init__(self, pool, log, infrastructure=None):
        super().__init__(daemon=True, name='ui-history')
        self.pool = pool
        self.log = log
        self.ready = False
        self.lock = threading.Lock()
        self.cleaned = 0
        self.infrastructure = infrastructure
        self.infrastructure_sampled = 0

    def database(self):
        pool = self.pool()
        if not pool:
            raise RuntimeError('The shared database is unavailable.')
        with self.lock:
            if not self.ready:
                pool.query('CREATE SCHEMA IF NOT EXISTS coder_ui_updates')
                pool.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.workspace_metrics (
                    organization_id uuid NOT NULL, workspace_id uuid NOT NULL, agent_id uuid NOT NULL,
                    metric text NOT NULL CHECK (metric IN ('cpu', 'ram', 'disk', 'load')), t bigint NOT NULL,
                    share double precision NOT NULL, value double precision NOT NULL, text text NOT NULL, key text NOT NULL,
                    PRIMARY KEY (agent_id, metric, t))''')
                pool.query('CREATE INDEX IF NOT EXISTS workspace_metrics_window ON coder_ui_updates.workspace_metrics (workspace_id, t)')
                pool.query('CREATE INDEX IF NOT EXISTS workspace_metrics_expiry ON coder_ui_updates.workspace_metrics(t)')
                pool.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.user_preferences (
                    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    settings jsonb NOT NULL DEFAULT '{}')''')
                pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.infrastructure_metrics (
                    scope text NOT NULL, metric text NOT NULL, t bigint NOT NULL,
                    used double precision NOT NULL, total double precision, unit text NOT NULL,
                    PRIMARY KEY(scope, metric, t))""")
                pool.query("CREATE INDEX IF NOT EXISTS infrastructure_metrics_window ON coder_ui_updates.infrastructure_metrics(t)")
                pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.hud_samples (
                    t bigint PRIMARY KEY, live integer, cpu double precision, cpu_ws double precision,
                    cpu_total double precision, mem double precision, mem_ws double precision, mem_total double precision,
                    lat_p50 double precision, lat_p95 double precision, lat_max double precision, connections integer,
                    net_rx double precision, net_tx double precision, disk_used double precision, disk_total double precision,
                    disk_claimed double precision, volume_used double precision)""")
                pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.agent_network (
                    agent_id uuid NOT NULL REFERENCES workspace_agents(id) ON DELETE CASCADE,
                    t bigint NOT NULL, rx bigint NOT NULL, tx bigint NOT NULL, PRIMARY KEY(agent_id, t))""")
                self.ready = True
        return pool

    @staticmethod
    def readings(rows):
        samples = []
        for org, workspace, agent, key, value, collected in rows:
            metric = next((name for suffix, name in METRICS.items() if key.endswith(suffix)), None)
            if not metric or not value or collected is None:
                continue
            match = PERCENT.search(value)
            numeric = re.search(r'-?\d+(?:\.\d+)?', value)
            if not numeric:
                continue
            parsed = float(match[1]) if match else float(numeric[0])
            share = parsed if match else parsed * 100 if metric == 'load' else None
            if share is None:
                fraction = re.search(r'(-?\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)', value)
                if fraction and float(fraction[2]) > 0:
                    share = float(fraction[1]) / float(fraction[2]) * 100
            if share is not None and math.isfinite(share) and math.isfinite(parsed):
                samples.append(dict(organization_id=org, workspace_id=workspace, agent_id=agent,
                                    metric=metric, t=int(collected), share=max(0, share), value=parsed,
                                    text=value, key=key))
        return samples

    def sample(self):
        pool = self.database()
        samples = self.readings(pool.query(READINGS))
        if samples:
            pool.query('''INSERT INTO coder_ui_updates.workspace_metrics
                SELECT * FROM jsonb_to_recordset($1::jsonb) AS sample(organization_id uuid, workspace_id uuid,
                    agent_id uuid, metric text, t bigint, share double precision, value double precision, text text, key text)
                ON CONFLICT (agent_id, metric, t) DO NOTHING''', [json.dumps(samples)])
        if self.infrastructure and time.time() - self.infrastructure_sampled >= 5:
            self.add_infrastructure(self.infrastructure())
            self.infrastructure_sampled = time.time()
        if time.time() - self.cleaned >= 60:
            pool.query('DELETE FROM coder_ui_updates.workspace_metrics WHERE t < $1::bigint', [int(time.time() * 1000) - RESOURCE_RETENTION * 1000])
            pool.query('DELETE FROM coder_ui_updates.infrastructure_metrics WHERE t < $1::bigint', [int(time.time() * 1000) - RESOURCE_RETENTION * 1000])
            pool.query('DELETE FROM coder_ui_updates.agent_network WHERE t < $1::bigint', [int(time.time() * 1000) - 360000])
            self.cleaned = time.time()

    def history(self, workspace, seconds=300, buckets=12):
        seconds = max(40, min(RESOURCE_RETENTION, int(seconds)))
        buckets = max(1, min(120, int(buckets)))
        now = int(time.time() * 1000)
        rows = self.database().query("""SELECT agent_id::text, metric, t, share, value, text, key FROM (
            SELECT DISTINCT ON (agent_id, metric, CASE WHEN t < $3::bigint THEN -1 ELSE least($6::integer - 1, floor((t - $3::bigint) / $5::numeric)) END)
                agent_id, metric, t, share, value, text, key
            FROM coder_ui_updates.workspace_metrics
            WHERE organization_id = $1::uuid AND workspace_id = $2::uuid AND t BETWEEN ($3::bigint - $7::bigint) AND $4::bigint
            ORDER BY agent_id, metric, CASE WHEN t < $3::bigint THEN -1 ELSE least($6::integer - 1, floor((t - $3::bigint) / $5::numeric)) END, CASE WHEN t < $3::bigint THEN 0 ELSE value END DESC, t DESC
            ) readings ORDER BY t""",
            [workspace['organization_id'], workspace['id'], now - seconds * 1000, now, seconds * 1000 / buckets, buckets, 120000 if seconds < 300 else 0])
        agents = {}
        for agent, metric, timestamp, share, value, text, key in rows:
            agents.setdefault(agent, {'cpu': [], 'ram': [], 'disk': [], 'load': []})[metric].append(
                {'t': int(timestamp), 'share': float(share), 'value': float(value), 'text': text, 'key': key})
        return {'windowSeconds': seconds, 'asOf': now, 'agents': agents}

    HUD_COLUMNS = ('t', 'live', 'cpu', 'cpu_ws', 'cpu_total', 'mem', 'mem_ws', 'mem_total',
                   'lat_p50', 'lat_p95', 'lat_max', 'connections', 'net_rx', 'net_tx',
                   'disk_used', 'disk_total', 'disk_claimed', 'volume_used')

    def insert_hud(self, rows):
        if not rows:
            return
        columns = ', '.join(self.HUD_COLUMNS)
        fields = ', '.join(name + (' bigint' if name == 't' else ' integer' if name in ('live', 'connections') else ' double precision') for name in self.HUD_COLUMNS)
        self.database().query('INSERT INTO coder_ui_updates.hud_samples (' + columns + ') SELECT ' + columns +
            ' FROM jsonb_to_recordset($1::jsonb) AS sample(' + fields + ') ON CONFLICT (t) DO NOTHING',
            [json.dumps([dict(zip(self.HUD_COLUMNS, row)) for row in rows])])

    def add_infrastructure(self, readings):
        samples = []
        for scope, metrics in readings.items():
            for name, reading in metrics.items():
                used = reading.get('used')
                at = reading.get('collectedAt')
                if reading.get('error') or used is None or not at or not math.isfinite(used):
                    continue
                samples.append(dict(scope=scope, metric=name, t=int(datetime.fromisoformat(at.replace('Z', '+00:00')).timestamp() * 1000),
                                    used=used, total=reading.get('total'), unit=reading['unit']))
        if samples:
            self.database().query("""INSERT INTO coder_ui_updates.infrastructure_metrics
                SELECT * FROM jsonb_to_recordset($1::jsonb) AS sample(scope text, metric text, t bigint,
                    used double precision, total double precision, unit text)
                ON CONFLICT (scope, metric, t) DO NOTHING""", [json.dumps(samples)])

    def infrastructure_history(self, scope, seconds=14400):
        now = int(time.time() * 1000)
        seconds = max(40, min(RESOURCE_RETENTION, int(seconds)))
        rows = self.database().query("""SELECT metric, t, used, total, unit FROM (
            SELECT DISTINCT ON (metric, CASE WHEN t < $2::bigint THEN -1 ELSE least(39, floor((t - $2::bigint) / $4::numeric)) END) metric, t, used, total, unit
            FROM coder_ui_updates.infrastructure_metrics
            WHERE scope = $1 AND t BETWEEN ($2::bigint - $5::bigint) AND $3::bigint
            ORDER BY metric, CASE WHEN t < $2::bigint THEN -1 ELSE least(39, floor((t - $2::bigint) / $4::numeric)) END, CASE WHEN t < $2::bigint THEN 0 ELSE used / nullif(total, 0) END DESC, t DESC
            ) readings ORDER BY t""", [scope, now - seconds * 1000, now, seconds * 1000 / 40, 120000 if seconds < 300 else 0])
        result = {}
        for metric, at, used, total, unit in rows:
            result.setdefault(metric, []).append(dict(t=int(at), used=float(used), total=float(total) if total is not None else None, unit=unit))
        return result

    def add_network(self, rows):
        samples = []
        for agent, text, at in rows:
            match = re.fullmatch(r'\s*(\d+)\s+(\d+)\s*', text or '')
            if match and at is not None:
                samples.append(dict(agent_id=agent, t=int(at), rx=int(match[1]), tx=int(match[2])))
        if samples:
            self.database().query("""INSERT INTO coder_ui_updates.agent_network SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS sample(agent_id uuid, t bigint, rx bigint, tx bigint) ON CONFLICT (agent_id, t) DO NOTHING""", [json.dumps(samples)])

    def network_history(self, agents, seconds=300):
        now = int(time.time() * 1000)
        rows = self.database().query("""SELECT agent_id::text, t, rx, tx FROM coder_ui_updates.agent_network
            WHERE agent_id = ANY($1::uuid[]) AND t BETWEEN $2::bigint AND $3::bigint ORDER BY agent_id, t""",
            ['{' + ','.join(str(uuid.UUID(agent)) for agent in agents) + '}', now - (seconds + 120) * 1000, now])
        result = {agent: {'samples': [], 'last': None} for agent in agents}
        for agent, at, rx, tx in rows:
            at, rx, tx = int(at), int(rx), int(tx)
            previous = result[agent]['last']
            elapsed = (at - previous['at']) / 1000 if previous else 0
            if 0 < elapsed <= 120 and at >= now - seconds * 1000:
                result[agent]['samples'].append({'from': previous['at'], 't': at,
                    'rx': round(max(0, rx - previous['rx']) / elapsed, 1), 'tx': round(max(0, tx - previous['tx']) / elapsed, 1)})
            result[agent]['last'] = {'at': at, 'rx': rx, 'tx': tx}
        return result

    def preferences(self, user_id, changes=None):
        pool = self.database()
        if changes is not None:
            if not isinstance(changes, dict) or changes.keys() - {'people_order', 'people_sort', 'quota_seen'}:
                raise ValueError('Unsupported preference.')
            if 'people_sort' in changes and changes['people_sort'] not in ('manual', 'name'):
                raise ValueError('Unsupported people sort.')
            for field in ('people_order', 'quota_seen'):
                if field not in changes:
                    continue
                order = changes[field]
                if not isinstance(order, list) or len(order) > (500 if field == 'people_order' else 2000) or not all(isinstance(item, str) for item in order) or len(set(order)) != len(order):
                    raise ValueError('Invalid people order.')
                for identifier in order:
                    if not isinstance(identifier, str) or str(uuid.UUID(identifier)) != identifier:
                        raise ValueError('Invalid person identifier.')
            pool.query('''INSERT INTO coder_ui_updates.user_preferences(user_id, settings) VALUES ($1::uuid, $2::jsonb)
                ON CONFLICT (user_id) DO UPDATE SET settings = coder_ui_updates.user_preferences.settings || EXCLUDED.settings ||
                    CASE WHEN EXCLUDED.settings ? 'quota_seen' THEN jsonb_build_object('quota_seen', (
                        SELECT coalesce(jsonb_agg(value), '[]'::jsonb) FROM (
                            SELECT DISTINCT value FROM jsonb_array_elements(
                                coalesce(coder_ui_updates.user_preferences.settings->'quota_seen', '[]'::jsonb) ||
                                (EXCLUDED.settings->'quota_seen')) LIMIT 2000) seen
                    )) ELSE '{}'::jsonb END''',
                       [user_id, json.dumps(changes)])
        rows = pool.query('SELECT settings::text FROM coder_ui_updates.user_preferences WHERE user_id = $1::uuid', [user_id])
        return json.loads(rows[0][0]) if rows else {}

    def run(self):
        last_error = None
        while True:
            try:
                self.sample()
                last_error = None
            except Exception as error:
                if str(error) != last_error:
                    self.log(event='ui-history-unavailable', error=str(error)[:200])
                last_error = str(error)
            time.sleep(2)
