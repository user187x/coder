"""Deployment contracts for persistent Keycloak and local login recovery."""
import base64
import importlib.util
import json
import pathlib
import subprocess
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('keycloak_deploy', pathlib.Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.objects = deploy.resources('example', 'database', 'identity.example.test', 'https://coder.example.test', 'keycloak@sha256:123', 'client-secret')

    def test_data_is_persistent_and_database_role_is_separate(self):
        database = next(item for item in self.objects if item['kind'] == 'Database')
        self.assertEqual(database['spec']['databaseReclaimPolicy'], 'retain')
        self.assertEqual(database['spec']['owner'], 'keycloak')
        pod = next(item for item in self.objects if item['kind'] == 'Deployment')['spec']['template']['spec']
        container = pod['containers'][0]
        self.assertEqual(container['args'], ['start', '--import-realm'])
        env = {item['name']: item for item in container['env']}
        self.assertEqual(env['KC_DB']['value'], 'postgres')
        self.assertIn('sslmode=verify-full', env['KC_DB_URL']['value'])
        self.assertIn('valueFrom', env['KC_DB_PASSWORD'])
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertFalse(container['securityContext']['allowPrivilegeEscalation'])

    def test_confidential_client_uses_exact_callback_and_disables_public_registration(self):
        realm = json.loads(next(item for item in self.objects if item['kind'] == 'Secret')['stringData']['coder-realm.json'])
        self.assertFalse(realm['registrationAllowed'])
        self.assertTrue(realm['bruteForceProtected'])
        client = realm['clients'][0]
        self.assertFalse(client['publicClient'])
        self.assertFalse(client['directAccessGrantsEnabled'])
        self.assertEqual(client['redirectUris'], ['https://coder.example.test/api/v2/users/oidc/callback'])
        service = next(item for item in self.objects if item['kind'] == 'Service')
        self.assertEqual([port['port'] for port in service['spec']['ports']], [8443])

    def test_native_tls_verifies_client_chain_without_trusting_proxy_headers(self):
        pod = next(item for item in self.objects if item['kind'] == 'Deployment')['spec']['template']['spec']
        container = pod['containers'][0]
        env = {item['name']: item.get('value') for item in container['env']}
        self.assertEqual(env['KC_HTTP_ENABLED'], 'false')
        self.assertNotIn('KC_PROXY_HEADERS', env)
        self.assertEqual(env['KC_HTTPS_CLIENT_AUTH'], 'request')
        self.assertEqual(env['KC_HTTPS_TRUST_STORE_FILE'], '/opt/keycloak/conf/client-auth/ca.crt')
        self.assertEqual(container['readinessProbe']['httpGet']['scheme'], 'HTTPS')
        gateway = next(item for item in self.objects if item['kind'] == 'Gateway')
        self.assertEqual(gateway['spec']['listeners'][0]['tls']['mode'], 'Passthrough')
        self.assertFalse(any(item['kind'] == 'HTTPRoute' for item in self.objects))
        policy = next(item for item in self.objects if item['kind'] == 'NetworkPolicy')
        self.assertEqual(policy['spec']['ingress'][0]['ports'], [{'protocol': 'TCP', 'port': 8443}])

    def test_reapply_preserves_credentials(self):
        result = subprocess.CompletedProcess([], 0, json.dumps({'data': {'password': base64.b64encode(b'existing').decode()}}))
        with mock.patch('subprocess.run', return_value=result), mock.patch.object(deploy, 'apply') as apply:
            self.assertEqual(deploy.secret(['kubectl'], 'example', 'identity', {'password': 'new'}), {'password': 'existing'})
            apply.assert_not_called()


if __name__ == '__main__':
    unittest.main()
