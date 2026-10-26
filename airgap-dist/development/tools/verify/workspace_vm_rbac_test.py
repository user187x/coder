"""Metrics lookup permissions remain available while VM mutation is staged off."""
import pathlib
import re
import shutil
import subprocess
import unittest


class MetricsRBACTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('helm'), 'Helm is required to verify rendered RBAC')
    def test_staged_off_vm_mode_still_grants_only_namespaced_metrics_reads(self):
        chart = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'
        result = subprocess.run(['helm', 'template', 'coder', str(chart), '-n', 'coder',
            '--set', 'platformWebhook.runtimeIsolation.vm.reconcileEnabled=false',
            '--show-only', 'templates/workspace-vm-read-rbac.yaml'], check=True, capture_output=True, text=True)
        documents = result.stdout.split('\n---')
        role = next(doc for doc in documents if re.search(r'^kind: Role$', doc, re.M))
        self.assertIn('namespace: coder', role)
        self.assertIn('resources: [virtualmachines, virtualmachineinstances]', role)
        self.assertIn('resources: [secrets]', role)
        self.assertEqual(re.findall(r'verbs: \[([^]]+)\]', role), ['get', 'get'])
        self.assertNotIn('ClusterRole', result.stdout)
        binding = next(doc for doc in documents if 'kind: RoleBinding' in doc)
        self.assertIn('name: coder-ui-updates, namespace: coder', binding)


if __name__ == '__main__':
    unittest.main()
