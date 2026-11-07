import io
import json
import os
import pathlib
import struct
import tempfile
import unittest
import urllib.parse
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import migrationcopy
import pgwire
import workspacemigration as migration


class CopyTests(unittest.TestCase):
    def test_round_trip_preserves_data_metadata_links_and_sparse_files(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as destination:
            root = pathlib.Path(source)
            (root / 'nested').mkdir()
            (root / 'nested' / 'settings').write_bytes(b'workspace data\0' * 100)
            os.chmod(root / 'nested' / 'settings', 0o640)
            os.setxattr(root / 'nested' / 'settings', 'user.migration', b'attribute')
            os.link(root / 'nested' / 'settings', root / 'hardlink')
            os.symlink('/outside/target', root / 'symlink')
            os.mkfifo(root / 'pipe')
            with open(root / 'sparse', 'wb') as handle:
                handle.seek(4 * 1024 * 1024)
                handle.write(b'end')
            data = io.BytesIO()
            migrationcopy.send(source, data.write)
            self.assertLess(len(data.getvalue()), 1024 * 1024)
            with patch('builtins.print'):
                migrationcopy.receive(destination, io.BytesIO(data.getvalue()))
            self.assertEqual(migrationcopy.digest(source), migrationcopy.digest(destination))
            self.assertEqual(os.stat(pathlib.Path(destination) / 'hardlink').st_ino,
                             os.stat(pathlib.Path(destination) / 'nested' / 'settings').st_ino)
            self.assertLess(os.stat(pathlib.Path(destination) / 'sparse').st_blocks * 512, 1024 * 1024)

    def test_incomplete_stream_is_rejected(self):
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                migrationcopy.receive(destination, io.BytesIO(b'\0\0'))

    def test_large_sparse_file_transfers_only_data_and_preserves_digest(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as destination:
            path = pathlib.Path(source, 'sparse')
            with path.open('wb') as handle:
                handle.write(b'begin')
                handle.seek(1024 ** 4 - 3)
                handle.write(b'end')
            data = io.BytesIO()
            migrationcopy.send(source, data.write)
            self.assertLess(len(data.getvalue()), 3 * migrationcopy.CHUNK)
            with patch('builtins.print'):
                migrationcopy.receive(destination, io.BytesIO(data.getvalue()))
            copied = pathlib.Path(destination, 'sparse')
            self.assertEqual(copied.stat().st_size, 1024 ** 4)
            self.assertLess(copied.stat().st_blocks * 512, 3 * migrationcopy.CHUNK)
            self.assertEqual(migrationcopy.digest(source), migrationcopy.digest(destination))
            with copied.open('rb') as handle:
                self.assertEqual(handle.read(5), b'begin')
                handle.seek(1024 ** 4 - 3)
                self.assertEqual(handle.read(3), b'end')

    def test_overlapping_sparse_extents_are_rejected(self):
        item = json.dumps(dict(name='file', kind='file', size=10)).encode()
        data = struct.pack('>I', len(item)) + item
        data += struct.pack('>QI', 0, 5) + b'first'
        data += struct.pack('>QI', 4, 2) + b'no'
        with tempfile.TemporaryDirectory() as destination:
            with self.assertRaisesRegex(ValueError, 'Invalid migration file extent'):
                migrationcopy.receive(destination, io.BytesIO(data))

    def test_paths_cannot_escape_through_parent_or_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            os.symlink('/tmp', os.path.join(root, 'link'))
            for name in ('../escape', '/absolute', 'link/escape'):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    migrationcopy.safe_path(root, name)

    def test_corrupted_copy_has_different_digest(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as destination:
            pathlib.Path(source, 'home').write_text('original')
            data = io.BytesIO()
            migrationcopy.send(source, data.write)
            with patch('builtins.print'):
                migrationcopy.receive(destination, io.BytesIO(data.getvalue()))
            pathlib.Path(destination, 'home').write_text('corrupted')
            self.assertNotEqual(migrationcopy.digest(source), migrationcopy.digest(destination))


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.now = migration.volumes.now()
        self.snapshot = dict(nodes=[dict(metadata=dict(name='target', labels={}), spec={}, status=dict(
            addresses=[dict(type='InternalIP', address='10.0.0.2')],
            allocatable=dict(cpu='8', memory='32000'), conditions=[dict(type='Ready', status='True')]))],
            usageTimes={'target': self.now}, usage={'target': dict(cpu='2', memory='4000')}, podsAvailable=True, pods=[])
        self.summary = {'target': {'node': {'fs': dict(time=self.now, capacityBytes=100 * 1024**3, usedBytes=20 * 1024**3, availableBytes=80 * 1024**3)}}}
        self.quantity = patch.object(migration, 'QUANTITY', lambda value: float(value) if value is not None else None)
        self.quantity.start()
        self.addCleanup(self.quantity.stop)
        self.pod = {'containers': [{'resources': {'requests': dict(cpu='1', memory='2000')}}]}

    def candidate(self):
        return migration.candidates(self.snapshot, self.summary, self.pod, 'source', 10 * 1024**3)[0]

    def test_capacity_and_unknown_metrics(self):
        self.assertTrue(self.candidate()['eligible'])
        self.snapshot['usageTimes']['target'] = '2000-01-01T00:00:00Z'
        self.assertFalse(self.candidate()['eligible'])
        self.snapshot['usageTimes']['target'] = self.now
        self.snapshot['podsAvailable'] = False
        self.assertFalse(self.candidate()['eligible'])

    def test_each_check_blocks_with_its_reason(self):
        self.assertEqual(self.candidate()['reasons'], [])
        self.assertEqual(self.candidate()['needs'], dict(cpu=1.0, memory=2000.0, disk=10 * 1024**3))
        node = self.snapshot['nodes'][0]
        node['spec']['unschedulable'] = True
        self.assertIn('Node is not schedulable', self.candidate()['reasons'])
        node['spec'].pop('unschedulable')
        node['status']['conditions'][0]['status'] = 'False'
        self.assertIn('Node is not schedulable', self.candidate()['reasons'])
        node['status']['conditions'][0]['status'] = 'True'
        self.snapshot['usage']['target']['memory'] = '31000'
        self.assertTrue(any(r.startswith('Needs') and 'memory' in r for r in self.candidate()['reasons']))
        self.snapshot['usage']['target']['memory'] = '4000'
        self.summary['target']['node']['fs']['availableBytes'] = 11 * 1024**3
        self.assertTrue(any('disk' in r and 'free' in r for r in self.candidate()['reasons']))

    def test_taints_need_tolerations_and_architecture_must_match(self):
        node = self.snapshot['nodes'][0]
        node['spec']['taints'] = [dict(key='gpu', value='a', effect='NoSchedule')]
        self.assertIn('Node has a taint the workspace does not tolerate', self.candidate()['reasons'])
        self.pod['tolerations'] = [dict(key='gpu', operator='Equal', value='a', effect='NoSchedule')]
        self.assertEqual(self.candidate()['reasons'], [])
        node['status']['nodeInfo'] = dict(architecture='arm64')
        self.snapshot['nodes'].append(dict(metadata=dict(name='source', labels={}), spec={}, status=dict(nodeInfo=dict(architecture='amd64'))))
        self.assertTrue(any(r.startswith('Architecture arm64') for r in self.candidate()['reasons']))

    def test_requested_resources_and_safety_reserve_block_destination(self):
        self.snapshot['pods'] = [{'spec': {'nodeName': 'target', 'containers': [{'resources': {'requests': {'cpu': '7'}}}]}}]
        self.assertTrue(any(r.startswith('Needs 1') and 'cores' in r for r in self.candidate()['reasons']))
        self.snapshot['pods'] = []
        self.summary['target']['node']['fs']['availableBytes'] = 11 * 1024**3
        self.assertFalse(self.candidate()['eligible'])

    def test_changed_pvc_is_never_deleted(self):
        old = {'metadata': {'name': 'home', 'uid': 'original'}}
        with patch.object(migration, 'read', return_value={'metadata': {'name': 'home', 'uid': 'replacement'}}), patch.object(migration, 'api') as api:
            with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                migration.delete('persistentvolumeclaims', old)
            api.assert_not_called()

    def test_retention_uses_uid_precondition(self):
        pv = {'metadata': {'name': 'pv', 'uid': 'pv-identity'}}
        with patch.object(migration, 'read', return_value=pv), patch.object(migration, 'api') as api:
            migration.retain(pv)
            self.assertEqual(api.call_args.args[2][0], {'op': 'test', 'path': '/metadata/uid', 'value': 'pv-identity'})
            self.assertEqual(api.call_args.args[2][1]['value'], 'Retain')

    def test_authentication_and_csrf_precede_workspace_access(self):
        handler = Mock()
        handler.user.return_value = (None, 'denied')
        with patch.object(migration.volumes, 'workspace') as workspace:
            self.assertTrue(migration.handle(handler, 'GET', migration.BASE + '314b2f50-3acd-43c9-89bf-b40a60cf885b'))
            handler.user.assert_called_once_with(admin=True)
            workspace.assert_not_called()
            handler.csrf_ok.return_value = False
            migration.handle(handler, 'POST', migration.BASE + '314b2f50-3acd-43c9-89bf-b40a60cf885b')
            workspace.assert_not_called()
            self.assertEqual(handler.send_json.call_args.args[0], 403)

    def test_progress_is_the_share_of_the_home_copied(self):
        copy = dict(phase='copy', homeUsedBytes=1000, copiedBytes=250)
        self.assertEqual(migration.progress(copy), 25)
        self.assertEqual(migration.progress(dict(copy, copiedBytes=5000)), 99)
        self.assertEqual(migration.progress(dict(copy, homeUsedBytes=None)), 0)
        self.assertEqual([migration.progress(dict(phase=p)) for p in ('prepare', 'canceled')], [0, 0])
        self.assertEqual([migration.progress(dict(phase=p)) for p in ('cutover', 'start', 'done')], [100] * 3)

    def test_requested_resources_sum_requests_then_limits(self):
        spec = dict(podSpec=dict(containers=[
            dict(resources=dict(requests=dict(cpu='2', memory='100'))),
            dict(resources=dict(limits=dict(cpu='1', memory='50')))]))
        self.assertEqual((migration.requested(spec, 'cpu'), migration.requested(spec, 'memory')), (3.0, 150.0))
        self.assertIsNone(migration.requested({}, 'cpu'))

    def test_list_reports_progress_and_requires_an_admin(self):
        state = json.dumps(dict(workspaceName='dev', phase='cutover', diskBytes=10, copiedBytes=7, podSpec=dict(containers=[dict(resources=dict(requests=dict(cpu='2', memory='100')))]), sourceNode='a', target='b', message='m', error=None))
        db = Mock()
        db.query.return_value = [['mid', 'wid', 'running', state, '2026-11-06T10:00:00Z', '2026-11-06T10:05:00Z']]
        handler = Mock()
        handler.user.return_value = ({'id': 'u'}, None)
        with patch.object(migration, 'database', return_value=db):
            self.assertTrue(migration.handle(handler, 'GET', migration.BASE.rstrip('/')))
        code, body = handler.send_json.call_args.args
        self.assertEqual(code, 200)
        self.assertEqual(body['migrations'][0], dict(
            id='mid', workspaceId='wid', workspaceName='dev', status='running', phase='cutover', percent=100, cpu=2.0, memoryBytes=100.0, diskBytes=10, copiedBytes=7,
            sourceNode='a', target='b', message='m', error=None,
            startedAt='2026-11-06T10:00:00Z', updatedAt='2026-11-06T10:05:00Z'))
        denied = Mock()
        denied.user.return_value = (None, 'denied')
        with patch.object(migration, 'database') as unused:
            migration.handle(denied, 'GET', migration.BASE.rstrip('/'))
            unused.assert_not_called()

    def test_missing_lease_never_runs_migration(self):
        lease = Mock()
        lease.query.return_value = [['f']]
        pool = Mock()
        pool.transaction.return_value.__enter__ = Mock(return_value=lease)
        pool.transaction.return_value.__exit__ = Mock(return_value=False)
        op = dict(id='op', workspaceId='workspace', worker='attempt')
        with patch.object(migration, 'database', return_value=pool), patch.object(migration, 'save'), patch.object(migration, 'LOG'), patch.object(migration, 'run') as run:
            migration.worker('token', op)
            run.assert_not_called()

    def test_live_mount_blocks_cutover(self):
        with patch.object(migration, 'api', return_value={'items': [{'spec': {'volumes': [{'persistentVolumeClaim': {'claimName': 'home'}}]}}]}):
            with self.assertRaisesRegex(RuntimeError, 'still uses'):
                migration.no_mounts(['home'])

    def test_cutover_refuses_to_delete_claims_still_mounted(self):
        op = {'pvc': {'metadata': {'name': 'home'}}, 'pv': {},
              'destinationPV': {'metadata': {'name': 'destination'}}, 'temporaryClaim': 'staging'}
        with patch.object(migration, 'read', return_value={'spec': {'volumeName': 'original'}}), \
             patch.object(migration, 'ensure_offline'), patch.object(migration, 'clean_helpers'), \
             patch.object(migration, 'retain'), \
             patch.object(migration, 'api', return_value={'items': [{'spec': {'volumes': [{'persistentVolumeClaim': {'claimName': 'home'}}]}}]}), \
             patch.object(migration, 'delete') as delete:
            with self.assertRaisesRegex(RuntimeError, 'still uses'):
                migration.cutover('token', op, Mock())
            delete.assert_not_called()


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Test Postgres required')
class MigrationFencingTests(unittest.TestCase):
    def setUp(self):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        self.admin = pgwire.Connection(url)
        self.name = 'migration_test_' + uuid.uuid4().hex
        self.admin.query('CREATE DATABASE ' + self.name)
        self.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/' + self.name)))
        self.pool.query('CREATE SCHEMA coder_ui_updates')
        self.pool.query('CREATE TABLE organizations(id uuid PRIMARY KEY)')
        self.org, self.wid, self.uid, self.mid = [str(uuid.uuid4()) for _ in range(4)]
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [self.org])
        self.addCleanup(self.cleanup)
        state = patch.object(migration, 'STATE', SimpleNamespace(database=lambda: self.pool))
        state.start()
        self.addCleanup(state.stop)
        migration.SCHEMA_READY = False
        migration.database()
        self.pvc = {'metadata': {'name': 'home', 'uid': 'original'}, 'spec': {'volumeName': 'source'}}
        op = {'phase': 'copy', 'workspaceId': self.wid, 'pvc': self.pvc,
              'pv': {'metadata': {'name': 'source'}}, 'temporaryClaim': 'staging', 'target': 'target'}
        self.pool.query('''INSERT INTO coder_ui_updates.workspace_migrations
            (id, organization_id, workspace_id, created_by, status, worker, state)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'failed','old-attempt',$5::jsonb)''',
            [self.mid, self.org, self.wid, self.uid, json.dumps(op)])
        self.ws = {'id': self.wid, 'organization_id': self.org}

    def cleanup(self):
        migration.SCHEMA_READY = False
        for connection in self.pool.idle:
            connection.close()
        self.admin.query('DROP DATABASE ' + self.name)
        self.admin.close()

    def test_cancel_fences_resume_and_stale_workers(self):
        stale = migration.latest(self.ws)
        def resume_during_cleanup(op):
            with self.assertRaisesRegex(ValueError, 'operation is in progress'):
                migration.start('token', self.ws, {'id': self.uid}, resume=True)
        with patch.object(migration, 'read', side_effect=lambda kind, name: self.pvc if name == 'home' else None), \
             patch.object(migration, 'clean_helpers', side_effect=resume_during_cleanup), \
             patch.object(migration, 'LOG'), patch.object(migration, 'run') as run:
            result = migration.cancel(self.ws)
            self.assertEqual((result['status'], result['phase']), ('done', 'canceled'))
            migration.worker('token', stale)
            run.assert_not_called()
        persisted = migration.latest(self.ws)
        self.assertEqual((persisted['status'], persisted['phase']), ('done', 'canceled'))

    def test_old_attempt_cannot_overwrite_new_claim(self):
        stale = migration.latest(self.ws)
        self.pool.query("UPDATE coder_ui_updates.workspace_migrations SET status='running',worker='new-attempt' WHERE id=$1::uuid", [self.mid])
        with patch.object(migration, 'run') as run:
            migration.worker('token', stale)
            run.assert_not_called()
        with self.assertRaisesRegex(RuntimeError, 'superseded'):
            migration.save(stale, status='failed')
        self.assertEqual(migration.latest(self.ws)['worker'], 'new-attempt')
        self.assertEqual(migration.latest(self.ws)['status'], 'running')


if __name__ == '__main__':
    unittest.main()
