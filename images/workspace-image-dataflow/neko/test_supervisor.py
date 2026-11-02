"""Offline checks for the Root-controlled browser launch gate."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('neko_supervisor', pathlib.Path(__file__).with_name('supervisor.py'))
neko = importlib.util.module_from_spec(spec)
spec.loader.exec_module(neko)


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = pathlib.Path(self.directory.name) / 'config.json'
        self.good = {'enabled': True, 'http_port': 9080, 'udp_port': 59000, 'advertised_ip': '10.253.0.8'}

    def read(self, value):
        self.path.write_text(json.dumps(value))
        return neko.read_config(self.path)

    def test_root_public_schema_and_atomic_disable(self):
        self.assertEqual(self.read(self.good), {'enabled': True, 'advertised_ip': '10.253.0.8'})
        replacement = self.path.with_suffix('.new')
        replacement.write_text(json.dumps({'enabled': False, 'http_port': 9080, 'udp_port': 59000}))
        replacement.replace(self.path)
        self.assertIsNone(neko.read_config(self.path))

    def test_untrusted_fields_and_invalid_types_fail_closed(self):
        for key, value in [('enabled', 'true'), ('http_port', True), ('http_port', 8080), ('udp_port', 59001), ('relay_sources', ['0.0.0.0/0'])]:
            with self.subTest(key=key, value=value):
                self.assertIsNone(self.read(dict(self.good, **{key: value})))
        for key in self.good:
            value = dict(self.good)
            del value[key]
            self.assertIsNone(self.read(value))

    def test_invalid_addresses_fail_closed(self):
        for address in ['0.0.0.0', '224.0.0.1', '169.254.1.2', '255.255.255.255', '::1', '010.2.3.4', 123]:
            with self.subTest(address=address):
                self.assertIsNone(self.read(dict(self.good, advertised_ip=address)))

    def test_symlink_and_oversize_fail_closed(self):
        target = self.path.with_suffix('.target')
        target.write_text(json.dumps(self.good))
        self.path.symlink_to(target)
        self.assertIsNone(neko.read_config(self.path))
        self.path.unlink()
        self.path.write_text(' ' * 4097)
        self.assertIsNone(neko.read_config(self.path))

    def test_private_state_rejects_shared_directory_and_symlink(self):
        shared = pathlib.Path(self.directory.name) / 'shared'
        shared.mkdir(mode=0o755)
        with self.assertRaises(RuntimeError):
            neko.private_directory(shared)
        link = shared.with_name('link')
        link.symlink_to(shared)
        with self.assertRaises(RuntimeError):
            neko.private_directory(link)


class StackTests(unittest.TestCase):
    def test_stop_reaps_only_owned_processes_and_preserves_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            profile = root / 'profile'
            profile.write_text('persistent browser data')
            unrelated = subprocess.Popen(['sleep', '60'], start_new_session=True)
            self.addCleanup(unrelated.wait)
            self.addCleanup(unrelated.kill)
            with mock.patch.object(neko, 'STATE', root):
                stack = neko.Stack()
                self.addCleanup(stack.stop)
                stack.spawn('owned', ['sleep', '60'], os.environ.copy())
                child = stack.children[0]
                stack.stop()
                self.assertIsNotNone(child.returncode)
                self.assertIsNone(unrelated.poll())
                self.assertEqual(profile.read_text(), 'persistent browser data')
                self.assertEqual(stack.children, [])
                self.assertEqual(stack.logs, [])

    def test_launch_uses_trusted_nat_fixed_ports_and_no_public_stun(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            commands = {}
            with mock.patch.object(neko, 'STATE', root), mock.patch.object(neko, 'SHARE', pathlib.Path(__file__).parent), mock.patch.object(neko.subprocess, 'check_output', return_value='cookie'), mock.patch.object(neko.subprocess, 'run'):
                stack = neko.Stack()
                with mock.patch.object(stack, 'ready'), mock.patch.object(stack, 'spawn', side_effect=lambda name, command, env: commands.update({name: command})):
                    stack.start({'enabled': True, 'advertised_ip': '10.253.0.8'})
            server = commands['server']
            for flag, value in [('--server.bind', '127.0.0.1:9080'), ('--iceservers', '[]'), ('--webrtc.udpmux', '59000'), ('--webrtc.nat1to1', '10.253.0.8'), ('--webrtc.ip_retrieval_url', '')]:
                self.assertEqual(server[server.index(flag) + 1], value)
            self.assertIn('--webrtc.icelite', server)
            self.assertIn('--user-data-dir=' + str(pathlib.Path.home() / '.config/chromium-panel'), commands['browser'])

    def test_disabled_during_startup_cancels_before_readiness_command(self):
        with mock.patch.object(neko, 'read_config', return_value=None), mock.patch.object(neko.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'canceled'):
                neko.Stack().ready(['true'], {}, {'enabled': True, 'advertised_ip': '10.253.0.8'})
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
