"""VM user commands retain owner/build fences and relative-folder behavior."""
import fcntl
import json
import os
import sys
import tempfile
import unittest
import uuid
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmusercommand


class UserGatewayTest(unittest.TestCase):
    def setUp(self):
        self.wid, self.org, self.owner, self.build = [str(uuid.uuid4()) for _ in range(4)]
        self.profile = {'version': 1, 'workspace_id': self.wid, 'organization_id': self.org,
                        'workspace_owner_id': self.owner, 'build_id': self.build}
        self.intent = {'workspace_id': self.wid, 'organization_id': self.org, 'owner_id': self.owner,
                       'build_id': self.build, 'job_status': 'succeeded'}
        self.pod = {'metadata': {'labels': {'com.coder.workspace.id': self.wid}}}
        self.instance = {'spec': {'volumes': [{'name': 'cloudinit', 'cloudInitNoCloud': {'secretRef': {'name': 'sealed'}}}]}}
        def call(method, path):
            if '/pods/' in path:
                return 200, self.pod
            if '/virtualmachineinstances/' in path:
                return 200, self.instance
            return 200, {}
        self.kube = mock.Mock()
        self.kube.call.side_effect = call
        for patch in (mock.patch.object(vmusercommand, 'boot_profile', return_value=self.profile),
                      mock.patch.object(vmusercommand, 'BUILD_INTENT', side_effect=lambda *args: self.intent)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_relative_and_home_paths_are_normalized_without_executing_shell(self):
        for path in ('data', '~/data', '/home/coder/a/../data'):
            with mock.patch.object(vmusercommand, 'Guest') as guest:
                vmusercommand._run(self.kube, 'coder', 'launcher', ['plan', path])
                request = guest.return_value.user_command.call_args.args[0]
                self.assertEqual(request['path'], '/home/coder/data')
                self.assertEqual(request['build_id'], self.build)

    def test_foreign_owner_or_unfinished_build_gets_no_guest_command(self):
        for change in ({'owner_id': str(uuid.uuid4())}, {'job_status': 'running'}):
            self.intent.update(change)
            with mock.patch.object(vmusercommand, 'Guest') as guest:
                with self.assertRaises(RuntimeError):
                    vmusercommand._run(self.kube, 'coder', 'launcher', ['list'])
                guest.assert_not_called()
            self.intent.update(owner_id=self.owner, job_status='succeeded')

    def test_concurrent_request_is_refused_before_fixed_files_can_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'VM_USER_COMMAND_LOCK_DIR': directory}):
            fd = os.open(os.path.join(directory, self.wid + '.lock'), os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with mock.patch.object(vmusercommand, '_run') as run:
                    with self.assertRaises(ValueError):
                        vmusercommand.run(self.kube, 'coder', 'launcher', ['list'])
                    run.assert_not_called()
            finally:
                os.close(fd)


if __name__ == '__main__':
    unittest.main()
