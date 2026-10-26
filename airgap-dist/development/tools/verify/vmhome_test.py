"""Exclusive HOME operations reject stale identity and preserve admission fences."""
import copy
import json
import os
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import vmhome
import vmfs

WID = '00000000-0000-4000-8000-000000000001'
OWNER = '00000000-0000-4000-8000-000000000002'
ORG = '00000000-0000-4000-8000-000000000003'
NODE = '00000000-0000-4000-8000-000000000004'


class Kube:
    def __init__(self):
        self.record = {'status': 'ready', 'workspace_id': WID, 'workspace_owner_id': OWNER, 'organization_id': ORG,
                       'claim_name': 'home', 'claim_uid': 'claim', 'pv_name': 'pv', 'pv_uid': 'physical',
                       'home_bytes': 1000000000, 'node_name': 'worker', 'node_uid': NODE}
        self.registry = {'metadata': {'resourceVersion': '1'}, 'data': {'homes.json': json.dumps({WID: self.record})}}
        self.claim = {'metadata': {'uid': 'claim', 'resourceVersion': '10'}, 'spec': {'volumeMode': 'Block'}}
        self.pv = {'metadata': {'uid': 'physical'}, 'spec': {'volumeMode': 'Block', 'persistentVolumeReclaimPolicy': 'Retain', 'claimRef': {'uid': 'claim'},
                  'local': {'path': str(vmhome.DEVICES / WID)}}}
        self.vm = {'metadata': {'uid': 'vm', 'resourceVersion': '1', 'generation': 1, 'labels': {'com.coder.workspace.id': WID, 'com.coder.organization.id': ORG, 'com.coder.user.id': OWNER}, 'annotations': {'platform.coder/build-id': WID, 'com.coder.agent.id': OWNER, 'platform.coder/desired-run-strategy': 'Halted'}}, 'spec': {'runStrategy': 'Halted'}}
        self.node_uid = NODE
        self.instance = False
        self.updates = []

    def call(self, method, path, body=None, content_type=None):
        if method == 'PATCH' and '/configmaps/' in path:
            if body[0]['value'] != self.registry['metadata']['resourceVersion']:
                return 409, {}
            self.registry['data']['homes.json'] = body[1]['value']
            self.registry['metadata']['resourceVersion'] = str(int(self.registry['metadata']['resourceVersion']) + 1)
            self.updates.append(json.loads(body[1]['value'])[WID]['status'])
            return 200, copy.deepcopy(self.registry)
        if method != 'GET':
            raise AssertionError((method, path))
        if '/configmaps/' in path:
            result = self.registry
        elif '/persistentvolumeclaims/' in path:
            result = self.claim
        elif '/persistentvolumes/' in path:
            result = self.pv
        elif '/virtualmachineinstances/' in path:
            return (200, {'metadata': {'uid': 'instance'}}) if self.instance else (404, {})
        elif '/virtualmachines/' in path:
            result = self.vm
        elif path.endswith('/pods'):
            result = {'items': []}
        elif '/nodes/' in path:
            result = {'metadata': {'uid': self.node_uid}, 'status': {'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        else:
            raise AssertionError(path)
        return 200, copy.deepcopy(result)


class VMHomeTest(unittest.TestCase):
    def request(self):
        return {'version': 1, 'workspace_id': WID, 'workspace_owner_id': OWNER, 'organization_id': ORG,
                'pvc_uid': 'claim', 'pv_uid': 'physical', 'record_resource_version': '1', 'old_bytes': 1000000000}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patch in (mock.patch.dict(os.environ, {'NODE_NAME': 'worker', 'POD_NAMESPACE': 'runtime', 'WORKSPACE_NAMESPACE': 'coder'}),
                      mock.patch.object(vmhome, 'private_directory', return_value=pathlib.Path(self.directory.name)),
                      mock.patch.object(vmhome, 'device_for', return_value='/dev/fake-home'),
                      mock.patch.object(vmhome, 'no_openers'), mock.patch.object(vmhome, 'quarantine'), mock.patch.object(vmhome, 'restore_device')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_missing_original_node_uid_or_reused_hostname_fails_before_any_home_mutation(self):
        for missing in (False, True):
            kube = Kube()
            if missing:
                kube.record.pop('node_uid')
                kube.registry['data']['homes.json'] = json.dumps({WID:kube.record})
            else:
                kube.node_uid = OWNER
            with self.subTest(missing=missing), self.assertRaises(vmhome.HomeError):
                with vmhome.locked_home(kube, self.request()):
                    self.fail('Unenrolled or replacement worker must not operate on HOME')
            self.assertEqual(kube.updates, [])
            vmhome.device_for.assert_not_called()
            vmhome.quarantine.assert_not_called()

    def test_capacity_preflight_does_not_create_directory_on_replacement_worker(self):
        kube = Kube()
        kube.node_uid = OWNER
        with mock.patch.object(vmhome, 'PARENT', pathlib.Path(self.directory.name, 'uncreated')):
            with self.assertRaises(vmhome.HomeError):
                vmhome.ensure_capacity(kube, {**self.request(),'new_bytes':2000000000})
        self.assertFalse(pathlib.Path(self.directory.name, 'uncreated').exists())

    def test_success_holds_exclusive_fence_until_caller_returns(self):
        kube = Kube()
        with vmhome.locked_home(kube, self.request(), 'backup') as context:
            self.assertEqual(context['device'], '/dev/fake-home')
            self.assertEqual(json.loads(kube.registry['data']['homes.json'])[WID]['status'], 'backup')
        self.assertEqual(kube.updates, ['backup', 'ready'])

    def test_restore_failure_keeps_starts_blocked(self):
        kube = Kube()
        with self.assertRaisesRegex(RuntimeError, 'restore failed'):
            with vmhome.locked_home(kube, self.request(), 'restore'):
                raise RuntimeError('restore failed')
        self.assertEqual(kube.updates, ['restore', 'needs-review'])

    def test_stale_or_foreign_request_never_mutates(self):
        for field, value in (('pvc_uid', 'replaced'), ('pv_uid', 'replaced'), ('record_resource_version', 'old'),
                             ('organization_id', OWNER), ('old_bytes', 2000000000)):
            kube = Kube()
            request = self.request()
            request[field] = value
            with self.subTest(field=field), self.assertRaises(vmhome.HomeError):
                with vmhome.locked_home(kube, request):
                    self.fail('operation must not start')
            self.assertEqual(kube.updates, [])

    def test_active_vm_instance_and_running_intent_rejected(self):
        for instance, strategy in ((True, 'Halted'), (False, 'Always')):
            kube = Kube()
            kube.instance, kube.vm['spec']['runStrategy'] = instance, strategy
            with self.subTest(instance=instance, strategy=strategy), self.assertRaises(vmhome.HomeError):
                with vmhome.locked_home(kube, self.request()):
                    self.fail('operation must not start')
            self.assertEqual(kube.updates, [])

    def test_journal_blocks_recovery_until_review(self):
        kube = Kube()
        with self.assertRaises(RuntimeError):
            with vmhome.locked_home(kube, self.request(), 'restore'):
                raise RuntimeError('failed')
        journal = pathlib.Path(self.directory.name, 'operation.json')
        self.assertEqual(json.loads(journal.read_text())['status'], 'needs-review')
        self.assertEqual(journal.stat().st_mode & 0o777, 0o600)

    def test_intervening_start_stop_version_blocks_physical_access(self):
        kube = Kube()
        original = kube.call
        def changed(method, path, body=None, content_type=None):
            result = original(method, path, body, content_type)
            if method == 'PATCH':
                kube.vm['metadata']['generation'] = 3
                kube.vm['metadata']['resourceVersion'] = '2'
            return result
        kube.call = changed
        with self.assertRaises(vmhome.HomeError):
            with vmhome.locked_home(kube, self.request()):
                self.fail('operation must not begin')
        vmhome.quarantine.assert_not_called()
        self.assertEqual(kube.updates, ['backup', 'needs-review'])

    def test_status_and_manager_proof_updates_do_not_change_intent_fence(self):
        kube = Kube()
        with vmhome.locked_home(kube, self.request()) as context:
            saved = json.loads(pathlib.Path(self.directory.name, 'operation.json').read_text())
            self.assertEqual(saved['vm_fence']['generation'], 1)
            kube.vm['metadata']['resourceVersion'] = '2'
            kube.vm['status'] = {'ready': False, 'volumeReady': True}
            kube.vm['metadata']['annotations']['platform.coder/applied-profile'] = 'proof'
        self.assertEqual(kube.updates, ['backup', 'ready'])

    def test_every_authoritative_intent_change_keeps_disk_quarantined(self):
        mutations = [
            lambda vm: vm['metadata'].update(uid='replaced'),
            lambda vm: vm['metadata'].update(generation=3),
            lambda vm: vm['spec'].update(template={'changed': True}),
            lambda vm: vm['metadata']['labels'].update({'com.coder.user.id': ORG}),
            lambda vm: vm['metadata']['labels'].update({'com.coder.organization.id': OWNER}),
            lambda vm: vm['metadata']['labels'].update({'com.coder.workspace.id': OWNER}),
            lambda vm: vm['metadata']['annotations'].update({'platform.coder/build-id': ORG}),
            lambda vm: vm['metadata']['annotations'].update({'com.coder.agent.id': ORG}),
            lambda vm: vm['metadata']['annotations'].update({'platform.coder/desired-run-strategy': 'Always'}),
        ]
        for mutate in mutations:
            kube = Kube()
            with self.subTest(mutation=mutate), self.assertRaises(vmhome.HomeError):
                with vmhome.locked_home(kube, self.request()):
                    mutate(kube.vm)
            self.assertEqual(kube.updates, ['backup', 'needs-review'])
            # Each isolated attempt uses the same private temporary directory.
            pathlib.Path(self.directory.name, 'operation.json').unlink()

    def test_maintenance_scratch_cannot_consume_worker_reserve(self):
        request=self.request()
        archive_bytes=request['old_bytes']+64*1048576
        copies=2*archive_bytes+2*request['old_bytes']
        reserves=32*1073741824+request['old_bytes']
        space=SimpleNamespace(f_bavail=reserves+copies+1073741824,f_frsize=1)
        kube=Kube()
        with mock.patch.object(vmhome,'PARENT',pathlib.Path(self.directory.name)),mock.patch.object(vmhome.os,'statvfs',return_value=space),mock.patch.object(vmfs,'available'):
            with self.assertRaisesRegex(vmhome.HomeError,'insufficient verified worker storage capacity'):
                with vmhome.restore_reservation(kube,request,archive_bytes):
                    self.fail('scratch must be reserved before starting restore')
        self.assertEqual(kube.updates,[])
        vmhome.quarantine.assert_not_called()

    def test_grow_copies_fitting_without_scratch_are_refused_before_quarantine(self):
        request={**self.request(),'new_bytes':2000000000}
        reserves=32*1073741824+request['old_bytes']
        space=SimpleNamespace(f_bavail=reserves+2*request['new_bytes']+1073741824,f_frsize=1)
        kube=Kube()
        with mock.patch.object(vmhome,'PARENT',pathlib.Path(self.directory.name)),mock.patch.object(vmhome.os,'statvfs',return_value=space),mock.patch.object(vmfs,'available'):
            with self.assertRaisesRegex(vmhome.HomeError,'insufficient verified worker storage capacity'):
                vmhome.grow(kube,request)
        self.assertEqual(kube.updates,[])
        vmhome.quarantine.assert_not_called()

    def test_sparse_allocation_cannot_exceed_logical_node_budget(self):
        request = {**self.request(), 'new_bytes': 1000000000000000, 'node_name': 'worker', 'node_uid': NODE}
        with mock.patch.object(vmhome, 'PARENT', pathlib.Path(self.directory.name)):
            with self.assertRaisesRegex(vmhome.HomeError, 'insufficient verified worker storage capacity'):
                vmhome.ensure_capacity(Kube(), request, preparing=True)
        self.assertFalse(pathlib.Path(self.directory.name, WID, 'home.raw').exists())

    def test_prepare_formats_private_file_before_publishing_device(self):
        kube = Kube()
        kube.registry['data']['homes.json'] = '{}'
        kube.claim['metadata']['labels'] = {'com.coder.workspace.id': WID, 'com.coder.user.id': OWNER,
                                            'com.coder.organization.id': ORG}
        kube.claim['spec']['resources'] = {'requests': {'storage': '1000000000'}}
        original = kube.call
        def call(method, path, body=None, content_type=None):
            if method == 'POST' and path == '/api/v1/persistentvolumes':
                return 201, {'metadata': {'uid': 'new-physical'}}
            if method == 'PATCH' and '/persistentvolumeclaims/' in path:
                self.assertEqual(body[:2], [{'op': 'test', 'path': '/metadata/uid', 'value': 'claim'}, {'op': 'test', 'path': '/metadata/resourceVersion', 'value': '10'}])
                self.assertEqual(body[2]['value']['platform.coder/retained-vm-home'], 'true')
                self.assertEqual(body[2]['value']['platform.coder/home-disk-bytes'], '1000000000')
                self.assertEqual(kube.updates, ['preparing'])
                events.append('claim-acknowledged')
                return 200, {}
            return original(method, path, body, content_type)
        kube.call = call
        events = []
        def run(*args):
            self.assertEqual(args, ('mkfs.ext4', '-F', '-m', '0', str(pathlib.Path(self.directory.name, 'home.raw'))))
            vmhome.device_for.assert_not_called()
            events.append('formatted')
        vmhome.device_for.side_effect = lambda *args: events.append('published')
        request = {**self.request(), 'old_bytes': 0, 'new_bytes': 1000000000,
                   'claim_name': 'home', 'node_name': 'worker', 'node_uid': NODE}
        with mock.patch.object(vmhome, 'run', side_effect=run), mock.patch.object(vmhome, 'ensure_capacity'), mock.patch.object(vmhome, 'digest', return_value='zero-test-digest'):
            self.assertTrue(vmhome.prepare(kube, request)['ok'])
        self.assertEqual(events, ['formatted', 'published', 'claim-acknowledged'])
        vmhome.no_openers.assert_not_called()
        self.assertEqual(kube.updates, ['preparing', 'ready'])
        self.assertEqual(json.loads(kube.registry['data']['homes.json'])[WID]['node_uid'], NODE)
        self.assertEqual(json.loads(pathlib.Path(self.directory.name, 'manifest.json').read_text())['node_uid'], NODE)

    def test_retained_ack_retries_only_binder_version_race(self):
        for replacement in (False, True):
            with self.subTest(replacement=replacement):
                kube = Kube()
                kube.claim['spec'].update(volumeName='pv', resources={'requests': {'storage': '1000000000'}})
                original = kube.call
                patches = []
                def call(method, path, body=None, content_type=None):
                    if method == 'PATCH':
                        patches.append(body)
                        if len(patches) == 1:
                            kube.claim['metadata']['resourceVersion'] = '11'
                            if replacement:
                                kube.claim['metadata']['uid'] = 'foreign'
                            return 422, {}
                        return 200, {}
                    return original(method, path, body, content_type)
                kube.call = call
                if replacement:
                    with self.assertRaises(vmhome.HomeError):
                        vmhome.acknowledge_claim(kube, 'coder', 'home', 'claim', 'pv', 1000000000)
                    self.assertEqual(len(patches), 1)
                else:
                    vmhome.acknowledge_claim(kube, 'coder', 'home', 'claim', 'pv', 1000000000)
                    self.assertEqual(len(patches), 2)
                    self.assertEqual(patches[1][1]['value'], '11')

    def test_retained_ack_does_not_retry_unrelated_validation_failure(self):
        kube = Kube()
        kube.claim['spec']['resources'] = {'requests': {'storage': '1000000000'}}
        original = kube.call
        patches = []
        def call(method, path, body=None, content_type=None):
            if method == 'PATCH':
                patches.append(body)
                return 422, {}
            return original(method, path, body, content_type)
        kube.call = call
        with self.assertRaisesRegex(vmhome.HomeError, 'HTTP 422'):
            vmhome.acknowledge_claim(kube, 'coder', 'home', 'claim', 'pv', 1000000000)
        self.assertEqual(len(patches), 1)

    def test_shrink_and_fractional_sector_never_reach_filesystem(self):
        for size in (500000000, 1000000000, 1000000001):
            with self.subTest(size=size), self.assertRaises(vmhome.HomeError):
                vmhome.grow(Kube(), {**self.request(), 'new_bytes': size})


if __name__ == '__main__':
    unittest.main()
