"""Fixed, offline Block HOME growth jobs for owned workspace VMs."""
import base64
import hashlib
import json
import os
import re
import time
import uuid

NAMESPACE = os.environ.get('CODER_NAMESPACE', 'coder')
RUNTIME_NAMESPACE = os.environ.get('WORKSPACE_VM_RUNTIME_NAMESPACE', 'coder-runtime-system')
IMAGE = os.environ.get('WORKSPACE_VM_GROW_IMAGE', '')
MANAGED_PARENT = '/var/lib/coder-vm-homes'


def runtime(kube, wid, ws=None):
    name = 'coder-vm-' + str(uuid.UUID(wid))
    status, vm = kube('GET', '/apis/kubevirt.io/v1/namespaces/%s/virtualmachines/%s' % (NAMESPACE, name))
    if status == 404:
        code, claim = kube('GET', '/api/v1/namespaces/%s/persistentvolumeclaims/coder-vm-%s-home' % (NAMESPACE, wid))
        if code == 200:
            raise RuntimeError('This workspace retains a VM HOME disk, but its VM is unavailable; the legacy directory will not be used.')
        if code != 404:
            raise RuntimeError('Could not safely inspect retained VM HOME storage.')
        code, ledger = kube('GET', '/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % RUNTIME_NAMESPACE)
        if code == 200 and wid in json.loads(ledger.get('data', {}).get('homes.json', '{}')):
            raise RuntimeError('This workspace has retained VM disk provenance; the legacy directory will not be used.')
        if code not in (200, 404):
            raise RuntimeError('Could not safely inspect retained VM disk provenance.')
        return None
    if status != 200 or not isinstance(vm, dict):
        raise RuntimeError('Could not inspect the workspace VM safely.')
    labels = vm.get('metadata', {}).get('labels', {})
    if labels.get('com.coder.workspace.id') != wid or (ws and any(labels.get(label) != ws[field] for label, field in (
            ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'owner_id')))):
        raise RuntimeError('VM organization or owner does not match the workspace.')
    volumes = vm.get('spec', {}).get('template', {}).get('spec', {}).get('volumes', [])
    claim = next((v.get('persistentVolumeClaim', {}).get('claimName') for v in volumes if v.get('name') == 'home'), None)
    if not claim or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,252}', claim):
        raise RuntimeError('Workspace VM has no managed HOME disk.')
    status, pvc = kube('GET', '/api/v1/namespaces/%s/persistentvolumeclaims/%s' % (NAMESPACE, claim))
    meta = pvc.get('metadata', {}) if isinstance(pvc, dict) else {}
    annotations = meta.get('annotations', {})
    if status != 200 or pvc.get('spec', {}).get('volumeMode') != 'Block' or annotations.get('platform.coder/retained-vm-home') != 'true' or any(
            meta.get('labels', {}).get(k) != labels.get(k) for k in ('com.coder.workspace.id', 'com.coder.organization.id', 'com.coder.user.id')):
        raise RuntimeError('VM HOME is not an owned retained Block volume.')
    try:
        size = int(annotations['platform.coder/home-disk-bytes'])
        if size <= 0:
            raise ValueError()
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError('VM HOME has no verified device capacity.') from exc
    return {'vm': vm, 'pvc': pvc, 'size': size}


def info(kube, wid):
    current = runtime(kube, wid)
    if not current:
        return None
    pvc = current['pvc']
    return {'name': pvc['metadata']['name'], 'sizeGB': current['size'] / 1e9, 'requestedGB': current['size'] / 1e9,
            'storageClass': pvc.get('spec', {}).get('storageClassName', ''), 'expandable': False,
            'phase': pvc.get('status', {}).get('phase'), 'conditions': [], 'runtime': 'vm', 'offlineExpansion': True}


def prepare(kube, ws, size):
    current = runtime(kube, ws['id'], ws)
    if not current:
        return None
    if not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', IMAGE):
        raise RuntimeError('The verified VM disk growth helper is not configured yet.')
    if ws.get('latest_build', {}).get('status') != 'stopped' or current['vm'].get('spec', {}).get('runStrategy') != 'Halted':
        raise ValueError('Stop this workspace before expanding its VM HOME disk.')
    path = '/apis/kubevirt.io/v1/namespaces/%s/virtualmachineinstances/coder-vm-%s' % (NAMESPACE, ws['id'])
    status, _ = kube('GET', path)
    if status != 404:
        raise ValueError('Wait until the workspace VM instance has fully stopped before expanding its disk.')
    if type(size) is not int or size * 1000000000 <= current['size']:
        raise ValueError('The new VM disk size must be a whole number of GB larger than its current size.')
    status, registry = kube('GET', '/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % RUNTIME_NAMESPACE)
    if status != 200:
        raise RuntimeError('The external VM HOME provenance registry is unavailable.')
    record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(ws['id'])
    pvc = current['pvc']
    if not record or record.get('status') != 'ready' or any(record.get(key) != value for key, value in {
            'workspace_id': ws['id'], 'organization_id': ws['organization_id'], 'workspace_owner_id': ws['owner_id'],
            'claim_name': pvc['metadata']['name'], 'claim_uid': pvc['metadata']['uid'],
            'pv_name': pvc['spec']['volumeName'], 'home_bytes': current['size']}.items()):
        raise RuntimeError('VM HOME provenance changed; no disk mutation was requested.')
    request = {key: record[key] for key in ('workspace_id', 'organization_id', 'workspace_owner_id', 'pv_uid')}
    request.update(version=1, old_bytes=current['size'], new_bytes=size * 1000000000,
                   pvc_uid=record['claim_uid'], record_resource_version=registry['metadata']['resourceVersion'])
    return {'request': request, 'node': record['node_name']}


def verify_result(kube, request):
    status, registry = kube('GET', '/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % RUNTIME_NAMESPACE)
    if status != 200:
        raise RuntimeError('Completed HOME job has no readable provenance acknowledgement.')
    record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(request['workspace_id'])
    if not record or record.get('status') != 'ready' or record.get('home_bytes') != request['new_bytes'] or any(
            record.get(k) != request[k] for k in ('workspace_id', 'organization_id', 'workspace_owner_id')) or \
            (request.get('pv_uid') and record.get('pv_uid') != request['pv_uid']):
        raise RuntimeError('Completed HOME job did not commit the requested disk provenance.')
    status, pvc = kube('GET', '/api/v1/namespaces/%s/persistentvolumeclaims/%s' % (NAMESPACE, record['claim_name']))
    if status != 200 or pvc.get('metadata', {}).get('uid') != record['claim_uid'] or \
            pvc.get('spec', {}).get('volumeMode') != 'Block' or \
            pvc.get('metadata', {}).get('annotations', {}).get('platform.coder/home-disk-bytes') != str(request['new_bytes']):
        raise RuntimeError('Completed HOME job did not publish its current Block claim.')
    return record


def run(kube, prepared, action="grow"):
    if action not in ("grow", "prepare"):
        raise ValueError("Unsupported fixed HOME action.")
    if not re.fullmatch(r"[^\s]+@sha256:[a-f0-9]{64}", IMAGE):
        raise RuntimeError("The verified VM disk helper image is not configured.")
    request = prepared['request']
    name = 'coder-vm-' + action + '-' + request['workspace_id'][:8] + '-' + uuid.uuid4().hex[:12]
    body = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': {'name': name, 'namespace': RUNTIME_NAMESPACE,
        'labels': {'com.coder.workspace.id': request['workspace_id'], 'com.coder.organization.id': request['organization_id']},
        'annotations': {'platform.coder/vm-home-request': hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()}},
        'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': 600, 'ttlSecondsAfterFinished': 3600,
            'template': {'metadata': {'labels': {'platform.coder/vm-home-grow': 'true'}}, 'spec': {
                'serviceAccountName': 'coder-vm-home-manager', 'restartPolicy': 'Never', 'hostPID': True,
                'nodeSelector': {'kubernetes.io/hostname': prepared['node']},
                'tolerations': [{'key': 'platform.coder/workspace-vm-host', 'operator': 'Exists', 'effect': 'NoSchedule'}],
                'containers': [{'name': 'grow', 'image': IMAGE, 'imagePullPolicy': 'IfNotPresent',
                    'env': [{'name': 'CODER_NAMESPACE', 'value': NAMESPACE}, {'name': 'WORKSPACE_VM_RUNTIME_NAMESPACE', 'value': RUNTIME_NAMESPACE}, {'name': 'WORKSPACE_NAMESPACE', 'value': NAMESPACE}, {'name': 'POD_NAMESPACE', 'value': RUNTIME_NAMESPACE}, {'name': 'NODE_NAME', 'valueFrom': {'fieldRef': {'fieldPath': 'spec.nodeName'}}}],
                    'command': ['python3', '/app/vmhome.py', action, '--request-base64', base64.b64encode(json.dumps(request, separators=(',', ':')).encode()).decode()],
                    'securityContext': {'privileged': True, 'runAsUser': 0},
                    'resources': {'requests': {'cpu': '1', 'memory': '1Gi'}, 'limits': {'cpu': '2', 'memory': '2Gi'}},
                    'volumeMounts': [{'name': 'udev-rule', 'mountPath': '/etc/udev/rules.d/10-coder-vm-home.rules', 'readOnly': True}, {'name': 'udev-stock', 'mountPath': '/usr/lib/udev/rules.d/60-persistent-storage.rules', 'readOnly': True}, {'name': 'homes', 'mountPath': MANAGED_PARENT}, {'name': 'devices', 'mountPath': '/dev'}, {'name': 'sys', 'mountPath': '/sys', 'readOnly': True}]}],
                'volumes': [{'name': 'udev-rule', 'hostPath': {'path': '/etc/udev/rules.d/10-coder-vm-home.rules', 'type': 'File'}}, {'name': 'udev-stock', 'hostPath': {'path': '/usr/lib/udev/rules.d/60-persistent-storage.rules', 'type': 'File'}}, {'name': 'homes', 'hostPath': {'path': MANAGED_PARENT, 'type': 'Directory'}},
                            {'name': 'devices', 'hostPath': {'path': '/dev', 'type': 'Directory'}}, {'name': 'sys', 'hostPath': {'path': '/sys', 'type': 'Directory'}}]}}}}
    base = '/apis/batch/v1/namespaces/' + RUNTIME_NAMESPACE + '/jobs'
    status, created = kube('POST', base, body)
    if status != 201:
        raise RuntimeError('The fixed VM HOME growth job could not be created.')
    if not isinstance(created, dict) or not created.get('metadata', {}).get('uid'):
        status, observed = kube('GET', base + '/' + name)
        actual = observed.get('spec', {}).get('template', {}).get('spec', {}) if isinstance(observed, dict) else {}
        expected = body['spec']['template']['spec']
        containers = actual.get('containers', [])
        if status != 200 or any(observed.get('metadata', {}).get('annotations', {}).get(k) != v for k, v in body['metadata']['annotations'].items()) or \
                len(containers) != 1 or any(containers[0].get(k) != expected['containers'][0][k] for k in ('name', 'image', 'command')) or \
                any(actual.get(k) != expected[k] for k in ('serviceAccountName', 'nodeSelector', 'hostPID', 'volumes')):
            raise RuntimeError('The HOME job submission is unconfirmed; review the exact operation before retrying.')
        created = observed
    uid = created['metadata']['uid']
    deadline = time.monotonic() + 630
    while time.monotonic() < deadline:
        status, job = kube('GET', base + '/' + name)
        if status != 200 or job.get('metadata', {}).get('uid') != uid:
            raise RuntimeError('The VM HOME growth job changed or became unavailable.')
        if job.get('status', {}).get('succeeded'):
            return verify_result(kube, request)
        if job.get('status', {}).get('failed'):
            raise RuntimeError('VM HOME growth did not complete; review the retained disk operation before retrying.')
        time.sleep(2)
    raise RuntimeError('VM HOME growth timed out; no success is claimed.')
