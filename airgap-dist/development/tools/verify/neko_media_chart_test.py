"""Opt-in Neko media routing, secret and configuration rendering contract."""
import copy
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

import yaml

CHART = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'
MEDIA = {
    'enabled': True, 'descriptorKeySecretName': 'test-neko-descriptor',
    'advertiseIP': '192.0.2.10', 'clientCIDRs': ['10.20.0.0/16'],
    'peerCIDRs': ['10.244.0.0/16'], 'relayCIDRs': ['10.244.0.0/16'],
    'guestImages': ['registry.invalid/neko@sha256:' + 'a' * 64],
    'clientManifestSHA256': 'a' * 64, 'portMin': 30100, 'portMax': 30115,
    'maxLeases': 8,
}


@unittest.skipUnless(shutil.which('helm'), 'Helm required')
class NekoMediaChartTest(unittest.TestCase):
    def values(self):
        return {'global': {'nekoMedia': copy.deepcopy(MEDIA)},
                'platformWebhook': {'enabled': True, 'runtimeIsolation': {
                    'prepareBackend': True, 'vm': {'reconcileEnabled': True}}}}

    def render(self, values=None):
        with tempfile.TemporaryDirectory(prefix='coder-neko-chart-') as directory:
            path = pathlib.Path(directory) / 'values.yaml'
            path.write_text(yaml.safe_dump(values or {}))
            return subprocess.run(['helm', 'template', 'coder', str(CHART), '--namespace', 'coder', '-f', str(path)],
                                  capture_output=True, text=True)

    def documents(self, values=None):
        result = self.render(values)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [doc for doc in yaml.safe_load_all(result.stdout) if doc]

    def test_disabled_does_not_publish_udp_or_install_media_environment_or_keys(self):
        docs = self.documents()
        self.assertFalse(any(doc['kind'] == 'Service' and doc['metadata']['name'] == 'coder-neko-media' for doc in docs))
        for doc in docs:
            spec = doc.get('spec', {}).get('template', {}).get('spec', {})
            self.assertFalse(any(volume['name'] == 'neko-media-key' for volume in spec.get('volumes', [])))
            for container in spec.get('containers', []):
                self.assertFalse(any('NEKO_MEDIA' in env['name'] for env in container.get('env', [])))
                self.assertFalse(any(mount['name'] == 'neko-media-key' for mount in container.get('volumeMounts', [])))

    def test_valid_pool_has_exact_udp_ports_active_selector_and_private_secret_mounts(self):
        values = self.values()
        values['global']['platformHA'] = {'mode': 'activeStandby'}
        docs = self.documents(values)
        service = next(doc for doc in docs if doc['kind'] == 'Service' and doc['metadata']['name'] == 'coder-neko-media')
        spec = service['spec']
        self.assertEqual(spec['type'], 'NodePort')
        self.assertEqual(spec['externalTrafficPolicy'], 'Local')
        self.assertEqual(spec['selector'], {'app.kubernetes.io/instance': 'coder',
            'app.kubernetes.io/name': 'coder', 'coder-airgapped/ha-role': 'active'})
        self.assertEqual(spec['ports'], [{'name': 'media-' + str(port), 'port': port,
            'targetPort': port, 'nodePort': port, 'protocol': 'UDP'} for port in range(30100, 30116)])
        for name, mode in (('coder', 0o440), ('coder-ui-updates', 0o400)):
            deployment = next(doc for doc in docs if doc['kind'] == 'Deployment' and doc['metadata']['name'] == name)
            pod = deployment['spec']['template']['spec']
            volume = next(volume for volume in pod['volumes'] if volume['name'] == 'neko-media-key')
            self.assertEqual(volume['secret'], {'secretName': MEDIA['descriptorKeySecretName'], 'defaultMode': mode})
            container = pod['containers'][0]
            mount = next(mount for mount in container['volumeMounts'] if mount['name'] == 'neko-media-key')
            self.assertEqual(mount, {'name': 'neko-media-key', 'mountPath': '/run/coder-neko', 'readOnly': True})
            env = {item['name']: item for item in container['env']}
            if name == 'coder':
                config = json.loads(env['CODER_NEKO_MEDIA_CONFIG']['value'])
                self.assertEqual(config['port_min'], MEDIA['portMin'])
                self.assertEqual(config['port_max'], MEDIA['portMax'])
                self.assertEqual(config['client_manifest_sha256'], MEDIA['clientManifestSHA256'])
                self.assertEqual(config['descriptor_key_file'], '/run/coder-neko/descriptor-key')
                self.assertEqual(env['CODER_NEKO_MEDIA_BIND_IP']['valueFrom'], {'fieldRef': {'fieldPath': 'status.podIP'}})
            else:
                self.assertEqual(env['NEKO_MEDIA_ENABLED']['value'], 'true')
                self.assertEqual(json.loads(env['NEKO_MEDIA_GUEST_IMAGES']['value']), MEDIA['guestImages'])
                self.assertEqual(json.loads(env['NEKO_MEDIA_RELAY_CIDRS']['value']), MEDIA['relayCIDRs'])

    def test_load_balancer_keeps_client_source_ranges_and_local_routing(self):
        values = self.values()
        values['global']['nekoMedia']['service'] = {'type': 'LoadBalancer'}
        docs = self.documents(values)
        service = next(doc for doc in docs if doc['kind'] == 'Service' and doc['metadata']['name'] == 'coder-neko-media')
        self.assertEqual(service['spec']['loadBalancerSourceRanges'], MEDIA['clientCIDRs'])
        self.assertEqual(service['spec']['externalTrafficPolicy'], 'Local')

    def test_missing_key_hash_or_explicit_allowlist_rejects_enablement(self):
        for field, invalid in (('descriptorKeySecretName', ''), ('clientManifestSHA256', ''),
                ('clientManifestSHA256', 'not-a-digest'), ('advertiseIP', ''),
                ('clientCIDRs', []), ('peerCIDRs', []), ('relayCIDRs', []), ('guestImages', [])):
            with self.subTest(field=field, value=invalid):
                values = self.values()
                values['global']['nekoMedia'][field] = invalid
                self.assertNotEqual(self.render(values).returncode, 0)

    def test_vm_backend_and_platform_service_are_required(self):
        for field in ('enabled', 'prepareBackend', 'reconcileEnabled'):
            values = self.values()
            if field == 'enabled':
                values['platformWebhook'][field] = False
            elif field == 'prepareBackend':
                values['platformWebhook']['runtimeIsolation'][field] = False
            else:
                values['platformWebhook']['runtimeIsolation']['vm'][field] = False
            with self.subTest(field=field):
                self.assertNotEqual(self.render(values).returncode, 0)

    def test_pool_bounds_even_capacity_and_integer_values_are_enforced(self):
        invalid = [('portMin', 29999), ('portMax', 32768), ('portMax', 30114),
                   ('portMax', 30229), ('maxLeases', 9), ('maxLeases', 0),
                   ('portMin', 30100.5), ('portMax', 30115.5), ('maxLeases', 8.5),
                   ('portMin', '30100'), ('portMax', '30115'), ('maxLeases', '8')]
        for field, value in invalid:
            with self.subTest(field=field, value=value):
                values = self.values()
                values['global']['nekoMedia'][field] = value
                self.assertNotEqual(self.render(values).returncode, 0)

    def test_invalid_cidr_and_guest_image_allowlists_fail_before_deployment(self):
        for field, value in (('clientCIDRs', ['bad-cidr']), ('peerCIDRs', ['0.0.0.0/0']),
                ('relayCIDRs', ['10.244.1.3/16']), ('guestImages', ['registry.invalid/neko:latest'])):
            with self.subTest(field=field, value=value):
                values = self.values()
                values['global']['nekoMedia'][field] = value
                self.assertNotEqual(self.render(values).returncode, 0)
