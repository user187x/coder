"""Common PostgreSQL lock ordering and fail-closed connection commits."""
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import quarantineguard

WID = '11111111-2222-4333-8444-555555555555'
OTHER = '22222222-2222-4333-8444-555555555555'
ORG = '33333333-2222-4333-8444-555555555555'
OWNER = '44444444-2222-4333-8444-555555555555'


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.rows = {wid: [(wid, ORG, OWNER, False, '00000000-0000-0000-0000-000000000000', False)] for wid in (WID, OTHER)}
        outer = self
        class Connection:
            def __init__(self, url, cafile, timeout):
                outer.calls.append(('connect', url, cafile, timeout))
            def query(self, sql, params=()):
                outer.calls.append((sql, params))
                return outer.rows[params[0]] if sql.startswith('SELECT w.id::text') else []
            def close(self):
                outer.calls.append(('close',))
        self.patch = patch.object(quarantineguard.pgwire, 'Connection', Connection)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.guard = quarantineguard.Guard(type('Pool', (), {'url':'private-url', 'cafile':'private-ca'})())

    def test_go_fnv1_lock_key_known_vectors(self):
        self.assertEqual(quarantineguard.lock_key(WID), -3833308646707712609)
        self.assertEqual(quarantineguard.lock_key(OTHER), 3738203156691341015)

    def test_pgwire_false_values_allow_connection_commit(self):
        self.rows[WID] = [(WID, ORG, OWNER, 'f', ORG, 'f')]
        with self.guard(WID) as current:
            self.assertIs(current['enabled'], False)
            self.assertIs(current['manual_start_required'], False)
        self.assertEqual(self.calls[-2:], [('COMMIT', ()), ('close',)])

    def test_pgwire_true_values_preserve_connection_restrictions(self):
        for enabled, manual in (('t', 'f'), ('f', 't')):
            with self.subTest(enabled=enabled, manual=manual):
                self.rows[WID] = [(WID, ORG, OWNER, enabled, ORG, manual)]
                with self.assertRaises(PermissionError), self.guard(WID):
                    self.fail('Restricted text policy yielded')

    def test_pgwire_unknown_policy_values_fail_closed(self):
        for value in (None, 0, 1, '', 'false', 'true'):
            with self.subTest(value=value):
                self.rows[WID] = [(WID, ORG, OWNER, value, ORG, 'f')]
                with self.assertRaises(RuntimeError), self.guard(WID):
                    self.fail('Unknown text policy yielded')

    def test_multi_target_locks_sorted_before_read_then_commits_and_closes(self):
        with self.guard.many([OTHER, WID, WID]) as current:
            self.calls.append(('local-write',))
            self.assertEqual(set(current), {WID, OTHER})
        locks = [call[1][0] for call in self.calls if call[0].startswith('SELECT pg_advisory')]
        self.assertEqual(locks, [quarantineguard.lock_key(WID), quarantineguard.lock_key(OTHER)])
        self.assertLess(next(i for i,c in enumerate(self.calls) if c[0].startswith('SELECT pg_advisory')), next(i for i,c in enumerate(self.calls) if c[0] == quarantineguard.POLICY))
        self.assertEqual(self.calls[-2:], [('COMMIT', ()), ('close',)])
        self.assertIn('AND NOT w.deleted', quarantineguard.POLICY)

    def test_quarantined_or_manual_latch_never_yields_and_rolls_back(self):
        for enabled, manual in ((True,False),(False,True)):
            with self.subTest(enabled=enabled,manual=manual):
                self.calls.clear()
                self.rows[WID] = [(WID,ORG,OWNER,enabled,ORG,manual)]
                with self.assertRaises(PermissionError), self.guard(WID):
                    self.fail('Blocked policy yielded a commit window')
                self.assertEqual(self.calls[-2:], [('ROLLBACK',()),('close',)])
                self.assertNotIn(('COMMIT',()),self.calls)

    def test_missing_or_invalid_policy_and_failed_local_write_roll_back(self):
        self.rows[WID]=[]
        with self.assertRaises(RuntimeError), self.guard(WID):
            self.fail('Missing policy yielded')
        self.rows[WID]=[(WID,ORG,OWNER,False,ORG,False)]
        with self.assertRaises(OSError), self.guard(WID):
            raise OSError('Local durable commit failed')
        self.assertEqual(self.calls[-2:], [('ROLLBACK',()),('close',)])

    def test_provider_recovers_after_database_discovery(self):
        pool = [None]
        guard = quarantineguard.Guard(lambda: pool[0])
        with self.assertRaises(RuntimeError), guard(WID):
            self.fail('Unavailable database yielded')
        self.assertEqual(self.calls, [])
        pool[0] = self.guard.pool
        with guard(WID):
            self.calls.append(('local-write',))
        self.assertEqual(self.calls[-2:], [('COMMIT', ()), ('close',)])

    def test_restriction_must_match_current_revision_and_cannot_overwrite_release(self):
        current = dict(zip(quarantineguard.FIELDS, (WID,ORG,OWNER,True,ORG,True)))
        self.rows[WID] = [tuple(current[key] for key in quarantineguard.FIELDS)]
        with self.guard.restrict(current):
            self.calls.append(('restrictive-write',))
        for revision, enabled, manual in ((OTHER,True,True),(ORG,False,False)):
            with self.subTest(revision=revision,enabled=enabled,manual=manual):
                self.rows[WID] = [(WID,ORG,OWNER,enabled,revision,manual)]
                with self.assertRaises(PermissionError), self.guard.restrict(current):
                    self.fail('Obsolete restriction yielded')
                self.assertEqual(self.calls[-2:], [('ROLLBACK',()),('close',)])
