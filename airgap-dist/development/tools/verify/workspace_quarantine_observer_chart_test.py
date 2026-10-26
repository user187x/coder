"""Quarantine observer privilege and placement rendering contract."""
import pathlib
import shutil
import subprocess
import unittest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'


@unittest.skipUnless(shutil.which('helm'), 'Helm required')
class ObserverChartTest(unittest.TestCase):
    def render(self, *args):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', *args],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [doc for doc in yaml.safe_load_all(result.stdout) if doc]

    def test_disabled_by_default(self):
        docs = self.render()
        self.assertFalse(any(doc['metadata']['name'] == 'coder-quarantine-observer' for doc in docs))

    def test_only_approved_nodes_no_host_filesystem_or_execution_authority(self):
        docs = self.render('--set', 'uiUpdates.quarantineObserver.enabled=true', '--set',
                           'platformWebhook.enabled=true', '--set', 'platformWebhook.runtimeIsolation.prepareBackend=true')
        ds = next(doc for doc in docs if doc['kind'] == 'DaemonSet' and doc['metadata']['name'] == 'coder-quarantine-observer')
        self.assertEqual(ds['metadata']['namespace'], 'coder-runtime-system')
        spec = ds['spec']['template']['spec']
        self.assertEqual(spec['nodeSelector'], {'kubernetes.io/os': 'linux', 'platform.coder/vm-ready': 'true'})
        self.assertTrue(spec['hostPID'])
        self.assertNotIn('hostNetwork', spec)
        self.assertNotIn('volumes', spec)
        self.assertTrue(spec['securityContext']['runAsNonRoot'])
        self.assertEqual(spec['securityContext']['runAsUser'], 65532)
        container = spec['containers'][0]
        self.assertNotIn('ports', container)
        self.assertNotIn('volumeMounts', container)
        self.assertEqual(container['command'], ['python3', '/app/vmquarantineobserver.py'])
        self.assertEqual(container['securityContext'], {'allowPrivilegeEscalation': False,
                                                      'readOnlyRootFilesystem': True,
                                                      'capabilities': {'drop': ['ALL']}})
        role = next(doc for doc in docs if doc['kind'] == 'Role' and doc['metadata']['name'] == 'coder-quarantine-observer')
        self.assertEqual(role['rules'], [{'apiGroups': [''], 'resources': ['configmaps'],
                                         'resourceNames': ['coder-workspace-quarantine-targets'], 'verbs': ['get']}])
        cluster_role = next(doc for doc in docs if doc['kind'] == 'ClusterRole' and doc['metadata']['name'].endswith('-quarantine-observer'))
        self.assertEqual(cluster_role['rules'], [{'apiGroups': [''], 'resources': ['nodes'], 'verbs': ['get', 'patch']}])

    def test_observer_requires_protected_backend_namespace(self):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', '--set',
                                 'uiUpdates.quarantineObserver.enabled=true'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('protected runtime backend', result.stderr)
