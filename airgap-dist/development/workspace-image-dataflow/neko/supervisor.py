#!/usr/bin/env python3
"""Watch Root's public media intent and own only the isolated Neko process stack."""
import fcntl
import ipaddress
import json
import os
import pathlib
import signal
import stat
import subprocess
import sys
import time

CONFIG = pathlib.Path('/etc/platform/neko.json')
STATE = pathlib.Path('/tmp/coder-neko-' + str(os.getuid()))
SHARE = pathlib.Path('/usr/local/share/coder-neko')


def read_config(path=CONFIG):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
                return None
            raw = stream.read(4097)
        if len(raw) > 4096:
            return None
        value = json.loads(raw)
        required = {'enabled', 'http_port', 'udp_port'}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - {'advertised_ip'}:
            return None
        if type(value['enabled']) is not bool or type(value['http_port']) is not int or type(value['udp_port']) is not int or value['http_port'] != 9080 or value['udp_port'] != 59000:
            return None
        if not value['enabled']:
            return None
        address = ipaddress.IPv4Address(value['advertised_ip'])
        if str(address) != value['advertised_ip'] or address.is_unspecified or address.is_multicast or address.is_link_local or str(address) == '255.255.255.255':
            return None
        return {'enabled': True, 'advertised_ip': str(address)}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Neko state directory is not private')


class Stack:
    def __init__(self):
        self.children = []
        self.logs = []

    def spawn(self, name, command, env):
        log = (STATE / (name + '.log')).open('ab')
        self.logs.append(log)
        child = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(child)

    def stop(self):
        for child in reversed(self.children):
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 3
        for child in reversed(self.children):
            try:
                child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=3)
        self.children.clear()
        for log in self.logs:
            log.close()
        self.logs.clear()

    def trim_logs(self):
        for log in self.logs:
            if os.fstat(log.fileno()).st_size > 1048576:
                os.ftruncate(log.fileno(), 0)
        path = STATE / 'xorg-native.log'
        if path.exists() and path.stat().st_size > 1048576:
            with path.open('w'):
                pass

    def ready(self, command, env, expected):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if read_config() != expected or any(child.poll() is not None for child in self.children):
                raise RuntimeError('Neko startup was canceled or a child stopped')
            try:
                if subprocess.run(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2).returncode == 0:
                    return
            except subprocess.TimeoutExpired:
                pass
            time.sleep(0.2)
        raise RuntimeError('Neko child readiness timed out')

    def start(self, config):
        private_directory(STATE / 'runtime')
        private_directory(STATE / 'pulse')
        env = {key: value for key, value in os.environ.items() if not key.startswith('NEKO_') and key != 'DBUS_SESSION_BUS_ADDRESS'}
        env.update(DISPLAY=':3', XAUTHORITY=str(STATE / 'Xauthority'), XDG_RUNTIME_DIR=str(STATE / 'runtime'),
                   PULSE_RUNTIME_PATH=str(STATE / 'pulse'), PULSE_STATE_PATH=str(STATE / 'pulse'), PULSE_SERVER='unix:' + str(STATE / 'pulse.sock'))
        authority = pathlib.Path(env['XAUTHORITY'])
        authority.touch(mode=0o600, exist_ok=True)
        cookie = subprocess.check_output(['mcookie'], text=True).strip()
        subprocess.run(['xauth', '-f', str(authority), 'add', ':3', 'MIT-MAGIC-COOKIE-1', cookie], check=True)
        xorg = (SHARE / 'xorg.conf').read_text().replace('/tmp/xf86-input-neko.sock', str(STATE / 'input.sock'))
        (STATE / 'xorg.conf').write_text(xorg)
        self.spawn('xorg', ['/usr/lib/xorg/Xorg', ':3', '-config', str(STATE / 'xorg.conf'), '-auth', str(authority), '-noreset', '-nolisten', 'tcp', '-logfile', str(STATE / 'xorg-native.log')], env)
        self.ready(['xdpyinfo', '-display', ':3'], env, config)
        self.spawn('pulse', ['pulseaudio', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--disallow-exit', '--disallow-module-loading', '-nF', str(SHARE / 'default.pa'), '--load=module-native-protocol-unix socket=' + str(STATE / 'pulse.sock') + ' auth-anonymous=1'], env)
        self.ready(['pactl', 'info'], env, config)
        self.spawn('window-manager', ['dbus-run-session', '--', 'xfwm4', '--compositor=off', '--sm-client-disable'], env)
        self.spawn('browser', ['chromium', '--start-maximized', '--user-data-dir=' + str(pathlib.Path.home() / '.config/chromium-panel')], env)
        # v3.1.6 adds public STUN defaults for empty modern ICE lists. The explicit
        # legacy override clears both lists after defaults, matching our pinned protocol.
        self.spawn('server', ['neko', 'serve', '--legacy', '--server.bind', '127.0.0.1:9080', '--server.static', '', '--server.proxy', '--server.metrics=false',
            '--desktop.display', ':3', '--desktop.screen', '1280x720@30', '--desktop.input.enabled', '--desktop.input.socket', str(STATE / 'input.sock'),
            '--desktop.upload_drop=false', '--desktop.file_chooser_dialog=false', '--member.provider', 'noauth',
            '--iceservers', '[]', '--webrtc.icelite', '--webrtc.udpmux', '59000', '--webrtc.tcpmux', '0', '--webrtc.epr', '', '--webrtc.iceservers.frontend', '[]', '--webrtc.iceservers.backend', '[]',
            '--webrtc.ip_retrieval_url', '', '--webrtc.nat1to1', config['advertised_ip'], '--capture.audio.device', 'audio_output.monitor', '--capture.video.codec', 'vp8', '--capture.broadcast.autostart=false'], env)


def main():
    if os.getuid() != 1000 or os.geteuid() != 1000:
        raise RuntimeError('Neko must run as the workspace account')
    os.umask(0o077)
    private_directory(STATE)
    lock = (STATE / 'supervisor.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    stopping = False
    def stop_signal(signum, frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    stack, active, retry_at = Stack(), None, 0
    try:
        while not stopping:
            current = read_config()
            if current != active or any(child.poll() is not None for child in stack.children):
                stack.stop()
                active = None
            if current and not stack.children and time.monotonic() >= retry_at:
                try:
                    stack.start(current)
                    active = current
                    print('Neko stack started', flush=True)
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    stack.stop()
                    retry_at = time.monotonic() + 5
                    print('Neko startup unavailable; retrying in five seconds', flush=True)
            stack.trim_logs()
            time.sleep(1)
    finally:
        stack.stop()
        lock.close()


if __name__ == '__main__':
    main()
