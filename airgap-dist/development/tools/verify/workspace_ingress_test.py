"""Opt-in packet tests against the rendered workspace ingress policy in an isolated namespace."""
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

import yaml

ROOT = Path(__file__).resolve().parents[4]
CHART = ROOT / 'airgap-dist/helm-chart/coder-airgapped'

SERVER = '''
import http.server, socket, threading
def udp(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('0.0.0.0', port))
    while True:
        payload, peer = s.recvfrom(1024)
        s.sendto(payload, peer)
for port in (41641, 51871, 30590):
    threading.Thread(target=udp, args=(port,), daemon=True).start()
http.server.HTTPServer(('0.0.0.0', 8081), http.server.BaseHTTPRequestHandler).serve_forever()
'''
PROBE = '''
import socket, sys
kind, host, port = sys.argv[1:]
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM if kind == 'udp' else socket.SOCK_STREAM)
s.settimeout(1)
try:
    s.connect((host, int(port)))
    if kind == 'udp':
        s.send(b'isolated-policy-probe')
        assert s.recv(1024) == b'isolated-policy-probe'
except (OSError, AssertionError):
    sys.exit(1)
finally:
    s.close()
'''


def render(namespace):
    result = subprocess.run(['helm', 'template', 'ingress-test', str(CHART),
                             '--set', 'coder-workspace.namespace=' + namespace,
                             '--show-only', 'templates/workspace-network-policy.yaml'],
                            check=True, capture_output=True, text=True)
    return yaml.safe_load(result.stdout)


class PolicyPackagingTest(unittest.TestCase):
    def test_namespace_override_and_only_udp_ingress(self):
        policy = render('isolated-workspaces')
        self.assertEqual(policy['metadata']['namespace'], 'isolated-workspaces')
        self.assertTrue(all(port['protocol'] == 'UDP' for rule in policy['spec']['ingress'] for port in rule['ports']))


@unittest.skipUnless(os.environ.get('WORKSPACE_INGRESS_TEST_IMAGE'), 'Set WORKSPACE_INGRESS_TEST_IMAGE to a trusted Python image for disposable cluster tests')
class PacketIsolationTest(unittest.TestCase):
    def kubectl(self, *args, data=None, check=True):
        return subprocess.run(['kubectl', '-n', self.namespace, *args],
                              input=json.dumps(data) if data is not None else None,
                              text=True, capture_output=True, check=check, timeout=120)

    def apply(self, value):
        self.kubectl('apply', '-f', '-', data=value)

    def pod(self, name, labels, script):
        self.apply({'apiVersion': 'v1', 'kind': 'Pod',
                    'metadata': {'name': name, 'namespace': self.namespace, 'labels': labels},
                    'spec': {'automountServiceAccountToken': False, 'restartPolicy': 'Never',
                             'securityContext': {'runAsNonRoot': True, 'runAsUser': 65532},
                             'containers': [{'name': 'probe', 'image': os.environ['WORKSPACE_INGRESS_TEST_IMAGE'],
                                             'command': ['python3', '-c', script],
                                             'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
                                             'resources': {'limits': {'cpu': '250m', 'memory': '64Mi'}}}]}})
        self.kubectl('wait', '--for=condition=Ready', 'pod/' + name, '--timeout=90s')

    def test_existing_workspaces_deny_tcp_and_scope_media(self):
        self.namespace = 'coder-ingress-test-' + uuid.uuid4().hex[:8]
        self.kubectl('create', 'namespace', self.namespace)
        self.addCleanup(self.kubectl, 'delete', 'namespace', self.namespace, '--wait=false')
        labels = {'com.coder.workspace.id': 'workspace-one', 'com.coder.user.id': 'owner-one'}
        self.pod('server', labels, SERVER)
        self.pod('client', {'com.coder.workspace.id': 'workspace-two', 'com.coder.user.id': 'owner-two'},
                 'import threading; threading.Event().wait()')
        self.pod('turn', {'app.kubernetes.io/name': 'selected-turn'}, 'import threading; threading.Event().wait()')
        address = json.loads(self.kubectl('get', 'pod', 'server', '-o', 'json').stdout)['status']['podIP']

        def allowed(client, protocol, port):
            return self.kubectl('exec', client, '--', 'python3', '-c', PROBE,
                                protocol, address, str(port), check=False).returncode == 0

        self.assertTrue(allowed('client', 'tcp', 8081), 'Disposable listener must be reachable before isolation')
        self.apply(render(self.namespace))
        self.apply({'apiVersion': 'networking.k8s.io/v1', 'kind': 'NetworkPolicy',
                    'metadata': {'name': 'selected-browser-media', 'namespace': self.namespace},
                    'spec': {'podSelector': {'matchLabels': labels}, 'policyTypes': ['Ingress'],
                             'ingress': [{'from': [{'podSelector': {'matchLabels': {'app.kubernetes.io/name': 'selected-turn'}}}],
                                          'ports': [{'protocol': 'UDP', 'port': 30590}]}]}})
        # The first blocked connection also waits for asynchronous CNI rule installation.
        for _ in range(40):
            if not allowed('client', 'tcp', 8081):
                break
        else:
            self.fail('CNI did not block direct TCP ingress')
        self.assertFalse(allowed('turn', 'tcp', 8081))
        self.assertTrue(allowed('client', 'udp', 41641))
        self.assertTrue(allowed('client', 'udp', 51871))
        self.assertFalse(allowed('turn', 'udp', 51871))
        self.assertFalse(allowed('client', 'udp', 30590))
        self.assertTrue(allowed('turn', 'udp', 30590))


if __name__ == '__main__':
    unittest.main()
