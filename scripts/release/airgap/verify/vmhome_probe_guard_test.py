"""Loop attachment requires the worker's exact audited probe opt-out."""
import pathlib
import sys
import unittest
import types
import stat
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import vmhome


class ProbeGuardTest(unittest.TestCase):
    def test_rule_matches_packaged_hash_and_stock_opt_out(self):
        rule = pathlib.Path(__file__).resolve().parents[1] / 'runtime/10-coder-vm-home.rules'
        self.assertEqual(vmhome.hashlib.sha256(rule.read_bytes()).hexdigest(), vmhome.UDEV_RULE_SHA256)
        self.assertIn('ATTR{loop/backing_file}=="/var/lib/coder-vm-homes/*"', rule.read_text())
        self.assertNotIn('DM_UDEV', rule.read_text())

    def test_missing_guard_refuses_before_loop_command(self):
        with mock.patch.object(vmhome.UDEV_RULE.__class__, 'lstat', side_effect=FileNotFoundError), mock.patch.object(vmhome, 'run') as command:
            with self.assertRaisesRegex(vmhome.HomeError, 'probe suppression'):
                vmhome.device_for(pathlib.Path('/unopened'), 1024)
            command.assert_not_called()

    def test_valid_rule_and_stock_contract_allow_publication(self):
        rule = pathlib.Path(__file__).resolve().parents[1] / 'runtime/10-coder-vm-home.rules'
        data = rule.read_bytes()
        safe = types.SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0)
        with mock.patch.object(pathlib.Path, 'lstat', return_value=safe), mock.patch.object(pathlib.Path, 'read_bytes', return_value=data), mock.patch.object(pathlib.Path, 'read_text', return_value='ENV{UDEV_DISABLE_PERSISTENT_STORAGE_RULES_FLAG}=="1", GOTO="persistent_storage_end"'):
            vmhome.require_probe_guard()
        with mock.patch.object(pathlib.Path, 'lstat', return_value=safe), mock.patch.object(pathlib.Path, 'read_bytes', return_value=b'changed'), mock.patch.object(pathlib.Path, 'read_text', return_value=''):
            with self.assertRaises(vmhome.HomeError):
                vmhome.require_probe_guard()

    def test_binding_bundle_has_no_guestfs_import_dependency(self):
        installer = pathlib.Path(__file__).resolve().parents[1] / 'runtime/install-home-devices.sh'
        source = installer.read_text()
        self.assertIn('"$bundle/vmfs.py"', source)
        self.assertIn('vmprofile.py vmgpu.py workspace_runtime.py', source)
        self.assertIn('"$bundle/vmgpu.py"', source)

    def test_reboot_binding_waits_for_network_before_required_kubelet(self):
        installer = pathlib.Path(__file__).resolve().parents[1] / 'runtime/install-home-devices.sh'
        source = installer.read_text()
        self.assertIn('Wants=network-online.target', source)
        self.assertIn('After=local-fs.target network-online.target', source)
        self.assertIn('Before=kubelet.service', source)
        self.assertIn('Requires=coder-vm-home-devices.service', source)
        self.assertIn('TimeoutStartSec=300', source)


if __name__ == '__main__':
    unittest.main()
