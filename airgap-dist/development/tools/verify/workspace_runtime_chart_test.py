"""Rendering regressions for fail-closed runtime admission recovery."""
import pathlib
import json
import shutil
import subprocess
import unittest

import yaml

CHART = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'


@unittest.skipUnless(shutil.which('helm'), 'Helm required')
class WorkspaceRuntimeChartTest(unittest.TestCase):
    def render(self, *settings):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder',
                                 '--set', 'platformWebhook.enabled=true', '--set', 'platformWebhook.runtimeIsolation.mode=native-sysbox', *settings], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [doc for doc in yaml.safe_load_all(result.stdout) if doc]

    def test_gpu_switch_defaults_off_and_never_renders_device_allocation(self):
        for enabled in ('false','true'):
            docs=self.render('--set','platformWebhook.runtimeIsolation.prepareBackend=true','--set','platformWebhook.runtimeIsolation.vm.gpu.enabled='+enabled)
            backends=[doc for doc in docs if doc['kind']=='Deployment' and doc['metadata']['name'] in ('coder-platform-webhook','coder-ui-updates')]
            self.assertTrue(backends)
            for backend in backends:
                container=backend['spec']['template']['spec']['containers'][0]
                setting=next(value for value in container['env'] if value['name']=='WORKSPACE_VM_GPU_CONFIG')
                self.assertEqual(json.loads(setting['value']),{'enabled':enabled=='true','profiles':[]})
                self.assertNotIn('nvidia.com/gpu',container.get('resources',{}).get('limits',{}))
        result=subprocess.run(['helm','template','coder',str(CHART),'--set','platformWebhook.enabled=true','--set-string','platformWebhook.runtimeIsolation.vm.gpu.enabled=true'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('boolean enabled switch',result.stderr)

    def test_load_collector_is_separate_unprivileged_infrastructure(self):
        docs = self.render('--set', 'uiUpdates.nodeLoad.enabled=true')
        collector = next(doc for doc in docs if doc['kind'] == 'DaemonSet' and doc['metadata']['name'] == 'coder-node-load')
        self.assertEqual(collector['metadata']['namespace'], 'coder-runtime-system')
        spec = collector['spec']['template']['spec']
        self.assertNotIn('hostPID', spec)
        self.assertNotIn('hostNetwork', spec)
        self.assertTrue(spec['securityContext']['runAsNonRoot'])
        container = spec['containers'][0]
        self.assertFalse(container['securityContext']['allowPrivilegeEscalation'])
        self.assertTrue(container['securityContext']['readOnlyRootFilesystem'])
        self.assertNotIn('ports', container)
        self.assertEqual(spec['volumes'], [{'name': 'loadavg', 'hostPath': {'path': '/proc/loadavg', 'type': 'File'}}])
        self.assertTrue(container['volumeMounts'][0]['readOnly'])
        namespaces = [doc for doc in docs if doc['kind'] == 'Namespace' and doc['metadata']['name'] == 'coder-runtime-system']
        self.assertEqual(len(namespaces), 1)

    def test_staging_retains_original_backend_and_routing(self):
        docs = self.render('--set', 'platformWebhook.runtimeIsolation.prepareBackend=true')
        backends = [d for d in docs if d['kind'] == 'Deployment' and d['metadata']['name'] == 'coder-platform-webhook']
        self.assertEqual({d['metadata']['namespace'] for d in backends}, {'coder', 'coder-runtime-system'})
        hooks = [d for d in docs if d['kind'].endswith('WebhookConfiguration') and d['metadata']['name'].startswith('coder-platform-webhook')]
        self.assertEqual(len(hooks), 1)
        self.assertEqual(hooks[0]['webhooks'][0]['clientConfig']['service']['namespace'], 'coder')

    def test_backend_recovers_outside_protected_namespace(self):
        docs = self.render('--set', 'platformWebhook.runtimeIsolation.enabled=true')
        backends = [d for d in docs if d['kind'] == 'Deployment' and d['metadata']['name'] == 'coder-platform-webhook']
        self.assertEqual([d['metadata']['namespace'] for d in backends], ['coder-runtime-system'])
        secret = next(d for d in docs if d['kind'] == 'Secret' and d['metadata']['name'] == 'coder-platform-webhook-tls')
        self.assertEqual(secret['metadata']['namespace'], 'coder-runtime-system')
        hooks = [d for d in docs if d['kind'].endswith('WebhookConfiguration') and d['metadata']['name'].startswith('coder-platform-webhook')]
        self.assertEqual(len(hooks), 3)
        for config in hooks:
            hook = config['webhooks'][0]
            self.assertEqual(hook['clientConfig']['service']['namespace'], 'coder-runtime-system')
            self.assertEqual(hook['clientConfig']['caBundle'], secret['data']['ca.crt'])
            self.assertEqual(hook['namespaceSelector']['matchLabels']['kubernetes.io/metadata.name'], 'coder')
            if '-runtime-' in config['metadata']['name']:
                self.assertEqual(hook['failurePolicy'], 'Fail')
                self.assertNotIn('objectSelector', hook)
        binding = next(d for d in docs if d['kind'] == 'RoleBinding' and d['metadata']['name'] == 'coder-platform-webhook')
        self.assertEqual(binding['metadata']['namespace'], 'coder')
        self.assertEqual(binding['subjects'][0]['namespace'], 'coder-runtime-system')

    def test_runtime_cannot_silently_disable_required_webhook(self):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder',
                                 '--set', 'platformWebhook.enabled=false', '--set', 'platformWebhook.runtimeIsolation.enabled=true'],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires the platform webhook', result.stderr)

    def test_vm_mode_is_default_and_requires_approved_guest_image(self):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', '--set',
                                 'platformWebhook.enabled=true', '--set', 'platformWebhook.runtimeIsolation.enabled=true'],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('approved immutable guest root images', result.stderr)
        docs = self.render('--set', 'platformWebhook.runtimeIsolation.enabled=true', '--set',
                           'platformWebhook.runtimeIsolation.mode=vm-sysbox', '--set-string',
                           'platformWebhook.runtimeIsolation.vm.allowedRootImages[0]=registry/guest@sha256:' + 'a' * 64)
        hooks = [d for d in docs if d['kind'] == 'ValidatingWebhookConfiguration' and '-runtime-' in d['metadata']['name']]
        resources = [resource for rule in hooks[0]['webhooks'][0]['rules'] for resource in rule['resources']]
        self.assertIn('virtualmachines', resources)
        self.assertIn('virtualmachineinstances', resources)
        self.assertIn('secrets', resources)
        self.assertFalse(any(d['kind'] == 'ConfigMap' and d['metadata']['name'] == 'coder-vm-home-provenance' for d in docs))

    def test_self_protected_namespace_rejected(self):
        result = subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', '--set',
                                 'platformWebhook.enabled=true', '--set', 'platformWebhook.runtimeIsolation.mode=native-sysbox', '--set', 'platformWebhook.runtimeIsolation.enabled=true',
                                 '--set', 'platformWebhook.runtimeIsolation.serviceNamespace=coder'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must differ', result.stderr)


if __name__ == '__main__':
    unittest.main()
