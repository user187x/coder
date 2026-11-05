"""Temporary lease accounts use lease expiry instead of recurring workspace schedules."""
import ast
import pathlib
import types
import unittest
from unittest.mock import Mock


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        names = {'scheduler_lease_users', 'scheduler_exempt', 'scheduler_me', 'scheduler_check'}
        definitions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.pool = Mock()
        self.pool.query.return_value = [('leased-id',)]
        self.settings = {'enabled': True, 'mode': 'user', 'maxActiveHours': 2,
                         'excludedUsers': [], 'ignoreAdmins': True}
        self.user = {'id': 'leased-id', 'username': 'temporary', 'roles': []}
        self.scope = {'LOGOS': types.SimpleNamespace(pool=self.pool), 'ADMIN_ROLES': {'owner'},
                      'scheduler_settings': lambda: self.settings, '_workspace_schedules': Mock(),
                      '_scheduler_target': lambda *_: self.user, 'schedule_problem': lambda *_: 'no schedule'}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), 'ui-service.py', 'exec'), self.scope)

    def test_lease_login_has_no_schedule_gate(self):
        result = self.scope['scheduler_me']('token', self.user)
        self.assertFalse(result['enforced'])
        self.assertEqual(result['workspaces'], [])
        self.scope['_workspace_schedules'].assert_not_called()
        self.pool.query.assert_called_once_with('SELECT user_id::text FROM short_term_leases')

    def test_lease_create_does_not_apply_fixed_schedule(self):
        self.settings['mode'] = 'fixed'
        result = self.scope['scheduler_check']('token', self.user, {'action': 'create'})
        self.assertTrue(result['allowed'])
        self.assertNotIn('apply', result)

    def test_name_prefix_does_not_exempt_regular_accounts(self):
        self.user.update(id='regular-id', username='lease-looking-name')
        result = self.scope['scheduler_check']('token', self.user, {'action': 'create'})
        self.assertFalse(result['allowed'])

    def test_unavailable_policy_fails_closed(self):
        self.scope['LOGOS'] = None
        with self.assertRaisesRegex(RuntimeError, 'policy is unavailable'):
            self.scope['scheduler_me']('token', self.user)

    def test_disabled_scheduler_does_not_need_database(self):
        self.settings['enabled'] = False
        self.scope['LOGOS'] = None
        result = self.scope['scheduler_me']('token', self.user)
        self.assertFalse(result['enforced'])


if __name__ == '__main__':
    unittest.main()
