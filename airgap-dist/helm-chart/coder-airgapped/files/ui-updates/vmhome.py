#!/usr/bin/env python3
"""Privileged, UID-fenced exact-sized workspace HOME operations on one worker."""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import urllib.parse
import shutil
import ssl
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

from vmprofile import identifier

PARENT = pathlib.Path('/var/lib/coder-vm-homes')
DEVICES = pathlib.Path('/dev/coder-vm-homes')
REGISTRY = 'coder-vm-home-provenance'
LOOP_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
UDEV_RULE = pathlib.Path('/etc/udev/rules.d/10-coder-vm-home.rules')
UDEV_RULE_SHA256 = '4efde29359ccd88f6f7f55370915e4d97d95d104f3bee27cbe2e872f9a0fc2e2'


class HomeError(RuntimeError):
    """The requested HOME operation is not safe to perform."""


class Client:
    def __init__(self):
        root = pathlib.Path('/var/run/secrets/kubernetes.io/serviceaccount')
        self.token = root.joinpath('token').read_text().strip()
        self.context = ssl.create_default_context(cafile=str(root / 'ca.crt'))
        host = os.environ['KUBERNETES_SERVICE_HOST']
        self.url = 'https://' + ('[' + host + ']' if ':' in host else host) + ':' + os.environ.get('KUBERNETES_SERVICE_PORT', '443')

    def call(self, method, path, body=None, content_type='application/json'):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': content_type})
        try:
            with urllib.request.urlopen(request, context=self.context, timeout=10) as response:
                raw = response.read(2097152)
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            return error.code, {}


NODE_IDENTITY = pathlib.Path('/etc/coder-vm/node-identity.json')
NODE_CA = pathlib.Path('/etc/coder-vm/node-api-ca.crt')
NODE_CERTIFICATE = pathlib.Path('/var/lib/kubelet/pki/kubelet-client-current.pem')


def trusted_host_file(path, private=False):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise HomeError('worker identity file is not trusted')
    return info


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class WorkerIdentityClient:
    """Read only this worker's current Node through its existing kubelet TLS identity."""

    def __init__(self):
        trusted_host_file(NODE_IDENTITY, private=True)
        if NODE_IDENTITY.stat().st_size > 8192:
            raise HomeError('worker identity configuration exceeds bound')
        config = json.loads(NODE_IDENTITY.read_text())
        if not isinstance(config, dict) or set(config) != {'server', 'node_name'}:
            raise HomeError('worker identity configuration is invalid')
        server, name = config['server'], config['node_name']
        if not isinstance(server, str) or not isinstance(name, str) or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?', name):
            raise HomeError('worker identity configuration is invalid')
        url = urllib.parse.urlsplit(server)
        if url.scheme != 'https' or not url.hostname or url.username is not None or url.password is not None or url.path or url.query or url.fragment or '?' in server or '#' in server or not re.fullmatch(r'[a-zA-Z0-9:.\[\]-]+', url.netloc):
            raise HomeError('worker API must be an exact HTTPS origin')
        if url.port is not None and not 1 <= url.port <= 65535:
            raise HomeError('worker API port is invalid')
        trusted_host_file(NODE_CA)
        link = NODE_CERTIFICATE.lstat()
        if link.st_uid != 0:
            raise HomeError('worker kubelet certificate is not trusted')
        certificate = NODE_CERTIFICATE.resolve(strict=True)
        if certificate.parent != NODE_CERTIFICATE.parent or not re.fullmatch(r'kubelet-client-(?:current|[0-9-]+)\.pem', certificate.name):
            raise HomeError('worker kubelet certificate path is invalid')
        trusted_host_file(certificate, private=True)
        context = ssl.create_default_context(cafile=str(NODE_CA))
        context.load_cert_chain(str(certificate))
        self.opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect())
        self.url, self.node_name = server, name

    def call(self, method, path, body=None, content_type=None):
        if method != 'GET' or body is not None or path != '/api/v1/nodes/' + self.node_name:
            raise HomeError('worker identity client only reads its own Node')
        # Network readiness can lag boot ordering. Retry transport availability,
        # never authentication, TLS verification, or a returned identity mismatch.
        for attempt in range(6):
            try:
                with self.opener.open(self.url + path, timeout=5) as response:
                    raw = response.read(2097153)
                    if len(raw) > 2097152:
                        raise HomeError('worker Node identity response exceeds bound')
                    return response.status, json.loads(raw)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                    raise
                error.close()
            except urllib.error.URLError as error:
                if isinstance(error.reason, ssl.SSLError) or attempt == 5:
                    raise
            except (TimeoutError, ConnectionError):
                if attempt == 5:
                    raise
            time.sleep(2)


def verified_node(kube, record, require_ready=True, require_local=True):
    """Require the original enrolled Node UID, never just a reusable hostname."""
    try:
        expected = identifier(record.get('node_uid'))
    except (ValueError, TypeError):
        raise HomeError('HOME original worker UID requires reviewed enrollment') from None
    name = record.get('node_name')
    if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?', name):
        raise HomeError('HOME worker identity is invalid')
    if require_local and os.environ.get('NODE_NAME') != name:
        raise HomeError('HOME operation is running on another worker')
    node = get(kube, '/api/v1/nodes/' + name)
    if not isinstance(node, dict) or node.get('metadata', {}).get('uid') != expected:
        raise HomeError('HOME original worker UID does not match the current Node')
    if require_ready and not any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in node.get('status', {}).get('conditions', [])):
        raise HomeError('HOME worker is not reachable and Ready')
    return node


def client():
    """Return the projected-service-account Kubernetes client for fixed Jobs."""
    return Client()


def call(kube, method, path, body=None, content_type='application/json'):
    function = kube.call if hasattr(kube, 'call') else kube
    return function(method, path, body, content_type)


def get(kube, path, missing=False):
    status, value = call(kube, 'GET', path)
    if missing and status == 404:
        return None
    if status != 200:
        raise HomeError('HOME control-plane lookup failed')
    return value


def run(*arguments, codes=(0,), env=None):
    result = subprocess.run(arguments, text=True, capture_output=True, env=env)
    if result.returncode not in codes:
        raise HomeError('HOME filesystem operation failed')
    return result.stdout.strip()


def settings():
    namespace = os.environ.get('WORKSPACE_NAMESPACE', 'coder')
    registry_namespace = os.environ.get('POD_NAMESPACE', 'coder-runtime-system')
    return namespace, '/api/v1/namespaces/' + registry_namespace + '/configmaps/' + REGISTRY


def request_identity(request):
    if type(request.get('version')) is not int or request.get('version') != 1:
        raise HomeError('unsupported HOME operation version')
    for field in ('workspace_id', 'organization_id', 'workspace_owner_id'):
        identifier(request.get(field))
    if 'build_id' in request:
        identifier(request['build_id'])
    for key in ('old_bytes', 'new_bytes'):
        if key in request and (type(request[key]) is not int or request[key] < 0 or request[key] % 512):
            raise HomeError('HOME sizes must be exact positive sectors')
    if not request.get('pvc_uid') or not request.get('record_resource_version'):
        raise HomeError('HOME operation requires immutable claim and provenance fences')


def update_record(kube, path, wid, expected, replacement, resource_version=None):
    for _ in range(5):
        registry = get(kube, path)
        if resource_version is not None and registry['metadata']['resourceVersion'] != resource_version:
            raise HomeError('HOME provenance changed before operation')
        records = json.loads((registry.get('data') or {}).get('homes.json', '{}'))
        if records.get(wid) != expected:
            raise HomeError('HOME provenance operation fence changed')
        records[wid] = replacement
        patch = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': registry['metadata']['resourceVersion']},
                 {'op': 'add', 'path': '/data/homes.json', 'value': json.dumps(records, sort_keys=True)}]
        status, _ = call(kube, 'PATCH', path, patch, 'application/json-patch+json')
        if status == 200:
            return
        if status != 409:
            raise HomeError('HOME provenance update failed')
    raise HomeError('HOME provenance update conflicted')


def stopped(kube, request, record):
    namespace, _ = settings()
    wid = request['workspace_id']
    vm = get(kube, '/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachines/coder-vm-' + wid)
    metadata = vm.get('metadata', {})
    labels, annotations = metadata.get('labels', {}), metadata.get('annotations', {})
    if vm.get('spec', {}).get('runStrategy') != 'Halted' or annotations.get('platform.coder/desired-run-strategy') != 'Halted' or metadata.get('deletionTimestamp'):
        raise HomeError('stop the workspace VM before operating on HOME')
    expected_labels = {'com.coder.workspace.id': wid, 'com.coder.organization.id': request['organization_id'], 'com.coder.user.id': request['workspace_owner_id']}
    if any(labels.get(key) != value for key, value in expected_labels.items()):
        raise HomeError('HOME VM ownership differs from request')
    intent = {key: annotations.get(key) for key in ('platform.coder/build-id', 'com.coder.agent.id', 'platform.coder/desired-run-strategy')}
    try:
        identifier(intent['platform.coder/build-id'])
        identifier(intent['com.coder.agent.id'])
    except (ValueError, TypeError):
        raise HomeError('HOME VM build identity is unavailable') from None
    generation = metadata.get('generation')
    if type(generation) is not int or generation < 1:
        raise HomeError('HOME VM generation is unavailable')
    if get(kube, '/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachineinstances/coder-vm-' + wid, True):
        raise HomeError('HOME VM instance is still present')
    pods = get(kube, '/api/v1/namespaces/' + namespace + '/pods')
    for pod in pods.get('items', []):
        if pod.get('status', {}).get('phase') in ('Succeeded', 'Failed'):
            continue
        if any(v.get('persistentVolumeClaim', {}).get('claimName') == record['claim_name'] for v in pod.get('spec', {}).get('volumes', [])):
            raise HomeError('HOME still has a pod consumer')
    verified_node(kube, record)
    # Status updates during PVC rebinding change resourceVersion. Fence actual
    # intent instead; generation also detects a spec change followed by reversal.
    # Protected metadata comes from trusted controllers and build IDs never reuse.
    # A metadata-only change and reversal is not inferred from final values.
    spec_hash = hashlib.sha256(json.dumps(vm['spec'], sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return {'uid': metadata['uid'], 'generation': generation, 'spec_sha256': spec_hash, 'labels': expected_labels, 'annotations': intent}


def private_directory(wid):
    directory = PARENT / identifier(wid)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise HomeError('HOME management directory is not root-private')
    return directory


@contextlib.contextmanager
def loop_lock():
    PARENT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if PARENT.lstat().st_uid != 0 or not PARENT.is_dir() or PARENT.is_symlink():
        raise HomeError('HOME parent is not a root-controlled directory')
    os.chmod(PARENT, 0o700)
    with PARENT.joinpath('loop-allocation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def persist(path, value):
    temporary = path.with_name(path.name + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def journal(directory, value):
    persist(directory / 'operation.json', value)


def require_probe_guard():
    """Refuse loop publication unless the worker's audited udev opt-out is present."""
    try:
        info = UDEV_RULE.lstat()
        valid = (stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
                 not info.st_mode & 0o022 and
                 hashlib.sha256(UDEV_RULE.read_bytes()).hexdigest() == UDEV_RULE_SHA256)
        stock = pathlib.Path('/usr/lib/udev/rules.d/60-persistent-storage.rules').read_text()
        valid = valid and 'ENV{UDEV_DISABLE_PERSISTENT_STORAGE_RULES_FLAG}=="1", GOTO="persistent_storage_end"' in stock
    except OSError:
        valid = False
    if not valid:
        raise HomeError('Worker HOME device probe suppression is unavailable')



def host_loop_args(*arguments):
    """Operate on loop files through the worker's mount namespace and root."""
    if pathlib.Path('/proc/1/comm').read_text().strip() != 'systemd':
        raise HomeError('HOME loop control requires the worker PID namespace')
    host_root = pathlib.Path('/proc/1/root')
    parent, host_parent = PARENT.stat(), (host_root / str(PARENT).lstrip('/')).stat()
    if parent.st_uid != 0 or parent.st_mode & 0o077 or (parent.st_dev, parent.st_ino) != (host_parent.st_dev, host_parent.st_ino):
        raise HomeError('HOME worker directory differs from the mounted binding')
    binary = host_root / 'usr/sbin/losetup'
    info = binary.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise HomeError('HOME worker loop controller is not trusted')
    for argument in arguments:
        if argument.startswith(str(PARENT) + '/'):
            path = pathlib.Path(argument)
            identifier(path.parent.name)
            if path.parent.parent != PARENT or path.name not in ('home.raw', 'operation-guard.raw'):
                raise HomeError('HOME loop backing path is not managed')
            current, target = path.lstat(), (host_root / argument.lstrip('/')).lstat()
            if not stat.S_ISREG(current.st_mode) or current.st_uid != 0 or current.st_mode & 0o077 or (current.st_dev, current.st_ino) != (target.st_dev, target.st_ino):
                raise HomeError('HOME worker backing file differs from the mounted binding')
    if os.stat('/proc/self/ns/mnt').st_ino == os.stat('/proc/1/ns/mnt').st_ino:
        return ['/usr/sbin/losetup', *arguments]
    return ['/usr/bin/nsenter', '--target', '1', '--mount', '--root=/proc/1/root', '--wdns=/', '--', '/usr/sbin/losetup', *arguments]


def loop_command(*arguments, codes=(0,)):
    return run(*host_loop_args(*arguments), codes=codes, env=LOOP_ENV)


def verify_loop_identity(device, raw, size, limit=None):
    """Match kernel backing identity, not namespace-relative display names."""
    rows = json.loads(loop_command('--json', '--list', '--output', 'NAME,BACK-FILE,BACK-INO,BACK-MAJ:MIN,SIZELIMIT'))['loopdevices']
    rows = [row for row in rows if row['name'] == device]
    info = raw.lstat()
    if len(rows) != 1:
        raise HomeError('HOME loop identity is unavailable')
    row = rows[0]
    expected_dev = '%s:%s' % (os.major(info.st_dev), os.minor(info.st_dev))
    if row.get('back-file') != str(raw) or row.get('back-ino') != info.st_ino or row.get('back-maj:min') != expected_dev or row.get('sizelimit') != (size if limit is None else limit):
        raise HomeError('HOME loop backing identity differs from the worker file')


def device_for(directory, size, publish=True):
    require_probe_guard()
    raw = directory / 'home.raw'
    info = raw.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size != size:
        raise HomeError('HOME backing image differs from its verified capacity')
    with loop_lock():
        device = loop_command('--find', '--show', '--nooverlap', '--sizelimit', str(size), str(raw))
    verify_loop_identity(device, raw, size)
    if not device.startswith('/dev/loop') or int(run('blockdev', '--getsize64', device)) != size:
        raise HomeError('HOME loop capacity differs from its allocation')
    if publish:
        DEVICES.mkdir(mode=0o755, exist_ok=True)
        alias = DEVICES / directory.name
        if alias.is_symlink():
            alias.unlink()
        elif alias.exists():
            raise HomeError('HOME stable device alias is not a managed symlink')
        alias.symlink_to(device)
    return device


def quarantine(device, directory):
    """Fence late consumers with a read-only guard before opening data privately."""
    require_probe_guard()
    guard = directory / 'operation-guard.raw'
    if not guard.exists():
        with guard.open('xb') as stream:
            stream.write(bytes(512))
        os.chmod(guard, 0o600)
    with loop_lock():
        no_openers(device)
        loop_command('--detach', device)
        state = subprocess.run(host_loop_args(device), text=True, capture_output=True, env=LOOP_ENV)
        if state.returncode == 0:
            raise HomeError('HOME device still has a delayed consumer; no data was changed')
        loop_command('--read-only', device, str(guard))
        verify_loop_identity(device, guard, 512, limit=0)
    if int(run('blockdev', '--getsize64', device)) != 512 or run('blockdev', '--getro', device) != '1':
        raise HomeError('HOME device quarantine could not be verified')


def restore_device(original, private, directory, size):
    """Publish completed data on its original device only after all operations end."""
    require_probe_guard()
    no_openers(private)
    with loop_lock():
        loop_command('--detach', private)
        loop_command('--detach', original)
        loop_command('--sizelimit', str(size), original, str(directory / 'home.raw'))
        verify_loop_identity(original, directory / 'home.raw', size)
    if int(run('blockdev', '--getsize64', original)) != size:
        raise HomeError('HOME device publication capacity differs')


def no_openers(device):
    if pathlib.Path('/proc/1/comm').read_text().strip() != 'systemd':
        raise HomeError('HOME operation requires the worker PID namespace')
    expected = os.stat(device).st_rdev
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdecimal():
            continue
        try:
            for fd in process.joinpath('fd').iterdir():
                try:
                    info = fd.stat()
                except FileNotFoundError:
                    continue
                if stat.S_ISBLK(info.st_mode) and info.st_rdev == expected:
                    raise HomeError('HOME block device is still open by a process')
        except FileNotFoundError:
            continue
        except PermissionError as exc:
            raise HomeError('cannot verify HOME device consumers') from exc


@contextlib.contextmanager
def locked_home(kube, request, operation='backup'):
    """Yield device/directory/record after exclusive API, UID and physical fences.

    A successful caller must unmount before returning. Any exception leaves the
    record needs-review; automatic workspace starts remain blocked.
    """
    request_identity(request)
    if operation not in ('backup', 'restore', 'resizing'):
        raise HomeError('unsupported exclusive HOME operation')
    namespace, registry_path = settings()
    registry = get(kube, registry_path)
    if registry['metadata']['resourceVersion'] != request['record_resource_version']:
        raise HomeError('HOME provenance changed before operation')
    record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(request['workspace_id'])
    if not record or (record.get('status') != 'ready' and not (operation in ('restore', 'backup') and record.get('status') == operation + '-staging' and record.get('reservation_id') == request.get('reservation_id'))):
        raise HomeError('HOME has another operation or needs review')
    for field in ('workspace_id', 'organization_id', 'workspace_owner_id'):
        if record.get(field) != request[field]:
            raise HomeError('HOME ownership differs from request')
    if record.get('claim_uid') != request['pvc_uid'] or record.get('pv_uid') != request.get('pv_uid') or record.get('home_bytes') != request.get('old_bytes'):
        raise HomeError('HOME identity or size changed before operation')
    claim = get(kube, '/api/v1/namespaces/' + namespace + '/persistentvolumeclaims/' + record['claim_name'])
    pv = get(kube, '/api/v1/persistentvolumes/' + record['pv_name'])
    if claim['metadata']['uid'] != record['claim_uid'] or claim.get('spec', {}).get('volumeMode') != 'Block' or pv['metadata']['uid'] != record['pv_uid'] or pv.get('spec', {}).get('volumeMode') != 'Block':
        raise HomeError('HOME volume identity or Block mode differs')
    if pv.get('spec', {}).get('persistentVolumeReclaimPolicy') != 'Retain':
        raise HomeError('HOME physical volume must retain data when claims are rebound')
    if pv.get('spec', {}).get('claimRef', {}).get('uid') != record['claim_uid'] or pv.get('spec', {}).get('local', {}).get('path') != str(DEVICES / request['workspace_id']):
        raise HomeError('HOME physical volume is not the approved local device')
    vm_fence = stopped(kube, request, record)
    directory = private_directory(request['workspace_id'])
    with directory.joinpath('operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if directory.joinpath('operation.json').exists():
            raise HomeError('HOME has an unfinished local operation requiring review')
        original = device_for(directory, record['home_bytes'])
        active = dict(record, status=operation, operation_id=str(uuid.uuid4()), vm_fence=vm_fence)
        if operation == 'resizing':
            import vmfs
            active['reserved_bytes'] = request['new_bytes']
            active['reserved_operation_bytes'] = 2 * request['new_bytes'] + vmfs.SCRATCH_BYTES
        update_record(kube, registry_path, request['workspace_id'], record, active, request['record_resource_version'])
        working = dict(active)
        journal(directory, active)
        try:
            if stopped(kube, request, working) != vm_fence:
                raise HomeError('HOME VM changed before operation')
            quarantine(original, directory)
            device = device_for(directory, record['home_bytes'], publish=False)
            context = {'device': device, 'directory': str(directory), 'record': working}
            yield context
            if stopped(kube, request, working) != vm_fence:
                raise HomeError('HOME VM changed during the exclusive operation')
            restore_device(original, context['device'], directory, working['home_bytes'])
        except BaseException:
            journal(directory, dict(working, status='needs-review'))
            update_record(kube, registry_path, request['workspace_id'], active, dict(working, status='needs-review'))
            raise
        else:
            ready = dict(working, status='ready')
            ready.pop('operation_id', None)
            ready.pop('vm_fence', None)
            ready.pop('reserved_bytes', None)
            ready.pop('reserved_operation_bytes', None)
            ready.pop('reservation_id', None)
            persist(directory / 'manifest.json', ready)
            update_record(kube, registry_path, request['workspace_id'], active, ready)
            directory.joinpath('operation.json').unlink()


@contextlib.contextmanager
def restore_reservation(kube, request, archive_bytes, operation='restore'):
    """Reserve archive staging and a full raw safety copy before changing HOME."""
    request_identity(request)
    _, path = settings()
    registry = get(kube, path)
    record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(request['workspace_id'])
    if not record or record.get('status') != 'ready':
        raise HomeError('HOME has another operation or needs review')
    for field in ('workspace_id', 'organization_id', 'workspace_owner_id'):
        if record.get(field) != request[field]:
            raise HomeError('HOME ownership differs from request')
    if record.get('home_bytes') != request.get('old_bytes'):
        raise HomeError('HOME capacity changed before restore reservation')
    if operation not in ('backup', 'restore'):
        raise HomeError('unsupported archive maintenance operation')
    import vmfs
    vmfs.available()
    amount = 2 * archive_bytes + request['old_bytes'] * (2 if operation == 'restore' else 1) + vmfs.SCRATCH_BYTES
    ensure_capacity(kube, request, additional_bytes=amount)
    reserved = dict(record, status=operation + '-staging', reservation_id=str(uuid.uuid4()), reserved_operation_bytes=amount)
    update_record(kube, path, request['workspace_id'], record, reserved, request['record_resource_version'])
    try:
        current = get(kube, path)
        entries = json.loads(current.get('data', {}).get('homes.json', '{}'))
        if entries.get(request['workspace_id']) != reserved:
            raise HomeError('HOME restore reservation changed')
        yield dict(request, reservation_id=reserved['reservation_id'], record_resource_version=current['metadata']['resourceVersion'])
    finally:
        current = get(kube, path)
        entry = json.loads(current.get('data', {}).get('homes.json', '{}')).get(request['workspace_id'])
        if entry == reserved:
            update_record(kube, path, request['workspace_id'], reserved, record)


def digest(path):
    result = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def ensure_capacity(kube, request, preparing=False, additional_bytes=None):
    """Reserve logical HOME/root budgets instead of trusting sparse file usage."""
    _, path = settings()
    registry = get(kube, path)
    if registry['metadata']['resourceVersion'] != request['record_resource_version']:
        raise HomeError('HOME allocation reservation changed')
    records = json.loads(registry.get('data', {}).get('homes.json', '{}'))
    record = request if preparing else records.get(request['workspace_id']) or {}
    verified_node(kube, record)
    node = record['node_name']
    PARENT.mkdir(mode=0o700, parents=True, exist_ok=True)
    space = os.statvfs(PARENT)
    free = space.f_bavail * space.f_frsize
    node_reserve = int(os.environ.get('VM_HOME_NODE_RESERVE_BYTES', str(16 * 1073741824)))
    root_reserve = int(os.environ.get('VM_GUEST_ROOT_RESERVE_BYTES', str(16 * 1073741824)))
    if node_reserve < 0 or root_reserve < 0:
        raise HomeError('invalid root storage reserve policy')
    reserved = node_reserve
    for wid, record in records.items():
        if record.get('node_name') != node:
            continue
        raw = PARENT / identifier(wid) / 'home.raw'
        allocated = raw.stat().st_blocks * 512 if raw.exists() else 0
        logical = max(record.get('home_bytes', 0), record.get('reserved_bytes', 0))
        reserved += max(0, logical - allocated) + root_reserve + record.get('reserved_operation_bytes', 0)
    additional = additional_bytes if additional_bytes is not None else (request['new_bytes'] + root_reserve if preparing else request['new_bytes'] - request['old_bytes'] + request['old_bytes'])
    if additional <= 0 or free - reserved < additional:
        raise HomeError('insufficient verified worker storage capacity for this HOME operation')


def grow(kube, request):
    new_size = request.get('new_bytes')
    if type(new_size) is not int or new_size <= request.get('old_bytes', 0) or new_size % 512:
        raise HomeError('HOME can only grow to a larger sector-aligned size')
    request_identity(request)
    import vmfs
    vmfs.available()
    ensure_capacity(kube, request, additional_bytes=2 * new_size + vmfs.SCRATCH_BYTES)
    with locked_home(kube, request, 'resizing') as context:
        directory = pathlib.Path(context['directory'])
        raw = directory / 'home.raw'
        backup = directory / ('before-grow-' + context['record']['operation_id'] + '.raw')
        with raw.open('rb') as source, backup.open('xb') as target:
            for chunk in iter(lambda: source.read(1048576), b''):
                if not chunk.strip(b'\0'):
                    target.seek(len(chunk), 1)
                else:
                    target.write(chunk)
            target.truncate(source.tell())
            target.flush()
            os.fsync(target.fileno())
        os.chmod(backup, 0o600)
        if digest(backup) != digest(raw):
            raise HomeError('HOME safety backup verification failed')
        context['record']['backup_file'] = backup.name
        import vmfs
        vmfs.operate(raw, 'grow', size=new_size)
        loop_command('--detach', context['device'])
        context['device'] = device_for(directory, new_size, publish=False)
        if int(run('blockdev', '--getsize64', context['device'])) != new_size:
            raise HomeError('grown HOME capacity verification failed')
        # Rebind a retained local Block PVC because no CSI expander exists for it.
        namespace, _ = settings()
        record = context['record']
        claim_path = '/api/v1/namespaces/' + namespace + '/persistentvolumeclaims/' + record['claim_name']
        pv_path = '/api/v1/persistentvolumes/' + record['pv_name']
        claim = get(kube, claim_path)
        pv = get(kube, pv_path)
        if claim['metadata']['uid'] != request['pvc_uid'] or pv['metadata']['uid'] != request['pv_uid']:
            raise HomeError('HOME volume changed during filesystem growth')
        patch = [{'op': 'test', 'path': '/metadata/uid', 'value': pv['metadata']['uid']}, {'op': 'test', 'path': '/metadata/resourceVersion', 'value': pv['metadata']['resourceVersion']}, {'op': 'add', 'path': '/spec/capacity/storage', 'value': str(new_size)}]
        status, _ = call(kube, 'PATCH', pv_path, patch, 'application/json-patch+json')
        if status != 200:
            raise HomeError('grown HOME physical capacity update failed')
        status, _ = call(kube, 'DELETE', claim_path, {'apiVersion': 'v1', 'kind': 'DeleteOptions', 'preconditions': {'uid': claim['metadata']['uid'], 'resourceVersion': claim['metadata']['resourceVersion']}})
        if status not in (200, 202):
            raise HomeError('retained HOME claim rebind failed')
        deadline = time.monotonic() + 60
        while get(kube, claim_path, True) is not None:
            if time.monotonic() > deadline:
                raise HomeError('HOME claim deletion has not converged')
            time.sleep(0.2)
        new_claim = {'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim', 'metadata': {'name': record['claim_name'], 'namespace': namespace, 'labels': claim['metadata'].get('labels', {}), 'annotations': {**{key: value for key, value in claim['metadata'].get('annotations', {}).items() if key.startswith('platform.coder/')}, 'platform.coder/home-disk-bytes': str(new_size)}}, 'spec': {'accessModes': ['ReadWriteOnce'], 'volumeMode': 'Block', 'storageClassName': claim['spec'].get('storageClassName', 'coder-vm-home'), 'volumeName': record['pv_name'], 'resources': {'requests': {'storage': str(new_size)}}}}
        status, created = call(kube, 'POST', '/api/v1/namespaces/' + namespace + '/persistentvolumeclaims', new_claim)
        if status != 201:
            raise HomeError('grown HOME claim creation failed')
        # Keep the old reservation until the new claim UID exists; never expose
        # this retained volume as Available to unrelated pending claims.
        pv = get(kube, pv_path)
        replacement = {'name': record['claim_name'], 'namespace': namespace, 'uid': created['metadata']['uid']}
        status, _ = call(kube, 'PATCH', pv_path, [{'op': 'test', 'path': '/metadata/uid', 'value': request['pv_uid']},
            {'op': 'test', 'path': '/metadata/resourceVersion', 'value': pv['metadata']['resourceVersion']},
            {'op': 'test', 'path': '/spec/claimRef/uid', 'value': request['pvc_uid']},
            {'op': 'replace', 'path': '/spec/claimRef', 'value': replacement}], 'application/json-patch+json')
        if status != 200:
            raise HomeError('HOME physical rebind fence failed')
        deadline = time.monotonic() + 60
        while get(kube, pv_path).get('spec', {}).get('claimRef', {}).get('uid') != created['metadata']['uid']:
            if time.monotonic() > deadline:
                raise HomeError('grown HOME rebind has not converged')
            time.sleep(0.2)
        record.update(home_bytes=new_size, claim_uid=created['metadata']['uid'], initial_sha256=digest(raw), verified_at=time.time())
        persist(directory / 'manifest.json', record)
    return {'ok': True, 'home_bytes': new_size, 'backup_retained': True}


def acknowledge_claim(kube, namespace, name, uid, pv_name, size):
    """Fence retained metadata while tolerating the binder's resourceVersion update."""
    path = '/api/v1/namespaces/' + namespace + '/persistentvolumeclaims/' + name
    for _ in range(3):
        current = get(kube, path)
        if current['metadata']['uid'] != uid or current['spec'].get('volumeMode') != 'Block' or current['spec'].get('volumeName') not in (None, '', pv_name):
            raise HomeError('prepared HOME claim identity changed')
        from workspace_runtime import quantity
        if quantity(current['spec'].get('resources', {}).get('requests', {}).get('storage', '0')) != size:
            raise HomeError('prepared HOME claim capacity changed')
        annotations = dict(current['metadata'].get('annotations') or {})
        annotations.update({'platform.coder/retained-vm-home': 'true',
                            'platform.coder/home-disk-bytes': str(size)})
        status, _ = call(kube, 'PATCH', path, [
            {'op': 'test', 'path': '/metadata/uid', 'value': uid},
            {'op': 'test', 'path': '/metadata/resourceVersion', 'value': current['metadata']['resourceVersion']},
            {'op': 'add', 'path': '/metadata/annotations', 'value': annotations}], 'application/json-patch+json')
        if status == 200:
            return
        # A failed JSON Patch test can be 422; retry only a real version race.
        after = get(kube, path)
        if status not in (409, 422) or after['metadata']['uid'] != uid or after['metadata']['resourceVersion'] == current['metadata']['resourceVersion']:
            raise HomeError('prepared HOME retained claim acknowledgement failed (HTTP ' + str(status) + ')')
    raise HomeError('prepared HOME claim changed repeatedly during acknowledgement')


def prepare(kube, request):
    """Prepare one existing pending claim without touching an existing HOME image."""
    request_identity(request)
    size = request.get('new_bytes')
    if type(size) is not int or size <= 0 or size % 512:
        raise HomeError('prepared HOME requires an exact positive sector size')
    namespace, registry_path = settings()
    registry = get(kube, registry_path)
    if registry['metadata']['resourceVersion'] != request['record_resource_version']:
        raise HomeError('HOME provenance changed before preparation')
    records = json.loads(registry.get('data', {}).get('homes.json', '{}'))
    wid = request['workspace_id']
    if wid in records:
        raise HomeError('HOME is already registered; use its explicit operation')
    name = request.get('claim_name')
    if not isinstance(name, str) or len(name) > 253 or not __import__('re').fullmatch(r'[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?', name):
        raise HomeError('invalid prepared HOME claim name')
    claim = get(kube, '/api/v1/namespaces/' + namespace + '/persistentvolumeclaims/' + name)
    if claim['metadata']['uid'] != request['pvc_uid'] or claim.get('spec', {}).get('volumeMode') != 'Block' or claim.get('spec', {}).get('volumeName'):
        raise HomeError('HOME preparation requires the exact unbound Block claim')
    for label, field in (('com.coder.workspace.id', 'workspace_id'), ('com.coder.user.id', 'workspace_owner_id'), ('com.coder.organization.id', 'organization_id')):
        if claim['metadata'].get('labels', {}).get(label) != request[field]:
            raise HomeError('pending HOME claim ownership differs')
    from workspace_runtime import quantity
    if quantity(claim['spec'].get('resources', {}).get('requests', {}).get('storage', '0')) != size:
        raise HomeError('pending HOME request differs from requested capacity')
    if get(kube, '/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachineinstances/coder-vm-' + wid, True):
        raise HomeError('HOME cannot be prepared while a VM instance exists')
    node_name = request.get('node_name')
    if not isinstance(node_name, str) or node_name != os.environ.get('NODE_NAME'):
        raise HomeError('HOME preparation must run on its selected worker')
    verified_node(kube, request)
    ensure_capacity(kube, request, preparing=True)
    directory = private_directory(wid)
    with directory.joinpath('operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        raw = directory / 'home.raw'
        if raw.exists():
            raise HomeError('unregistered existing HOME data requires explicit recovery, never formatting')
        record = {key: request[key] for key in ('workspace_id', 'workspace_owner_id', 'organization_id')}
        record.update(status='preparing', claim_name=name, claim_uid=request['pvc_uid'], node_name=node_name, node_uid=request['node_uid'],
                      home_bytes=size, operation_id=str(uuid.uuid4()))
        update_record(kube, registry_path, wid, None, record, request['record_resource_version'])
        active = dict(record)
        journal(directory, active)
        try:
            with raw.open('xb') as stream:
                stream.truncate(size)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(raw, 0o600)
            # Format the private new file before publishing a block device.
            # Publishing first lets udev probes race the exclusive-open check.
            run('mkfs.ext4', '-F', '-m', '0', str(raw))
            verified_node(kube, record)
            device_for(directory, size)
            pv_name = 'coder-vm-home-' + wid
            pv = {'apiVersion': 'v1', 'kind': 'PersistentVolume', 'metadata': {'name': pv_name, 'labels': claim['metadata'].get('labels', {})}, 'spec': {'capacity': {'storage': str(size)}, 'volumeMode': 'Block', 'accessModes': ['ReadWriteOnce'], 'persistentVolumeReclaimPolicy': 'Retain', 'storageClassName': claim['spec'].get('storageClassName', 'coder-vm-home'), 'local': {'path': str(DEVICES / wid)}, 'claimRef': {'name': name, 'namespace': namespace, 'uid': request['pvc_uid']}, 'nodeAffinity': {'required': {'nodeSelectorTerms': [{'matchExpressions': [{'key': 'kubernetes.io/hostname', 'operator': 'In', 'values': [node_name]}]}]}}}}
            status, created = call(kube, 'POST', '/api/v1/persistentvolumes', pv)
            if status != 201:
                raise HomeError('prepared HOME physical volume creation failed')
            acknowledge_claim(kube, namespace, name, request['pvc_uid'], pv_name, size)
            verified_node(kube, record)
            record.update(pv_name=pv_name, pv_uid=created['metadata']['uid'], initial_sha256=digest(raw), verified_at=time.time(), status='ready')
            record.pop('operation_id', None)
            persist(directory / 'manifest.json', record)
            update_record(kube, registry_path, wid, active, record)
            directory.joinpath('operation.json').unlink()
        except BaseException:
            journal(directory, dict(record, status='needs-review'))
            update_record(kube, registry_path, wid, active, dict(record, status='needs-review'))
            raise
    return {'ok': True, 'home_bytes': size, 'pv_name': pv_name}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('grow', 'prepare'))
    parser.add_argument('--request-base64', required=True)
    args = parser.parse_args()
    if len(args.request_base64) > 16384:
        raise HomeError('HOME operation request exceeds limit')
    request = json.loads(base64.b64decode(args.request_base64, validate=True))
    result = (grow if args.operation == 'grow' else prepare)(client(), request)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (HomeError, ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, HomeError) else 'HOME operation failed; inspect the retained backup and provenance before retrying.'}))
        sys.exit(1)
