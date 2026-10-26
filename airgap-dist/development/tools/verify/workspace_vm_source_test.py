"""VM Cloud Drive sources never execute a server on a physical-node workspace pod."""
import os
import sys
import unittest
import uuid
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import safe


class SourceTest(unittest.TestCase):
    def setUp(self):
        self.wid, self.org, self.owner = [str(uuid.uuid4()) for _ in range(3)]
        self.labels = {'com.coder.workspace.id': self.wid, 'com.coder.organization.id': self.org, 'com.coder.user.id': self.owner}
        self.pod = {'metadata': {'labels': self.labels, 'ownerReferences': [{'kind': 'VirtualMachineInstance',
            'controller': True, 'name': 'coder-vm-' + self.wid, 'uid': 'instance'}]}}
        self.instance = {'metadata': {'uid': 'instance', 'ownerReferences': [
            {'kind': 'VirtualMachine', 'controller': True, 'uid': 'vm'}]}}
        self.vm = {'metadata': {'uid': 'vm', 'labels': self.labels}, 'spec': {'runStrategy': 'Always'}}
        self.kube = mock.Mock()
        self.kube.call.side_effect = lambda method, path: (200, self.instance if '/virtualmachineinstances/' in path else self.vm)
        patch = mock.patch.object(safe, 'KUBE', self.kube)
        patch.start()
        self.addCleanup(patch.stop)

    def test_launcher_requires_matching_vm_instance_controller_organization_and_account(self):
        self.assertTrue(safe._vm_source_pod(self.pod))
        self.vm['metadata']['uid'] = 'replacement'
        with self.assertRaises(RuntimeError):
            safe._vm_source_pod(self.pod)

    def test_source_reconcile_waits_for_private_guest_apply_without_legacy_exec(self):
        seen = {}
        with mock.patch.object(safe, 'sources', return_value={self.owner: {'workspace': self.wid}}), \
             mock.patch.object(safe, 'WORKSPACES', None), mock.patch.object(safe, '_sources_seen', seen), \
             mock.patch.object(safe, '_source_pod', return_value=('launcher', '10.0.0.1')), \
             mock.patch.object(safe, 'source_config', return_value={'id': 'config'}), \
             mock.patch.object(safe, '_health', return_value=None), \
             mock.patch.object(safe, '_source_is_vm', return_value=True), \
             mock.patch.object(safe, '_launch') as launch:
            safe.sources_once()
        launch.assert_not_called()
        self.assertFalse(seen[self.owner]['running'])
        self.assertIn('private source configuration', seen[self.owner]['error'])

    def test_removed_source_is_reconciled_in_guest_without_physical_node_exec(self):
        with mock.patch.object(safe, '_source_pod', return_value=('launcher', '10.0.0.1')), \
             mock.patch.object(safe, '_source_is_vm', return_value=True), \
             mock.patch.object(safe, '_launch') as launch:
            safe._stop_source_server(self.wid)
        launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
