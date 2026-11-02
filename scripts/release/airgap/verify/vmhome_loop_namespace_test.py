"""Privileged loop control uses the node root and verifies backing identity."""
import json
import os
import pathlib
import stat
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import vmhome

WID = '00000000-0000-4000-8000-000000000001'


class LoopNamespaceTest(unittest.TestCase):
    def args(self, same_namespace=False, mismatch=False):
        parent = types.SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o700, st_dev=1, st_ino=2)
        raw = types.SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o600, st_dev=1, st_ino=3)
        other = types.SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o600, st_dev=1, st_ino=4)
        binary = types.SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o755)
        def lstat(path):
            if str(path).endswith('/usr/sbin/losetup'):
                return binary
            return other if mismatch and str(path).startswith('/proc/1/root') else raw
        with mock.patch.object(pathlib.Path, 'read_text', return_value='systemd\n'), mock.patch.object(pathlib.Path, 'stat', return_value=parent), mock.patch.object(pathlib.Path, 'lstat', lstat), mock.patch.object(vmhome.os, 'stat', side_effect=lambda path: types.SimpleNamespace(st_ino=10 if same_namespace or path == '/proc/self/ns/mnt' else 20)):
            return vmhome.host_loop_args('--find', '--show', str(vmhome.PARENT / WID / 'home.raw'))

    def test_helper_enters_exact_host_mount_namespace_and_root(self):
        args = self.args()
        self.assertEqual(args[:9], ['/usr/bin/nsenter', '--target', '1', '--mount', '--root=/proc/1/root', '--wdns=/', '--', '/usr/sbin/losetup', '--find'])
        self.assertEqual(args[-1], str(vmhome.PARENT / WID / 'home.raw'))
        self.assertNotIn('--env', args)

    def test_loop_command_clears_inherited_environment(self):
        with mock.patch.object(vmhome, 'host_loop_args', return_value=['/usr/sbin/losetup', '--version']), mock.patch.object(vmhome, 'run') as run:
            vmhome.loop_command('--version')
        self.assertEqual(run.call_args.kwargs['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})

    def test_host_binder_runs_fixed_binary_directly(self):
        self.assertEqual(self.args(same_namespace=True)[0], '/usr/sbin/losetup')

    def test_different_host_inode_never_attaches(self):
        with self.assertRaisesRegex(vmhome.HomeError, 'backing file differs'):
            self.args(mismatch=True)

    def test_post_attach_identity_checks_path_inode_device_and_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = pathlib.Path(directory) / 'home.raw'
            raw.write_bytes(bytes(512))
            info = raw.stat()
            valid = {'name': '/dev/loop9', 'back-file': str(raw), 'back-ino': info.st_ino,
                     'back-maj:min': '%s:%s' % (os.major(info.st_dev), os.minor(info.st_dev)), 'sizelimit': 512}
            with mock.patch.object(vmhome, 'loop_command', return_value=json.dumps({'loopdevices': [valid]})):
                vmhome.verify_loop_identity('/dev/loop9', raw, 512)
            for key, value in [('back-file', '/' + WID + '/home.raw'), ('back-ino', info.st_ino + 1), ('back-maj:min', '0:0'), ('sizelimit', 0)]:
                with self.subTest(field=key), mock.patch.object(vmhome, 'loop_command', return_value=json.dumps({'loopdevices': [dict(valid, **{key: value})]})), self.assertRaises(vmhome.HomeError):
                    vmhome.verify_loop_identity('/dev/loop9', raw, 512)


if __name__ == '__main__':
    unittest.main()
