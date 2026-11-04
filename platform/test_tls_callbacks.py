"""Caller-level synthetic TLS checks. Uses only loopback and temporary files."""
import ast
import io
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tarfile
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler
from types import SimpleNamespace
from unittest.mock import Mock, patch

import servicetls
import workspacevolumes
import vmbackup
import imagebuilder
import securitydata

ROOT = Path(__file__).resolve().parent


def archive(files, mode):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode=mode) as tar:
        for name, value in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(value)
            member.mode = 0o600
            tar.addfile(member, io.BytesIO(value))
    return output.getvalue()


class HTTPHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError):
            # Failure probes deliberately close a verified connection mid-request.
            pass

    def handle_request(self):
        payload = b''
        if self.headers.get('Transfer-Encoding') == 'chunked':
            while True:
                size = int(self.rfile.readline().strip(), 16)
                if size == 0:
                    self.rfile.readline()
                    break
                payload += self.rfile.read(size)
                assert self.rfile.read(2) == b'\r\n'
        elif self.headers.get('Content-Length'):
            payload = self.rfile.read(int(self.headers['Content-Length']))
        self.server.requests.append((self.command, self.path, payload))
        status = 503 if self.path == '/failure' else 302 if self.path == '/redirect' else 200
        data = self.server.responses.get(self.path, b'{}')
        self.send_response(status)
        if status == 302:
            self.send_header('Location', self.server.url + '/should-not-follow')
        self.send_header('Content-Type', 'image/png' if self.path.startswith(('/pictures/', '/favicons/')) else 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    do_GET = do_HEAD = do_PUT = do_POST = handle_request

    def log_message(self, *_args):
        pass


class TLSCallbackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='coder-tls-callback-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.path = Path(cls.temp.name)
        cls.ca, cls.key = cls.path / 'cert.pem', cls.path / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', str(cls.key), '-out', str(cls.ca)], check=True, capture_output=True)
        cls.server = servicetls.TLSServer(('127.0.0.1', 0), HTTPHandler, certificate=str(cls.ca), key=str(cls.key))
        cls.addClassCleanup(cls.server.server_close)
        cls.server.url = f'https://localhost:{cls.server.server_port}'
        cls.server.requests = []
        cls.server.responses = {
            '/home': archive({'restored.txt': b'restored'}, 'w:gz'),
            '/context': archive({'Dockerfile': b'FROM scratch'}, 'w'),
            '/security': archive({'fips-rules.json': b'{"rules":[]}'}, 'w:gz'),
            '/pictures/probe.png': b'synthetic-picture',
            '/favicons/favicon-dark.png': b'synthetic-favicon',
        }
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.thread.join, 2)
        cls.addClassCleanup(cls.server.shutdown)

    def setUp(self):
        self.server.requests.clear()
        self.enterContext(patch.dict(os.environ, {
            'SERVICE_CA_FILE': str(self.ca), 'SERVICE_CA_PEM': '',
            'NO_PROXY': 'localhost,127.0.0.1', 'no_proxy': 'localhost,127.0.0.1',
        }))

    def url(self, path):
        return self.server.url + path

    def test_native_archive_upload_verified_tls(self):
        with tempfile.TemporaryDirectory() as source:
            Path(source, 'original.txt').write_text('backup')
            workspacevolumes.archive(source, self.url('/upload'))
            with tarfile.open(fileobj=io.BytesIO(self.server.requests[-1][2]), mode='r:gz') as tar:
                with tar.extractfile('./original.txt') as original:
                    self.assertEqual(original.read(), b'backup')

    def test_native_archive_verifies_tls_before_starting_tar(self):
        with patch.dict(os.environ, {'SERVICE_CA_FILE': ''}), patch.object(workspacevolumes.subprocess, 'Popen') as spawn:
            with self.assertRaises(ssl.SSLCertVerificationError):
                workspacevolumes.archive(str(self.path), self.url('/upload'))
            spawn.assert_not_called()
        self.assertEqual(self.server.requests, [])

    def test_native_archive_reaps_child_when_upload_fails(self):
        connection = servicetls.service_connection(self.url('/upload'), timeout=2)
        self.addCleanup(connection.close)
        process = Mock(stdout=io.BytesIO(b'synthetic tar output'))
        process.poll.return_value = None
        process.wait.return_value = -9
        with patch.object(workspacevolumes, 'service_connection', return_value=connection), \
                patch.object(workspacevolumes.subprocess, 'Popen', return_value=process) as spawn, \
                patch.object(connection, 'request', side_effect=BrokenPipeError('interrupted upload')):
            with self.assertRaises(BrokenPipeError):
                workspacevolumes.archive(str(self.path), self.url('/upload'))
        spawn.assert_called_once()
        process.kill.assert_called_once()
        process.wait.assert_called_once()
        self.assertTrue(process.stdout.closed)
        self.assertIsNone(connection.sock)

    def test_native_restore_tls_success_and_prebody_failures(self):
        for path, trusted, hostname in [('/home', False, True), ('/home', True, False), ('/failure', True, True), ('/redirect', True, True)]:
            with self.subTest(path=path, trusted=trusted, hostname=hostname), tempfile.TemporaryDirectory() as dest, patch.dict(os.environ, {'SERVICE_CA_FILE': str(self.ca) if trusted else ''}):
                sentinel = Path(dest, 'keep.txt')
                sentinel.write_text('keep')
                url = self.url(path) if hostname else self.url(path).replace('localhost', '127.0.0.1')
                with self.assertRaises(urllib.error.URLError) as error:
                    workspacevolumes.restore(dest, url)
                if isinstance(error.exception, urllib.error.HTTPError):
                    error.exception.close()
                self.assertEqual(sentinel.read_text(), 'keep')
        with tempfile.TemporaryDirectory() as dest:
            Path(dest, 'keep.txt').write_text('old')
            workspacevolumes.restore(dest, self.url('/home'))
            self.assertEqual(Path(dest, 'restored.txt').read_bytes(), b'restored')
            self.assertFalse(Path(dest, 'keep.txt').exists())

    def test_vm_upload_and_download_verified_tls(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'backup.tar.gz')
            path.write_bytes(self.server.responses['/home'])
            vmbackup.upload_archive(path, self.url('/vm-upload'))
            self.assertEqual(self.server.requests[-1][2], path.read_bytes())
            target = Path(directory, 'download.tar.gz')
            vmbackup.download_archive(self.url('/home'), target, 1024)
            self.assertEqual(target.read_bytes(), path.read_bytes())
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with patch.dict(os.environ, {'SERVICE_CA_FILE': ''}):
                with self.assertRaises(ssl.SSLCertVerificationError):
                    vmbackup.upload_archive(path, self.url('/vm-upload'))
                with self.assertRaises(urllib.error.URLError):
                    vmbackup.download_archive(self.url('/home'), Path(directory, 'denied'), 1024)
            self.assertFalse(Path(directory, 'denied').exists())

    def test_vm_cross_namespace_embedded_ca(self):
        job = vmbackup.job_body({'node': 'synthetic-node', 'request': {'workspace_id': 'synthetic-workspace', 'organization_id': 'synthetic-organization'}}, 'backup', self.url('/upload'))
        env = {entry['name']: entry.get('value') for entry in job['spec']['template']['spec']['containers'][0]['env']}
        self.assertEqual(env['SERVICE_CA_PEM'], self.ca.read_text())
        self.assertNotIn('PRIVATE KEY', json.dumps(job))
        with patch.dict(os.environ, {'SERVICE_CA_FILE': '', 'SERVICE_CA_PEM': env['SERVICE_CA_PEM']}), tempfile.TemporaryDirectory() as directory:
            target = Path(directory, 'archive')
            vmbackup.download_archive(self.url('/home'), target, 1024)
            self.assertEqual(target.read_bytes(), self.server.responses['/home'])

    def test_builder_callbacks_and_init_ca(self):
        with tempfile.TemporaryDirectory() as directory:
            imagebuilder.fetch_context(self.url('/context'), directory)
            self.assertEqual(Path(directory, 'Dockerfile').read_bytes(), b'FROM scratch')
            securitydata.fetch(self.url('/security'), directory)
            self.assertEqual(Path(directory, 'fips-rules.json').read_bytes(), b'{"rules":[]}')
        imagebuilder._post_to(self.url('/report'))({'synthetic': 'report'})
        self.assertEqual(json.loads(self.server.requests[-1][2]), {'synthetic': 'report'})
        for callback in [lambda url: imagebuilder._post_to(url)({}), lambda url: imagebuilder.fetch_context(url, str(self.path / 'rejected')), lambda url: securitydata.fetch(url, str(self.path / 'rejected'))]:
            with self.subTest(callback=callback), patch.dict(os.environ, {'SERVICE_CA_FILE': ''}):
                with self.assertRaises(urllib.error.URLError):
                    callback(self.url('/context'))
        spec = {'containers': [{'name': 'scan', 'image': imagebuilder.TOOLS_IMAGE}], 'initContainers': [{'name': 'fetch', 'image': imagebuilder.TOOLS_IMAGE}], 'volumes': []}
        imagebuilder.add_service_ca(spec)
        for container in spec['containers'] + spec['initContainers']:
            self.assertIn({'name': 'SERVICE_CA_FILE', 'value': '/run/service-ca/ca.crt'}, container['env'])
            self.assertEqual(container['volumeMounts'][0]['readOnly'], True)
        self.assertNotIn('secret', json.dumps(spec))
        native = workspacevolumes.job_body('test', 1, [{'name': 'backup', 'image': imagebuilder.TOOLS_IMAGE}], [])
        self.assertEqual(native['spec']['template']['spec']['volumes'][0]['configMap']['name'], 'coder-ui-updates-internal-tls')

    def test_actual_picture_favicon_and_default_json_callers(self):
        # Importing the service initializes deployment stores; compile its real
        # HTTP callers without starting those unrelated services.
        tree = ast.parse((ROOT / 'ui-service.py').read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('http_json', 'parse_background_picture')]
        constants = [node for node in tree.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id in
                             ('BG_PICTURE_REF', 'BG_PICTURE_RE', 'BG_STORE_PICTURE_RE') for target in node.targets)]
        handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
        favicon = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'favicon')
        functions.append(favicon)
        ctx = ssl.create_default_context(cafile=str(self.ca))
        cache = Mock()
        cache.get.return_value = None
        namespace = {'ssl': ssl, 're': re, 'json': json, 'urllib': urllib, 'TLS': ctx,
                     'CODER_URL': self.server.url, 'LOGOS': None, 'FAVICONS': cache,
                     'STORE': SimpleNamespace(get_setting=lambda name, default: default)}
        exec(compile(ast.Module(body=constants + functions, type_ignores=[]), str(ROOT / 'ui-service.py'), 'exec'), namespace)
        self.assertEqual(namespace['http_json'](self.url('/json')), (200, {}))
        self.assertEqual(namespace['parse_background_picture']('/pictures/probe.png')[1], b'/pictures/probe.png\n17')
        fake = SimpleNamespace(send=Mock())
        namespace['favicon'](fake, 'favicon-dark.png')
        self.assertEqual(fake.send.call_args.args[:2], (200, b'synthetic-favicon'))
        namespace['TLS'] = ssl.create_default_context()
        with self.assertRaises(urllib.error.URLError):
            namespace['http_json'](self.url('/json'))
        with self.assertRaises(ValueError):
            namespace['parse_background_picture']('/pictures/probe.png')
        namespace['favicon'](fake, 'favicon-dark.png')
        self.assertEqual(fake.send.call_args.args[0], 502)

    def test_copa_plan_and_result_callbacks(self):
        # Exercise Copa's HTTP closure without invoking Trivy or BuildKit.
        tree = ast.parse((ROOT / 'imagebuilder.py').read_text())
        copa = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'copa')
        callback = next(node for node in copa.body if isinstance(node, ast.FunctionDef) and node.name == 'call')
        namespace = {'urllib': urllib, 'json': json, 'open_service': servicetls.open_service, 'url': self.url('/copa')}
        exec(compile(ast.Module(body=[callback], type_ignores=[]), str(ROOT / 'imagebuilder.py'), 'exec'), namespace)
        self.assertEqual(namespace['call']('GET'), {})
        self.assertEqual(namespace['call']('POST', '/result', {'exit': 0}), {})
        self.assertEqual(self.server.requests[-1], ('POST', '/copa/result', b'{"exit": 0}'))
        with patch.dict(os.environ, {'SERVICE_CA_FILE': ''}):
            with self.assertRaises(urllib.error.URLError):
                namespace['call']('GET')

    def test_uploads_and_reports_reject_redirects_and_wrong_hostnames(self):
        for path in ('/redirect', '/failure'):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                source = Path(directory, 'source')
                source.write_bytes(b'synthetic')
                with self.assertRaises(RuntimeError):
                    vmbackup.upload_archive(source, self.url(path))
                with self.assertRaises(urllib.error.HTTPError) as error:
                    imagebuilder._post_to(self.url(path))({'synthetic': True})
                error.exception.close()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, 'source')
            source.write_bytes(b'synthetic')
            with self.assertRaises(ssl.SSLCertVerificationError):
                vmbackup.upload_archive(source, self.url('/upload').replace('localhost', '127.0.0.1'))
        self.assertFalse(any(path == '/should-not-follow' for _, path, _ in self.server.requests))


if __name__ == '__main__':
    unittest.main(verbosity=2)
