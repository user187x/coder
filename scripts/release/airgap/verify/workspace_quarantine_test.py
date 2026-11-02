"""Quarantine lifecycle restrictions must not depend on guest cooperation."""
import copy
import datetime
import json
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import quarantine

WID = '11111111-1111-4111-8111-111111111111'
ORG = '22222222-2222-4222-8222-222222222222'
REV = '33333333-3333-4333-8333-333333333333'
UID = '44444444-4444-4444-8444-444444444444'
NODE = '55555555-5555-4555-8555-555555555555'


class QuarantineTest(unittest.TestCase):
    def setUp(self):
        self.current = dict(workspace_id=WID, organization_id=ORG, revision=REV, enabled=True, manual_start_required=True, release_prepared=False)
        self.vm = {'metadata': {'name': 'coder-vm-' + WID, 'uid': UID, 'resourceVersion': '10',
            'labels': {'com.coder.workspace.id': WID, 'com.coder.organization.id': ORG}, 'annotations': {}},
            'spec': {'runStrategy': 'Always'}}
        self.kube = mock.Mock()
        self.kube.call.side_effect = lambda method, *args: (200, copy.deepcopy(self.vm)) if method == 'GET' else (200, {})
        self.lookup = mock.Mock(side_effect=lambda wid: copy.deepcopy(self.current))
        self.withdraw = mock.Mock(return_value={name: quarantine.component('revoked', 'Withdrawn.') for name in ('tunnels', 'cloud_drive')})
        self.enforcer = quarantine.Enforcer(self.kube, 'coder', self.lookup, self.withdraw)

    def test_activation_fences_identity_and_halts_without_guest_execution(self):
        self.assertTrue(self.enforcer(self.vm))
        call = self.kube.call.call_args
        self.assertEqual(call.args[0], 'PATCH')
        patch = call.args[2]
        self.assertEqual(patch[:2], [{'op': 'test', 'path': '/metadata/uid', 'value': UID},
                                     {'op': 'test', 'path': '/metadata/resourceVersion', 'value': '10'}])
        self.assertIn({'op': 'add', 'path': '/spec/runStrategy', 'value': 'Halted'}, patch)

    def test_connection_failure_does_not_prevent_halt(self):
        self.withdraw.side_effect = RuntimeError('unavailable')
        self.assertTrue(self.enforcer(self.vm))
        self.assertEqual(self.kube.call.call_args.args[0], 'PATCH')
        self.withdraw.assert_not_called()
        self.vm['spec']['runStrategy'] = 'Halted'
        self.vm['metadata']['annotations'].update({quarantine.MARKER: REV, quarantine.DESIRED: 'Halted'})
        self.assertTrue(self.enforcer(self.vm))
        self.assertEqual(self.enforcer.status(WID, ORG)['components']['tunnels']['state'], 'unverified')

    def test_policy_failure_never_starts_or_clears_restriction(self):
        self.lookup.side_effect = RuntimeError('database unavailable')
        with self.assertRaises(RuntimeError):
            self.enforcer(self.vm)
        self.kube.call.assert_not_called()

    def test_concurrent_policy_change_prevents_projection(self):
        changed = dict(self.current, revision=UID)
        self.lookup.side_effect = [self.current, changed]
        self.assertTrue(self.enforcer(self.vm))
        self.assertFalse(any(c.args[0] == 'PATCH' for c in self.kube.call.call_args_list))

    def test_cross_organization_policy_is_rejected(self):
        self.current['organization_id'] = UID
        with self.assertRaises(RuntimeError):
            self.enforcer(self.vm)
        self.kube.call.assert_not_called()

    def test_release_latch_keeps_vm_halted(self):
        self.current['enabled'] = False
        self.assertTrue(self.enforcer(self.vm))
        self.assertEqual(self.kube.call.call_args.args[2][-1]['value'], 'Halted')
        self.withdraw.assert_not_called()

    def test_explicit_start_only_removes_projection_while_stopped(self):
        self.current.update(enabled=False, manual_start_required=False, release_prepared=True)
        self.vm['spec']['runStrategy'] = 'Halted'
        self.vm['metadata']['annotations'][quarantine.MARKER] = REV
        self.assertTrue(self.enforcer(self.vm))
        patch = self.kube.call.call_args.args[2]
        self.assertEqual(patch[-1]['op'], 'remove')
        self.assertFalse(any(p.get('value') == 'Always' for p in patch))

    def test_api_disappearance_does_not_claim_network_isolation(self):
        self.kube.call.return_value = (404, {})
        self.kube.call.side_effect = None
        result = self.enforcer.status(WID, ORG)
        self.assertNotEqual(result['state'], 'quarantined')
        self.assertEqual(result['components']['network']['state'], 'unverified')

    def test_previous_revision_never_supplies_current_proof(self):
        old = quarantine.report(dict(self.current, revision=UID))
        old['components']['tunnels'] = quarantine.component('revoked', 'Old proof.')
        self.enforcer.remember(old)
        self.assertEqual(self.enforcer.status(WID, ORG)['components']['tunnels']['state'], 'pending')

    def test_stale_runtime_proof_downgrades_cached_connection_confirmation(self):
        self.vm['spec']['runStrategy'] = 'Halted'
        self.vm['metadata']['annotations'].update({quarantine.MARKER: REV, quarantine.DESIRED: 'Halted'})
        self.enforcer.observe = mock.Mock(return_value={'verified': True})
        self.enforcer(self.vm)
        self.assertEqual(self.enforcer.status(WID, ORG)['state'], 'quarantined')
        self.enforcer.observe.return_value = {'verified': False}
        result = self.enforcer.status(WID, ORG)
        self.assertEqual(result['components']['cloud_drive']['state'], 'revoking')
        self.assertEqual(result['components']['tunnels']['state'], 'revoking')
        self.assertEqual(result['components']['network']['state'], 'unverified')

    def test_unprepared_release_cannot_remove_projection(self):
        self.current.update(enabled=False, manual_start_required=False)
        self.vm['spec']['runStrategy'] = 'Halted'
        self.vm['metadata']['annotations'][quarantine.MARKER] = REV
        self.assertTrue(self.enforcer(self.vm))
        self.kube.call.assert_not_called()
        self.withdraw.assert_not_called()


class HostProofTest(unittest.TestCase):
    def setUp(self):
        self.vm = {'metadata': {'name': 'coder-vm-' + WID, 'uid': UID,
            'annotations': {quarantine.MARKER: REV, quarantine.DESIRED: 'Halted'}}, 'spec': {'runStrategy': 'Halted'}}
        self.current = dict(workspace_id=WID, revision=REV)
        self.target = dict(revision=REV, vm_uid=UID, node_name='worker', node_uid=NODE, launcher_pod_uids=[])
        entry = {key: value for key, value in self.target.items() if key in ('revision', 'vm_uid', 'launcher_pod_uids')}
        entry.update(verified=True, qemu_absent=True, cgroups_absent=True)
        self.proof = dict(node_uid=NODE, boot_id=ORG, collected_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), targets={WID: entry})
        self.node = {'metadata': {'uid': NODE}, 'status': {'nodeInfo': {'bootID': ORG}, 'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        self.kube = mock.Mock()
        def call(method, path):
            if '/configmaps/' in path:
                return 200, {'data': {'targets.json': json.dumps({WID: self.target})}}
            if '/virtualmachineinstances/' in path:
                return 404, {}
            node = copy.deepcopy(self.node)
            node['metadata']['annotations'] = {quarantine.PROOF: json.dumps(self.proof)}
            return 200, node
        self.kube.call.side_effect = call
        self.reader = quarantine.HostObservation(self.kube, 'coder', 'runtime')

    def test_fresh_exact_host_proof_confirms_absence(self):
        self.assertTrue(self.reader(self.vm, self.current)['verified'])

    def test_stale_proof_is_unverified(self):
        self.proof['collected_at'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=11)).isoformat()
        self.assertFalse(self.reader(self.vm, self.current)['verified'])

    def test_node_replacement_is_not_old_worker_shutdown_proof(self):
        self.node['metadata']['uid'] = ORG
        self.assertFalse(self.reader(self.vm, self.current)['verified'])

    def test_running_process_is_not_isolated(self):
        self.proof['targets'][WID]['qemu_absent'] = False
        self.assertFalse(self.reader(self.vm, self.current)['verified'])

    def test_conflicting_desired_run_intent_is_not_confirmed(self):
        self.vm['metadata']['annotations'][quarantine.DESIRED] = 'Always'
        self.assertFalse(self.reader(self.vm, self.current)['verified'])

    def test_old_boot_or_revision_proof_is_rejected(self):
        self.proof['boot_id'] = WID
        self.assertFalse(self.reader(self.vm, self.current)['verified'])
        self.proof['boot_id'] = ORG
        self.proof['targets'][WID]['revision'] = UID
        self.assertFalse(self.reader(self.vm, self.current)['verified'])

    def test_missing_boot_or_invalid_timestamp_is_unverified(self):
        self.proof['boot_id'] = None
        self.node['status']['nodeInfo']['bootID'] = None
        self.assertFalse(self.reader(self.vm, self.current)['verified'])
        self.proof['boot_id'] = ORG
        self.proof['collected_at'] = 'not a timestamp'
        self.assertFalse(self.reader(self.vm, self.current)['verified'])


class HostTargetTest(unittest.TestCase):
    def setUp(self):
        self.vm = {'metadata': {'name': 'coder-vm-' + WID, 'uid': UID, 'labels': {
            'com.coder.workspace.id': WID, 'com.coder.organization.id': ORG,
            'com.coder.user.id': REV}}}
        self.current = dict(workspace_id=WID, revision=REV)
        self.record = dict(workspace_id=WID, organization_id=ORG, workspace_owner_id=REV,
                           node_name='worker', node_uid=NODE)
        self.targets = {}
        self.cm = {'metadata': {'uid': ORG, 'resourceVersion': '10'}}
        self.conflicts = 0
        self.kube = mock.Mock()
        self.kube.call.side_effect = self.call
        self.reader = quarantine.HostObservation(self.kube, 'coder', 'runtime')

    def call(self, method, path, *args):
        if method == 'GET':
            if '/virtualmachineinstances/' in path:
                return 404, {}
            if path.endswith('/coder-vm-home-provenance'):
                return 200, {'data': {'homes.json': json.dumps({WID: self.record})}}
            if path == '/api/v1/nodes/worker':
                return 200, {'metadata': {'uid': NODE}}
            if '/pods?' in path:
                return 200, {'items': []}
            if path == self.reader.path:
                if self.cm is None:
                    return 404, {}
                return 200, dict(self.cm, data={'targets.json': json.dumps(self.targets)})
        if method in ('PATCH', 'POST'):
            if self.conflicts:
                self.conflicts -= 1
                return 409, {}
            self.targets = json.loads(args[0]['data']['targets.json'])
            return 200, {}
        raise AssertionError((method, path))

    def mutations(self):
        return [call for call in self.kube.call.call_args_list if call.args[0] != 'GET']

    def test_first_capture_requires_original_home_node_uid(self):
        for node_uid in (None, ORG):
            with self.subTest(node_uid=node_uid):
                self.record['node_uid'] = node_uid
                self.kube.call.reset_mock()
                with self.assertRaises((ValueError, RuntimeError)):
                    self.reader.prepare(self.vm, self.current)
                self.assertEqual(self.mutations(), [])
                self.assertEqual(self.targets, {})

    def test_first_capture_persists_exact_original_worker_and_vm(self):
        self.cm = None
        target = self.reader.prepare(self.vm, self.current)
        self.assertEqual(target, dict(revision=REV, vm_uid=UID, node_name='worker',
                                      node_uid=NODE, launcher_pod_uids=[]))
        self.assertEqual(self.targets, {WID: target})
        self.assertEqual(self.mutations()[0].args[0], 'POST')

    def test_capture_cannot_replace_previous_worker_identity(self):
        self.targets[WID] = dict(node_uid=ORG)
        with self.assertRaises(RuntimeError):
            self.reader.prepare(self.vm, self.current)
        self.assertEqual(self.mutations(), [])

    def test_retirement_preserves_another_vm_target(self):
        self.targets[WID] = dict(vm_uid=ORG)
        self.reader.retire(self.vm, lambda: True)
        self.assertEqual(self.targets[WID]['vm_uid'], ORG)
        self.assertEqual(self.mutations(), [])

    def test_retirement_requires_fresh_released_policy(self):
        self.targets[WID] = dict(vm_uid=UID)
        self.reader.retire(self.vm, lambda: False)
        self.assertIn(WID, self.targets)
        self.assertEqual(self.mutations(), [])

    def test_retirement_rechecks_policy_after_compare_and_swap_conflict(self):
        self.targets[WID] = dict(vm_uid=UID)
        self.conflicts = 1
        released = mock.Mock(side_effect=[True, False])
        self.reader.retire(self.vm, released)
        self.assertIn(WID, self.targets)
        self.assertEqual(len(self.mutations()), 1)
        self.assertEqual(released.call_count, 2)

    def test_retirement_retries_fenced_write_and_preserves_other_targets(self):
        other = dict(vm_uid=REV)
        self.targets = {WID: dict(vm_uid=UID), ORG: other}
        self.conflicts = 1
        self.reader.retire(self.vm, lambda: True)
        self.assertEqual(self.targets, {ORG: other})
        self.assertEqual(len(self.mutations()), 2)
        for call in self.mutations():
            self.assertEqual(call.args[2]['metadata'], self.cm['metadata'])


class ReleaseTest(unittest.TestCase):
    def test_only_durably_withdrawn_current_release_is_acknowledged(self):
        current = dict(workspace_id=WID, organization_id=ORG, revision=REV, enabled=False,
                       manual_start_required=True, release_prepared=False)
        acknowledge = mock.Mock()
        withdrawn = {name: quarantine.component('revoked', 'Intent withdrawn.') for name in ('tunnels', 'cloud_drive')}
        worker = quarantine.ReleasePreparer(lambda: [current], lambda current: withdrawn, acknowledge, mock.Mock())
        worker.tick()
        acknowledge.assert_called_once_with(current)
        acknowledge.reset_mock()
        withdrawn['cloud_drive'] = quarantine.component('unverified', 'Persistence failed.')
        worker.tick()
        acknowledge.assert_not_called()

    def test_active_policy_never_receives_release_acknowledgement(self):
        current = dict(workspace_id=WID, organization_id=ORG, revision=REV, enabled=True,
                       manual_start_required=True, release_prepared=False)
        withdraw, acknowledge = mock.Mock(), mock.Mock()
        quarantine.ReleasePreparer(lambda: [current], withdraw, acknowledge, mock.Mock()).tick()
        withdraw.assert_not_called()
        acknowledge.assert_not_called()


if __name__ == '__main__':
    unittest.main()
