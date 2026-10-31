"""Revoke support TURN allocations and expire the relay's liveness lease on failure."""
import json
import os
import re
import socket
import time
import urllib.request
from pathlib import Path

from servicetls import open_service

SESSION = re.compile(r'^\s+\d+\) id=(\d{18}), user <([^>\r\n]*)>:\s*$', re.M)
TOTAL = re.compile(r'^\s*Total sessions: (\d+)\s*$', re.M)
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
USERNAME = re.compile(r'^' + UUID + r':[0-9]+:' + UUID + r'$')
LEASE = Path('/run/relay-watchdog/lease')


class RelayCLI:
    """Bounded loopback Telnet client for the pinned coturn management protocol."""
    def __init__(self, password, port=5766):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=1)
        self.deadline = time.monotonic() + 3
        try:
            self.read_until(b'Enter password: ')
            self.socket.sendall(password.encode() + b'\r\n')
            self.read_until(b'> ')
        except Exception:
            self.close()
            raise

    def close(self):
        self.socket.close()

    def read_until(self, ending):
        output = bytearray()
        while not output.endswith(ending):
            remaining = self.deadline - time.monotonic()
            if remaining <= 0 or len(output) > 512 * 1024:
                raise TimeoutError('Incomplete relay management response')
            self.socket.settimeout(min(1, remaining))
            byte = self.socket.recv(1)
            if not byte:
                raise ConnectionError('Relay management connection closed')
            if byte == b'\xff':
                # Decline Telnet option negotiation; this interface needs only text.
                command = self.socket.recv(1)
                if command == b'\xff':
                    output += command
                elif command in (b'\xfb', b'\xfc', b'\xfd', b'\xfe'):
                    option = self.socket.recv(1)
                    if not option:
                        raise ConnectionError('Incomplete Telnet option')
                    if command in (b'\xfb', b'\xfd'):
                        self.socket.sendall(b'\xff' + (b'\xfe' if command == b'\xfb' else b'\xfc') + option)
                else:
                    raise ValueError('Unexpected relay management negotiation')
            else:
                output += byte
        return output.decode('utf-8', errors='strict')

    def command(self, text):
        self.socket.sendall(text.encode() + b'\r\n')
        return self.read_until(b'> ')

    def sessions(self):
        text = self.command('ps')
        matches = SESSION.findall(text)
        total = TOTAL.findall(text)
        if len(total) != 1 or int(total[0]) != len(matches) or len(matches) > 256:
            raise ValueError('Incomplete relay session inventory')
        if len({sid for sid, _ in matches}) != len(matches):
            raise ValueError('Duplicate relay session')
        return dict(matches)


def enforce(cli, allowed, now=None):
    """Cancel every unauthorized allocation and confirm its removal before renewing."""
    now = time.time() if now is None else now
    sessions = cli.sessions()
    rejected = {sid for sid, username in sessions.items() if not (
        USERNAME.fullmatch(username) and username in allowed and int(username.split(':')[1]) > now
    )}
    for sid in rejected:
        cli.command('cs ' + sid)
    # Cancellation is queued to coturn's relay threads. A pending cancellation must
    # not renew the lease; the next bounded poll can confirm it or restart the relay.
    if rejected.intersection(cli.sessions()):
        raise RuntimeError('Relay cancellation has not completed')


def policy(url, secret):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + secret})
    with open_service(request, timeout=2) as response:
        body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise ValueError('Relay policy response too large')
    allowed = json.loads(body)['allowed']
    if not isinstance(allowed, list) or not all(isinstance(x, str) and USERNAME.fullmatch(x) for x in allowed):
        raise ValueError('Invalid relay policy')
    return set(allowed)


def check_once(url, password, secret, lease=LEASE, port=5766):
    """Renew readiness only after fresh policy and verified allocation cleanup."""
    cli = None
    started = time.monotonic()
    try:
        allowed = policy(url, secret)
        cli = RelayCLI(password, port)
        enforce(cli, allowed)
        if time.monotonic() - started > 5:
            raise TimeoutError('Relay policy expired during enforcement')
        temporary = lease.with_suffix('.new')
        temporary.write_text(str(int(time.time()) + 6))
        temporary.replace(lease)
    except Exception:
        lease.unlink(missing_ok=True)
        raise
    finally:
        if cli:
            cli.close()


def run():
    url = os.environ['RELAY_POLICY_URL']
    password = Path('/run/relay-secrets/cli-password').read_text().strip()
    secret = Path('/run/relay-secrets/control-secret').read_text().strip()
    if min(len(password), len(secret)) < 32:
        raise ValueError('Relay management secrets are invalid')
    while True:
        try:
            check_once(url, password, secret)
        except Exception as error:
            # Do not include remote response data or credentials in logs.
            print('Support relay authorization unavailable: ' + type(error).__name__, flush=True)
        time.sleep(2)


if __name__ == '__main__':
    run()
