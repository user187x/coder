"""Evaluate the actual Terraform migration precondition before any resource changes."""
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/charts/coder-workspace/files/workspace-vm.tf'


@unittest.skipUnless(shutil.which('terraform'), 'Terraform required')
class MigrationGuardTest(unittest.TestCase):
    def test_native_home_requires_exact_verified_retained_copy_before_conversion(self):
        text = SOURCE.read_text()
        condition = re.search(r'condition\s*= ([^\n]*local.vm_legacy_home_uid[^\n]*)', text).group(1)
        cases = [('', '', False), ('old-pvc', '', False), ('old-pvc', 'foreign-pvc', True),
                 ('old-pvc', 'old-pvc', False), ('old-pvc', 'old-pvc', True)]
        expressions = []
        for old, migrated, retained in cases:
            expression = condition.replace('local.vm_legacy_home_uid', json.dumps(old))
            expression = expression.replace('local.vm_migrated_home_uid', json.dumps(migrated))
            expression = expression.replace('local.vm_home_retained', json.dumps(retained))
            expressions.append(expression)
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['terraform', 'console', '-no-color'], cwd=directory,
                                    input='jsonencode([' + ','.join(expressions) + '])\n', text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(json.loads(result.stdout)), [True, False, False, False, True])
