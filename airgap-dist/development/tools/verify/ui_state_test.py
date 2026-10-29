"""Exercise shared UI persistence against an isolated database on a test Postgres server."""
import os
import json
import ast
import re
import sqlite3
import tempfile
import threading
import concurrent.futures
import pathlib
import sys
import time
import unittest
import urllib.parse
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import pgwire
import uistate
import pgdocuments
import driveaudit


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Set UI_STATE_TEST_DATABASE_URL to a test Postgres server')
class UIStateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin = pgwire.Connection(url)
        cls.name = 'ui_state_test_' + uuid.uuid4().hex
        cls.admin.query('CREATE DATABASE ' + cls.name)
        parts = urllib.parse.urlsplit(url)
        cls.url = urllib.parse.urlunsplit(parts._replace(path='/' + cls.name))
        cls.pool = pgwire.Pool(cls.url)
        cls.pool.query('CREATE TABLE users(id uuid PRIMARY KEY)')
        cls.pool.query('CREATE TABLE workspaces(id uuid PRIMARY KEY, organization_id uuid NOT NULL, deleted boolean DEFAULT false)')
        cls.pool.query('CREATE TABLE workspace_builds(workspace_id uuid, job_id uuid, build_number int, transition text)')
        cls.pool.query('CREATE TABLE workspace_resources(id uuid, job_id uuid)')
        cls.pool.query('CREATE TABLE workspace_agents(id uuid PRIMARY KEY, resource_id uuid, parent_id uuid, deleted boolean DEFAULT false)')
        cls.pool.query("CREATE TABLE workspace_agent_metadata(workspace_agent_id uuid, key text, value text, collected_at timestamptz, error text DEFAULT '')")

    @classmethod
    def tearDownClass(cls):
        for connection in cls.pool.idle:
            connection.close()
        cls.admin.query('DROP DATABASE ' + cls.name)
        cls.admin.close()

    def setUp(self):
        self.state = uistate.UIState(lambda: self.pool, lambda **kwargs: None)
        self.user, self.other, self.org, self.workspace, self.agent = (str(uuid.uuid4()) for _ in range(5))
        self.pool.query('INSERT INTO users VALUES ($1::uuid), ($2::uuid)', [self.user, self.other])
        self.state.database()

    def test_preferences_survive_service_restart_and_remain_per_user(self):
        settings = {'people_sort': 'manual', 'people_order': [self.other]}
        self.assertEqual(self.state.preferences(self.user, settings), settings)
        restarted = uistate.UIState(lambda: self.pool, lambda **kwargs: None)
        self.assertEqual(restarted.preferences(self.user), settings)
        self.assertEqual(restarted.preferences(self.other), {})
        self.assertEqual(restarted.preferences(self.user, {'people_sort': 'name'}), {**settings, 'people_sort': 'name'})
        for invalid in ({'people_order': [self.other, self.other]}, {'people_order': [{}]},
                        {'people_order': ['not-a-user-id']}, {'people_sort': 'unknown'}, {'admin': True}):
            with self.assertRaises(ValueError):
                self.state.preferences(self.user, invalid)
        self.assertEqual(restarted.preferences(self.user)['people_order'], [self.other])

    def test_background_sampling_deduplicates_replicas_and_expires_old_readings(self):
        job, resource = (str(uuid.uuid4()) for _ in range(2))
        self.pool.query('INSERT INTO workspaces(id, organization_id) VALUES ($1::uuid, $2::uuid)', [self.workspace, self.org])
        self.pool.query('INSERT INTO workspace_builds VALUES ($1::uuid, $2::uuid, 1, $3)', [self.workspace, job, 'start'])
        self.pool.query('INSERT INTO workspace_resources VALUES ($1::uuid, $2::uuid)', [resource, job])
        self.pool.query('INSERT INTO workspace_agents(id, resource_id) VALUES ($1::uuid, $2::uuid)', [self.agent, resource])
        self.pool.query("INSERT INTO workspace_agent_metadata(workspace_agent_id, key, value, collected_at) VALUES ($1::uuid, '0_cpu_usage', '1 / 2 cores (50%)', now()), ($1::uuid, '1_mem_usage', '1 / 4 GiB (25%)', now())", [self.agent])
        self.state.sample()
        restarted = uistate.UIState(lambda: self.pool, lambda **kwargs: None)
        restarted.sample()
        ws = {'organization_id': self.org, 'id': self.workspace}
        history = restarted.history(ws)
        self.assertEqual(history['windowSeconds'], 300)
        self.assertEqual(len(history['agents'][self.agent]['cpu']), 1)
        self.assertEqual(history['agents'][self.agent]['cpu'][0]['share'], 50)
        self.assertIsInstance(history['agents'][self.agent]['cpu'][0]['t'], int)
        self.assertEqual(history['agents'][self.agent]['ram'][0]['share'], 25)
        self.assertEqual(restarted.history({**ws, 'organization_id': self.other})['agents'], {})
        self.assertEqual(restarted.history({**ws, 'id': self.other})['agents'], {})
        self.pool.query('UPDATE coder_ui_updates.workspace_metrics SET t = $1::bigint WHERE workspace_id = $2::uuid', [int(time.time() * 1000) - 14401000, self.workspace])
        self.assertEqual(restarted.history(ws)['agents'], {})
        self.pool.query('DELETE FROM workspace_agent_metadata WHERE workspace_agent_id = $1::uuid', [self.agent])
        self.state.cleaned = 0
        self.state.sample()
        self.assertEqual(self.pool.query('SELECT count(*) FROM coder_ui_updates.workspace_metrics WHERE workspace_id = $1::uuid', [self.workspace]), [('0',)])

    def test_short_graph_keeps_one_prior_disk_reading_for_its_reporting_interval(self):
        now = int(time.time() * 1000)
        sample = self.state.readings([(self.org, self.workspace, self.agent, '2_home_disk', '1 / 10 GB (10%)', now - 50000)])
        self.pool.query("""INSERT INTO coder_ui_updates.workspace_metrics SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS sample(organization_id uuid, workspace_id uuid, agent_id uuid, metric text, t bigint,
            share double precision, value double precision, text text, key text)""", [json.dumps(sample)])
        data = self.state.history({'organization_id': self.org, 'id': self.workspace}, seconds=40, buckets=40)
        self.assertEqual(len(data['agents'][self.agent]['disk']), 1)
        self.assertEqual(data['agents'][self.agent]['disk'][0]['share'], 10)

    def test_viewed_quota_requests_merge_across_clients_without_losing_prior_reads(self):
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        self.state.preferences(self.user, {'quota_seen': [first]})
        restarted = uistate.UIState(lambda: self.pool, lambda **kwargs: None)
        result = restarted.preferences(self.user, {'quota_seen': [second]})
        self.assertEqual(set(result['quota_seen']), {first, second})
        self.assertEqual(restarted.preferences(self.other), {})

    def test_connection_documents_migrate_once_rollback_and_serialize_replicas(self):
        with tempfile.TemporaryDirectory() as folder:
            path = folder + '/connections-' + uuid.uuid4().hex + '.json'
            with open(path, 'w') as source:
                json.dump({'revision': 7, 'revoked': True}, source)
            first = pgdocuments.Documents(lambda: self.pool)
            second = pgdocuments.Documents(lambda: self.pool)
            self.assertEqual(first.read_file(path)['revision'], 7)
            def update(index):
                store = first if index % 2 else second
                with store.file_state(path, {}, write=True) as state:
                    state['revision'] += 1
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                list(executor.map(update, range(16)))
            self.assertEqual(second.read_file(path), {'revision': 23, 'revoked': True})
            with self.assertRaises(RuntimeError):
                with first.file_state(path, {}, write=True) as state:
                    state['revoked'] = False
                    raise RuntimeError('cancel update')
            self.assertTrue(second.read_file(path)['revoked'])
            with first.file_state(path, {}, write=True):
                first.write_file(path, {'revision': 24, 'revoked': True})
            self.assertEqual(second.read_file(path)['revision'], 24)
            first.write_file(path, None)
            self.assertIsNone(second.read_file(path))
            # The retained legacy file cannot resurrect a reset setting.
            self.assertTrue(os.path.isfile(path))

    def test_cloud_drive_credentials_outbox_and_revocation_survive_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = folder + '/drive-audit.sqlite'
            legacy = driveaudit.Store(path)
            original = legacy.credentials(self.user)
            item = driveaudit.event(self.user, self.other, 'added', 'sample.txt', 9)
            legacy.record(item)
            shared = driveaudit.PostgresStore(path, lambda: self.pool)
            self.assertEqual(shared.credentials(self.user), original)
            restarted = driveaudit.PostgresStore(path, lambda: self.pool)
            self.assertEqual(restarted.principal(original['accessKey'])[0], self.user)
            self.assertIn(item['id'], [event['id'] for event in restarted.pending()])
            sent = []
            restarted.deliver(lambda event: [self.other], lambda *args: sent.append(args))
            self.assertEqual(len(sent), 1)
            shared.deliver(lambda event: [self.other], lambda *args: sent.append(args))
            self.assertEqual(len(sent), 1)
            # An old local outbox cannot cause a delivered event to reappear.
            again = driveaudit.PostgresStore(path, lambda: self.pool)
            self.assertEqual(again.pending(), [])

    def test_all_workspace_metrics_are_bucketed_in_postgres(self):
        now = int(time.time() * 1000)
        samples = []
        for index in range(200):
            for key, text in [('0_cpu_usage', f'{index % 100}%'), ('1_ram_usage', '1 / 4 GiB (25%)'),
                              ('2_home_disk', '2 / 10 GB (20%)'), ('3_load', '0.5')]:
                samples += self.state.readings([(self.org, self.workspace, self.agent, key, text, now - 299000 + index * 1000)])
        self.pool.query("""INSERT INTO coder_ui_updates.workspace_metrics SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS sample(organization_id uuid, workspace_id uuid, agent_id uuid, metric text, t bigint,
            share double precision, value double precision, text text, key text)""", [json.dumps(samples)])
        data = self.state.history({'organization_id': self.org, 'id': self.workspace}, buckets=12)['agents'][self.agent]
        for metric in ('cpu', 'ram', 'disk', 'load'):
            self.assertGreater(len(data[metric]), 0)
            self.assertLessEqual(len(data[metric]), 12)
        self.assertEqual(max(point['share'] for point in data['cpu']), 99)
        self.assertEqual(data['load'][0]['value'], 0.5)
        self.assertEqual(data['load'][0]['share'], 50)
        self.assertEqual(data['disk'][0]['share'], 20)

    def test_trusted_node_identity_and_cluster_histories_stay_separate(self):
        at = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
        cpu = {'used': 1, 'total': 4, 'unit': 'cores', 'collectedAt': at, 'error': None}
        self.state.add_infrastructure({'node:one:uid-one': {'cpu': cpu},
                                      'node:two:uid-two': {'cpu': {**cpu, 'used': 2}},
                                      'cluster': {'cpu': {**cpu, 'used': 3, 'total': 8}},
                                      'node:unavailable:uid': {'cpu': {**cpu, 'used': None, 'error': 'unavailable'}}})
        restarted = uistate.UIState(lambda: self.pool, lambda **kwargs: None)
        self.assertEqual(restarted.infrastructure_history('node:one:uid-one')['cpu'][0]['used'], 1)
        self.assertEqual(restarted.infrastructure_history('cluster')['cpu'][0]['used'], 3)
        self.assertEqual(restarted.infrastructure_history('node:one:new-uid'), {})
        self.assertEqual(restarted.infrastructure_history('node:unavailable:uid'), {})

    def test_hud_legacy_migration_shared_reads_and_all_sample_fields(self):
        source = pathlib.Path(uistate.__file__).with_name('ui-service.py').read_text()
        history = next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == 'HudHistory')
        namespace = dict(threading=threading, sqlite3=sqlite3, time=time, os=os, re=re,
                         HUD_SAMPLE_EVERY=15, HUD_HISTORY_DAYS=7, HUD_RANGES={'1h': 3600})
        exec(compile(ast.Module(body=[history], type_ignores=[]), '<HUD history>', 'exec'), namespace)
        now = int(time.time())
        self.pool.query('DELETE FROM coder_ui_updates.hud_samples')
        with tempfile.TemporaryDirectory() as folder:
            path = folder + '/hud.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE samples (t INTEGER PRIMARY KEY, live INTEGER, cpu REAL, cpu_total REAL, mem REAL, mem_total REAL)')
                db.execute('INSERT INTO samples VALUES (?, 1, 1, 8, 2, 16)', [now - 60])
            old = namespace['HudHistory'](path, backing=self.state)
            self.assertEqual(old.usage_recent()['points'][0]['cpu'], 1)
            row = dict.fromkeys(self.state.HUD_COLUMNS, None)
            row.update(t=now, live=1, cpu=2, cpu_ws=1, cpu_total=8, mem=3, mem_ws=2, mem_total=16,
                       lat_p50=5, lat_p95=9, lat_max=12, connections=3, net_rx=2048.25, net_tx=512.5,
                       disk_used=3, disk_total=10, disk_claimed=4, volume_used=2)
            self.state.insert_hud([tuple(row[name] for name in self.state.HUD_COLUMNS)])
            restarted = namespace['HudHistory'](folder + '/absent.sqlite', backing=self.state)
            recent = restarted.usage_recent()
            self.assertEqual([point['cpu'] for point in recent['points']], [1, 2])
            self.assertEqual(restarted.network_recent()['rx'], 2048.2)
            point = restarted.series('1h')['points'][-1]
            self.assertEqual((point['diskUsed'], point['diskTotal'], point['diskClaimed'], point['volumeUsed']), (3, 10, 4, 2))
            self.assertEqual((point['cpu'], point['memory'], point['latencyP95'], point['connections']), (2, 3, 9, 3))
            old.migrate_legacy()
            self.assertEqual(self.pool.query('SELECT count(*) FROM coder_ui_updates.hud_samples'), [('2',)])


if __name__ == '__main__':
    unittest.main()
