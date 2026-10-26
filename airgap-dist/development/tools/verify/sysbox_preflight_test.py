"""Explicit quota feature-gate checks must never assume the safe default."""
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parent.parent / 'runtime/sysbox-preflight.py'
spec = importlib.util.spec_from_file_location('sysbox_preflight', path)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)
GATE = 'DisableCPUQuotaWithExclusiveCPUs'


class SysboxPreflightTest(unittest.TestCase):
    def test_explicit_yaml_and_json(self):
        for config in ('featureGates:\n  ' + GATE + ': false\ncpuManagerPolicy: static\n',
                       'featureGates: {' + GATE + ': false}\n',
                       '{"featureGates":{"' + GATE + '":false}}'):
            with self.subTest(config=config):
                self.assertEqual(preflight.feature_gate(config, {}, GATE), 'false')

    def test_missing_true_and_ambiguous_not_safe(self):
        for config in ('cpuManagerPolicy: static\n', 'featureGates:\n  ' + GATE + ': true\n',
                       'featureGates:\n  ' + GATE + ': false\n  ' + GATE + ': true\n',
                       'featureGates: {}\nfeatureGates: {' + GATE + ': false}\n'):
            with self.subTest(config=config):
                self.assertNotEqual(preflight.feature_gate(config, {}, GATE), 'false')

    def test_process_override_has_precedence(self):
        config = 'featureGates:\n  ' + GATE + ': false\n'
        self.assertEqual(preflight.feature_gate(config, {'feature-gates': GATE + '=true'}, GATE), 'true')
        self.assertEqual(preflight.feature_gate('', {'feature-gates': GATE + '=true,' + GATE + '=false'}, GATE), 'false')


if __name__ == '__main__':
    unittest.main()
