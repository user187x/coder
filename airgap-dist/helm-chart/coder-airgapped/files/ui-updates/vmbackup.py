"""Offline backups and restores of privately registered workspace VM HOME disks."""
import base64
import json
import gzip
import http.client
import math
import posixpath
import tarfile
import tempfile
import os
import pathlib
import re
import sys
import time
import threading
import urllib.parse
import urllib.request
import uuid

import vmgrow


def prepare(kube, ws):
    """Fence an owned stopped VM before scheduling any privileged storage work."""
    current = vmgrow.runtime(kube, ws['id'], ws)
    if not current:
        return None
    if not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', vmgrow.IMAGE):
        raise RuntimeError('The verified VM HOME helper is not configured yet.')
    if ws.get('latest_build', {}).get('status') != 'stopped' or current['vm'].get('spec', {}).get('runStrategy') != 'Halted':
        raise ValueError('Stop this workspace before backing up its VM HOME disk.')
    status, _ = kube('GET', '/apis/kubevirt.io/v1/namespaces/%s/virtualmachineinstances/coder-vm-%s' % (vmgrow.NAMESPACE, ws['id']))
    if status != 404:
        raise ValueError('Wait for the workspace VM to stop before accessing its HOME disk.')
    status, registry = kube('GET', '/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % vmgrow.RUNTIME_NAMESPACE)
    if status != 200:
        raise RuntimeError('The private VM HOME registry is unavailable.')
    record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(ws['id'])
    pvc = current['pvc']
    expected = {'workspace_id': ws['id'], 'organization_id': ws['organization_id'],
                'workspace_owner_id': ws['owner_id'], 'claim_uid': pvc['metadata']['uid'],
                'claim_name': pvc['metadata']['name'], 'pv_name': pvc['spec']['volumeName'],
                'home_bytes': current['size'], 'status': 'ready'}
    if not record or any(record.get(k) != value for k, value in expected.items()):
        raise RuntimeError('VM HOME provenance changed; no storage operation was started.')
    request = {k: record[k] for k in ('workspace_id', 'organization_id', 'workspace_owner_id', 'pv_uid')}
    request.update(version=1, pvc_uid=record['claim_uid'], old_bytes=current['size'],
                   record_resource_version=registry['metadata']['resourceVersion'])
    return {'request': request, 'node': record['node_name']}


def wait_stopped(kube, ws, refresh, current=None, timeout=900):
    """Wait for the exact stopped build's VMI and all HOME consumers to disappear."""
    current = current or vmgrow.runtime(kube, ws['id'], ws)
    if not current:
        raise RuntimeError('The retained VM disappeared while waiting for its stop.')
    vm = current['vm']['metadata']
    claim = current['pvc']['metadata']['name']
    build_id = ws.get('latest_build', {}).get('id')
    if not build_id or not vm.get('uid'):
        raise RuntimeError('The stopped VM has no stable build or resource identity.')
    base = '/apis/kubevirt.io/v1/namespaces/' + vmgrow.NAMESPACE
    deadline = time.monotonic() + timeout
    delay = threading.Event()
    while True:
        fresh = refresh()
        if fresh.get('id') != ws['id'] or fresh.get('owner_id') != ws['owner_id'] or fresh.get('organization_id') != ws['organization_id'] or fresh.get('latest_build', {}).get('id') != build_id or fresh.get('latest_build', {}).get('status') != 'stopped':
            raise RuntimeError('The workspace build changed while waiting for its VM to stop.')
        status, latest = kube('GET', base + '/virtualmachines/' + vm['name'])
        if status != 200 or latest.get('metadata', {}).get('uid') != vm['uid'] or latest.get('spec', {}).get('runStrategy') != 'Halted':
            raise RuntimeError('The workspace VM changed while waiting for its stop.')
        status, instance = kube('GET', base + '/virtualmachineinstances/' + vm['name'])
        if status not in (200, 404):
            raise RuntimeError('The workspace VM instance could not be checked safely.')
        code, pods = kube('GET', '/api/v1/namespaces/' + vmgrow.NAMESPACE + '/pods')
        if code != 200 or not isinstance(pods, dict):
            raise RuntimeError('The retained HOME consumers could not be checked safely.')
        consumers = any(any(v.get('persistentVolumeClaim', {}).get('claimName') == claim for v in p.get('spec', {}).get('volumes', [])) for p in pods.get('items', []))
        if status == 404 and not consumers:
            return fresh
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('The workspace VM or its retained HOME consumers did not stop within the deadline.')
        delay.wait(min(1, remaining))


def job_body(prepared, action, url):
    """Build a fixed control-plane Job; tenant input cannot supply host paths or commands."""
    if action not in ('backup', 'restore'):
        raise ValueError('Unsupported VM HOME operation.')
    name = 'coder-vm-' + action + '-' + uuid.uuid4().hex[:16]
    request = prepared['request']
    spec = {
        'serviceAccountName': 'coder-vm-home-manager', 'restartPolicy': 'Never', 'hostPID': True,
        'nodeSelector': {'kubernetes.io/hostname': prepared['node']},
        'tolerations': [{'key': 'platform.coder/workspace-vm-host', 'operator': 'Exists', 'effect': 'NoSchedule'}],
        'containers': [{'name': action, 'image': vmgrow.IMAGE, 'imagePullPolicy': 'IfNotPresent',
            'command': ['python3', '/app/vmbackup.py', action, base64.b64encode(json.dumps(request).encode()).decode()],
            'env': [{'name': 'WORKSPACE_NAMESPACE', 'value': vmgrow.NAMESPACE},
                    {'name': 'POD_NAMESPACE', 'value': vmgrow.RUNTIME_NAMESPACE},
                    {'name': 'NODE_NAME', 'valueFrom': {'fieldRef': {'fieldPath': 'spec.nodeName'}}},
                    {'name': 'CODER_VM_TRANSFER_URL', 'value': url}],
            'securityContext': {'privileged': True, 'runAsUser': 0},
            'resources': {'requests': {'cpu': '1', 'memory': '1Gi'}, 'limits': {'cpu': '2', 'memory': '2Gi'}},
            'volumeMounts': [{'name': 'udev-rule', 'mountPath': '/etc/udev/rules.d/10-coder-vm-home.rules', 'readOnly': True}, {'name': 'udev-stock', 'mountPath': '/usr/lib/udev/rules.d/60-persistent-storage.rules', 'readOnly': True}, {'name': 'homes', 'mountPath': vmgrow.MANAGED_PARENT},
                             {'name': 'devices', 'mountPath': '/dev'}]}],
        'volumes': [{'name': 'udev-rule', 'hostPath': {'path': '/etc/udev/rules.d/10-coder-vm-home.rules', 'type': 'File'}}, {'name': 'udev-stock', 'hostPath': {'path': '/usr/lib/udev/rules.d/60-persistent-storage.rules', 'type': 'File'}}, {'name': 'homes', 'hostPath': {'path': vmgrow.MANAGED_PARENT, 'type': 'Directory'}},
                    {'name': 'devices', 'hostPath': {'path': '/dev', 'type': 'Directory'}}]}
    return {'apiVersion': 'batch/v1', 'kind': 'Job',
            'metadata': {'name': name, 'namespace': vmgrow.RUNTIME_NAMESPACE,
                         'labels': {'com.coder.workspace.id': request['workspace_id'], 'com.coder.organization.id': request['organization_id']}},
            'spec': {'backoffLimit': 0, 'ttlSecondsAfterFinished': 3600, 'activeDeadlineSeconds': 21600,
                     'template': {'metadata': {'labels': {'platform.coder/vm-home-operation': action}}, 'spec': spec}}}


def contains(actual, expected):
    """Compare fixed Job intent while permitting API-server defaulted fields."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(key in actual and contains(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(contains(a,b) for a,b in zip(actual,expected))
    return actual == expected


def run(kube, prepared, action, url):
    """Wait for the exact Job UID, including disk unmount and provenance release."""
    body = job_body(prepared, action, url)
    base = '/apis/batch/v1/namespaces/%s/jobs' % vmgrow.RUNTIME_NAMESPACE
    status, created = kube('POST', base, body)
    if status != 201:
        raise RuntimeError('The fixed VM HOME storage Job could not be created.')
    metadata = created.get('metadata', {}) if isinstance(created, dict) else {}
    if not metadata.get('uid'):
        status, created = kube('GET', base + '/' + body['metadata']['name'])
        if status != 200 or not contains(created, {'metadata': body['metadata'], 'spec': body['spec']}):
            raise RuntimeError('VM HOME storage Job intent could not be verified after a creation retry.')
        metadata = created.get('metadata', {})
    uid, name = metadata.get('uid'), metadata.get('name')
    if not uid or name != body['metadata']['name']:
        raise RuntimeError('VM HOME storage Job identity is unavailable.')
    deadline = time.monotonic() + 21630
    while time.monotonic() < deadline:
        status, job = kube('GET', base + '/' + name)
        if status != 200 or job.get('metadata', {}).get('uid') != uid:
            raise RuntimeError('VM HOME storage Job identity changed; no success is claimed.')
        if job.get('status', {}).get('succeeded'):
            return
        if job.get('status', {}).get('failed'):
            raise RuntimeError('VM HOME operation failed. Its disk and any safety copy remain retained for review.')
        time.sleep(2)
    raise RuntimeError('VM HOME operation timed out; no success is claimed.')


def safety_copy(directory):
    """Retain a verified sparse raw-disk copy before replacing any HOME contents."""
    import vmhome
    raw = directory / 'home.raw'
    backup = directory / ('before-restore-' + uuid.uuid4().hex + '.raw')
    with raw.open('rb') as source, backup.open('xb') as target:
        for block in iter(lambda: source.read(1048576), b''):
            if any(block):
                target.write(block)
            else:
                target.seek(len(block), 1)
        target.truncate(source.tell())
        target.flush()
        os.fsync(target.fileno())
    os.chmod(backup, 0o600)
    if vmhome.digest(raw) != vmhome.digest(backup):
        raise RuntimeError('VM HOME safety-copy verification failed.')
    return backup


MAX_METADATA = 64 * 1024
MAX_ENTRIES = 200000
METADATA_BUDGET = 64 * 1024 * 1024
CONTROL_BUDGET = 16 * 1024 * 1024


def check_archive(path, capacity):
    """Bound raw tar headers before parsing extensions, then reject unsafe members."""
    if type(capacity) is not int or capacity <= 0:
        raise ValueError('A verified VM HOME capacity is required.')
    budget = capacity + METADATA_BUDGET
    total = entries = controls = 0
    try:
        with gzip.open(path, 'rb') as stream:
            def read(amount):
                nonlocal total
                if amount > budget - total:
                    raise ValueError('The VM backup exceeds its HOME capacity budget.')
                result = stream.read(amount)
                total += len(result)
                if len(result) != amount:
                    raise ValueError('The VM backup is truncated.')
                return result
            while True:
                header = read(512)
                if header == bytes(512):
                    while True:
                        block = stream.read(min(1048576, budget - total + 1))
                        total += len(block)
                        if total > budget or any(block):
                            raise ValueError('The VM backup has excessive or trailing data.')
                        if not block:
                            break
                    break
                member = tarfile.TarInfo.frombuf(header, 'utf-8', 'surrogateescape')
                entries += 1
                if entries > MAX_ENTRIES or member.size < 0:
                    raise ValueError('The VM backup has too many entries.')
                extension = member.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK)
                if extension:
                    if member.size > MAX_METADATA:
                        raise ValueError('VM backup metadata exceeds its limit.')
                    controls += member.size
                    if controls > CONTROL_BUDGET:
                        raise ValueError('Cumulative VM backup metadata exceeds its limit.')
                    data = read(member.size)
                    if member.type in (tarfile.XHDTYPE, tarfile.XGLTYPE):
                        # A tiny PAX record cannot override size to an unbounded allocation.
                        for line in data.splitlines():
                            key, separator, value = line.partition(b'=')
                            if not separator:
                                raise ValueError('Invalid VM backup metadata.')
                            key = key.partition(b' ')[2]
                            if key == b'size' and (not value.isdigit() or int(value) > capacity):
                                raise ValueError('VM backup file exceeds its HOME capacity.')
                            if b'sparse' in key.lower():
                                raise ValueError('Sparse tar extensions are not supported for VM restores.')
                else:
                    if member.size > capacity:
                        raise ValueError('VM backup file exceeds its HOME capacity.')
                    remaining = member.size
                    while remaining:
                        chunk = min(1048576, remaining)
                        read(chunk)
                        remaining -= chunk
                padding = -member.size % 512
                if padding:
                    read(padding)
        members = {}
        size = names = 0
        files = 0
        with tarfile.open(path, 'r:gz') as archive:
            for member in archive:
                name = posixpath.normpath(member.name)
                if member.name.startswith('/') or '..' in member.name.split('/') or '\0' in member.name or len(member.name) > 4096:
                    raise ValueError('VM backup entry escapes retained HOME.')
                if not (member.isfile() or member.isdir() or member.issym() or member.islnk()) or member.sparse is not None:
                    raise ValueError('VM backups may contain only normal HOME files, folders and safe links.')
                size += member.size if member.isfile() else 0
                if size > capacity or len(members) >= MAX_ENTRIES:
                    raise ValueError('VM backup contents exceed retained HOME capacity.')
                names += len(name.encode('utf-8', 'surrogateescape')) + len(member.linkname.encode('utf-8', 'surrogateescape'))
                if names > CONTROL_BUDGET:
                    raise ValueError('Cumulative VM backup paths exceed their limit.')
                if name in members or (name in ('', '.') and not member.isdir()):
                    raise ValueError('VM backup has duplicate entries or replaces its HOME root.')
                if not all(type(value) is int and 0 <= value < 4294967295 for value in (member.uid, member.gid)) or not math.isfinite(member.mtime):
                    raise ValueError('VM backup has unsupported numeric ownership or timestamps.')
                if member.issym() or member.islnk():
                    if len(member.linkname) > 4096 or '\0' in member.linkname:
                        raise ValueError('Invalid VM backup link.')
                    if member.islnk():
                        target = posixpath.normpath(member.linkname)
                        if member.linkname.startswith('/') or target == '..' or target.startswith('../'):
                            raise ValueError('VM backup hard link escapes retained HOME.')
                members[name] = member
                files += name not in ('', '.', '.coder-backup.json')
            # No member or hard-link source may traverse another member's symlink.
            for name, member in members.items():
                paths = [name]
                if member.islnk():
                    paths.append(posixpath.normpath(member.linkname))
                for value in paths:
                    parts = value.split('/')
                    if any(prefix in members and not members[prefix].isdir() for prefix in ('/'.join(parts[:i]) for i in range(1, len(parts)))):
                        raise ValueError('VM backup entries cannot traverse symbolic links or non-directories.')
                if member.islnk() and (posixpath.normpath(member.linkname) not in members or not members[posixpath.normpath(member.linkname)].isfile()):
                    raise ValueError('VM backup hard link requires a regular HOME file.')
        if not files:
            raise ValueError('The VM backup is empty.')
        return files
    except (tarfile.TarError, OSError, EOFError, UnicodeError) as error:
        raise ValueError('Invalid VM HOME archive.') from error


def restore_capacity(current, plan, max_gb):
    """Bound staging by the stopped HOME or an approved new-workspace size."""
    capacity = current['size']
    if plan.get('mode') == 'new':
        for parameter in plan.get('parameters', []):
            if parameter.get('name') == 'home_disk_size':
                value = str(parameter.get('value', ''))
                if value.isdigit() and 0 < int(value) <= max_gb:
                    capacity = max(capacity, int(value) * 1000000000)
    return capacity


def upload_archive(path, url):
    parsed = urllib.parse.urlsplit(url)
    connection = (http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection)(parsed.hostname, parsed.port, timeout=600)
    try:
        with pathlib.Path(path).open('rb') as source:
            connection.request('PUT', parsed.path, body=source, headers={'Content-Type': 'application/gzip', 'Content-Length': str(pathlib.Path(path).stat().st_size)})
            response = connection.getresponse()
            response.read()
            if response.status != 200:
                raise RuntimeError('VM HOME archive transfer did not complete.')
    finally:
        connection.close()


def download_archive(url, path, capacity):
    """Bound staging before touching the HOME registry or block device."""
    maximum = capacity + METADATA_BUDGET
    count = 0
    with urllib.request.urlopen(url, timeout=600) as source, path.open('xb') as target:
        while True:
            block = source.read(min(1048576, maximum - count + 1))
            if not block:
                break
            count += len(block)
            if count > maximum:
                raise ValueError('The VM backup download exceeds its capacity budget.')
            target.write(block)
    os.chmod(path, 0o600)


def worker(kube, request, action, url):
    """Transfer a verified stopped HOME through the isolated filesystem appliance."""
    import vmhome
    if action not in ('backup', 'restore'):
        raise ValueError('Unsupported VM HOME operation.')
    parsed = urllib.parse.urlsplit(url)
    suffix = 'archive' if action == 'backup' else 'restore'
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not re.fullmatch(r'/__coder-ui/internal/volumes/[A-Za-z0-9_-]{40,64}/' + suffix, parsed.path):
        raise ValueError('Invalid one-use VM HOME transfer URL.')
    capacity = request.get('old_bytes')
    if type(capacity) is not int or capacity <= 0:
        raise ValueError('A verified VM HOME capacity is required.')
    import vmfs
    vmfs.available()
    reservation = vmhome.restore_reservation(kube, request, capacity + METADATA_BUDGET, operation=action)
    with reservation as reserved_request, tempfile.TemporaryDirectory(prefix='coder-vm-restore-', dir=vmhome.PARENT) as staging:
        download = pathlib.Path(staging) / 'restore.tar.gz'
        if action == 'restore':
            download_archive(url, download, capacity)
            check_archive(download, capacity)
        with vmhome.locked_home(kube, reserved_request, action) as home:
            directory = pathlib.Path(home['directory'])
            if action == 'restore':
                home['record']['backup_file'] = safety_copy(directory).name
                vmfs.operate(directory / 'home.raw', 'restore', archive=download)
            else:
                vmfs.operate(directory / 'home.raw', 'backup', archive=download)
                check_archive(download, capacity)
                upload_archive(download, url)



if __name__ == '__main__':
    try:
        import vmhome
        worker(vmhome.client(), json.loads(base64.b64decode(sys.argv[2], validate=True)), sys.argv[1], os.environ['CODER_VM_TRANSFER_URL'])
    except (Exception, SystemExit):
        # Transfer tokens and private configuration must never enter Job logs.
        print('VM HOME backup or restore failed; retained storage requires review.', file=sys.stderr)
        sys.exit(1)
