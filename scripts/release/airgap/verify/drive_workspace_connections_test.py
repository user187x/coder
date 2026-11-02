"""Workspace connection intent must never implicitly grant access to drive content."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates/drivepeers.py'

class WorkspaceConnectionsTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('workspace_connections_peers', MODULE)
        self.p = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.p)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p.PEERS_FILE = str(Path(self.tmp.name) / 'peers.json')
        self.admin = {'id': '11111111-1111-4111-8111-111111111111', 'username': 'admin', 'admin': True}
        self.member = {'id': '22222222-2222-4222-8222-222222222222', 'username': 'member'}
        self.ws = {'id': '33333333-3333-4333-8333-333333333333', 'name': 'workspace', 'owner_id': self.member['id'], 'owner_name': 'member', 'organization_id': 'org'}
        users = {u['id']: u for u in [self.admin, self.member]}
        self.p.setup(lambda **kwargs: None, lambda u: u.get('admin', False), users.get, None, lambda: None,
                     item=lambda uid, path: 'file' if path == 'selected.txt' else None,
                     workspace_info=lambda token, wid: self.ws if token == 'authorized' and wid == self.ws['id'] else None)
        self.p.save_settings(self.admin, {'enabled': True})

    def connect(self):
        self.p.connect_workspace(self.admin, self.ws, True)

    def share(self, **overrides):
        return self.p.share(self.admin, {'to': self.member['id'], 'path': 'selected.txt', 'workspaceId': self.ws['id'], **overrides}, 'authorized')['share']

    def test_connection_has_no_content_permission(self):
        self.connect()
        self.assertEqual(len(self.p.workspace_connections(self.admin)), 1)
        self.assertEqual(self.p.workspace_connections(self.member), [])
        self.assertEqual(self.p.active(), {})
        self.assertIsNone(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'))
        self.assertEqual(self.p.view(self.member)['asked'], [])

    def test_member_cannot_connect(self):
        with self.assertRaises(PermissionError):
            self.p.connect_workspace(self.member, self.ws, True)

    def test_sharing_requires_connection(self):
        with self.assertRaises(PermissionError):
            self.share()

    def test_selected_file_defaults_read_only(self):
        self.connect()
        grant = self.share()
        self.assertEqual(grant['state'], 'active')
        self.assertEqual(grant['access'], 'read')
        self.assertEqual(grant['workspaceId'], self.ws['id'])
        self.assertEqual(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'), 'read')
        self.assertIsNone(self.p.access_at(self.member['id'], self.admin['id'], 'private.txt'))
        self.assertEqual(self.p.active()[self.member['id']][0]['workspaceId'], self.ws['id'])

    def test_connection_cannot_share_entire_drive(self):
        self.connect()
        with self.assertRaises(PermissionError):
            self.share(path='')

    def test_disconnect_revokes_and_reconnect_does_not_restore_grants(self):
        self.connect()
        grant = self.share()
        self.p.connect_workspace(self.admin, self.ws, False)
        self.assertIsNone(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'))
        with self.assertRaises(PermissionError):
            self.p.connection(self.admin, grant['id'], {'connected': True})
        self.connect()
        self.assertIsNone(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'))

    def test_revoke_removes_access_and_future_mounts_but_keeps_connection(self):
        self.connect()
        grant = self.share()
        self.p.end(self.admin, grant['id'])
        self.assertIsNone(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'))
        self.assertEqual(self.p.active(), {})
        self.assertEqual(len(self.p.workspace_connections(self.admin)), 1)

    def test_unrelated_user_cannot_revoke(self):
        self.connect()
        grant = self.share()
        with self.assertRaises(PermissionError):
            self.p.end({'id': 'outsider', 'username': 'outsider'}, grant['id'])
        self.assertEqual(self.p.access_at(self.member['id'], self.admin['id'], 'selected.txt'), 'read')

    def test_changed_workspace_owner_rejected(self):
        self.connect()
        self.ws = {**self.ws, 'owner_id': self.admin['id']}
        with self.assertRaises(PermissionError):
            self.share()

if __name__ == '__main__':
    unittest.main()
