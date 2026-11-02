"""Allocation revocation against the pinned relay, plus fail-closed policy checks."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest import mock

import relaywatchdog


class EnforcementTest(unittest.TestCase):
    def test_cancels_revoked_expired_and_unknown_allocations(self):
        valid = str(uuid.uuid4()) + ':2000:' + str(uuid.uuid4())
        expired = valid.replace(':2000:', ':999:')
        revoked = str(uuid.uuid4()) + ':2000:' + str(uuid.uuid4())
        cli = mock.Mock()
        cli.sessions.side_effect = [{'1': valid, '2': expired, '3': revoked, '4': 'unknown'}, {'1': valid}]
        relaywatchdog.enforce(cli, {valid, expired}, now=1000)
        self.assertEqual({call.args[0] for call in cli.command.call_args_list}, {'cs 2', 'cs 3', 'cs 4'})

    def test_unconfirmed_cancellation_does_not_renew_lease(self):
        cli = mock.Mock()
        cli.sessions.return_value = {'000000000000000001': 'revoked'}
        with tempfile.TemporaryDirectory() as directory:
            lease = Path(directory, 'lease')
            lease.write_text('existing lease')
            with mock.patch.object(relaywatchdog, 'policy', return_value=set()), \
                 mock.patch.object(relaywatchdog, 'RelayCLI', return_value=cli):
                with self.assertRaisesRegex(RuntimeError, 'cancellation'):
                    relaywatchdog.check_once('https://service/policy', 'password', 'secret', lease)
            self.assertFalse(lease.exists())
            cli.close.assert_called_once()

    def test_unavailable_policy_removes_lease_without_connecting(self):
        with tempfile.TemporaryDirectory() as directory:
            lease = Path(directory, 'lease')
            lease.write_text('existing lease')
            with mock.patch.object(relaywatchdog, 'policy', side_effect=ConnectionError), \
                 mock.patch.object(relaywatchdog, 'RelayCLI') as cli:
                with self.assertRaises(ConnectionError):
                    relaywatchdog.check_once('https://service/policy', 'password', 'secret', lease)
            self.assertFalse(lease.exists())
            cli.assert_not_called()

    def test_truncated_session_inventory_is_rejected(self):
        cli = relaywatchdog.RelayCLI.__new__(relaywatchdog.RelayCLI)
        cli.command = mock.Mock(return_value='    1) id=000000000000000001, user <one>:\r\nTotal sessions: 2\r\n> ')
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            cli.sessions()


def attribute(kind, value):
    return struct.pack('!HH', kind, len(value)) + value + b'\0' * (-len(value) % 4)


class Allocation:
    """Minimal authenticated STUN client; all traffic stays on the test loopback ports."""
    def __init__(self, port, certificate, username, secret):
        context = ssl.create_default_context(cafile=certificate)
        self.socket = context.wrap_socket(socket.create_connection(('127.0.0.1', port), timeout=3),
                                          server_hostname='localhost')
        self.username = username.encode()
        self.password = base64.b64encode(hmac.new(secret.encode(), self.username, hashlib.sha1).digest())
        try:
            kind, attrs = self.request(3, [(0x19, b'\x11\0\0\0')])
            if kind != 0x113 or 0x14 not in attrs or 0x15 not in attrs:
                raise AssertionError('Expected TURN authentication challenge')
            self.realm, self.nonce = attrs[0x14], attrs[0x15]
            self.key = hashlib.md5(self.username + b':' + self.realm + b':' + self.password).digest()
            kind, _ = self.request(3, [(0x19, b'\x11\0\0\0')], authenticated=True)
            if kind != 0x103:
                raise AssertionError('TURN allocation was rejected: %x' % kind)
        except Exception:
            self.close()
            raise

    def close(self):
        self.socket.close()

    def read(self, count):
        result = b''
        while len(result) < count:
            part = self.socket.recv(count - len(result))
            if not part:
                raise ConnectionError('TURN allocation closed')
            result += part
        return result

    def request(self, kind, attributes, authenticated=False):
        transaction = secrets.token_bytes(12)
        payload = b''.join(attribute(k, v) for k, v in attributes)
        if authenticated:
            payload += attribute(6, self.username) + attribute(0x14, self.realm) + attribute(0x15, self.nonce)
        header = struct.pack('!HHI', kind, len(payload) + (24 if authenticated else 0), 0x2112A442) + transaction
        if authenticated:
            payload += attribute(8, hmac.new(self.key, header + payload, hashlib.sha1).digest())
        self.socket.sendall(header + payload)
        header = self.read(20)
        response_kind, length, cookie = struct.unpack('!HHI', header[:8])
        if cookie != 0x2112A442 or header[8:] != transaction:
            raise AssertionError('Unexpected TURN transaction')
        payload, result, offset = self.read(length), {}, 0
        while offset < length:
            attr_kind, size = struct.unpack('!HH', payload[offset:offset + 4])
            result[attr_kind] = payload[offset + 4:offset + 4 + size]
            offset += 4 + size + (-size % 4)
        return response_kind, result

    def refresh(self):
        kind, _ = self.request(4, [(0x0d, struct.pack('!I', 600))], authenticated=True)
        if kind != 0x104:
            raise AssertionError('TURN refresh rejected: %x' % kind)


@unittest.skipUnless(os.environ.get('RUN_TURN_TESTS') == '1', 'Set RUN_TURN_TESTS=1 for the isolated Docker relay')
class LiveRelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        directory = Path(cls.directory.name)
        directory.chmod(0o755)
        cls.certificate = str(directory / 'cert.pem')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                        '-keyout', str(directory / 'key.pem'), '-out', cls.certificate],
                       check=True, capture_output=True)
        (directory / 'key.pem').chmod(0o644)
        cls.password, cls.secret = secrets.token_hex(24), secrets.token_hex(24)
        (directory / 'turnserver.conf').write_text('\n'.join([
            'listening-ip=0.0.0.0', 'relay-ip=127.0.0.1', 'tls-listening-port=5349',
            'no-udp', 'no-tcp', 'no-dtls', 'no-tlsv1', 'no-tlsv1_1', 'no-tcp-relay',
            'use-auth-secret', 'static-auth-secret=' + cls.secret, 'realm=isolated.test', 'user-quota=2',
            'cert=/test/cert.pem', 'pkey=/test/key.pem', 'allow-loopback-peers',
            'cli', 'cli-ip=0.0.0.0', 'cli-port=5766', 'cli-password=' + cls.password,
            'cli-max-output-sessions=256', 'relay-threads=1', 'min-port=49200', 'max-port=49209',
            'log-file=stdout', 'no-stdout-log', 'pidfile=/tmp/turn.pid',
        ]) + '\n')
        cls.name = 'coder-relay-test-' + uuid.uuid4().hex[:12]
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', cls.name], capture_output=True))
        image = 'coturn/coturn:4.17.1-r0@sha256:ed84c3109f3f0a57ccc829ae9413f70b95fc0452322efb9279db308717138280'
        subprocess.run(['docker', 'run', '--detach', '--rm', '--name', cls.name,
                        '--publish', '127.0.0.1::5349', '--publish', '127.0.0.1::5766',
                        '--volume', str(directory) + ':/test:ro', image, '-c', '/test/turnserver.conf'],
                       check=True, capture_output=True)
        inspected = json.loads(subprocess.check_output(['docker', 'inspect', cls.name]))[0]
        ports = inspected['NetworkSettings']['Ports']
        cls.port = int(ports['5349/tcp'][0]['HostPort'])
        cls.cli_port = int(ports['5766/tcp'][0]['HostPort'])
        deadline = time.monotonic() + 10
        # Poll readiness, rather than guessing a container startup delay.
        while True:
            try:
                cli = relaywatchdog.RelayCLI(cls.password, cls.cli_port)
                cli.sessions()
                cli.close()
                break
            except (OSError, ValueError):
                if time.monotonic() >= deadline:
                    raise
                threading.Event().wait(0.05)

    def allocate(self, user=None):
        username = (user or str(uuid.uuid4())) + ':' + str(int(time.time()) + 60) + ':' + str(uuid.uuid4())
        allocation = Allocation(self.port, self.certificate, username, self.secret)
        self.addCleanup(allocation.close)
        return username, allocation

    def cli(self):
        cli = relaywatchdog.RelayCLI(self.password, self.cli_port)
        self.addCleanup(cli.close)
        return cli

    def test_revocation_closes_live_allocation_and_preserves_authorized_peer(self):
        first, allocation = self.allocate()
        second, other = self.allocate()
        cli = self.cli()
        relaywatchdog.enforce(cli, {first, second})
        allocation.refresh()
        other.refresh()
        relaywatchdog.enforce(cli, {second})
        self.assertNotIn(first, cli.sessions().values())
        with self.assertRaises((ConnectionError, OSError)):
            allocation.refresh()
        other.refresh()

    def test_expired_allocation_is_cancelled_even_if_still_in_policy(self):
        username, allocation = self.allocate()
        cli = self.cli()
        relaywatchdog.enforce(cli, {username}, now=int(username.split(':')[1]) + 1)
        self.assertNotIn(username, cli.sessions().values())
        with self.assertRaises((ConnectionError, OSError)):
            allocation.refresh()

    def test_session_credentials_share_the_users_allocation_quota(self):
        user = str(uuid.uuid4())
        _, first = self.allocate(user)
        _, second = self.allocate(user)
        first.refresh()
        second.refresh()
        with self.assertRaisesRegex(AssertionError, 'allocation was rejected'):
            self.allocate(user)
        # A different user can still allocate and use their own capacity.
        _, other = self.allocate()
        other.refresh()


if __name__ == '__main__':
    unittest.main()
