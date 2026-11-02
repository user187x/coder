"""Exercise certificate verification and plaintext rejection with real sockets."""
import os
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import patch

from servicetls import TLSServer, open_service


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://localhost/leak")
        else:
            self.send_response(200)
        self.end_headers()
        self.wfile.write(b"verified")

    def log_message(self, *_args):
        pass


class ServiceTLSTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.certificate = str(Path(cls.directory.name, "cert.pem"))
        cls.key = str(Path(cls.directory.name, "key.pem"))
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
            "-keyout", cls.key, "-out", cls.certificate,
        ], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        self.server = TLSServer(("127.0.0.1", 0), Handler, certificate=self.certificate, key=self.key)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = "https://localhost:%d" % self.server.server_port

    def test_requires_tls_for_network_listener_and_client(self):
        with self.assertRaises(ValueError):
            TLSServer(("0.0.0.0", 0), Handler)
        with self.assertRaises(ValueError):
            open_service("http://coder.namespace.svc/secret", timeout=2)
        with socket.create_connection(self.server.server_address, timeout=2) as client:
            client.sendall(b"GET / HTTP/1.0\r\n\r\n")
            try:
                response = client.recv(1024)
            except ConnectionResetError:
                response = b""
            self.assertNotIn(b"200", response)

    def test_verified_tls_succeeds_and_untrusted_certificate_fails(self):
        with patch.dict(os.environ, {"SERVICE_CA_FILE": self.certificate}):
            with open_service(self.url, timeout=2) as response:
                self.assertEqual(response.read(), b"verified")
        with patch.dict(os.environ, {"SERVICE_CA_FILE": ""}):
            with self.assertRaises(urllib.error.URLError) as error:
                open_service(self.url, timeout=2)
            self.assertIsInstance(error.exception.reason, ssl.SSLCertVerificationError)

    def test_hostname_verification_and_credential_redirect_protection(self):
        with patch.dict(os.environ, {"SERVICE_CA_FILE": self.certificate}):
            with self.assertRaises(urllib.error.URLError) as error:
                open_service(self.url.replace("localhost", "127.0.0.1"), timeout=2)
            self.assertIsInstance(error.exception.reason, ssl.SSLCertVerificationError)
            with self.assertRaises(urllib.error.HTTPError) as redirect:
                open_service(self.url + "/redirect", timeout=2)
            self.assertEqual(redirect.exception.code, 302)
            redirect.exception.close()

    def test_unfinished_handshake_does_not_block_other_clients(self):
        with socket.create_connection(self.server.server_address, timeout=2):
            with patch.dict(os.environ, {"SERVICE_CA_FILE": self.certificate}):
                with open_service(self.url, timeout=2) as response:
                    self.assertEqual(response.status, 200)

    def test_restore_authentication_failure_preserves_home(self):
        import workspacevolumes
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"SERVICE_CA_FILE": ""}):
            sentinel = Path(home, "keep.txt")
            sentinel.write_text("existing home data")
            with self.assertRaises(urllib.error.URLError):
                workspacevolumes.restore(home, self.url)
            self.assertEqual(sentinel.read_text(), "existing home data")
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {"SERVICE_CA_FILE": self.certificate}):
            sentinel = Path(home, "keep.txt")
            sentinel.write_text("existing home data")
            with self.assertRaises(urllib.error.HTTPError) as error:
                workspacevolumes.restore(home, self.url + "/redirect")
            error.exception.close()
            self.assertEqual(sentinel.read_text(), "existing home data")


if __name__ == "__main__":
    unittest.main()
