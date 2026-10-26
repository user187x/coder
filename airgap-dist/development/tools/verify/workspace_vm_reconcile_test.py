"""Current-build VM updates must not acknowledge stale hardware or undo stops."""
import copy
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmreconcile
from test_vmprofile import fixture, lookup


class ReconcileTest(unittest.TestCase):
    def setUp(self):
        self.kube, self.http = mock.Mock(), mock.Mock()
        self.intent = {'workspace_id': 'workspace', 'organization_id': 'org', 'owner_id': 'user', 'build_id': 'build', 'transition': 'start', 'job_status': 'running'}
        self.manager = vmreconcile.Reconciler(self.kube, self.http, 'http://coder', 'coder', mock.Mock(), build_intent=lambda wid, bid: self.intent)
        self.manager.home_ready = mock.Mock(return_value=True)
        self.manager.assigned_node = mock.Mock(return_value="worker")
        self.profile = {'workspace_id': 'workspace', 'organization_id': 'org', 'workspace_owner_id': 'user',
                        'build_id': 'build', 'agent': {'token': 'private-token'}, 'memory_bytes': 2147483648}
        self.cpu = {'sockets': 1, 'cores': 2, 'threads': 1, 'maxSockets': 1, 'model': 'Haswell-noTSX'}
        self.vm = {'metadata': {'name': 'coder-vm-workspace', 'uid': 'vm-uid', 'resourceVersion': '1',
            'labels': {'com.coder.workspace.id': 'workspace', 'com.coder.organization.id': 'org', 'com.coder.user.id': 'user'},
            'annotations': {'com.coder.agent.id': 'agent', 'platform.coder/build-id': 'build'}}, 'spec': {'runStrategy': 'Always', 'template': {'spec': {
                'volumes': [{'name': 'cloudinit', 'cloudInitNoCloud': {'secretRef': {'name': 'new-boot-hash'}}}],
                'domain': {'cpu': self.cpu}}}}}
        self.instance = {'metadata': {'uid': 'vmi-uid', 'resourceVersion': '2', 'ownerReferences': [
            {'kind': 'VirtualMachine', 'controller': True, 'uid': 'vm-uid'}]},
            'spec': {'volumes': copy.deepcopy(self.vm['spec']['template']['spec']['volumes']),
                     'domain': {'cpu': self.cpu, 'memory': {'guest': '2Gi'}}},
            'status': {'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        self.http.return_value = (200, {'workspace_id': 'workspace', 'organization_id': 'org', 'agent_id': 'agent'})
        patch = mock.patch.object(vmreconcile, 'boot_profile', return_value=self.profile)
        patch.start()
        self.addCleanup(patch.stop)
        self.deleted, self.marked = [], []
        self.latest = self.vm
        def call(method, path, body=None, patch_type=None):
            if method == 'GET' and '/secrets/' in path:
                return 200, {}
            if method == 'GET' and '/virtualmachineinstances/' in path:
                return (200, self.instance) if self.instance else (404, {})
            if method == 'GET' and '/virtualmachines/' in path:
                return 200, self.latest
            if method == 'DELETE':
                self.deleted.append(body)
                return 200, {}
            if method == 'PATCH':
                self.marked.append(body)
                return 200, {}
            raise AssertionError((method, path))
        self.kube.call.side_effect = call

    def test_pending_home_cannot_start_and_ready_home_starts_with_fences(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Always'
        self.vm['spec']['runStrategy'] = 'Halted'
        self.instance = None
        self.manager.home_ready.return_value = False
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)
        self.manager.home_ready.return_value = True
        self.manager.reconcile(self.vm)
        self.assertEqual(self.marked[0][-1], {'op': 'add', 'path': '/spec/runStrategy', 'value': 'Always'})
        self.assertEqual(self.marked[0][1]['value'], '1')
        self.assertIn({'op': 'add', 'path': '/spec/template/spec/nodeSelector/kubernetes.io~1hostname', 'value': 'worker'}, self.marked[0])
        self.assertFalse(self.deleted)

    def test_changed_build_or_home_during_start_cannot_release_guest(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Always'
        self.vm['spec']['runStrategy'] = 'Halted'
        self.instance = None
        self.manager.build_intent = mock.Mock(side_effect=[self.intent, dict(self.intent, transition='stop')])
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)
        self.manager.build_intent = lambda wid, bid: self.intent
        self.manager.home_ready.side_effect = [True, False]
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)

    def test_desired_stop_halts_even_if_provider_left_actual_always(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Halted'
        self.intent['transition'] = 'stop'
        self.manager.home_ready.return_value = False
        self.manager.reconcile(self.vm)
        self.assertEqual(self.marked[0][-1]['value'], 'Halted')
        self.manager.home_ready.assert_not_called()
        self.assertFalse(self.deleted)

    def test_completed_start_does_not_resurrect_independent_halt(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Always'
        self.vm['spec']['runStrategy'] = 'Halted'
        self.instance = None
        self.intent['job_status'] = 'succeeded'
        self.vm['metadata']['annotations'][vmreconcile.MARKER] = 'starting:hash'
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked or self.deleted)

    def test_completed_current_build_may_initialize_once_but_never_undo_later_halt(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Always'
        self.vm['spec']['runStrategy'] = 'Halted'
        self.instance = None
        self.intent['job_status'] = 'succeeded'
        self.manager.reconcile(self.vm)
        self.assertEqual(self.marked[0][-1]['value'], 'Always')
        self.assertIn({'op': 'add', 'path': '/metadata/annotations/platform.coder~1applied-profile', 'value': 'starting:hash'}, self.marked[0])
        self.marked.clear()
        for marker in ('starting:hash', 'hash'):
            self.vm['metadata']['annotations'][vmreconcile.MARKER] = marker
            self.manager.reconcile(self.vm)
            self.assertFalse(self.marked)

    def test_concurrent_stop_cannot_be_overwritten_by_pending_start(self):
        self.vm['metadata']['annotations'][vmreconcile.DESIRED] = 'Always'
        self.vm['spec']['runStrategy'] = 'Halted'
        self.instance = None
        self.latest = copy.deepcopy(self.vm)
        self.latest['metadata']['resourceVersion'] = '2'
        self.latest['metadata']['annotations'][vmreconcile.DESIRED] = 'Halted'
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked or self.deleted)

    def test_failed_canceled_and_superseded_profiles_are_physically_revoked(self):
        for status in ('failed', 'canceled', 'canceling', 'superseded'):
            with self.subTest(status=status):
                current = dict(self.intent)
                if status == 'superseded':
                    current['build_id'] = 'new-build'
                else:
                    current['job_status'] = status
                self.manager.current_intent = lambda wid: current
                self.marked.clear()
                self.manager.reconcile(self.vm)
                self.assertEqual(self.marked[0][-1]['value'], 'Halted')
                self.assertEqual(self.marked[0][-2]['path'], '/metadata/annotations/platform.coder~1desired-run-strategy')
                self.assertEqual(self.marked[0][0]['value'], 'vm-uid')
                self.manager.home_ready.assert_not_called()

    def test_database_unavailable_or_missing_current_intent_does_not_halt(self):
        self.manager.current_intent = mock.Mock(side_effect=RuntimeError('database unavailable'))
        with self.assertRaises(RuntimeError):
            self.manager.reconcile(self.vm)
        self.assertFalse(self.marked or self.deleted)
        self.manager.current_intent = lambda wid: None
        self.manager.reconcile(self.vm)
        self.assertNotEqual(self.marked[0][-1]['value'], 'Halted')

    def test_foreign_current_identity_cannot_revoke_or_authorize_guest(self):
        self.manager.current_intent = lambda wid: dict(self.intent, owner_id='foreign', job_status='failed')
        self.manager.build_intent = lambda wid, bid: None
        with self.assertRaises(RuntimeError):
            self.manager.reconcile(self.vm)
        self.assertFalse(self.marked or self.deleted)

    def test_concurrent_new_profile_or_changed_database_prevents_stale_revocation(self):
        failed = dict(self.intent, job_status='failed')
        self.manager.current_intent = lambda wid: failed
        self.latest = copy.deepcopy(self.vm)
        self.latest['metadata']['resourceVersion'] = 'new'
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)
        self.latest = self.vm
        self.manager.current_intent = mock.Mock(side_effect=[failed, self.intent])
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)

    def test_current_ready_hardware_acknowledges_profile_with_uid_and_version_fences(self):
        self.manager.reconcile(self.vm)
        self.assertEqual(self.marked[0][-1]['value'], 'hash')
        self.assertEqual(self.marked[0][0]['value'], 'vm-uid')
        self.assertEqual(self.marked[0][1]['value'], '1')
        self.assertFalse(self.deleted)

    def test_changed_profile_restarts_only_owned_instance_with_uid_version_preconditions(self):
        self.instance['spec']['volumes'][0]['cloudInitNoCloud']['secretRef']['name'] = 'old-profile'
        self.manager.reconcile(self.vm)
        self.assertEqual(self.deleted[0]['preconditions'], {'uid': 'vmi-uid', 'resourceVersion': '2'})
        self.assertFalse(self.marked)

    def test_concurrent_stop_prevents_restart_and_never_restores_always(self):
        self.instance['spec']['volumes'][0]['cloudInitNoCloud']['secretRef']['name'] = 'old-profile'
        self.latest = copy.deepcopy(self.vm)
        self.latest['metadata']['resourceVersion'] = '3'
        self.latest['spec']['runStrategy'] = 'Halted'
        self.manager.reconcile(self.vm)
        self.assertFalse(self.deleted or self.marked)

    def test_stale_build_foreign_owner_and_hardware_cannot_acknowledge(self):
        original = copy.deepcopy(self.instance)
        for problem in ('build', 'owner', 'memory'):
            with self.subTest(problem=problem):
                instance = copy.deepcopy(original)
                if problem == 'build':
                    self.intent['build_id'] = 'stale'
                elif problem == 'owner':
                    instance['metadata']['ownerReferences'][0]['uid'] = 'foreign'
                else:
                    instance['spec']['domain']['memory']['guest'] = '1Gi'
                self.instance = instance
                with self.assertRaises(RuntimeError):
                    self.manager.reconcile(self.vm)
                self.assertFalse(self.deleted or self.marked)
                self.intent['build_id'] = 'build'

    def test_active_home_operation_blocks_private_configuration_and_profile_ack(self):
        self.manager.home_ready.return_value = False
        self.manager.configure = mock.Mock()
        self.manager.reconcile(self.vm)
        self.manager.configure.assert_not_called()
        self.assertFalse(self.marked or self.deleted)

    def test_halted_without_instance_acknowledges_even_when_home_needs_review(self):
        self.vm['spec']['runStrategy'] = 'Halted'
        self.intent['transition'] = 'stop'
        self.instance = None
        self.manager.home_ready.return_value = False
        self.manager.reconcile(self.vm)
        self.manager.home_ready.assert_not_called()
        self.assertEqual(self.marked[0][-1]['value'], 'halted:hash')

    def test_halted_profile_acknowledges_only_after_instance_disappears(self):
        self.vm['spec']['runStrategy'] = 'Halted'
        self.intent['transition'] = 'stop'
        self.manager.reconcile(self.vm)
        self.assertFalse(self.marked)
        self.instance = None
        self.manager.reconcile(self.vm)
        self.assertEqual(self.marked[0][-1]['value'], 'halted:hash')


class HomeNodeIdentityTest(unittest.TestCase):
    def test_original_node_is_required_for_ready_and_assigned_home(self):
        profile, secret, vm = fixture()
        manager = vmreconcile.Reconciler(mock.Mock(), mock.Mock(), 'https://coder.example', 'coder', mock.Mock())
        manager.fetch = mock.Mock(side_effect=lookup(secret))
        self.assertTrue(manager.home_ready(vm, profile, None))
        self.assertEqual(manager.assigned_node(profile), 'worker')
        for problem in ('missing', 'replacement'):
            with self.subTest(problem=problem):
                def fetch(path):
                    value = lookup(secret)(path)
                    if problem == 'missing' and '/configmaps/' in path:
                        records = json.loads(value['data']['homes.json'])
                        records[profile['workspace_id']].pop('node_uid')
                        value['data']['homes.json'] = json.dumps(records)
                    if problem == 'replacement' and '/nodes/' in path:
                        value['metadata']['uid'] = 'replacement-node'
                    return value
                manager.fetch.side_effect = fetch
                self.assertFalse(manager.home_ready(vm, profile, None))
                with self.assertRaises(RuntimeError):
                    manager.assigned_node(profile)


if __name__ == '__main__':
    unittest.main()
