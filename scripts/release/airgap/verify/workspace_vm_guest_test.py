"""Private VM configuration never enters Kubernetes exec command arguments."""
import copy
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmguest


class GuestTest(unittest.TestCase):
    def setUp(self):
        self.kube = mock.Mock()
        volumes = [{'name': 'cloudinit', 'cloudInitNoCloud': {'secretRef': {'name': 'sealed-profile'}}}]
        self.vm = {'metadata': {'name': 'vm', 'uid': 'vm-uid', 'resourceVersion': '1'},
                   'spec': {'runStrategy': 'Always', 'template': {'spec': {'volumes': volumes}}}}
        self.instance = {'metadata': {'name': 'vm', 'uid': 'vmi-uid', 'resourceVersion': '2', 'ownerReferences': [
            {'kind': 'VirtualMachine', 'controller': True, 'uid': 'vm-uid'}]}, 'spec': {'volumes': volumes}}
        self.pod = {'metadata': {'name': 'launcher', 'uid': 'pod-uid', 'ownerReferences': [
            {'kind': 'VirtualMachineInstance', 'controller': True, 'uid': 'vmi-uid'}]}}
        def call(method, path):
            if '/virtualmachines/' in path:
                return 200, self.vm
            if '/virtualmachineinstances/' in path:
                return 200, self.instance
            return 200, self.pod
        self.kube.call.side_effect = call
        self.guest = vmguest.Guest(self.kube, 'coder', copy.deepcopy(self.vm), copy.deepcopy(self.instance), copy.deepcopy(self.pod))

    def test_private_secret_uses_stdin_and_only_fixed_apply_command(self):
        config = {'version': 1, 'credential': 'private-example-secret'}
        size = len(json.dumps(config, separators=(',', ':')).encode())
        with mock.patch.object(vmguest.kexec, 'exec_in', side_effect=[
                (0, b'{"return":9}', b''), (0, json.dumps({'return': {'count': size}}).encode(), b''),
                (0, b'{"return":{}}', b''), (0, b'{"return":{"pid":10}}', b'')]) as execute:
            self.assertEqual(self.guest.deliver(config), 10)
        for call in execute.call_args_list:
            self.assertNotIn('private-example-secret', str(call.args))
            self.assertEqual(call.args[3], 'compute')
        self.assertIn(b'guest-file-write', execute.call_args_list[1].kwargs['stdin'])
        self.assertNotIn(b'private-example-secret', execute.call_args_list[1].kwargs['stdin'])
        self.assertIn(b'/usr/local/sbin/coder-vm-config-apply', execute.call_args_list[-1].kwargs['stdin'])

    def test_replaced_vm_pod_or_profile_blocks_private_delivery(self):
        for target in ('vm', 'pod', 'profile'):
            with self.subTest(target=target):
                vm, pod, instance = copy.deepcopy(self.vm), copy.deepcopy(self.pod), copy.deepcopy(self.instance)
                if target == 'vm':
                    self.vm['metadata']['resourceVersion'] = 'replacement'
                elif target == 'pod':
                    self.pod['metadata']['uid'] = 'replacement'
                else:
                    self.guest.instance['spec']['volumes'] = []
                with mock.patch.object(vmguest.kexec, 'exec_in') as execute:
                    with self.assertRaises(RuntimeError):
                        self.guest.deliver({'version': 1})
                    execute.assert_not_called()
                self.vm, self.pod, self.instance = vm, pod, instance

    def test_incomplete_write_does_not_execute_apply(self):
        with mock.patch.object(vmguest.kexec, 'exec_in', side_effect=[
                (0, b'{"return":9}', b''), (0, b'{"return":{"count":0}}', b''), (0, b'{"return":{}}', b'')]) as execute:
            with self.assertRaises(RuntimeError):
                self.guest.deliver({'version': 1})
            self.assertEqual(execute.call_count, 3)
            self.assertNotIn('guest-exec', str(execute.call_args_list[-1].kwargs['stdin']))


if __name__ == '__main__':
    unittest.main()
