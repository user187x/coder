#!/usr/bin/env python3
"""Apply fixed, root-private workspace services without exposing their credentials."""
import base64
import fcntl
import ipaddress
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, '/usr/local/lib/coder-vm')
from vmprofile import ProfileError, identifier, validate_runtime

CONFIG = pathlib.Path('/etc/coder-workspace')
PRIVATE = CONFIG / 'private'
ROOT = pathlib.Path('/var/lib/coder-workspace')
DRIVES = ROOT / 'drives'
PUBLIC = ROOT / 'platform'
LIB = pathlib.Path('/usr/local/lib/coder-vm')
SOURCE_KEYS = {'root', 'bucket', 'prefix', 'accessKey', 'secretKey', 'region', 'port', 'auditEnabled', 'auditOwner', 'auditVersion', 'id'}


def exact(obj, required, optional=()):
    if not isinstance(obj, dict) or set(obj) - set(required) - set(optional) or set(required) - set(obj):
        raise ProfileError('Unsupported private configuration fields')


def safe_text(value, pattern, maximum=256):
    if not isinstance(value, str) or len(value) > maximum or not re.fullmatch(pattern, value):
        raise ProfileError('Invalid private configuration value')
    return value


def relative(value):
    if not isinstance(value, str) or len(value) > 4096 or '\\' in value or any(ord(c) < 32 for c in value):
        raise ProfileError('Invalid relative storage path')
    if value.startswith('/') or any(part in ('.', '..') for part in value.split('/')):
        raise ProfileError('Storage path escapes its mount')
    return value


def public_state(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or re.search(r'secret|token|password|credential|access.?key|private.?key', key, re.I):
                raise ProfileError('Public mount state contains credentials')
            public_state(child)
    elif isinstance(value, list):
        for child in value:
            public_state(child)
    elif value is not None and not isinstance(value, (str, bool, int, float)):
        raise ProfileError('Invalid public mount state')


def validate(config, runtime):
    """Validate the entire request before changing any running guest service."""
    validate_runtime(runtime)
    exact(config, ('version', 'workspace_id', 'organization_id', 'workspace_owner_id', 'cloud_drive', 'tunnel'), ('source', 'vm_uid', 'agent_id', 'build_id', 'neko'))
    if type(config['version']) is not int or config['version'] != 1:
        raise ProfileError('Unsupported private configuration version')
    for field in ('workspace_id', 'organization_id', 'workspace_owner_id'):
        if identifier(config[field]) != runtime[field]:
            raise ProfileError('Private configuration belongs to another workspace')
    if 'build_id' in runtime and config.get('build_id') != runtime['build_id']:
        raise ProfileError('Private configuration belongs to another build')
    for field in ('vm_uid', 'agent_id'):
        if field in config:
            identifier(config[field])
    drive = config['cloud_drive']
    exact(drive, ('enabled', 'annotation', 'mounts', 'mounts_state'))
    if type(drive['enabled']) is not bool or drive['enabled'] and not runtime.get('cloud_drive', {}).get('enabled'):
        raise ProfileError('Cloud Drive is not enabled by the current runtime')
    if drive['annotation'] not in ('on', 'off') and not (isinstance(drive['annotation'], str) and drive['annotation'].startswith('source:/home/coder')):
        raise ProfileError('Invalid Cloud Drive attachment state')
    if not isinstance(drive['mounts'], list) or len(drive['mounts']) > 128 or not drive['enabled'] and drive['mounts']:
        raise ProfileError('Invalid private mounts')
    destinations = set()
    for mount in drive['mounts']:
        exact(mount, ('id', 'kind', 'endpoint', 'region', 'bucket', 'prefix', 'access_key', 'secret_key', 'ca_pem_base64', 'read_only'), ('name', 'item_kind', 'item'))
        if mount['kind'] not in ('own', 'peer', 'item', 'iso') or type(mount['read_only']) is not bool:
            raise ProfileError('Invalid private mount kind')
        if mount['kind'] == 'iso' and (mount['bucket'] != 'audit-library-isos' or mount['read_only'] is not True):
            raise ProfileError('ISO mounts require the read-only audited library')
        if mount['kind'] in ('own', 'iso'):
            if mount['id'] != mount['kind']:
                raise ProfileError('Invalid fixed mount identity')
        elif not isinstance(mount['id'], str) or not re.fullmatch(r'[0-9a-f]{32}', mount['id']):
            identifier(mount['id'])
        endpoint = urllib.parse.urlsplit(mount['endpoint'])
        if endpoint.scheme != 'https' or not endpoint.hostname or not re.fullmatch(r'coder-ui-updates\.[a-z0-9-]+\.svc', endpoint.hostname) or endpoint.port != 9444 or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment or endpoint.username or endpoint.password:
            raise ProfileError('Mounts must use the verified audit gateway')
        if runtime.get('cluster_namespace') and endpoint.hostname != 'coder-ui-updates.' + runtime['cluster_namespace'] + '.svc':
            raise ProfileError('Audit gateway belongs to another protected namespace')
        if mount['region'] != 'us-east-1':
            raise ProfileError('Unsupported storage region')
        safe_text(mount['bucket'], r'[a-z0-9][a-z0-9.-]{0,252}')
        relative(mount['prefix'])
        for key in ('access_key', 'secret_key'):
            safe_text(mount[key], r'[A-Za-z0-9/+=_.-]+')
        ca = base64.b64decode(mount['ca_pem_base64'], validate=True)
        if len(ca) > 131072 or b'-----BEGIN CERTIFICATE-----' not in ca or b'PRIVATE KEY' in ca:
            raise ProfileError('Invalid audit gateway certificate')
        if mount['kind'] == 'peer':
            safe_text(mount.get('name'), r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}')
        if mount['kind'] == 'item':
            if mount.get('item_kind') not in ('file', 'folder'):
                raise ProfileError('Shared items require their explicit file or folder kind')
            if mount['item_kind'] == 'file':
                safe_text(mount.get('item'), r'[^/\\\x00-\x1f]+', 255)
                if mount['item'] in ('.', '..'):
                    raise ProfileError('Invalid shared filename')
        destination = destination_for(mount)
        if destination in destinations:
            raise ProfileError('Duplicate private mount destination')
        destinations.add(destination)
    public_state(drive['mounts_state'])
    tunnel = config['tunnel']
    exact(tunnel, ('enabled', 'endpoint', 'url'))
    if type(tunnel['enabled']) is not bool or tunnel['enabled'] and not runtime['tunnel']['enabled']:
        raise ProfileError('Tunnel is not enabled by the current runtime')
    if tunnel['url'] != runtime['agent']['url'].rstrip('/') + '/__coder-ui/api/workspace-tunnels/agent/sync':
        raise ProfileError('Tunnel policy must use the configured Coder origin')
    host, sep, port = tunnel['endpoint'].rpartition(':')
    address = ipaddress.IPv4Address(host)
    if not sep or port != '51871' or address.is_loopback or address.is_multicast or address.is_unspecified or address.is_link_local:
        raise ProfileError('Invalid verified launcher endpoint')
    media = config.get('neko', {'enabled': False, 'relay_sources': []})
    validate_neko(media)
    if media['enabled'] and media['advertised_ip'] != str(address):
        raise ProfileError('Neko media address must be the verified launcher endpoint')
    source = config.get('source', {'enabled': False})
    exact(source, ('enabled',), ('config',))
    if type(source['enabled']) is not bool or source['enabled'] and not drive['enabled']:
        raise ProfileError('Source requires the current Cloud Drive feature')
    if source['enabled']:
        cfg = source.get('config')
        exact(cfg, SOURCE_KEYS)
        path = cfg['root']
        if not isinstance(path, str) or (path != '/home/coder' and not path.startswith('/home/coder/')):
            raise ProfileError('Source folder must be inside retained HOME')
        relative(path.removeprefix('/home/coder').lstrip('/'))
        if cfg['bucket'] != 'drive' or cfg['prefix'] != runtime['workspace_owner_id'] + '/' or cfg['port'] != 9900 or cfg['region'] != 'us-east-1' or cfg['auditEnabled'] is not True or cfg['auditOwner'] != runtime['workspace_owner_id'] or cfg['auditVersion'] != 2:
            raise ProfileError('Source must preserve actor-attributed auditing')
        for key in ('accessKey', 'secretKey'):
            safe_text(cfg[key], r'[A-Za-z0-9/+=_.-]+')
        safe_text(cfg['id'], r'[a-f0-9]{16}')
    return config


def destination_for(mount):
    if mount['kind'] == 'peer':
        return DRIVES / 'peers' / mount['name']
    if mount['kind'] == 'item':
        return DRIVES / 'items' / mount['id']
    return DRIVES / mount['kind']


def file_parent(mount):
    return DRIVES / 'files' / mount['id']


def file_link(mount, remove=False):
    """Keep a shared file reachable without pinning a stale FUSE file inode."""
    target = destination_for(mount)
    expected = os.path.relpath(file_parent(mount) / mount['item'], target.parent)
    directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ProfileError('Shared file link parent must be protected by the guest supervisor')
        try:
            original = os.stat(target.name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            if not remove:
                os.symlink(expected, target.name, dir_fd=directory)
            return
        if not stat.S_ISLNK(original.st_mode) or original.st_uid != 0 or os.readlink(target.name, dir_fd=directory) != expected:
            raise ProfileError('Shared file link differs from its approved target')
        if remove:
            fresh = os.stat(target.name, dir_fd=directory, follow_symlinks=False)
            if (fresh.st_dev, fresh.st_ino, fresh.st_uid) != (original.st_dev, original.st_ino, original.st_uid):
                raise ProfileError('Shared file link changed during removal')
            os.unlink(target.name, dir_fd=directory)
    finally:
        os.close(directory)


def remove_mount(mount):
    if mount['kind'] == 'item' and mount['item_kind'] == 'file':
        unmount(file_parent(mount))
        file_link(mount, remove=True)
    else:
        unmount(destination_for(mount))
    service('coder-vm-mount-' + mount['id'], '', enabled=False)


def trusted_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > 131072:
            raise ProfileError('Guest control configuration must be private and root-owned')
        return json.load(source)


def trusted_staging_json(path):
    """Seal fixed QGA staging files within the root-only control directory."""
    if path.parent != CONFIG or path.name not in ('private-config.next', 'user-command.next'):
        raise ProfileError('Unsupported guest staging configuration')
    directory = os.open(CONFIG, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            raise ProfileError('Guest staging directory must be root-private')
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd) as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_size > 131072:
                raise ProfileError('Guest staging configuration must be a bounded root-owned file')
            os.fchmod(source.fileno(), 0o600)
            content = source.read(131073)
            if len(content) > 131072:
                raise ProfileError('Guest staging configuration exceeds its limit')
            return json.loads(content)
    finally:
        os.close(directory)


def atomic(path, data, mode=0o600):
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), mode)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ProfileError('Guest private directory is not protected')


def public_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o755)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
        raise ProfileError('Guest public directory is not a root-owned directory')
    if os.path.ismount(path):
        if info.st_mode & 0o055 != 0o055:
            raise ProfileError('Guest public mount is not traversable by the workspace UID')
        return
    # Services use a private umask. Public mount ancestors must still be traversable
    # by the isolated workspace UID; credentials remain in PRIVATE, never here.
    os.chmod(path, 0o755)


def service(name, executable, environment=None, enabled=True):
    if not enabled:
        run('systemctl', 'stop', name, check=False)
        state = run('systemctl', 'is-active', '--quiet', name, check=False)
        if state.returncode not in (3, 4):
            raise ProfileError('Guest service shutdown could not be confirmed')
        return
    unit = '[Unit]\nAfter=network-online.target docker.service\n[Service]\nType=simple\nUMask=0077\nRestart=on-failure\nRestartSec=3\n'
    if environment:
        unit += 'EnvironmentFile=' + str(environment) + '\n'
    unit += 'ExecStart=' + executable + '\n'
    atomic(pathlib.Path('/etc/systemd/system') / (name + '.service'), unit)
    run('systemctl', 'daemon-reload')
    run('systemctl', 'restart', name)
    run('systemctl', 'is-active', '--quiet', name)


def unmount(path):
    status = run('findmnt', '--mountpoint', str(path), '-n', check=False).returncode
    if status == 0:
        run('umount', str(path))
    elif status != 1:
        raise ProfileError('Guest mount removal could not be inspected')


def apply_mount(mount):
    identity = mount['id']
    folder = PRIVATE / ('mount-' + identity)
    private_directory(folder)
    atomic(folder / 'ca.pem', base64.b64decode(mount['ca_pem_base64']).decode())
    # Credentials stay in a root-only file, never in Docker arguments or user mounts.
    atomic(folder / 'rclone.conf', '[drive]\ntype = s3\nprovider = Other\nenv_auth = false\naccess_key_id = ' + mount['access_key'] + '\nsecret_access_key = ' + mount['secret_key'] + '\nendpoint = ' + mount['endpoint'] + '\nregion = us-east-1\nforce_path_style = true\n')
    target = destination_for(mount)
    file_item = mount['kind'] == 'item' and mount['item_kind'] == 'file'
    actual = file_parent(mount) if file_item else target
    actual.mkdir(parents=True, exist_ok=True)
    remote = 'drive:' + mount['bucket'] + '/' + mount['prefix']
    argv = ['/usr/bin/rclone', 'mount', remote, str(actual), '--config', str(folder / 'rclone.conf'), '--ca-cert', str(folder / 'ca.pem'), '--allow-other', '--umask', '0000', '--file-perms', '0666', '--dir-perms', '0777', '--dir-cache-time', '1s', '--poll-interval', '0', '--vfs-cache-mode', 'writes', '--cache-dir', str(folder / 'cache'), '--vfs-cache-max-size', '128M', '--log-level', 'ERROR']
    if file_item:
        atomic(folder / 'files', mount['item'] + '\n')
        argv += ['--files-from-raw', str(folder / 'files')]
    if mount['read_only']:
        argv.append('--read-only')
    # systemd syntax is fixed; values are escaped as individual argv words.
    quoted = ' '.join('"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"' for value in argv)
    run('/usr/bin/rclone', 'lsf', remote, '--max-depth', '1', '--config', str(folder / 'rclone.conf'), '--ca-cert', str(folder / 'ca.pem'), '--contimeout', '5s', '--timeout', '10s')
    service('coder-vm-mount-' + identity, quoted)
    for _ in range(100):
        if run('findmnt', '--mountpoint', str(actual), '-n', check=False).returncode == 0:
            break
        time.sleep(0.1)
    else:
        raise ProfileError('Audited Cloud Drive mount did not become ready')
    if file_item:
        source = actual / mount['item']
        if not stat.S_ISREG(source.lstat().st_mode):
            raise ProfileError('Shared file is not a regular file')
        file_link(mount)


def app_address():
    result = run('docker', 'inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', 'coder-workspace')
    addresses = result.stdout.split()
    if len(addresses) != 1:
        raise ProfileError('Workspace requires exactly one private Docker bridge address')
    address = ipaddress.IPv4Address(addresses[0])
    if not address.is_private or address.is_loopback:
        raise ProfileError('Invalid workspace bridge address')
    return str(address)


def unicast_address(value):
    if not isinstance(value, str):
        raise ProfileError('Media address must be canonical unicast IPv4')
    address = ipaddress.IPv4Address(value)
    if str(address) != value or any((address.is_loopback, address.is_link_local, address.is_multicast, address.is_unspecified, address.is_reserved)):
        raise ProfileError('Media address must be canonical unicast IPv4')
    return value


def validate_neko(config):
    exact(config, ('enabled', 'relay_sources'), ('advertised_ip',))
    sources = config['relay_sources']
    if type(config['enabled']) is not bool or not isinstance(sources, list) or len(sources) > 16 or config['enabled'] != bool(sources):
        raise ProfileError('Neko media requires an explicit trusted relay source list')
    seen = set()
    for value in sources:
        unicast_address(value)
        if value in seen:
            raise ProfileError('Neko relay source must be a unique canonical unicast IPv4 address')
        seen.add(value)
    if config['enabled']:
        if unicast_address(config.get('advertised_ip')) in seen:
            raise ProfileError('Neko launcher cannot be its own trusted relay')
    elif 'advertised_ip' in config:
        raise ProfileError('Disabled Neko media must not advertise an endpoint')


def restore_rules(table, rules):
    payload = '*' + table + '\n' + '\n'.join(rules) + '\nCOMMIT\n'
    subprocess.run(['iptables-restore', '--noflush', '--wait', '5'], input=payload, text=True, capture_output=True, check=True)


def app_source_rules(address):
    address = str(ipaddress.IPv4Address(address))
    restore_rules('filter', [':CODER_VM_APP_SOURCE - [0:0]', '-F CODER_VM_APP_SOURCE',
                           '-A CODER_VM_APP_SOURCE -s ' + address + '/32 -j RETURN',
                           '-A CODER_VM_APP_SOURCE -j DROP'])
    for parent in ('INPUT', 'FORWARD'):
        args = ('iptables', '-t', 'filter', '-C', parent, '-i', 'docker0', '-j', 'CODER_VM_APP_SOURCE')
        if run(*args, check=False).returncode:
            run('iptables', '-t', 'filter', '-I', parent, '1', *args[5:])


def neko_rules(address, config):
    """Expose only the fixed media port to infrastructure-selected relay pods."""
    validate_neko(config)
    address = str(ipaddress.IPv4Address(address))
    rules = [':CODER_VM_NEKO - [0:0]', '-F CODER_VM_NEKO',
             '-A CODER_VM_NEKO -i docker0 -j CODER_VM_APP_SOURCE',
             '-A CODER_VM_NEKO -m conntrack --ctdir REPLY -j RETURN',
             ':CODER_VM_NEKO_INPUT - [0:0]', '-F CODER_VM_NEKO_INPUT',
             '-A CODER_VM_NEKO_INPUT -j DROP']
    for source in config['relay_sources']:
        rules.append('-A CODER_VM_NEKO -s ' + source + '/32 -d ' + address + '/32 -j ACCEPT')
    rules.append('-A CODER_VM_NEKO -d ' + address + '/32 -j DROP')
    # Commit default-deny forwarding before enabling or changing destination NAT.
    restore_rules('filter', rules)
    nat = [':CODER_VM_NEKO - [0:0]', '-F CODER_VM_NEKO']
    for source in config['relay_sources']:
        nat.append('-A CODER_VM_NEKO -p udp --dport 59000 -s ' + source + '/32 -j DNAT --to-destination ' + address + ':59000')
    restore_rules('nat', nat)
    for table, parent, chain in (('filter', 'FORWARD', 'CODER_VM_NEKO'), ('filter', 'INPUT', 'CODER_VM_NEKO_INPUT'), ('nat', 'PREROUTING', 'CODER_VM_NEKO')):
        args = ('iptables', '-t', table, '-C', parent, '-p', 'udp', '--dport', '59000', '-j', chain)
        if run(*args, check=False).returncode:
            run('iptables', '-t', table, '-I', parent, '1', *args[5:])


def tunnel_rules(address, enabled):
    # Dedicated chains make repeated applies idempotent without changing Docker's rules.
    for table, chain in (('nat', 'CODER_VM_TUNNEL'), ('filter', 'CODER_VM_TUNNEL')):
        run('iptables', '-t', table, '-N', chain, check=False)
        run('iptables', '-t', table, '-F', chain)
    for table, parent, extra in (('nat', 'PREROUTING', ('-i', 'coderwg')), ('filter', 'DOCKER-USER', ())):
        args = ('iptables', '-t', table, '-C', parent, *extra, '-j', 'CODER_VM_TUNNEL')
        if run(*args, check=False).returncode:
            run('iptables', '-t', table, '-I', parent, '1', *extra, '-j', 'CODER_VM_TUNNEL')
    if enabled:
        run('iptables', '-t', 'filter', '-A', 'CODER_VM_TUNNEL', '-i', 'docker0', '-j', 'CODER_VM_APP_SOURCE')
        run('iptables', '-t', 'filter', '-A', 'CODER_VM_TUNNEL', '-p', 'udp', '--dport', '59000', '-j', 'CODER_VM_NEKO')
        for protocol in ('tcp', 'udp'):
            run('iptables', '-t', 'nat', '-A', 'CODER_VM_TUNNEL', '-p', protocol, '-j', 'DNAT', '--to-destination', address)
        run('iptables', '-t', 'filter', '-A', 'CODER_VM_TUNNEL', '-i', 'coderwg', '-o', 'docker0', '-d', address, '-j', 'ACCEPT')
        run('iptables', '-t', 'filter', '-A', 'CODER_VM_TUNNEL', '-i', 'docker0', '-o', 'coderwg', '-s', address, '-j', 'ACCEPT')


def process_boundary(pid):
    """Read kernel namespace evidence from the guest supervisor, never tenant commands."""
    if type(pid) is not int or pid <= 1:
        raise ProfileError('Workspace process identity is unavailable')
    proc = pathlib.Path('/proc') / str(pid)
    for kind in ('uid', 'gid'):
        lines = (proc / (kind + '_map')).read_text().splitlines()
        mappings = [tuple(map(int, line.split())) for line in lines]
        if not mappings or any(len(parts) != 3 or parts[1] == 0 for parts in mappings) or not any(start == 0 and outside >= 65536 and count > 1000 for start, outside, count in mappings):
            raise ProfileError('Workspace requires an isolated user namespace')
    for kind in ('pid', 'mnt', 'net', 'ipc', 'user'):
        if os.readlink(proc / 'ns' / kind) == os.readlink(pathlib.Path('/proc/1/ns') / kind):
            raise ProfileError('Workspace shares a guest supervisor namespace')


def app_socket_scope(address):
    identity = run('docker', 'inspect', '--format', '{{.Id}} {{.State.Pid}}', 'coder-workspace').stdout.strip()
    fields = identity.split()
    if len(fields) != 2 or not re.fullmatch(r'[a-f0-9]{64}', fields[0]) or not fields[1].isdigit():
        raise ProfileError('Workspace socket observation process is unavailable')
    pid = int(fields[1])
    process_boundary(pid)
    verify_public_binding(pid)
    namespace = os.readlink(pathlib.Path('/proc') / str(pid) / 'ns/net')
    if not re.fullmatch(r'net:\[[1-9][0-9]{0,19}\]', namespace) or app_address() != address or run('docker', 'inspect', '--format', '{{.Id}} {{.State.Pid}}', 'coder-workspace').stdout.strip() != identity:
        raise ProfileError('Workspace socket observation process changed')
    return 'WORKSPACE_TUNNEL_APP_PID=' + str(pid) + '\nWORKSPACE_TUNNEL_APP_NETNS=' + namespace + '\nWORKSPACE_TUNNEL_APP_ADDRESS=' + address + '\n'


def gate_nonce():
    """Read the fresh supervisor-generated launch authorization without following links."""
    path = pathlib.Path('/run/coder-workspace/gate-nonce')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size != 65:
            raise ProfileError('Workspace launch authorization is not root-private')
        value = source.read(66)
    if not re.fullmatch(r'[a-f0-9]{64}\n', value):
        raise ProfileError('Workspace launch authorization is invalid')
    return value[:-1]


def verify_public_binding(pid):
    """The image cannot substitute a HOME-backed readiness path via a symlink."""
    expected = PUBLIC.stat()
    actual = (pathlib.Path('/proc') / str(pid) / 'root/etc/platform').stat()
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
        raise ProfileError('Workspace readiness directory is not its supervisor bind')


def verify_container(runtime):
    """Verify actual Sysbox controls and the exact retained HOME before releasing user code."""
    inspected = json.loads(run('docker', 'inspect', 'coder-workspace').stdout)
    if not isinstance(inspected, list) or len(inspected) != 1:
        raise ProfileError('Workspace container is unavailable')
    container = inspected[0]
    host = container.get('HostConfig') or {}
    state = container.get('State') or {}
    config = container.get('Config') or {}
    usable = runtime['memory_bytes'] - runtime['reserved_memory_bytes']
    expected = {'Runtime': 'sysbox-runc', 'Privileged': False, 'NanoCpus': runtime['cpu'] * 1000000000,
                'CpusetCpus': '0-' + str(runtime['cpu']-1), 'Memory': usable, 'MemorySwap': usable}
    if state.get('Running') is not True or any(host.get(k) != value for k,value in expected.items()):
        raise ProfileError('Workspace isolation or assigned controls are not active')
    if config.get('User') != '1000:1000' or config.get('Image') != runtime['workspace_image'] or config.get('Entrypoint') != ['/run/coder-vm/launch-gate'] or config.get('Cmd') != ['--authorization', gate_nonce()] or config.get('Healthcheck', {}).get('Test') != ['NONE']:
        raise ProfileError('Workspace must use the fixed unprivileged launch gate')
    if host.get('NetworkMode') not in ('bridge','default') or host.get('PidMode') not in ('', 'private') or host.get('IpcMode') not in ('', 'private') or host.get('UTSMode') == 'host' or host.get('CgroupnsMode') == 'host':
        raise ProfileError('Workspace must use private guest namespaces')
    if any(host.get(key) for key in ('Devices','DeviceRequests','DeviceCgroupRules','VolumesFrom','CapAdd','PortBindings')):
        raise ProfileError('Workspace cannot receive supervisor devices or extra privileges')
    required = {'/home/coder': (str(ROOT/'home'), True), '/etc/platform': (str(PUBLIC), False),
        '/mnt/coder-vm-drives': (str(DRIVES), True), '/run/coder-vm/launch-user.sh': (str(LIB/'launch-user.sh'), False),
        '/run/coder-vm/agent-init.sh': ('/run/coder-workspace/agent-init.sh', False),
        '/run/coder-vm/launch-gate': (str(LIB/'launch-gate'), False),
        '/etc/ssl/certs/ca-certificates.crt': ('/run/coder-workspace/ca-certificates.crt', False),
        '/opt/coder-vm-support/clouddrive_cli.py': (str(LIB/'clouddrive_cli.py'), False)}
    for path in ('/proc/cpuinfo','/proc/meminfo','/proc/stat','/proc/swaps','/proc/uptime','/sys/devices/system/cpu'):
        required[path] = ('/var/lib/lxcfs'+path, False)
    mounts = container.get('Mounts') or []
    if len(mounts) != len(required) or {m.get('Destination') for m in mounts} != set(required):
        raise ProfileError('Workspace has unexpected supervisor mounts')
    for mount in mounts:
        expected_mount = required.get(mount.get('Destination'))
        if not expected_mount or mount.get('Type') != 'bind' or (mount.get('Source'),mount.get('RW')) != expected_mount:
            raise ProfileError('Workspace mount differs from its fixed guest contract')
        if mount['Destination'] == '/mnt/coder-vm-drives' and mount.get('Propagation') != 'rslave':
            raise ProfileError('Workspace drive propagation must be one-way')
    device = pathlib.Path(runtime['home_device'])
    if not stat.S_ISBLK(device.stat().st_mode) or int(run('blockdev','--getsize64',str(device)).stdout.strip()) != runtime['home_bytes']:
        raise ProfileError('Retained HOME device differs from its assigned capacity')
    mounted = run('findmnt','--mountpoint',str(ROOT/'home'),'-n','-o','SOURCE').stdout.strip()
    if os.path.realpath(mounted) != os.path.realpath(device):
        raise ProfileError('Workspace HOME is not its retained block mount')
    process_boundary(state.get('Pid'))
    verify_public_binding(state.get('Pid'))
    fresh = json.loads(run('docker','inspect','coder-workspace').stdout)
    if len(fresh) != 1 or fresh[0].get('Id') != container.get('Id') or fresh[0].get('State',{}).get('Pid') != state.get('Pid') or fresh[0].get('State',{}).get('Running') is not True:
        raise ProfileError('Workspace process changed before private readiness')


def apply(config, runtime, previous=None):
    """Apply validated root services and publish only non-secret attachment state."""
    validate(config, runtime)
    private_directory(PRIVATE)
    PUBLIC.mkdir(parents=True, exist_ok=True, mode=0o755)
    os.chmod(PUBLIC, 0o755)
    atomic(PUBLIC / 'private-ready', 'false\n', 0o444)
    verify_container(runtime)
    app_source_rules(app_address())
    public_directory(DRIVES)
    for name in ('own', 'peers', 'items', 'iso', 'files'):
        public_directory(DRIVES / name)
    prior = {m['id']: m for m in (previous or {}).get('cloud_drive', {}).get('mounts', [])}
    desired = {m['id']: m for m in config['cloud_drive']['mounts']}
    for identity, mount in prior.items():
        if desired.get(identity) != mount:
            remove_mount(mount)
    for identity, mount in desired.items():
        if prior.get(identity) != mount:
            apply_mount(mount)
    if (previous or {}).get('source') != config.get('source'):
        if config.get('source', {}).get('enabled'):
            # Wrapper revalidates the root-only committed config before opening HOME.
            atomic(PRIVATE / 'source-private.json', json.dumps(config))
        service('coder-vm-source', '/usr/local/sbin/coder-vm-source', enabled=config.get('source', {}).get('enabled', False))
        if config.get('source', {}).get('enabled'):
            source_ready(config['source']['config']['id'])
    neko = config.get('neko', {'enabled': False, 'relay_sources': []})
    if previous is None or (previous or {}).get('neko', {'enabled': False, 'relay_sources': []}) != neko:
        neko_rules(app_address(), neko)
    public_neko = {'enabled': neko['enabled'], 'http_port': 9080, 'udp_port': 59000}
    if neko['enabled']:
        public_neko['advertised_ip'] = neko['advertised_ip']
    atomic(PUBLIC / 'neko.json', json.dumps(public_neko), 0o444)
    if (previous or {}).get('tunnel') != config['tunnel']:
        enabled = config['tunnel']['enabled']
        address = app_address() if enabled else None
        tunnel_rules(address, enabled)
        if enabled:
            atomic(PRIVATE / 'tunnel.env', 'CODER_AGENT_TOKEN=' + runtime['agent']['token'] + '\nPOD_IP=' + config['tunnel']['endpoint'].split(':')[0] + '\nWORKSPACE_TUNNEL_URL=' + config['tunnel']['url'] + '\nWORKSPACE_TUNNEL_FORWARD_CHAIN=CODER_VM_TUNNEL\nSSL_CERT_FILE=/run/coder-workspace/ca-certificates.crt\n' + app_socket_scope(address))
        service('coder-vm-tunnel', str(LIB / 'workspace-tunnel'), PRIVATE / 'tunnel.env', enabled)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    atomic(PUBLIC / 'cloud-drive', config['cloud_drive']['annotation'] + '\n', 0o444)
    atomic(PUBLIC / 'cloud-drive-mounts', json.dumps(config['cloud_drive']['mounts_state']), 0o444)
    atomic(PUBLIC / 'private-ready', 'true\n', 0o444)


def source_ready(identity):
    """A fixed local health probe confirms the audited source loaded this profile."""
    for _ in range(50):
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://127.0.0.1:9900/__health', timeout=1) as response:
                health = json.load(response)
            if health.get('ok') is True and health.get('config') == identity and isinstance(health.get('audit'), dict) and not health['audit'].get('error'):
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise ProfileError('Audited source service did not become ready')


def prepare(runtime):
    """Prepare only non-secret bind roots before starting the Sysbox container."""
    validate_runtime(runtime)
    private_directory(CONFIG)
    private_directory(PRIVATE)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o755)
    os.chmod(ROOT, 0o755)
    public_directory(DRIVES)
    if DRIVES.is_symlink():
        raise ProfileError('Drive propagation root must not be a symlink')
    if run('findmnt', '--mountpoint', str(DRIVES), '-n', check=False).returncode:
        run('mount', '--bind', str(DRIVES), str(DRIVES))
    run('mount', '--make-rshared', str(DRIVES))
    for name in ('own', 'peers', 'items', 'iso', 'files'):
        public_directory(DRIVES / name)
    PUBLIC.mkdir(parents=True, exist_ok=True, mode=0o755)
    os.chmod(PUBLIC, 0o755)
    for name, value in (('cloud-drive', 'off\n'), ('cloud-drive-mounts', '{}'), ('private-ready', 'false\n')):
        path = PUBLIC / name
        if not path.exists():
            atomic(path, value, 0o444)


def resume(runtime):
    """Restore fixed guest services after the user container is available."""
    path = CONFIG / 'private-config.json'
    if not path.exists():
        return False
    config = trusted_json(path)
    apply(config, runtime)
    return True


def source_main():
    """Run the audited fixed source server with no credential file in user HOME."""
    try:
        if os.geteuid() != 0:
            raise ProfileError('Source startup requires the guest supervisor')
        runtime = trusted_json(CONFIG / 'runtime.json')
        config = validate(trusted_json(PRIVATE / 'source-private.json'), runtime)
        if not config.get('source', {}).get('enabled'):
            raise ProfileError('Source server is disabled')
        cfg = dict(config['source']['config'])
        home = (ROOT / 'home').resolve(strict=True)
        requested = ROOT / 'home' / cfg['root'].removeprefix('/home/coder').lstrip('/')
        current = ROOT / 'home'
        for part in requested.relative_to(current).parts:
            current = current / part
            if current.is_symlink():
                raise ProfileError('Source folder cannot traverse a symlink')
        root = requested.resolve(strict=True)
        if not root.is_relative_to(home) or not root.is_dir():
            raise ProfileError('Source folder is outside retained HOME')
        cfg['root'] = str(root)
        state = ROOT / 'source-state'
        state.mkdir(exist_ok=True, mode=0o700)
        if state.is_symlink():
            raise ProfileError('Source state must be private')
        os.chmod(state, 0o700)
        os.chown(state, 1000, 1000)
        control = state / 'control.json'
        atomic(control, json.dumps(cfg))
        import drivesource
        drivesource.load(str(control))
        control.unlink()
        # The audit database and upload staging stay outside the user container.
        for path in state.rglob('*'):
            if path.is_symlink():
                raise ProfileError('Source control state cannot contain symlinks')
            os.chown(path, 1000, 1000)
        os.setgroups([])
        os.setgid(1000)
        os.setuid(1000)
        server = drivesource.Server(('0.0.0.0', 9900), drivesource.Handler)
        import threading
        threading.Thread(target=drivesource.clean_uploads, daemon=True).start()
        if drivesource.AUDIT is None:
            raise ProfileError('Source audit observations are required')
        threading.Thread(target=drivesource.AUDIT.run, daemon=True).start()
        server.serve_forever()
    except Exception:
        sys.stderr.write('Guest source service could not be started.\n')
        return 1
    return 0


def main():
    try:
        if os.geteuid() != 0:
            raise ProfileError('Guest configuration requires its root supervisor')
        os.umask(0o077)
        private_directory(CONFIG)
        private_directory(PRIVATE)
        fd = os.open(PRIVATE / 'apply.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            runtime = trusted_json(CONFIG / 'runtime.json')
            config = trusted_staging_json(CONFIG / 'private-config.next')
            try:
                previous = trusted_json(CONFIG / 'private-config.json')
                validate(previous, runtime)
            except FileNotFoundError:
                previous = None
            apply(config, runtime, previous)
            os.replace(CONFIG / 'private-config.next', CONFIG / 'private-config.json')
    except Exception:
        # QGA completion and journals must never expose credential-bearing values.
        sys.stderr.write('Guest private configuration could not be applied.\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
