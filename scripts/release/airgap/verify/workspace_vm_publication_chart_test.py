"""Canonical VM publication must be explicit, organization scoped, and use only public CA input."""
import pathlib
import shutil
import subprocess
import unittest
import yaml

CHART = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'


@unittest.skipUnless(shutil.which('helm'), 'Helm required')
class PublicationTest(unittest.TestCase):
    def render(self, enabled=False, required=True, drives=False):
        args = ['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', '--set', 'coder-workspace.dataflowTemplate.enabled=true']
        if enabled:
            args += ['--set', 'coder-workspace.vmPublication.enabled=true', '--set', 'coder-workspace.workspaceTunnelImage=', '--set', 'global.userStorage.enabled=' + str(drives).lower()]
            if required:
                args += ['--set', 'coder-workspace.vmPublication.rootImage=registry/gold@sha256:' + 'a' * 64,
                         '--set', 'coder-workspace.vmPublication.organizationId=672ea503-0c18-4456-840d-a4d6068491a1']
        return subprocess.run(args, capture_output=True, text=True)

    def test_default_and_dataflow_use_explicit_profile_and_existing_public_ca(self):
        result = self.render(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        docs = [d for d in yaml.safe_load_all(result.stdout) if d]
        jobs = [d for d in docs if d['kind'] == 'Job' and 'push-template' in d['metadata']['name']]
        self.assertEqual(len(jobs), 2)
        for job in jobs:
            spec = job['spec']['template']['spec']
            command = str(spec['containers'])
            self.assertIn('workspace_vm_enabled=true', command)
            self.assertIn('workspace_vm_ca_pem="$(cat /etc/ssl/certs/coder/ca.crt)"', command)
            self.assertIn('export CODER_ORGANIZATION=', command)
            self.assertNotIn('tls.key', command)
            login = str(spec['initContainers'])
            self.assertIn('TEMPLATE_ORGANIZATION_ID', login)
            self.assertIn('t.get("organization_id") == organization', login)

    def test_opt_out_preserves_native_publication(self):
        result = self.render()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--variable workspace_vm_enabled=true', result.stdout)

    def test_missing_required_profile_and_unqualified_features_fail_render(self):
        self.assertNotEqual(self.render(True, required=False).returncode, 0)
        self.assertNotEqual(self.render(True, drives=True).returncode, 0)
