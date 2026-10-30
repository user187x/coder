"""Regression coverage for media permissions following browser workspace identity."""
import base64
import importlib.util
import json
import pathlib
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_template', ROOT / 'build-template.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class NekoNetworkTest(unittest.TestCase):
    def test_template_packages_workspace_owned_media_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            base = root / 'base'
            base.mkdir()
            (base / 'scripts').mkdir()
            (base / 'main.tf').write_text('        container {\n          name  = "dev"\n          security_context {\n            run_as_user = "1000"\n          }\n        }\n')
            (base / 'workspace-vm.tf').write_text('')
            archive = builder.neko_template(base, root / 'template', 'registry.test/neko@sha256:123', 'custom-turn')
            with tarfile.open(archive) as tar:
                policy = json.load(tar.extractfile('browser-network.tf.json'))['resource']['kubernetes_network_policy_v1']['browser_media']
            source = (root / 'template/main.tf').read_text()
            self.assertNotIn('var.terminal', source)
            self.assertIn('terminal = false', (root / 'template/terraform.tfvars').read_text())
            self.assertIn('CODER_AGENT_BLOCK_TERMINAL_ACCESS', source)
            self.assertIn('run_as_non_root = true', source)
            self.assertIn('allow_privilege_escalation = false', source)
            self.assertIn('drop = ["ALL"]', source)
            # The same template must resolve fresh names and selectors on recreation.
            for workspace_id in ('first-workspace', 'recreated-workspace'):
                rendered = json.loads(json.dumps(policy).replace('${data.coder_workspace.me.id}', workspace_id))
                self.assertEqual(rendered['metadata'][0]['name'], 'coder-neko-' + workspace_id)
                self.assertEqual(rendered['metadata'][0]['namespace'], '${var.namespace}')
                self.assertEqual(rendered['count'], '${var.workspace_vm_enabled ? 0 : data.coder_workspace.me.start_count}')
                network = rendered['spec'][0]
                self.assertEqual(network['policy_types'], ['Ingress', 'Egress'])
                self.assertEqual(network['pod_selector'], [{'match_labels': {'app.kubernetes.io/name': 'custom-turn'}}])
                for direction, peers, first, last in [('ingress', 'from', '49160', 49200), ('egress', 'to', '30590', 30595)]:
                    self.assertEqual(network[direction], [{
                        peers: [{'pod_selector': [{'match_labels': {'com.coder.workspace.id': workspace_id}}]}],
                        'ports': [{'protocol': 'UDP', 'port': first, 'end_port': last}],
                    }])

    def test_upgrade_preparation_preserves_existing_relay_and_media_rules(self):
        argv = ['configure-turn.py', '--kubeconfig', '/unused', '--hostname', 'turn.example.test',
                '--tls-secret', 'tls', '--pod-cidr-range', '10.42.0.0-10.42.255.255', '--prepare-workspaces']
        with mock.patch.object(sys, 'argv', argv), mock.patch('subprocess.run') as kubectl:
            with self.assertRaises(SystemExit) as stopped:
                runpy.run_path(str(ROOT / 'configure-turn.py'), run_name='__main__')
        self.assertEqual(stopped.exception.code, 0)
        kubectl.assert_called_once()
        resources = json.loads(kubectl.call_args.kwargs['input'])['items']
        self.assertEqual([item['kind'] for item in resources], ['Role', 'RoleBinding'])

    def test_shared_relay_setup_does_not_pin_a_workspace_or_rotate_credentials(self):
        ice = [{'urls': ['turns:turn.example.test:443?transport=tcp'], 'username': 'browser', 'credential': 'existing'}]
        existing = {'data': {'ice-servers': base64.b64encode(json.dumps(ice).encode()).decode()}}
        for legacy_args in ([], ['--workspace-id', 'deleted-workspace']):
            with self.subTest(legacy_args=legacy_args):
                def kubectl(command, **kwargs):
                    if 'get' in command:
                        return subprocess.CompletedProcess(command, 0, json.dumps(existing))
                    applied.append(json.loads(kwargs['input']))
                    return subprocess.CompletedProcess(command, 0)
                applied = []
                argv = ['configure-turn.py', '--kubeconfig', '/unused', '--hostname', 'turn.example.test',
                        '--tls-secret', 'tls', '--pod-cidr-range', '10.42.0.0-10.42.255.255',
                        '--namespace', 'browser-workspaces', '--provisioner-service-account', 'browser-provisioner'] + legacy_args
                with mock.patch.object(sys, 'argv', argv), mock.patch('subprocess.run', side_effect=kubectl):
                    runpy.run_path(str(ROOT / 'configure-turn.py'), run_name='__main__')
                self.assertEqual(len(applied), 1)
                resources = applied[0]['items']
                self.assertFalse(any(item['kind'] == 'Secret' for item in resources))
                policy = next(item['spec'] for item in resources if item['kind'] == 'NetworkPolicy')
                self.assertEqual(policy['policyTypes'], ['Ingress', 'Egress'])
                self.assertEqual(policy['egress'], [])
                self.assertEqual(policy['ingress'], [{
                    'from': [{'podSelector': {'matchLabels': {'app.kubernetes.io/name': 'traefik'}}}],
                    'ports': [{'protocol': 'TCP', 'port': 5349}],
                }])
                self.assertNotIn('com.coder.workspace.id', json.dumps(resources))
                role = next(item for item in resources if item['kind'] == 'Role')
                self.assertEqual(role['metadata']['namespace'], 'browser-workspaces')
                self.assertEqual(role['rules'], [{'apiGroups': ['networking.k8s.io'],
                                                'resources': ['networkpolicies'],
                                                'verbs': ['get', 'create', 'update', 'delete']}])
                binding = next(item for item in resources if item['kind'] == 'RoleBinding')
                self.assertEqual(binding['subjects'], [{'kind': 'ServiceAccount', 'name': 'browser-provisioner',
                                                       'namespace': 'browser-workspaces'}])
                self.assertEqual(binding['roleRef']['name'], role['metadata']['name'])


if __name__ == '__main__':
    unittest.main()
