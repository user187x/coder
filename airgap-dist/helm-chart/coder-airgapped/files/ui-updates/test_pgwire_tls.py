"""Database TLS verification must survive absent or invalid custom trust files."""
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import pgwire


class DatabaseTLSTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        cls.ca = str(Path(directory.name, 'ca.pem'))
        key = str(Path(directory.name, 'key.pem'))
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '1', '-subj', '/CN=localhost', '-addext',
                        'subjectAltName=DNS:localhost', '-keyout', key, '-out', cls.ca],
                       check=True, capture_output=True)
        cls.server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.server_context.load_cert_chain(cls.ca, key)

    def connection(self, mode, reply=b'S'):
        client, server = socket.socketpair()
        client.settimeout(2)
        server.settimeout(2)

        def serve():
            with server:
                try:
                    request = server.recv(8)
                    if request != struct.pack('!II', 8, 80877103):
                        return
                    server.sendall(reply)
                    if reply == b'S':
                        with self.server_context.wrap_socket(server, server_side=True) as secured:
                            secured.recv(1)
                except (OSError, ssl.SSLError):
                    pass

        worker = threading.Thread(target=serve)
        worker.start()
        connection = pgwire.Connection.__new__(pgwire.Connection)
        connection.sock, connection.buf, connection.sslmode = client, b'', mode
        self.addCleanup(worker.join, 3)
        self.addCleanup(lambda: connection.sock.close())
        return connection

    def test_verified_certificate_and_hostname(self):
        connection = self.connection('verify-full')
        connection._tls('localhost', self.ca)
        self.assertIsInstance(connection.sock, ssl.SSLSocket)
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.connection('verify-full')._tls('wrong.example.test', self.ca)

    def test_verification_without_custom_ca_rejects_unknown_issuer(self):
        for mode in ('verify-ca', 'verify-full'):
            with self.subTest(mode=mode), self.assertRaises(ssl.SSLCertVerificationError):
                self.connection(mode)._tls('localhost', None)

    def test_missing_custom_ca_never_downgrades(self):
        for mode in ('require', 'verify-ca', 'verify-full'):
            with self.subTest(mode=mode), self.assertRaises(FileNotFoundError):
                self.connection(mode)._tls('localhost', self.ca + '.missing')

    def test_verify_ca_checks_issuer_without_hostname(self):
        connection = self.connection('verify-ca')
        connection._tls('wrong.example.test', self.ca)
        self.assertIsInstance(connection.sock, ssl.SSLSocket)

    def test_required_tls_and_invalid_response_fail_closed(self):
        for mode in ('require', 'verify-ca', 'verify-full'):
            with self.subTest(mode=mode), self.assertRaises(ConnectionError):
                self.connection(mode, b'N')._tls('localhost', self.ca)
        with self.assertRaisesRegex(ConnectionError, 'invalid'):
            self.connection('prefer', b'X')._tls('localhost', None)

    def test_invalid_mode_and_failed_connection_cleanup(self):
        with mock.patch.object(pgwire.socket, 'create_connection') as connect:
            with self.assertRaisesRegex(ValueError, 'sslmode'):
                pgwire.Connection('postgresql://localhost/test?sslmode=verfy-full')
            connect.assert_not_called()
            with mock.patch.object(pgwire.Connection, '_tls', side_effect=FileNotFoundError):
                with self.assertRaises(FileNotFoundError):
                    pgwire.Connection('postgresql://localhost/test?sslmode=verify-full')
            connect.return_value.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
