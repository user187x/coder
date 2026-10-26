"""Managed connection withdrawal for native and VM-independent workspace restrictions."""
import contextlib
import importlib.util
import os
import tempfile
import pathlib
import sys
import types
import unittest
from unittest import mock

SRC = pathlib.Path(os.environ.get('CODER_UI_SOURCE_DIR') or pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates')
sys.path.insert(0, str(SRC))
from workspaceconnections import Restrictions

WID = '11111111-2222-4333-8444-555555555555'
OTHER = '22222222-2222-4333-8444-555555555555'
ORG = '33333333-2222-4333-8444-555555555555'
OWNER = '44444444-2222-4333-8444-555555555555'
CURRENT = dict(workspace_id=WID, organization_id=ORG, owner_id=OWNER, enabled=True,
               revision=ORG, manual_start_required=True)


class ConnectionRestrictionsTest(unittest.TestCase):
    def setUp(self):
        self.pool = mock.Mock()
        self.rows = [[WID, ORG, OWNER, 't', ORG, 't']]
        self.pool.query.side_effect = lambda query, *args: [[True]] if 'to_regclass' in query else self.rows
        self.links = {}
        self.sources = {}
        self.data = {'tunnels': {
            'incident': dict(source_workspace_id=WID, target_workspace_id=OTHER, revision=1),
            'unrelated': dict(source_workspace_id=OTHER, target_workspace_id=ORG, revision=1)}}
        self.safe = types.SimpleNamespace(
            local_lock=lambda path: contextlib.nullcontext(), LINKS_FILE='links', SOURCES_FILE='sources',
            disconnected=lambda: self.links, sources=lambda: self.sources, _write_json=mock.Mock(),
            source_endpoint_snapshot=mock.Mock(return_value=['old-endpoint']),
            source_generation=lambda src: 'new-generation', delete_source_endpoints=mock.Mock(), _wake=mock.Mock())
        self.tunnels = types.SimpleNamespace(state=lambda: contextlib.nullcontext(self.data), changed=mock.Mock(return_value=2))
        self.locks = mock.Mock(return_value={})
        self.restrictions = Restrictions(lambda: self.pool, self.locks, self.safe, self.tunnels, mock.Mock())

    def test_native_policy_is_not_dependent_on_a_virtual_machine(self):
        self.assertTrue(self.restrictions.restricted(WID))
        self.assertTrue(self.restrictions.policies()[0]['enabled'])
        self.assertNotIn('kubevirt', self.pool.query.call_args.args[0])

    def test_full_lockdown_is_selected_but_partial_policy_is_not(self):
        self.locks.return_value = {WID: {'modes': ['network', 'sudo']}, OTHER: {'modes': ['sudo']}}
        self.restrictions.policies()
        self.assertEqual(self.pool.query.call_args.args[1][1], '{' + WID + '}')

    def test_withdraws_only_incident_connections_and_does_not_restore_on_release(self):
        self.restrictions.withdraw(CURRENT)
        self.assertEqual(self.links[WID]['owner'], OWNER)
        self.assertTrue(self.data['tunnels']['incident']['deleted'])
        self.assertNotIn('deleted', self.data['tunnels']['unrelated'])
        self.restrictions.withdraw(CURRENT)
        self.tunnels.changed.assert_called_once()
        self.rows = []
        self.restrictions.once()
        self.assertIn(WID, self.links)

    def test_source_is_suspended_and_only_captured_endpoints_are_removed(self):
        self.sources[OWNER] = {'workspace': WID, 'path': '/home/coder/files', 'secretKey': 'test-only'}
        self.restrictions.withdraw(CURRENT)
        self.assertTrue(self.sources[OWNER]['suspended'])
        self.assertNotEqual(self.sources[OWNER]['secretKey'], 'test-only')
        self.safe.delete_source_endpoints.assert_called_with(['old-endpoint'])

    def test_tunnels_are_withdrawn_even_if_a_source_endpoint_is_unavailable(self):
        self.safe.delete_source_endpoints.side_effect = RuntimeError('retry source withdrawal')
        with self.assertRaises(RuntimeError):
            self.restrictions.withdraw(CURRENT)
        self.assertTrue(self.data['tunnels']['incident']['deleted'])
        self.assertIn(WID, self.links)

    def test_legacy_schema_still_enforces_full_lockdown(self):
        self.locks.return_value = {WID: {'modes': ['freeze']}}
        self.pool.query.side_effect = lambda query, *args: [[False]] if 'to_regclass' in query else self.rows
        self.assertTrue(self.restrictions.restricted(WID))
        self.assertNotIn('workspace_quarantines', self.pool.query.call_args.args[0])

    def test_unavailable_policy_fails_closed(self):
        self.pool.query.side_effect = RuntimeError('unavailable')
        with self.assertRaises(RuntimeError):
            self.restrictions.restricted(WID)


class StoredConnectionsTest(unittest.TestCase):
    def test_persists_withdrawal_and_rejects_reconnection(self):
        def load(name):
            spec = importlib.util.spec_from_file_location('restriction_test_' + name, SRC / (name + '.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        safe, tunnels = load('safe'), load('workspacetunnels')
        with tempfile.TemporaryDirectory() as directory:
            safe.LINKS_FILE = directory + '/links.json'
            safe.SOURCES_FILE = directory + '/sources.json'
            tunnels.STATE_FILE = directory + '/tunnels.json'
            pool = mock.Mock()
            pool.query.side_effect = lambda query, *args: [[True]] if 'to_regclass' in query else [[WID, ORG, OWNER, 't', ORG, 't']]
            restrictions = Restrictions(lambda: pool, lambda: {}, safe, tunnels, mock.Mock())
            with tunnels.state() as state:
                state['tunnels']['test'] = dict(source_workspace_id=WID, target_workspace_id=OTHER, revision=1)
            restrictions.once()
            self.assertIn(WID, safe.disconnected())
            with tunnels.state(write=False) as state:
                self.assertTrue(state['tunnels']['test']['deleted'])
            safe.CONNECTION_RESTRICTED = restrictions.restricted
            safe.WORKSPACE_INFO = lambda token, wid: {'id': WID, 'owner_id': OWNER}
            with self.assertRaises(PermissionError):
                safe.set_connected(types.SimpleNamespace(token=lambda: 'test-only'), {'id': OWNER, 'username': 'owner'}, WID, {'connected': True})
            tunnels.CONNECTION_RESTRICTED = restrictions.restricted
            with mock.patch.object(tunnels, 'authorize', return_value={'id': WID, 'owner_id': OWNER}):
                with self.assertRaises(PermissionError):
                    tunnels.create('test-only', {'id': OWNER}, ORG, {'source_workspace_id': WID, 'target_workspace_id': OTHER})


if __name__ == '__main__':
    unittest.main()
