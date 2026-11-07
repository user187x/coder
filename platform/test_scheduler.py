"""Temporary lease accounts use lease expiry instead of recurring workspace schedules."""
import ast
import json
import pathlib
import re
import types
import unittest
from unittest.mock import Mock
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        names = {'scheduler_lease_users', 'scheduler_exempt', 'scheduler_me', 'scheduler_check'}
        definitions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.pool = Mock()
        self.pool.query.return_value = [('leased-id',)]
        self.settings = {'enabled': True, 'mode': 'user', 'maxActiveHours': 2,
                         'excludedUsers': [], 'ignoreAdmins': True,
                         'enforcedDays': [0, 1, 2, 3, 4, 5, 6]}
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


class EnforcedDaysTest(unittest.TestCase):
    def setUp(self):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        funcs = {'clean_scheduler', '_day_labels', '_cron_days', '_enforced_days_problem', '_fixed_ttl_ms',
                 'fixed_schedule', 'schedule_problem', 'scheduler_check'}
        values = {'SCHEDULER_DEFAULT', '_DAY_NAMES', '_HHMM'}
        body = [n for n in source.body
                if (isinstance(n, ast.FunctionDef) and n.name in funcs)
                or (isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') in values)]
        self.settings = None
        self.scope = {'re': re, 'json': json, 'ZoneInfo': ZoneInfo, 'ZoneInfoNotFoundError': ZoneInfoNotFoundError,
                      'scheduler_settings': lambda: self.settings, 'ADMIN_ROLES': {'owner'},
                      '_scheduler_target': lambda *_: {'id': 'u1', 'username': 'bob', 'roles': []},
                      'scheduler_lease_users': lambda _s: set(),
                      'scheduler_exempt': lambda *_: ''}
        exec(compile(ast.Module(body=body, type_ignores=[]), 'ui-service.py', 'exec'), self.scope)
        self.settings = self.scope['clean_scheduler']({'enabled': True, 'mode': 'user', 'enforcedDays': [1, 2, 3, 4, 5]})

    def clean(self, **raw):
        return self.scope['clean_scheduler'](raw)

    def test_default_is_every_day(self):
        self.assertEqual(self.clean()['enforcedDays'], [0, 1, 2, 3, 4, 5, 6])
        self.assertEqual(self.scope['SCHEDULER_DEFAULT']['enforcedDays'], [0, 1, 2, 3, 4, 5, 6])

    def test_days_are_sorted_and_deduplicated(self):
        self.assertEqual(self.clean(enforcedDays=[5, 1, 1, 9])['enforcedDays'], [1, 5])

    def test_empty_list_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'at least one day'):
            self.clean(enforcedDays=[])

    def test_non_list_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'list of weekdays'):
            self.clean(enforcedDays='1,2')

    def test_fixed_days_outside_enforced_days_are_rejected(self):
        fixed = {'start': '08:00', 'stop': '18:00', 'days': [1, 6], 'timezone': 'UTC'}
        with self.assertRaisesRegex(ValueError, r'\(Sat\) must be among the enforced days \(Mon, Tue'):
            self.clean(mode='fixed', fixed=fixed, enforcedDays=[1, 2, 3])
        self.assertEqual(self.clean(mode='fixed', fixed=fixed, enforcedDays=[1, 6])['fixed']['days'], [1, 6])

    def test_user_mode_does_not_compare_fixed_days(self):
        fixed = {'start': '08:00', 'stop': '18:00', 'days': [6], 'timezone': 'UTC'}
        self.assertEqual(self.clean(mode='user', fixed=fixed, enforcedDays=[1])['enforcedDays'], [1])

    def test_cron_days(self):
        days = self.scope['_cron_days']
        self.assertEqual(days('CRON_TZ=UTC 0 8 * * 1-5'), {1, 2, 3, 4, 5})
        self.assertEqual(days('0 8 * * 0,6'), {0, 6})
        self.assertEqual(days('0 8 * * *'), set(range(7)))
        self.assertEqual(days('0 8 * * Mon-Wed'), {1, 2, 3})
        self.assertEqual(days('0 8 * * 5-1'), {5, 6, 0, 1})
        self.assertIsNone(days('0 8 1 * 1'))

    def test_check_rejects_user_schedule_on_unenforced_day(self):
        ask = lambda action, cron: self.scope['scheduler_check']('t', {'id': 'u1', 'username': 'bob', 'roles': []},
                                                                {'action': action, 'autostart_schedule': cron,
                                                                 'ttl_ms': 3600000})
        bad = ask('create', 'CRON_TZ=UTC 0 8 * * 1,6')
        self.assertFalse(bad['allowed'])
        self.assertIn('starts on Sat, but workspaces may only be scheduled on Mon, Tue, Wed, Thu, Fri', bad['message'])
        self.assertFalse(ask('autostart', 'CRON_TZ=UTC 0 8 * * *')['allowed'])
        self.assertTrue(ask('create', 'CRON_TZ=UTC 0 8 * * 1-5')['allowed'])
        self.assertTrue(ask('ttl', None)['allowed'])

    def test_all_days_enforced_keeps_old_behaviour(self):
        self.settings = self.clean(enabled=True)
        self.assertEqual(self.scope['schedule_problem'](self.settings, '0 8 * * 6', 3600000), '')


if __name__ == '__main__':
    unittest.main()
