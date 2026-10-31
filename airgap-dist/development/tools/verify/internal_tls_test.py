"""Internal certificate renewal retains trust and activates the new serving leaf."""
import base64
import importlib.util
import json
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'runtime' / 'internal-tls.py'
SPEC = importlib.util.spec_from_file_location('internal_tls', SOURCE)
tls = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tls)
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
from servicetls import TLSServer
import urllib.request


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'alive')

    def log_message(self, *_args):
        pass


class RenewalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        directory = Path(cls.directory.name)
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
                        '-subj', '/CN=Isolated test CA', '-addext', 'basicConstraints=critical,CA:TRUE',
                        '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', str(directory / 'ca.key'),
                        '-out', str(directory / 'ca.pem')], check=True, capture_output=True)
        cls.ca = (directory / 'ca.pem').read_bytes()
        cls.key = (directory / 'ca.key').read_bytes()

    def serve(self, cert, key, directory):
        Path(directory, 'tls.crt').write_bytes(cert)
        Path(directory, 'tls.key').write_bytes(key)
        server = TLSServer(('127.0.0.1', 0), Handler, certificate=str(Path(directory, 'tls.crt')),
                           key=str(Path(directory, 'tls.key')))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_port

    def test_near_expiry_and_hostname_change_renew_without_trust_rollover(self):
        old, old_key = tls.sign(self.ca, self.key, 'coder', ['localhost', 'old.example.test'], days=1)
        with self.assertRaises(RuntimeError):
            tls.check_certificate(old, ['localhost'], 30 * 86400)
        new, new_key = tls.sign(self.ca, self.key, 'coder', ['localhost', 'new.example.test'])
        tls.check_certificate(new, ['localhost', 'new.example.test'], 30 * 86400)
        with self.assertRaises(RuntimeError):
            tls.check_certificate(new, ['old.example.test'], 0)
        # Both old and replacement servers accept an unchanged client trust store.
        context = ssl.create_default_context(cadata=self.ca.decode())
        with tempfile.TemporaryDirectory() as old_dir, tempfile.TemporaryDirectory() as new_dir:
            for port in [self.serve(old, old_key, old_dir), self.serve(new, new_key, new_dir)]:
                with urllib.request.urlopen('https://localhost:%d/' % port, context=context, timeout=2) as response:
                    self.assertEqual(response.read(), b'alive')

    def test_replacement_uses_version_and_rollout_can_resume(self):
        data = {'ca.crt': base64.b64encode(self.ca).decode(), 'ca.key': base64.b64encode(self.key).decode()}
        leaf = {'metadata': {'name': 'coder-internal-tls', 'resourceVersion': '17'},
                'data': {'ca.crt': data['ca.crt']}}
        calls = []

        class Cluster(tls.Cluster):
            def get(self, kind, name):
                if kind == 'configmap':
                    return {'data': {'ca.crt': RenewalTest.ca.decode()}}
                return {'data': data} if name.endswith('-issuer') else leaf

            def run(self, args, *, data=None):
                calls.append((args, json.loads(data) if data else None))

        cluster = Cluster('test')
        cluster.renew('coder', 'coder.example.test')
        self.assertEqual(calls[0][0], ['replace', '-f', '-'])
        self.assertEqual(calls[0][1]['metadata']['resourceVersion'], '17')
        self.assertEqual(calls[-1][0], ['rollout', 'status', 'deployment/coder', '--timeout=300s'])
        calls.clear()
        cluster.activate('coder')
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0][0], 'patch')

    def test_invalid_hostname_and_expiring_issuer_are_rejected(self):
        with self.assertRaises(ValueError):
            tls.names('coder', 'test', 'localhost\nCA:TRUE')
        short, short_key = tls.sign(self.ca, self.key, 'coder', ['localhost'], days=1)
        with self.assertRaises(RuntimeError):
            tls.sign(short, short_key, 'coder', ['localhost'])


if __name__ == '__main__':
    unittest.main()
