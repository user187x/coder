"""VM HOME growth cannot fall through to directory-copy or target a live guest."""
import copy
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmgrow


class GrowTest(unittest.TestCase):
    def setUp(self):
        self.wid = '11111111-1111-4111-8111-111111111111'
        self.ws = {'id': self.wid, 'organization_id': 'org', 'owner_id': 'owner', 'latest_build': {'status': 'stopped'}}
        labels = {'com.coder.workspace.id': self.wid, 'com.coder.organization.id': 'org', 'com.coder.user.id': 'owner'}
        self.vm = {'metadata': {'labels': labels}, 'spec': {'runStrategy': 'Halted', 'template': {'spec': {'volumes': [
            {'name': 'home', 'persistentVolumeClaim': {'claimName': 'block-home'}}]}}}}
        self.pvc = {'metadata': {'name': 'block-home', 'uid': 'claim-uid', 'labels': labels, 'annotations': {
            'platform.coder/retained-vm-home': 'true', 'platform.coder/home-disk-bytes': '1000000000'}},
            'spec': {'volumeMode': 'Block', 'volumeName': 'pv-home'}}
        self.record = {'workspace_id': self.wid, 'organization_id': 'org', 'workspace_owner_id': 'owner',
            'claim_name': 'block-home', 'claim_uid': 'claim-uid', 'pv_name': 'pv-home', 'pv_uid': 'pv-uid',
            'home_bytes': 1000000000, 'node_name': 'vm-worker', 'status': 'ready'}
        self.kube = mock.Mock(side_effect=self.call)
        self.jobs = []
        patch = mock.patch.object(vmgrow, 'IMAGE', 'registry/helper@sha256:' + 'a' * 64)
        patch.start()
        self.addCleanup(patch.stop)

    def call(self, method, path, body=None):
        if '/virtualmachines/' in path:
            return 200, self.vm
        if '/persistentvolumeclaims/' in path:
            return 200, self.pvc
        if '/virtualmachineinstances/' in path:
            return 404, {}
        if '/configmaps/' in path:
            import json
            return 200, {'metadata': {'resourceVersion': '7'}, 'data': {'homes.json': json.dumps({self.wid: self.record})}}
        if method == 'POST' and path.endswith('/jobs'):
            self.jobs.append(body)
            return 201, {'metadata': {'uid': 'job-uid'}}
        if method == 'GET' and '/jobs/' in path:
            self.record['home_bytes'] = 2000000000
            self.record['claim_uid'] = 'new-claim-uid'
            self.pvc['metadata']['uid'] = 'new-claim-uid'
            self.pvc['metadata']['annotations']['platform.coder/home-disk-bytes'] = '2000000000'
            return 200, {'metadata': {'uid': 'job-uid'}, 'status': {'succeeded': 1}}
        raise AssertionError((method, path))

    def test_offline_growth_uses_fixed_job_image_command_and_only_managed_host_paths(self):
        prepared = vmgrow.prepare(self.kube, self.ws, 2)
        vmgrow.run(self.kube, prepared)
        self.assertEqual(prepared['request']['record_resource_version'], '7')
        self.assertEqual(prepared['request']['new_bytes'], 2000000000)
        spec = self.jobs[0]['spec']['template']['spec']
        self.assertTrue(spec['hostPID'])
        self.assertEqual(spec['serviceAccountName'], 'coder-vm-home-manager')
        self.assertEqual(spec['nodeSelector'], {'kubernetes.io/hostname': 'vm-worker'})
        self.assertEqual(spec['containers'][0]['command'][:4], ['python3', '/app/vmhome.py', 'grow', '--request-base64'])
        self.assertEqual({v['hostPath']['path'] for v in spec['volumes']}, {'/var/lib/coder-vm-homes', '/dev', '/sys', '/etc/udev/rules.d/10-coder-vm-home.rules', '/usr/lib/udev/rules.d/60-persistent-storage.rules'})
        self.assertTrue(next(v for v in spec['containers'][0]['volumeMounts'] if v['name'] == 'sys')['readOnly'])
        for name in ('udev-rule', 'udev-stock'):
            self.assertTrue(next(v for v in spec['containers'][0]['volumeMounts'] if v['name'] == name)['readOnly'])
            self.assertEqual(next(v for v in spec['volumes'] if v['name'] == name)['hostPath']['type'], 'File')

    def test_running_workspace_wrong_provenance_and_shrink_create_no_job(self):
        original = copy.deepcopy(self.ws)
        self.ws['latest_build']['status'] = 'running'
        with self.assertRaises(ValueError):
            vmgrow.prepare(self.kube, self.ws, 2)
        self.ws = original
        self.record['claim_uid'] = 'replaced'
        with self.assertRaises(RuntimeError):
            vmgrow.prepare(self.kube, self.ws, 2)
        self.record['claim_uid'] = 'claim-uid'
        for size in (0, 1, True, 1.5):
            with self.assertRaises(ValueError):
                vmgrow.prepare(self.kube, self.ws, size)
        self.assertFalse(self.jobs)

    def test_filesystem_or_foreign_home_is_rejected_without_legacy_fallback(self):
        self.pvc['spec']['volumeMode'] = 'Filesystem'
        with self.assertRaises(RuntimeError):
            vmgrow.info(self.kube, self.wid)
        self.assertFalse(self.jobs)

    def test_missing_vm_and_claim_with_retained_ledger_never_falls_back_even_when_controller_off(self):
        def call(method, path, body=None):
            if '/virtualmachines/' in path or '/persistentvolumeclaims/' in path:
                return 404, {}
            return self.call(method, path, body)
        self.kube.side_effect = call
        with mock.patch.dict(os.environ, {'WORKSPACE_VM_ENABLED': 'false'}):
            with self.assertRaises(RuntimeError):
                vmgrow.runtime(self.kube, self.wid)

    def test_unconfigured_unpinned_helper_cannot_mutate_disk(self):
        with mock.patch.object(vmgrow, 'IMAGE', 'registry/helper:latest'):
            with self.assertRaises(RuntimeError):
                vmgrow.prepare(self.kube, self.ws, 2)
        self.assertFalse(self.jobs)


if __name__ == '__main__':
    unittest.main()
