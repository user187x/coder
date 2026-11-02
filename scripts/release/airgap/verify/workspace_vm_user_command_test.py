"""Only fixed, bounded user commands may cross the guest-root control boundary."""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest
import uuid
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files'
sys.path.insert(0, str(ROOT / 'ui-updates'))
sys.path.insert(0, str(ROOT / 'vmguest'))
spec = importlib.util.spec_from_file_location('workspace_guest_user_command', ROOT / 'vmguest/user_command.py')
command = importlib.util.module_from_spec(spec)
spec.loader.exec_module(command)


class UserCommandTest(unittest.TestCase):
    def setUp(self):
        self.identity = {key: str(uuid.uuid4()) for key in ('workspace_id', 'workspace_owner_id', 'organization_id', 'build_id')}
        self.request = {**self.identity, 'version': 1, 'request_id': str(uuid.uuid4()), 'action': 'plan',
                        'path': '/home/coder/project', 'mode': None, 'decisions': {}}

    def test_cli_runs_baked_script_only_as_unprivileged_container_user(self):
        request = command.validate(self.request, self.identity)
        args, data = command.command(request)
        self.assertEqual(args[:6], ['docker', 'exec', '--interactive', '--user', '1000:1000', '--env'])
        self.assertIn('/opt/coder-vm-support/clouddrive_cli.py', args)
        self.assertEqual(args[-3:], ['plan', '/home/coder/project', '--json'])
        self.assertEqual(data, b'')
        self.assertNotIn('sh', args)

    def test_foreign_build_scripts_shell_and_non_normalized_paths_are_rejected(self):
        for change in ({'build_id': str(uuid.uuid4())}, {'script': 'id'}, {'action': 'shell'},
                       {'path': '/home/coder/../private'}, {'mode': 'overwrite-all'}):
            with self.subTest(change=change):
                with self.assertRaises((ValueError, command.ProfileError)):
                    command.validate({**self.request, **change}, self.identity)

    def test_apply_decisions_are_data_stdin_and_not_code_or_command_arguments(self):
        request = {**self.request, 'action': 'apply', 'mode': 'ask', 'decisions': {'file.txt': 'keep'}}
        command.validate(request, self.identity)
        args, data = command.command(request)
        self.assertEqual(json.loads(data), {'file.txt': 'keep'})
        self.assertNotIn('file.txt', str(args))
        self.assertIn('--decisions=-:%d' % len(data), args)

    def test_result_is_bounded_before_returning_to_control_plane(self):
        with self.assertRaises(command.ProfileError):
            command.execute([sys.executable, '-c', "print('x' * 1048577)"], b'')

    def test_source_checker_cannot_create_a_folder_outside_retained_home(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, '-c', command.CHECK_SOURCE, directory + '/outside'],
                                    capture_output=True, check=True)
            self.assertEqual(json.loads(result.stdout), {'ok': False})
            self.assertFalse(os.path.exists(directory + '/outside'))

    def test_adapter_checks_actual_controls_and_never_reads_private_mount_credentials(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(command, 'CONFIG', pathlib.Path(directory)), \
             mock.patch.object(command.os, 'geteuid', return_value=0), \
             mock.patch.object(command.private_config, 'trusted_json', return_value=self.identity) as read, \
             mock.patch.object(command.private_config, 'trusted_staging_json', return_value=self.request) as staging, \
             mock.patch.object(command.private_config, 'verify_container') as verify, \
             mock.patch.object(command, 'execute', return_value=(0, {'files': []})), \
             mock.patch.object(command.private_config, 'atomic') as write:
            self.assertEqual(command.main(), 0)
            verify.assert_called_once_with(self.identity)
            self.assertEqual([call.args[0].name for call in read.call_args_list], ['runtime.json'])
            staging.assert_called_once_with(pathlib.Path(directory) / 'user-command.next')
            result = json.loads(write.call_args.args[1])
            self.assertEqual(result['request_id'], self.request['request_id'])
            self.assertEqual(result['result'], {'files': []})


if __name__ == '__main__':
    unittest.main()
