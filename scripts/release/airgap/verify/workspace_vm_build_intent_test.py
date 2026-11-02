"""Captured profiles require exact current-build identity; revocation may read current intent."""
import ast
import pathlib
import types
import unittest
from unittest import mock

SOURCE = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates/ui-service.py'


class BuildIntentTest(unittest.TestCase):
    def test_missing_capture_is_not_authorized_and_revocation_uses_parameterized_current_lookup(self):
        node = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'vm_build_intent')
        pool = mock.Mock()
        pool.query.return_value = [('workspace', 'org', 'owner', 'build', 'start', 'failed')]
        scope = {'LOGOS': types.SimpleNamespace(pool=pool)}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), scope)
        lookup = scope['vm_build_intent']
        self.assertIsNone(lookup('workspace', None))
        pool.query.assert_not_called()
        current = lookup('workspace', None, allow_current=True)
        self.assertEqual(current['job_status'], 'failed')
        self.assertEqual(pool.query.call_args.args[1], ['workspace', None])
        self.assertIn('$2::uuid IS NULL', pool.query.call_args.args[0])
        captured = lookup('workspace', 'build')
        self.assertEqual(captured['build_id'], 'build')
        self.assertEqual(pool.query.call_args.args[1], ['workspace', 'build'])
        pool.query.side_effect = RuntimeError('database unavailable')
        with self.assertRaises(RuntimeError):
            lookup('workspace', None, allow_current=True)
