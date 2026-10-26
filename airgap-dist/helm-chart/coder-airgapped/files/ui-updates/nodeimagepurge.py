"""Reviewed node-cache cleanup. Registry copies and storage volumes are never removed."""
import hashlib
import http.client
import json
import os
import re
import secrets
import socket
import ssl
import urllib.parse
import urllib.request

WORKLOADS = ['/api/v1/pods', '/apis/apps/v1/deployments', '/apis/apps/v1/statefulsets',
             '/apis/apps/v1/daemonsets', '/apis/apps/v1/replicasets', '/apis/batch/v1/jobs', '/apis/batch/v1/cronjobs']



def normalize(ref):
    for prefix in ('docker://', 'docker-pullable://', 'containerd://', 'cri-o://'):
        ref = ref.removeprefix(prefix)
    if re.fullmatch(r'sha256:[a-f0-9]{64}', ref):
        return ref
    if '/' not in ref:
        return 'docker.io/library/' + ref
    first = ref.split('/', 1)[0]
    if '.' not in first and ':' not in first and first != 'localhost':
        return 'docker.io/' + ref
    for host in ('index.docker.io/', 'registry-1.docker.io/'):
        if ref.startswith(host):
            return 'docker.io/' + ref[len(host):]
    return ref

def protected_images(call):
    """Include pending and stopped controller templates, not just running workspace containers."""
    refs = set()
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('image'), str):
                refs.add(value['image'])
            if isinstance(value.get('imageID'), str):
                refs.add(value['imageID'].removeprefix('docker://').removeprefix('docker-pullable://'))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for path in WORKLOADS:
        status, data = call('GET', path)
        if status != 200 or not isinstance(data, dict):
            raise ValueError('Cannot verify all workload image references. Cleanup is blocked.')
        visit(data.get('items') or [])
    return {normalize(ref) for ref in refs}



def annotate(call, images, extra=()):
    try:
        refs = protected_images(call) | {normalize(ref) for ref in extra}
        code, nodes = call('GET', '/api/v1/nodes')
        if code != 200:
            raise ValueError('Cannot verify node runtimes.')
        runtimes = {node['metadata']['name']: (node.get('status') or {}).get('nodeInfo', {}).get('containerRuntimeVersion', '')
                    for node in nodes.get('items') or []}
        for image in images:
            names = {normalize(ref) for ref in [image['image'], *image['names']]}
            image['purgeBlocked'] = ('Referenced by a workload' if names & refs else
                'Cleanup supports Docker nodes only' if any(not runtimes.get(node, '').startswith('docker://') for node in image['nodes']) else '')
    except Exception:
        for image in images:
            image['purgeBlocked'] = 'Cannot verify all workload references; cleanup is unavailable'
    return images

def plan(call, groups, selected, extra=()):
    if not isinstance(selected, list) or not 1 <= len(selected) <= 100 or any(not isinstance(ref, str) for ref in selected):
        raise ValueError('Select between one and 100 images.')
    refs = protected_images(call) | {normalize(ref) for ref in extra}
    status, data = call('GET', '/api/v1/nodes')
    if status != 200:
        raise ValueError('Cannot verify node runtimes.')
    runtimes = {n['metadata']['name']: (n.get('status') or {}).get('nodeInfo', {}).get('containerRuntimeVersion', '')
                for n in data.get('items') or []}
    by_name = {name: group for group in groups for name in group['names']}
    targets = {}
    seen = set()
    for ref in selected:
        group = by_name.get(ref)
        if not group:
            raise ValueError('The image list changed. Refresh and review again.')
        if refs.intersection(normalize(name) for name in group['names']):
            raise ValueError('%s is referenced by a workload and cannot be purged.' % ref)
        key = tuple(sorted(group['names']))
        if key in seen:
            continue
        seen.add(key)
        for node in group['nodes']:
            if not runtimes.get(node, '').startswith('docker://'):
                raise ValueError('Cleanup currently supports Docker nodes only; %s uses another runtime.' % node)
            targets.setdefault(node, []).append(ref)
    payload = dict(nodes=[dict(node=node, images=sorted(images)) for node, images in sorted(targets.items())],
                   images=sorted(set(selected)))
    payload['review'] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return payload


def start(call, namespace, tools_image, reviewed, user, service_account, keep_refs=()):
    batch = secrets.token_hex(10)
    jobs = []
    for index, target in enumerate(reviewed['nodes']):
        name = 'coder-image-purge-%s-%s' % (batch, index)
        labels = {'app.kubernetes.io/name': 'coder-image-purge', 'coder-image/purge': batch}
        job = dict(apiVersion='batch/v1', kind='Job', metadata=dict(name=name, namespace=namespace, labels=labels),
                   spec=dict(backoffLimit=0, activeDeadlineSeconds=300, ttlSecondsAfterFinished=86400,
                   template=dict(metadata=dict(labels=labels), spec=dict(nodeName=target['node'], restartPolicy='Never',
                   serviceAccountName=service_account, automountServiceAccountToken=True,
                   containers=[dict(name='purge', image=tools_image, imagePullPolicy='IfNotPresent',
                       command=['python3', '/app/nodeimagepurge.py'], terminationMessagePolicy='FallbackToLogsOnError', env=[dict(name='PURGE_IMAGES', value=json.dumps(target['images'])), dict(name='PROTECTED_IMAGES', value=json.dumps(list(keep_refs)))],
                       securityContext=dict(runAsUser=0, runAsNonRoot=False, allowPrivilegeEscalation=False,
                                            capabilities=dict(drop=['ALL'])),
                       resources=dict(requests=dict(cpu='50m', memory='64Mi'), limits=dict(cpu='500m', memory='128Mi')),
                       volumeMounts=[dict(name='runtime', mountPath='/var/run/docker.sock')])],
                   volumes=[dict(name='runtime', hostPath=dict(path='/var/run/docker.sock', type='Socket'))]))))
        status, _ = call('POST', '/apis/batch/v1/namespaces/%s/jobs' % namespace, job)
        if status not in (200, 201):
            raise ValueError('Could not start cleanup on %s. Already started jobs: %s' % (target['node'], ', '.join(jobs)))
        jobs.append(name)
    return dict(id=batch, jobs=[dict(name=name, status='running') for name in jobs], status='running')


def status(call, namespace, batch):
    if not re.fullmatch('[a-f0-9]{20}', batch):
        raise ValueError('Invalid cleanup identifier.')
    query = urllib.parse.urlencode({'labelSelector': 'coder-image/purge=' + batch})
    code, data = call('GET', '/apis/batch/v1/namespaces/%s/jobs?%s' % (namespace, query))
    if code != 200 or not data.get('items'):
        raise ValueError('Cleanup was not found or its history expired.')
    jobs = [dict(name=j['metadata']['name'], node=j['spec']['template']['spec']['nodeName'],
                 status='failed' if (j.get('status') or {}).get('failed') else 'complete' if (j.get('status') or {}).get('succeeded') else 'running')
            for j in data['items']]
    code, pods = call('GET', '/api/v1/namespaces/%s/pods?%s' % (namespace, query))
    if code == 200:
        reports = {}
        for pod in pods.get('items') or []:
            owner = next((ref['name'] for ref in pod.get('metadata', {}).get('ownerReferences', []) if ref.get('kind') == 'Job'), '')
            for container in pod.get('status', {}).get('containerStatuses', []):
                message = container.get('state', {}).get('terminated', {}).get('message')
                if message:
                    try:
                        reports[owner] = json.loads(message)
                    except (ValueError, TypeError):
                        pass
        for job in jobs:
            if isinstance(reports.get(job['name']), dict):
                job.update({key: reports[job['name']][key] for key in ('error', 'removed', 'absent') if key in reports[job['name']]})
    return dict(id=batch, jobs=jobs, status='running' if any(j['status'] == 'running' for j in jobs) else 'failed' if any(j['status'] == 'failed' for j in jobs) else 'complete')


class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=20)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker(method, path):
    connection = Docker()
    try:
        connection.request(method, path)
        response = connection.getresponse()
        data = response.read(4 * 1024 * 1024)
        return response.status, json.loads(data) if data else None
    finally:
        connection.close()


def kube(method, path):
    root = '/var/run/secrets/kubernetes.io/serviceaccount/'
    with open(root + 'token') as source:
        bearer = source.read().strip()
    request = urllib.request.Request('https://kubernetes.default.svc' + path, headers={'Authorization': 'Bearer ' + bearer}, method=method)
    with urllib.request.urlopen(request, context=ssl.create_default_context(cafile=root + 'ca.crt'), timeout=15) as response:
        return response.status, json.load(response)


def purge(refs, runtime=docker, workloads=lambda: protected_images(kube)):
    results = []
    inspect = lambda ref: runtime('GET', '/images/%s/json' % urllib.parse.quote(normalize(ref), safe=''))
    for ref in refs:
        code, image = inspect(ref)
        if code == 404:
            results.append(dict(image=ref, status='absent'))
            continue
        if code != 200 or not re.fullmatch(r'sha256:[a-f0-9]{64}', (image or {}).get('Id', '')):
            raise ValueError('Cannot resolve the selected image to an immutable runtime ID.')
        image_id = image['Id']
        protected = workloads()
        for protected_ref in protected:
            code, protected_image = inspect(protected_ref)
            if code == 200 and protected_image.get('Id') == image_id:
                raise ValueError('%s is still referenced by a workload.' % ref)
        code, containers = runtime('GET', '/containers/json?all=true')
        if code != 200:
            raise ValueError('Cannot verify runtime container references.')
        if any(container.get('ImageID') == image_id for container in containers):
            raise ValueError('%s is still referenced by a runtime container.' % ref)
        # No force and no parent pruning. Docker refuses in-use images and ambiguous multi-tag removal.
        code, result = runtime('DELETE', '/images/%s?force=false&noprune=true' % urllib.parse.quote(image_id, safe=''))
        if code not in (200, 404):
            raise ValueError('Runtime refused cleanup of %s: %s' % (ref, (result or {}).get('message', code)))
        results.append(dict(image=ref, status='removed' if code == 200 else 'absent'))
    return results


if __name__ == '__main__':
    try:
        results = purge(json.loads(os.environ['PURGE_IMAGES']), workloads=lambda: protected_images(kube) | set(json.loads(os.environ.get('PROTECTED_IMAGES', '[]'))))
        report = dict(removed=sum(result['status'] == 'removed' for result in results), absent=sum(result['status'] == 'absent' for result in results))
        exit_code = 0
    except Exception as error:
        report = dict(error=str(error)[:1000])
        exit_code = 1
    payload = json.dumps(report)
    with open('/dev/termination-log', 'w') as destination:
        destination.write(payload)
    print(payload, flush=True)
    raise SystemExit(exit_code)
