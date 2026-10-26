#!/usr/bin/env python3
"""Run all workspace user code in Sysbox within an allocation-sized guest VM."""
import base64
import json
import os
import pathlib
import signal
import secrets
import stat
import subprocess
import sys

sys.path.insert(0, '/usr/local/lib/coder-vm')
from vmprofile import ProfileError, validate_runtime

ROOT = pathlib.Path('/var/lib/coder-workspace')
RUN = pathlib.Path('/run/coder-workspace')
NAME = 'coder-workspace'


def docker_argv(profile, home, runtime, bundle, nonce):
    """Return fixed Docker arguments; profile data cannot supply runtime flags."""
    validate_runtime(profile)
    if not isinstance(nonce, str) or len(nonce) != 64 or any(c not in '0123456789abcdef' for c in nonce):
        raise ProfileError('invalid launch authorization nonce')
    usable = profile['memory_bytes'] - profile['reserved_memory_bytes']
    args = ['docker', 'run', '--name', NAME, '--runtime=sysbox-runc', '--init', '--no-healthcheck',
            '--cpus', str(profile['cpu']), '--cpuset-cpus', '0-' + str(profile['cpu'] - 1),
            '--memory', str(usable), '--memory-swap', str(usable),
            '--entrypoint', '/run/coder-vm/launch-gate', '--user', '1000:1000', '--workdir', '/home/coder',
            '--env-file', str(runtime / 'agent.env'),
            '--env', 'HOME=/home/coder', '--env', 'USER=coder', '--env', 'LOGNAME=coder',
            '--env', 'CODER_CODE_SERVER_HA=', '--env', 'CODER_HOME_DISK_SIZE=' + str(profile['home_bytes']),
            '--mount', 'type=bind,src=/usr/local/lib/coder-vm/launch-gate,dst=/run/coder-vm/launch-gate,readonly',
            '--mount', 'type=bind,src=/usr/local/lib/coder-vm/launch-user.sh,dst=/run/coder-vm/launch-user.sh,readonly',
            '--mount', 'type=bind,src=/usr/local/lib/coder-vm/clouddrive_cli.py,dst=/opt/coder-vm-support/clouddrive_cli.py,readonly',
            '--mount', 'type=bind,src=/var/lib/coder-workspace/platform,dst=/etc/platform,readonly',
            '--mount', 'type=bind,src=/var/lib/coder-workspace/drives,dst=/mnt/coder-vm-drives,bind-propagation=rslave',
            '--mount', 'type=bind,src=' + str(home) + ',dst=/home/coder',
            '--mount', 'type=bind,src=' + str(runtime / 'agent-init.sh') + ',dst=/run/coder-vm/agent-init.sh,readonly',
            '--mount', 'type=bind,src=' + str(bundle) + ',dst=/etc/ssl/certs/ca-certificates.crt,readonly']
    for path in ('/proc/cpuinfo', '/proc/meminfo', '/proc/stat', '/proc/swaps', '/proc/uptime', '/sys/devices/system/cpu'):
        args += ['--mount', 'type=bind,src=/var/lib/lxcfs' + path + ',dst=' + path + ',readonly']
    # Sysbox's documented system-container capabilities remain inside this VM.
    # No privileged mode, guest Docker socket, raw device or guest root is exposed.
    args += [profile['workspace_image'], '--authorization', nonce]
    return args


def command(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def home_mount(profile):
    """Mount only the exact prepared HOME disk, preserving existing data."""
    device = pathlib.Path(profile['home_device'])
    if not stat.S_ISBLK(device.stat().st_mode):
        raise ProfileError('prepared HOME device is not a block device')
    if int(command('blockdev', '--getsize64', str(device)).stdout.strip()) != profile['home_bytes']:
        raise ProfileError('prepared HOME disk size differs from its allocation')
    if command('blkid', '-o', 'value', '-s', 'TYPE', str(device)).stdout.strip() != 'ext4':
        raise ProfileError('HOME must contain a prepared ext4 filesystem; automatic formatting is forbidden')
    target = ROOT / 'home'
    target.mkdir(parents=True, exist_ok=True)
    mounted = command('findmnt', '--mountpoint', str(target), '-n', '-o', 'SOURCE', check=False)
    if mounted.returncode == 0:
        if os.path.realpath(mounted.stdout.strip()) != os.path.realpath(device):
            raise ProfileError('HOME mount has an unexpected source')
    else:
        command('mount', '-o', 'nodev,nosuid', str(device), str(target))
    os.chown(target, 1000, 1000)
    return target


def main():
    if os.geteuid() != 0:
        raise ProfileError('guest supervisor must be root-owned')
    profile_path = pathlib.Path('/etc/coder-workspace/runtime.json')
    info = profile_path.stat()
    if info.st_uid != 0 or info.st_mode & 0o077:
        raise ProfileError('runtime profile must be root-owned and private')
    profile = validate_runtime(json.loads(profile_path.read_text()))
    import private_config
    home = home_mount(profile)
    private_config.prepare(profile)
    private_config.atomic(private_config.PUBLIC / 'private-ready', 'false\n', 0o444)
    private_config.atomic(private_config.PUBLIC / 'private-authorization', 'false\n', 0o444)
    RUN.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(RUN, 0o700)
    nonce = secrets.token_hex(32)
    private_config.atomic(RUN / 'gate-nonce', nonce + '\n', 0o600)
    script = RUN / 'agent-init.sh'
    script.write_bytes(base64.b64decode(profile['agent']['init_script_base64']))
    os.chmod(script, 0o555)
    env = RUN / 'agent.env'
    env.write_text('CODER_AGENT_TOKEN=' + profile['agent']['token'] + '\nCODER_URL=' + profile['agent']['url'] + '\n')
    os.chmod(env, 0o600)
    bundle = RUN / 'ca-certificates.crt'
    bundle.write_bytes(pathlib.Path('/etc/ssl/certs/ca-certificates.crt').read_bytes() + b'\n' + base64.b64decode(profile['trusted_ca_pem_base64']))
    os.chmod(bundle, 0o444)
    command('docker', 'rm', '-f', NAME, check=False)
    if command('docker', 'image', 'inspect', profile['workspace_image'], check=False).returncode:
        # Pulling a multi-GiB image is separate from the bounded container-create phase.
        subprocess.run(['docker', 'pull', profile['workspace_image']], check=True, timeout=900,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    child = subprocess.Popen(docker_argv(profile, home, RUN, bundle, nonce))
    def stop(_signum, _frame):
        command('docker', 'stop', '--time', '15', NAME, check=False)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    import time
    deadline = time.monotonic() + 30
    while child.poll() is None:
        state = command('docker', 'inspect', '--format', '{{.State.Running}}', NAME, check=False)
        if state.returncode == 0 and state.stdout.strip() == 'true':
            break
        if time.monotonic() > deadline:
            raise ProfileError('workspace container did not become available')
        time.sleep(0.2)
    if child.poll() is None:
        private_config.resume(profile)
        # Only trusted guest-root state authorizes image code, including setup.
        while child.poll() is None:
            if (private_config.PUBLIC / 'private-ready').read_text() == 'true\n':
                break
            time.sleep(0.2)
    if child.poll() is None:
        command('docker', 'exec', '--user', '0:0', NAME, '/bin/sh', '-c',
                'for item in cloud-drive:own cloud-drive-peers:peers cloud-drive-items:items iso-library:iso; do '
                'name=${item%:*}; target=${item#*:}; '
                'test -L /mnt/$name || test ! -e /mnt/$name || exit 1; '
                'ln -sfn /mnt/coder-vm-drives/$target /mnt/$name; done')
        private_config.atomic(private_config.PUBLIC / 'private-authorization', nonce + '\n', 0o444)
    return child.wait()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ProfileError, ValueError, OSError, subprocess.SubprocessError):
        # Never emit runtime configuration, token-bearing argv or cloud credentials.
        print('Workspace guest startup failed; check the validated profile, runtime and retained HOME disk.', file=sys.stderr)
        sys.exit(1)
