"""Sandbox membership, organization boundaries, and durable startup projection."""
import contextlib
import copy
import json
import pathlib
import sys
import unittest
from unittest import mock

SRC = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'
sys.path.insert(0, str(SRC))
import sandbox

ORG = '11111111-2222-4333-8444-555555555555'
OTHER_ORG = '22222222-2222-4333-8444-555555555555'
GROUP = '33333333-2222-4333-8444-555555555555'
A = dict(id='44444444-2222-4333-8444-555555555555', name='a', owner_name='owner')
B = dict(id='55555555-2222-4333-8444-555555555555', name='b', owner_name='owner')

class Documents:
    def __init__(self):
        self.data = {}
    def read(self, *args):
        return copy.deepcopy(self.data)
    @contextlib.contextmanager
    def state(self, *args, **kwargs):
        data = copy.deepcopy(self.data)
        yield data
        self.data = data

class SandboxTest(unittest.TestCase):
    def setUp(self):
        self.cm = {'data': {}}
        self.documents = Documents()
        self.tunnels = {'revision': 0, 'tunnels': {'old': {'source_workspace_id': A['id'], 'target_workspace_id': B['id']}}}
        self.lock = mock.Mock(NAMESPACE='coder', CONFIGMAP='coder-lockdown')
        self.lock._configmap.side_effect = lambda: copy.deepcopy(self.cm)
        self.lock.now.return_value = '2026-10-29T00:00:00Z'
        def call(method, path, body):
            self.cm = copy.deepcopy(body)
            return 200, {}
        self.lock.KUBE.call.side_effect = call
        self.lock.settings.side_effect = lambda: self.documents.read()
        patchers = [mock.patch.object(sandbox, 'network_policies'), mock.patch.object(sandbox, 'LOCKDOWN', self.lock),
                    mock.patch.object(sandbox, 'PERSISTENCE', self.documents),
                    mock.patch.object(sandbox, 'settings', lambda: self.documents.read()),
                    mock.patch.object(sandbox, 'member_state', self.documents.state),
                    mock.patch.object(sandbox.workspacetunnels, 'state', lambda **kwargs: contextlib.nullcontext(self.tunnels))]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def change(self, workspaces, org=ORG, **kwargs):
        return sandbox.change(org, workspaces, {'username': 'admin'}, group=GROUP, **kwargs)

    def test_members_share_only_inside_group_and_release_restores_normal_access(self):
        self.change([A, B])
        self.assertTrue(sandbox.pair_allowed(A['id'], B['id']))
        self.assertFalse(sandbox.pair_allowed(A['id'], 'outside'))
        self.assertEqual('sandbox', self.cm['data'][A['id']])
        self.change([], release=True)
        self.assertTrue(sandbox.pair_allowed(A['id'], 'outside'))
        self.assertNotIn(A['id'], self.cm['data'])

    def test_external_tunnel_is_revoked_with_new_policy_revision(self):
        self.change([A])
        self.assertTrue(self.tunnels['tunnels']['old']['deleted'])
        self.assertGreater(self.tunnels['revision'], 0)

    def test_group_cannot_cross_organizations(self):
        self.change([A])
        with self.assertRaises(ValueError):
            self.change([B], org=OTHER_ORG)
        self.assertNotIn(B['id'], self.documents.data)

    def test_projection_failure_does_not_commit_membership(self):
        self.lock.KUBE.call.side_effect = None
        self.lock.KUBE.call.return_value = (503, {})
        with self.assertRaises(RuntimeError):
            self.change([A])
        self.assertEqual({}, self.documents.data)

    def test_startup_projection_is_restored_from_database(self):
        self.change([A])
        self.cm = {'data': {}}
        sandbox.project()
        self.assertEqual('sandbox', self.cm['data'][A['id']])
        self.assertEqual(ORG, json.loads(self.cm['data'][A['id']+'.meta'])['organization_id'])

class SandboxNetworkPolicyTest(unittest.TestCase):
    def test_policy_only_allows_group_peers_and_coder_then_is_removed(self):
        policies = {}
        lock = mock.Mock(NAMESPACE='coder')
        def call(method, path, body=None):
            if method == 'GET':
                return 200, {'items': list(policies.values())}
            if method in ('POST', 'PUT'):
                stored = copy.deepcopy(body)
                stored['metadata']['resourceVersion'] = '1'
                policies[stored['metadata']['name']] = stored
                return 201, stored
            if method == 'DELETE':
                policies.pop(path.rsplit('/', 1)[1])
                return 200, {}
            raise AssertionError(method)
        lock.KUBE.call.side_effect = call
        members = {A['id']: {'sandbox_group': GROUP}, B['id']: {'sandbox_group': GROUP}}
        with mock.patch.object(sandbox, 'LOCKDOWN', lock), mock.patch.object(sandbox, 'inputs', return_value=('10.0.0.2', '', '')):
            sandbox.network_policies(members)
            for policy in policies.values():
                spec = policy['spec']
                peer = {'podSelector': {'matchExpressions': [{'key': 'com.coder.workspace.id', 'operator': 'In', 'values': sorted(members)}]}}
                self.assertEqual(spec['ingress'], [{'from': [peer]}])
                self.assertEqual(spec['egress'][0], {'to': [peer]})
                self.assertEqual(spec['egress'][1]['to'], [{'ipBlock': {'cidr': '10.0.0.2/32'}}])
                self.assertEqual(spec['egress'][1]['ports'], [{'protocol': 'TCP', 'port': p} for p in (80, 443, 8080)])
            sandbox.network_policies({})
            self.assertEqual(policies, {})

if __name__ == '__main__':
    unittest.main()
