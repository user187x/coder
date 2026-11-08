"""The Dashboard's quota view: the caller's own workspaces and limits only, whoever asks."""
import ast
import math
import pathlib
import re
import types
import unittest
from unittest.mock import Mock

ALICE = {'id': 'alice-id', 'username': 'alice', 'roles': []}
ADMIN = {'id': 'admin-id', 'username': 'root', 'roles': ['owner']}


def workspace(wid, owner, owner_id, cpu=2.0, memory=4.0, disk=10.0, running=True):
    return {'id': wid, 'name': wid + '-name', 'owner': owner, 'ownerId': owner_id, 'template': 'docker',
            'organizationId': 'org', 'cpu': cpu, 'memory': memory, 'disk': disk,
            'status': 'running' if running else 'stopped', 'running': running}


def pod(wid, gpus=None):
    resources = {'limits': {'nvidia.com/gpu': str(gpus)}} if gpus else {}
    return {'metadata': {'labels': {'com.coder.workspace.id': wid}},
            'spec': {'containers': [{'resources': resources}]}}


class QuotaMeResourcesTest(unittest.TestCase):
    def setUp(self):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        names = {'quota_me_resources', '_workspace_gpus', '_gpus', 'quota_usage', 'quota_exempt', 'quota_limits',
                 'quota_resource_modes', 'quantity'}
        values = {'QUOTA_KEYS', 'GPU_RESOURCE', 'QUANTITY_SUFFIX'}
        body = [n for n in source.body
                if (isinstance(n, ast.FunctionDef) and n.name in names)
                or (isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') in values)]
        self.settings = {'default': {'workspaces': 3, 'cpu': 8, 'memory': 16, 'disk': 50},
                         'users': {}, 'exemptAdmins': True, 'excludedUsers': []}
        self.workspaces = [workspace('a1', 'alice', 'alice-id'),
                           workspace('a2', 'alice', 'alice-id', cpu=1, memory=2, disk=5, running=False),
                           workspace('b1', 'bob', 'bob-id', cpu=6, memory=12, disk=40),
                           workspace('r1', 'root', 'admin-id', cpu=4, memory=8, disk=20)]
        self.kube = Mock()
        self.kube.call.return_value = (200, {'items': [pod('a1', 1), pod('b1', 4), pod('r1')]})
        self.quota_workspaces = Mock(side_effect=lambda _token, owner=None: list(self.workspaces))
        self.scope = {'re': re, 'math': math, 'KUBE': self.kube, 'WORKSPACE_NAMESPACE': 'coder-workspaces',
                      'ADMIN_ROLES': {'owner'}, 'quota_settings': lambda: self.settings,
                      'quota_workspaces': self.quota_workspaces,
                      'quotaextras': types.SimpleNamespace(limits=lambda base, _uid: {'limits': base})}
        exec(compile(ast.Module(body=body, type_ignores=[]), 'ui-service.py', 'exec'), self.scope)

    def resources(self, user):
        return self.scope['quota_me_resources']('caller-token', user)

    def test_user_sees_only_their_own_workspaces(self):
        result = self.resources(ALICE)
        self.quota_workspaces.assert_called_once_with('caller-token', owner='alice')
        self.assertEqual([w['id'] for w in result['workspaces']], ['a1', 'a2'])
        self.assertEqual(result['usage'], {'workspaces': 2, 'cpu': 3.0, 'memory': 6.0, 'disk': 15.0})
        self.assertEqual(result['limits'], self.settings['default'])
        self.assertFalse(result['exempt'])

    def test_switched_off_holds_nobody_to_the_limits(self):
        self.settings['enabled'] = False
        result = self.resources(ALICE)
        self.assertTrue(result['exempt'])
        self.assertEqual(result['limits'], self.settings['default'])

    def test_rows_carry_no_owner_or_organization(self):
        row = self.resources(ALICE)['workspaces'][0]
        self.assertEqual(set(row), {'id', 'name', 'template', 'status', 'running', 'cpu', 'memory', 'disk', 'gpus'})

    def test_admin_sees_their_own_workspaces_not_the_clusters(self):
        result = self.resources(ADMIN)
        self.quota_workspaces.assert_called_once_with('caller-token', owner='root')
        self.assertEqual([w['id'] for w in result['workspaces']], ['r1'])
        self.assertTrue(result['exempt'])
        self.assertEqual(result['limits'], self.settings['default'])

    def test_gpus_count_only_the_callers_pods(self):
        rows = {w['id']: w['gpus'] for w in self.resources(ALICE)['workspaces']}
        self.assertEqual(rows, {'a1': 1, 'a2': 0})

    def test_unreadable_pods_leave_gpus_unknown(self):
        self.kube.call.return_value = (403, {})
        self.assertEqual([w['gpus'] for w in self.resources(ALICE)['workspaces']], [None, None])

    def test_instance_mode_reports_the_largest_workspace(self):
        self.settings['resourceModes'] = {'cpu': 'instance', 'memory': 'cumulative', 'disk': 'cumulative'}
        result = self.resources(ALICE)
        self.assertEqual(result['usage']['cpu'], 2.0)
        self.assertEqual(result['resourceModes']['cpu'], 'instance')


if __name__ == '__main__':
    unittest.main()


class CleanQuotaTest(unittest.TestCase):
    def setUp(self):
        import uuid
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        names = {'clean_quota', '_quota_number', 'quota_excluded_users', 'quota_resource_modes'}
        body = [n for n in source.body
                if (isinstance(n, ast.FunctionDef) and n.name in names)
                or (isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'QUOTA_KEYS')]
        self.scope = {'re': re, 'math': math, 'uuid': uuid}
        exec(compile(ast.Module(body=body, type_ignores=[]), 'ui-service.py', 'exec'), self.scope)

    def test_keeps_the_switch_on_unless_turned_off(self):
        clean = self.scope['clean_quota']
        self.assertTrue(clean({})['enabled'])
        self.assertFalse(clean({'enabled': False})['enabled'])
        with self.assertRaises(ValueError):
            clean({'enabled': 'off'})
