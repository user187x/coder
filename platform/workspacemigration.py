"""Admin-only, retained-volume migrations for native workspaces on local-path storage."""
import copy
import json
import pathlib
import queue
import re
import threading
import time
import urllib.parse
import uuid

import hudstorage
import imagebuilder as ib
import kexec
import workspacevolumes as volumes

BASE = '/__coder-ui/api/workspace-migrations/'
INSTANCE = str(uuid.uuid4())
KUBE = STATE = SNAPSHOT = SUMMARIES = QUANTITY = LOG = None
SCHEMA_READY = False
SCHEMA_LOCK = threading.Lock()


def setup(kube, state, snapshot, summaries, quantity, log):
    global KUBE, STATE, SNAPSHOT, SUMMARIES, QUANTITY, LOG
    KUBE, STATE, SNAPSHOT, SUMMARIES, QUANTITY, LOG = kube, state, snapshot, summaries, quantity, log


def database():
    global SCHEMA_READY
    db = STATE.database()
    with SCHEMA_LOCK:
        if not SCHEMA_READY:
            with db.transaction() as tx:
                tx.query('SELECT pg_advisory_xact_lock(731942, 0)')
                tx.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.workspace_migrations (
                    id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), workspace_id uuid NOT NULL,
                    created_by uuid NOT NULL, status text NOT NULL, worker text NOT NULL, state jsonb NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())''')
                tx.query("CREATE UNIQUE INDEX IF NOT EXISTS workspace_migration_active ON coder_ui_updates.workspace_migrations(workspace_id) WHERE status != 'done'")
            SCHEMA_READY = True
    return db


def latest(ws):
    rows = database().query('''SELECT id::text, status, worker, state::text FROM coder_ui_updates.workspace_migrations
        WHERE organization_id=$1::uuid AND workspace_id=$2::uuid ORDER BY created_at DESC LIMIT 1''', [ws['organization_id'], ws['id']])
    if not rows:
        return None
    mid, status, worker, state = rows[0]
    return dict(**json.loads(state), id=mid, status=status, worker=worker)


def busy(wid):
    return bool(database().query("SELECT 1 FROM coder_ui_updates.workspace_migrations WHERE workspace_id=$1::uuid AND status != 'done'", [wid]))


def save(op, status='running', **updates):
    op.update(updates)
    op['status'] = status
    state = {key: value for key, value in op.items() if key not in ('id', 'status', 'worker')}
    changed = database().query("UPDATE coder_ui_updates.workspace_migrations SET status=$2, state=$3::jsonb, updated_at=now() WHERE id=$1::uuid AND worker=$4 AND status != 'done' RETURNING id", [op['id'], status, json.dumps(state), op['worker']])
    if not changed:
        raise RuntimeError('This migration attempt was superseded or canceled.')


def api(method, path, body=None, content_type=None):
    status, data = KUBE.call(method, path, body, content_type) if content_type else KUBE.call(method, path, body) if body is not None else KUBE.call(method, path)
    if status not in (200, 201, 202):
        raise RuntimeError('Kubernetes %s %s failed (HTTP %s).' % (method, path, status))
    return data


def path(kind, name=None):
    root = ('/apis/batch/v1/' if kind == 'jobs' else '/api/v1/') + ('' if kind in ('nodes', 'persistentvolumes') else 'namespaces/%s/' % volumes.NAMESPACE) + kind
    return root + ('/' + urllib.parse.quote(name, safe='') if name else '')


def requests(spec):
    out = {}
    for resource in ('cpu', 'memory'):
        read = lambda c: QUANTITY(((c.get('resources') or {}).get('requests') or {}).get(resource)) or 0
        regular = sum(read(c) for c in spec.get('containers') or [])
        out[resource] = max([regular] + [read(c) for c in spec.get('initContainers') or []]) + (QUANTITY((spec.get('overhead') or {}).get(resource)) or 0)
    return out


def local_node(pv):
    terms = ((pv.get('spec', {}).get('nodeAffinity') or {}).get('required') or {}).get('nodeSelectorTerms') or []
    if len(terms) == 1:
        expressions = terms[0].get('matchExpressions') or []
        if len(expressions) == 1 and expressions[0].get('key') == 'kubernetes.io/hostname' and expressions[0].get('operator') == 'In' and len(expressions[0].get('values') or []) == 1:
            return expressions[0]['values'][0]
    raise ValueError('Migration requires a local home volume bound to exactly one node.')


def tolerated(taint, tolerations):
    for t in tolerations or []:
        if t.get('effect') not in (None, '', taint.get('effect')):
            continue
        if not t.get('key') and t.get('operator') == 'Exists':
            return True
        if t.get('key') == taint.get('key') and (t.get('operator') == 'Exists' or (t.get('operator') or 'Equal') == 'Equal' and t.get('value', '') == taint.get('value', '')):
            return True
    return False


def gib(value):
    return '%.1f GiB' % (value / 1024 ** 3)


def candidates(snapshot, summaries, pod_spec, source, disk_bytes):
    required = requests(pod_spec)
    arch = lambda n: ((n.get('status') or {}).get('nodeInfo') or {}).get('architecture')
    source_arch = next((arch(n) for n in snapshot['nodes'] if n['metadata']['name'] == source), None)
    out = []
    for node in snapshot['nodes']:
        meta, spec, status = node['metadata'], node.get('spec') or {}, node.get('status') or {}
        name = meta['name']
        conditions = {c['type']: c['status'] for c in status.get('conditions') or []}
        fs = ((summaries.get(name) or {}).get('node') or {}).get('fs') or {}
        measured = hudstorage.fresh(fs)
        disks = {key: hudstorage.number(fs.get(field)) if measured else None for key, field in [('total', 'capacityBytes'), ('used', 'usedBytes'), ('free', 'availableBytes')]}
        usage = (snapshot.get('usage') or {}).get(name) or {}
        metrics_fresh = bool((snapshot.get('usageTimes') or {}).get(name)) and hudstorage.fresh({'time': snapshot['usageTimes'][name]})
        total = {key: QUANTITY((status.get('allocatable') or {}).get(key)) or 0 for key in ('cpu', 'memory')}
        used = {key: QUANTITY(usage.get(key)) if metrics_fresh else None for key in total}
        reserved = {key: 0 for key in total}
        for pod in snapshot['pods']:
            if pod.get('spec', {}).get('nodeName') == name:
                req = requests(pod['spec'])
                for key in reserved:
                    reserved[key] += req[key]
        reasons = []
        if name == source:
            reasons.append('Current node')
        if conditions.get('Ready') != 'True' or spec.get('unschedulable'):
            reasons.append('Node is not schedulable')
        if any(conditions.get(key) == 'True' for key in ('DiskPressure', 'MemoryPressure', 'PIDPressure')):
            reasons.append('Node reports resource pressure')
        if any(t.get('effect') in ('NoSchedule', 'NoExecute') and not tolerated(t, pod_spec.get('tolerations')) for t in spec.get('taints') or []):
            reasons.append('Node has a taint the workspace does not tolerate')
        if source_arch and arch(node) and arch(node) != source_arch:
            reasons.append('Architecture %s differs from %s' % (arch(node), source_arch))
        labels = meta.get('labels') or {}
        if any(labels.get(key) != value for key, value in (pod_spec.get('nodeSelector') or {}).items()):
            reasons.append('Workspace node selector does not match')
        for key in total:
            if used[key] is None or not snapshot.get('podsAvailable', False):
                reasons.append('%s usage is unavailable' % key.capitalize())
            elif max(used[key], reserved[key]) + required[key] > total[key] * .9:
                free = max(0, total[key] * .9 - max(used[key], reserved[key]))
                reasons.append('Needs %s cores, %.1f free' % (round(required[key], 2), free) if key == 'cpu'
                               else 'Needs %s memory, %s free' % (gib(required[key]), gib(free)))
        if disks['free'] is None or disks['total'] is None:
            reasons.append('Disk measurements unavailable')
        elif disks['free'] - disk_bytes < max(1024 ** 3, disks['total'] * .05):
            reasons.append('Needs %s disk plus a safety reserve, %s free' % (gib(disk_bytes), gib(disks['free'])))
        out.append(dict(name=name, ips=[a['address'] for a in status.get('addresses') or [] if a['type'] in ('InternalIP', 'ExternalIP')],
                        cpu=dict(total=total['cpu'], used=used['cpu'], requested=reserved['cpu']),
                        memory=dict(total=total['memory'], used=used['memory'], requested=reserved['memory']),
                        disk=disks, eligible=not reasons, reasons=reasons,
                        needs=dict(cpu=required['cpu'], memory=required['memory'], disk=disk_bytes)))
    return out


def plan(ws):
    pvc = volumes.get_pvc(volumes.pvc_name(ws['id']))
    if not pvc or pvc.get('status', {}).get('phase') != 'Bound' or pvc.get('metadata', {}).get('deletionTimestamp'):
        raise ValueError('The workspace must have a bound native home volume.')
    pv = api('GET', path('persistentvolumes', pvc['spec']['volumeName']))
    sc = pvc['spec'].get('storageClassName')
    storage_class = api('GET', '/apis/storage.k8s.io/v1/storageclasses/' + urllib.parse.quote(sc or '', safe=''))
    if storage_class.get('provisioner') != 'rancher.io/local-path' or not pv['spec'].get('local') or pvc['spec'].get('volumeMode', 'Filesystem') != 'Filesystem':
        raise ValueError('This migration supports native filesystem homes on local-path storage. This workspace uses another storage type.')
    selector = urllib.parse.quote('com.coder.workspace.id=' + ws['id'])
    deployments = api('GET', '/apis/apps/v1/namespaces/%s/deployments?labelSelector=%s' % (volumes.NAMESPACE, selector))['items']
    if len(deployments) != 1:
        raise ValueError('Migration requires exactly one native workspace deployment. Start the workspace to inspect its placement.')
    pod_spec = deployments[0]['spec']['template']['spec']
    if (pod_spec.get('affinity') or {}).get('podAffinity') or ((pod_spec.get('affinity') or {}).get('podAntiAffinity') or {}).get('requiredDuringSchedulingIgnoredDuringExecution') or any(c.get('whenUnsatisfiable') == 'DoNotSchedule' for c in pod_spec.get('topologySpreadConstraints') or []):
        raise ValueError('This workspace has required placement constraints that need a template-specific migration.')
    if any(c.get('restartPolicy') == 'Always' for c in pod_spec.get('initContainers') or []) or (pod_spec.get('affinity') or {}).get('nodeAffinity') or pod_spec.get('nodeName'):
        raise ValueError('This workspace has fixed scheduling constraints that require a template-specific migration.')
    claims = [v['persistentVolumeClaim']['claimName'] for v in pod_spec.get('volumes') or [] if 'persistentVolumeClaim' in v]
    if claims != [pvc['metadata']['name']]:
        raise ValueError('Workspaces with additional persistent volumes need a coordinated storage migration.')
    source = local_node(pv)
    disk_bytes = volumes.ib_quantity((pvc['status'].get('capacity') or {}).get('storage'))
    # Persist scheduling inputs only; container environment variables may contain agent credentials.
    scheduling = {key: copy.deepcopy(pod_spec[key]) for key in ('nodeSelector', 'tolerations', 'overhead') if key in pod_spec}
    runtime = pod_spec.get('runtimeClassName')
    if runtime:
        try:
            runtime_class = api('GET', '/apis/node.k8s.io/v1/runtimeclasses/' + urllib.parse.quote(runtime, safe=''))
        except Exception:
            raise ValueError('The workspace runtime class %s could not be inspected.' % runtime)
        scheduling['nodeSelector'] = dict(scheduling.get('nodeSelector') or {}, **((runtime_class.get('scheduling') or {}).get('nodeSelector') or {}))
        scheduling['tolerations'] = (scheduling.get('tolerations') or []) + ((runtime_class.get('scheduling') or {}).get('tolerations') or [])
        if 'overhead' not in scheduling and (runtime_class.get('overhead') or {}).get('podFixed'):
            scheduling['overhead'] = runtime_class['overhead']['podFixed']
    for key in ('containers', 'initContainers'):
        scheduling[key] = [{'resources': copy.deepcopy(c.get('resources') or {})} for c in pod_spec.get(key) or []]
    snapshot = SNAPSHOT()
    summaries = SUMMARIES()
    nodes = candidates(snapshot, summaries, scheduling, source, disk_bytes)
    measurements = [hudstorage.number(volume.get('usedBytes')) for summary in summaries.values()
                    for pod in summary.get('pods') or [] for volume in pod.get('volume') or []
                    if (volume.get('pvcRef') or {}).get('name') == pvc['metadata']['name']
                    and (volume.get('pvcRef') or {}).get('namespace') == volumes.NAMESPACE and hudstorage.fresh(volume)]
    home_used = max((value for value in measurements if value is not None), default=None)
    return dict(workspaceId=ws['id'], workspaceName=ws['name'], sourceNode=source, diskBytes=disk_bytes,
                nodes=nodes, homeUsedBytes=home_used, generatedAt=volumes.now()), dict(pvc=pvc, pv=pv, podSpec=scheduling)


PHASES = ('prepare', 'copy', 'cutover', 'start', 'done')


def progress(op):
    """Share of the home volume copied: bytes sent out of the measured home size, 100 once the copy is verified."""
    phase = op.get('phase')
    if phase in PHASES[2:]:
        return 100
    total, copied = op.get('homeUsedBytes'), op.get('copiedBytes')
    if phase != 'copy' or not total or not copied:
        return 0
    return min(99, int(100 * copied / total))


def requested(op, key):
    """Total CPU cores or memory bytes the workspace's containers request (limits if no request), or None."""
    values = []
    for container in (op.get('podSpec') or {}).get('containers') or []:
        resources = container.get('resources') or {}
        value = (resources.get('requests') or {}).get(key) or (resources.get('limits') or {}).get(key)
        if value is not None:
            values.append(QUANTITY(value))
    return sum(v for v in values if v is not None) if values else None


def listing():
    rows = database().query('''SELECT id::text, workspace_id::text, status, state::text,
        to_char(created_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        to_char(updated_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        FROM coder_ui_updates.workspace_migrations ORDER BY created_at DESC LIMIT 50''')
    out = []
    for mid, wid, status, state, created, updated in rows:
        op = json.loads(state)
        out.append(dict(id=mid, workspaceId=wid, workspaceName=op.get('workspaceName'), status=status,
                        phase=op.get('phase'), percent=progress(op), cpu=requested(op, 'cpu'), memoryBytes=requested(op, 'memory'),
                        diskBytes=op.get('diskBytes'), copiedBytes=op.get('copiedBytes'), sourceNode=op.get('sourceNode'),
                        target=op.get('target'), message=op.get('message'), error=op.get('error'),
                        startedAt=created, updatedAt=updated))
    return out


def public(op):
    if not op:
        return None
    return {key: op.get(key) for key in ('id', 'status', 'phase', 'message', 'error', 'target', 'retainedVolume', 'sourceNode')}


def read(kind, name):
    status, obj = KUBE.call('GET', path(kind, name))
    if status == 404:
        return None
    if status != 200:
        raise RuntimeError('Cannot inspect %s %s (HTTP %s).' % (kind, name, status))
    return obj


def wait_for(check, message, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(2)
    raise RuntimeError(message)


def delete(kind, obj):
    current = read(kind, obj['metadata']['name'])
    if not current:
        return
    if current['metadata']['uid'] != obj['metadata']['uid']:
        raise RuntimeError('Resource identity changed; refusing to delete ' + obj['metadata']['name'])
    api('DELETE', path(kind, obj['metadata']['name']), {'preconditions': {'uid': obj['metadata']['uid']}, 'propagationPolicy': 'Foreground'})
    wait_for(lambda: not read(kind, obj['metadata']['name']), 'Waiting for ' + obj['metadata']['name'] + ' to be released.')


def retain(pv):
    current = read('persistentvolumes', pv['metadata']['name'])
    if not current or current['metadata']['uid'] != pv['metadata']['uid']:
        raise RuntimeError('Volume identity changed. The migration needs administrator recovery.')
    api('PATCH', path('persistentvolumes', pv['metadata']['name']), [
        {'op': 'test', 'path': '/metadata/uid', 'value': pv['metadata']['uid']},
        {'op': 'replace', 'path': '/spec/persistentVolumeReclaimPolicy', 'value': 'Retain'},
    ], 'application/json-patch+json')


def helper(op, side, claim, node, readonly):
    name = 'coder-migrate-' + op['id'] + '-' + side
    old = read('jobs', name)
    if old:
        delete('jobs', old)
        wait_for(lambda: not api('GET', path('pods') + '?labelSelector=job-name%3D' + name)['items'], 'Previous copy helper is still terminating.')
    body = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': name,
            'labels': {'coder.com/workspace-migration': op['id']}},
            'spec': {'restartPolicy': 'Never', 'terminationGracePeriodSeconds': 5, 'automountServiceAccountToken': False,
            'nodeSelector': {'kubernetes.io/hostname': node},
            'imagePullSecrets': ib.PULL_SECRETS,
            'containers': [{'name': 'copy', 'image': ib.TOOLS_IMAGE,
                'command': ['python3', '-c', 'import signal,sys; signal.signal(signal.SIGTERM,lambda *_:sys.exit(0)); signal.pause()'],
                'resources': {'requests': {'cpu': '50m', 'memory': '64Mi'}, 'limits': {'memory': '256Mi'}},
                'securityContext': {'runAsUser': 0, 'allowPrivilegeEscalation': False,
                    'capabilities': {'drop': ['ALL'], 'add': ['CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER', 'FSETID', 'SETFCAP']},
                    'seccompProfile': {'type': 'RuntimeDefault'}},
                'volumeMounts': [{'name': 'home', 'mountPath': '/home-data', 'readOnly': readonly}]}],
            'volumes': [{'name': 'home', 'persistentVolumeClaim': {'claimName': claim, 'readOnly': readonly}}]}}
    job = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': body['metadata'],
           'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': 14400, 'ttlSecondsAfterFinished': 3600,
                    'template': {'metadata': {'labels': body['metadata']['labels']}, 'spec': body['spec']}}}
    api('POST', path('jobs'), job)
    def ready():
        pods = api('GET', path('pods') + '?labelSelector=job-name%3D' + name)['items']
        return next((pod for pod in pods if any(c.get('type') == 'Ready' and c.get('status') == 'True'
                    for c in pod.get('status', {}).get('conditions', []))), None)
    return wait_for(ready, 'Migration helper could not start on ' + node)


def clean_helpers(op):
    for side in ('source', 'target'):
        name = 'coder-migrate-' + op['id'] + '-' + side
        job = read('jobs', name)
        if job:
            delete('jobs', job)
        wait_for(lambda: not api('GET', path('pods') + '?labelSelector=job-name%3D' + name)['items'], 'Migration helper is still terminating.')


def command(mode):
    script = pathlib.Path(__file__).with_name('migrationcopy.py').read_text()
    return ['python3', '-c', script, mode, '/home-data']


def copy_home(source, target, op=None):
    chunks = queue.Queue(maxsize=16)
    stopped = threading.Event()
    result = []

    def enqueue(chunk):
        while not stopped.is_set():
            try:
                chunks.put(chunk, timeout=1)
                return
            except queue.Full:
                continue
        raise RuntimeError('Copy receiver stopped')

    def produce():
        try:
            code, error = kexec.exec_stream(KUBE, volumes.NAMESPACE, source, 'copy', command('send'), enqueue, timeout=7200)
            if code:
                raise RuntimeError('Reading the source home failed: ' + error[-500:])
            result.append(None)
        except Exception as error:
            result.append(error)
        finally:
            if not stopped.is_set():
                enqueue(None)

    def consume():
        sent, saved = 0, 0.0
        while True:
            chunk = chunks.get(timeout=7200)
            if chunk is None:
                if result[0]:
                    raise result[0]
                return
            sent += len(chunk)
            if op is not None and time.monotonic() - saved > 3:
                saved = time.monotonic()
                save(op, copiedBytes=sent)
            yield chunk

    producer = threading.Thread(target=produce, daemon=True)
    producer.start()
    try:
        code, copied, error = kexec.exec_in(KUBE, volumes.NAMESPACE, target, 'copy', command('receive'), timeout=7200, stdin=consume())
        if code or not re.fullmatch(r'[a-f0-9]{64}', copied.strip()):
            raise RuntimeError('Copy verification failed: ' + error[-500:])
        producer.join(timeout=30)
        if not result or result[0]:
            raise RuntimeError('The source copy did not finish successfully.')
        code, original, error = kexec.exec_in(KUBE, volumes.NAMESPACE, source, 'copy', command('digest'), timeout=7200)
        if code or original.strip() != copied.strip():
            raise RuntimeError('The copied home does not match the original. The original volume is unchanged.')
        return copied.strip()
    finally:
        stopped.set()


def ensure_offline(token, op):
    ws = volumes.workspace(token, op['workspaceId'])
    build = ws['latest_build']
    if build.get('status') != 'stopped' or (op.get('stoppedBuild') and build['id'] != op['stoppedBuild']):
        raise RuntimeError('The workspace build changed during migration. Keep it stopped and contact an administrator before resuming.')
    return ws


def no_mounts(claims):
    pods = api('GET', path('pods'))['items']
    if any(v.get('persistentVolumeClaim', {}).get('claimName') in claims
           for pod in pods if pod.get('status', {}).get('phase') not in ('Succeeded', 'Failed') for v in pod.get('spec', {}).get('volumes', [])):
        raise RuntimeError('A pod still uses the home volume. No volume will be removed until it is released.')


def cutover(token, op, lease):
    old, destination = op['pvc'], op['destinationPV']
    canonical = old['metadata']['name']
    current = read('persistentvolumeclaims', canonical)
    if current and current['spec'].get('volumeName') == destination['metadata']['name']:
        return wait_for(lambda: (read('persistentvolumeclaims', canonical) or {}).get('status', {}).get('phase') == 'Bound', 'The migrated volume has not bound yet.')
    ensure_offline(token, op)
    lease.query('SELECT 1')
    clean_helpers(op)
    retain(op['pv'])
    retain(destination)
    no_mounts([canonical, op['temporaryClaim']])
    if current:
        delete('persistentvolumeclaims', old)
    temporary = read('persistentvolumeclaims', op['temporaryClaim'])
    if temporary:
        if temporary['metadata']['uid'] != op.get('temporaryUID', temporary['metadata']['uid']) or temporary['spec'].get('volumeName') != destination['metadata']['name']:
            raise RuntimeError('Staging volume binding changed. Refusing to continue.')
        delete('persistentvolumeclaims', temporary)
    lease.query('SELECT 1')
    ensure_offline(token, op)
    # Prebinding by name prevents the scheduler from allocating another home.
    current_pv = api('GET', path('persistentvolumes', destination['metadata']['name']))
    if current_pv['metadata']['uid'] != destination['metadata']['uid']:
        raise RuntimeError('Staging volume was replaced. Administrator recovery is required.')
    api('PATCH', path('persistentvolumes', destination['metadata']['name']), [
        {'op': 'test', 'path': '/metadata/resourceVersion', 'value': current_pv['metadata']['resourceVersion']},
        {'op': 'add', 'path': '/spec/claimRef', 'value': {'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim', 'namespace': volumes.NAMESPACE, 'name': canonical}},
    ], 'application/json-patch+json')
    body = volumes.new_pvc_body(old, canonical, 1)
    body['spec']['resources'] = copy.deepcopy(old['spec']['resources'])
    body['spec']['volumeName'] = destination['metadata']['name']
    body['metadata']['annotations']['coder.com/migrated-from'] = op['pv']['metadata']['name']
    api('POST', path('persistentvolumeclaims'), body)
    wait_for(lambda: (read('persistentvolumeclaims', canonical) or {}).get('status', {}).get('phase') == 'Bound', 'The migrated volume has not bound yet.')


def run(token, op, lease):
    phase = op.get('phase', 'prepare')
    if phase in ('prepare', 'copy'):
        ws = volumes.workspace(token, op['workspaceId'])
        if phase == 'prepare':
            if op.get('initialBuild') and ws['latest_build']['id'] != op['initialBuild']:
                raise RuntimeError('The workspace build changed before migration began. Cancel and choose a destination again.')
            save(op, message='Stopping the workspace before copying its home.')
            if ws['latest_build']['status'] != 'stopped':
                volumes.build(token, ws, 'stop')
            ws = volumes.workspace(token, op['workspaceId'])
            save(op, phase='copy', stoppedBuild=ws['latest_build']['id'])
        ensure_offline(token, op)
        volumes.wait_no_pods(op['workspaceId'])
        clean_helpers(op)
        no_mounts([op['pvc']['metadata']['name']])
        options = candidates(SNAPSHOT(), SUMMARIES(), op['podSpec'], op['sourceNode'], op['diskBytes'])
        selected = next((n for n in options if n['name'] == op['target']), None)
        if not selected or not selected['eligible']:
            raise RuntimeError('Destination is no longer eligible: ' + ', '.join(selected['reasons'] if selected else ['Node missing']))
        temporary = read('persistentvolumeclaims', op['temporaryClaim'])
        if not temporary:
            body = volumes.new_pvc_body(op['pvc'], op['temporaryClaim'], 1, temp=True)
            body['spec']['resources'] = copy.deepcopy(op['pvc']['spec']['resources'])
            body['metadata']['labels']['coder.com/migration-id'] = op['id']
            temporary = api('POST', path('persistentvolumeclaims'), body)
        if op.get('temporaryUID') and temporary['metadata']['uid'] != op['temporaryUID']:
            raise RuntimeError('Staging claim identity changed. Administrator recovery is required.')
        save(op, temporaryUID=temporary['metadata']['uid'], message='Preparing destination storage on ' + op['target'] + '.')
        target = helper(op, 'target', op['temporaryClaim'], op['target'], False)
        source = helper(op, 'source', op['pvc']['metadata']['name'], op['sourceNode'], True)
        temporary = api('GET', path('persistentvolumeclaims', op['temporaryClaim']))
        pv = api('GET', path('persistentvolumes', temporary['spec']['volumeName']))
        if local_node(pv) != op['target']:
            raise RuntimeError('The staging disk was provisioned on an unexpected node.')
        code, available, error = kexec.exec_in(KUBE, volumes.NAMESPACE, target['metadata']['name'], 'copy', ['python3', '-c', 'import os; s=os.statvfs("/home-data"); print(s.f_bavail*s.f_frsize)'])
        if code or not available.strip().isdigit() or int(available) < op['diskBytes'] + 1024 ** 3:
            raise RuntimeError('The destination filesystem does not have enough free space.')
        save(op, message='Copying and verifying home files, ownership, permissions and extended attributes.')
        checksum = copy_home(source['metadata']['name'], target['metadata']['name'], op)
        save(op, phase='cutover', destinationPV=pv, checksum=checksum,
             retainedVolume=op['pv']['metadata']['name'], message='Verified the copy. Switching the workspace home binding.')
    if op['phase'] == 'cutover':
        cutover(token, op, lease)
        save(op, phase='start', message='Home moved successfully. Starting the workspace on ' + op['target'] + '.')
    if op['phase'] == 'start':
        current = read('persistentvolumeclaims', op['pvc']['metadata']['name'])
        if not current or current['spec'].get('volumeName') != op['destinationPV']['metadata']['name']:
            raise RuntimeError('The destination home binding changed. Administrator recovery is required.')
        lease.query('SELECT 1')
        clean_helpers(op)
        ws = volumes.workspace(token, op['workspaceId'])
        if op['wasRunning']:
            if ws['latest_build']['status'] not in ('running', 'starting', 'pending'):
                volumes.build(token, ws, 'start')
            def ready():
                ws = volumes.workspace(token, op['workspaceId'])
                pods = api('GET', path('pods') + '?labelSelector=' + urllib.parse.quote('com.coder.workspace.id=' + ws['id']))['items']
                return ws['latest_build']['status'] == 'running' and any(
                    p.get('spec', {}).get('nodeName') == op['target'] and any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in p.get('status', {}).get('conditions', [])) for p in pods)
            wait_for(ready, 'The home has moved, but the workspace has not become ready on the destination. Retry to check startup again.', timeout=600)
        destination = api('GET', path('persistentvolumes', op['destinationPV']['metadata']['name']))
        api('PATCH', path('persistentvolumes', destination['metadata']['name']), [
            {'op': 'test', 'path': '/metadata/uid', 'value': op['destinationPV']['metadata']['uid']},
            {'op': 'replace', 'path': '/spec/persistentVolumeReclaimPolicy', 'value': op['pv']['spec']['persistentVolumeReclaimPolicy']},
        ], 'application/json-patch+json')
        save(op, status='done', phase='done', error=None, message='Migration complete. The original home volume is retained for recovery.')
        LOG(event='workspace-migration-complete', workspace=op['workspaceId'], target=op['target'], recovery_volume=op['retainedVolume'])


def worker(token, op):
    try:
        # One migration at a time across replicas also avoids concurrent disk reservations.
        with database().transaction() as lease:
            if lease.query("SELECT pg_try_advisory_xact_lock(731942, 1)")[0][0] != "t":
                raise RuntimeError('Another migration is running. Try again after it finishes.')
            if not lease.query("SELECT id FROM coder_ui_updates.workspace_migrations WHERE id=$1::uuid AND worker=$2 AND status='running'", [op['id'], op['worker']]):
                return
            save(op, error=None)
            run(token, op, lease)
    except Exception as error:
        try:
            save(op, status='failed', error=str(error)[:1500])
        except RuntimeError:
            return
        LOG(event='workspace-migration-failed', workspace=op['workspaceId'], error=str(error)[:300])
    finally:
        with volumes.OPS_LOCK:
            if volumes.OPS.get(op['workspaceId']) == op['worker']:
                volumes.OPS.pop(op['workspaceId'], None)


def start(token, ws, user, target=None, resume=False):
    with volumes.OPS_LOCK, database().transaction() as lease:
        if lease.query('SELECT pg_try_advisory_xact_lock(731942, 1)')[0][0] != 't':
            raise ValueError('Another migration operation is in progress. Try again after it finishes.')
        if ws['id'] in volumes.OPS:
            raise ValueError('A volume operation is already running for this workspace.')
        op = latest(ws)
        attempt = str(uuid.uuid4())
        if resume:
            if not op or op['status'] not in ('failed', 'interrupted'):
                raise ValueError('There is no interrupted migration to resume.')
            claimed = lease.query("UPDATE coder_ui_updates.workspace_migrations SET status='running', worker=$2, updated_at=now() WHERE id=$1::uuid AND status IN ('failed','interrupted') RETURNING id", [op['id'], attempt])
            if not claimed:
                raise ValueError('Another administrator already resumed this migration.')
        else:
            if op and op['status'] != 'done':
                raise ValueError('Resume the existing migration before starting another.')
            if ws['latest_build']['status'] not in ('running', 'stopped'):
                raise ValueError('Wait for the current workspace build to finish.')
            preview, private = plan(ws)
            node = next((n for n in preview['nodes'] if n['name'] == target), None)
            if not node or not node['eligible']:
                raise ValueError('This destination cannot accept the workspace.')
            op = dict(id=str(uuid.uuid4()), workspaceId=ws['id'], workspaceName=ws['name'], target=target, sourceNode=preview['sourceNode'],
                      diskBytes=preview['diskBytes'], homeUsedBytes=preview['homeUsedBytes'], phase='prepare', initialBuild=ws['latest_build']['id'], wasRunning=volumes.is_running(ws), **private)
            op['temporaryClaim'] = 'coder-migration-' + op['id']
            lease.query('''INSERT INTO coder_ui_updates.workspace_migrations(id, organization_id, workspace_id, created_by, status, worker, state)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'running',$5,$6::jsonb)''',
                [op['id'], ws['organization_id'], ws['id'], user['id'], attempt, json.dumps({k: v for k, v in op.items() if k != 'id'})])
        op['worker'] = attempt
        volumes.OPS[ws['id']] = attempt
    LOG(event='workspace-migration-requested', workspace=ws['id'], by=user['id'], target=op['target'], resume=resume)
    threading.Thread(target=worker, args=(token, op), daemon=True).start()
    return public(dict(op, status='running'))


def cancel(ws):
    with database().transaction() as lease:
        if lease.query('SELECT pg_try_advisory_xact_lock(731942, 1)')[0][0] != 't':
            raise ValueError('Wait for the active migration to finish before canceling.')
        op = latest(ws)
        if not op or op['status'] not in ('failed', 'interrupted') or op['phase'] not in ('prepare', 'copy'):
            raise ValueError('Only an interrupted migration that has not switched home volumes can be canceled.')
        current = read('persistentvolumeclaims', op['pvc']['metadata']['name'])
        if not current or current['metadata']['uid'] != op['pvc']['metadata']['uid'] or current['spec'].get('volumeName') != op['pv']['metadata']['name']:
            raise ValueError('The original home binding changed. Resume the migration or contact an administrator.')
        clean_helpers(op)
        temporary = read('persistentvolumeclaims', op['temporaryClaim'])
        if temporary:
            if temporary['metadata'].get('labels', {}).get('coder.com/migration-id') != op['id']:
                raise ValueError('Staging claim identity changed. Administrator recovery is required.')
            delete('persistentvolumeclaims', temporary)
        save(op, status='done', phase='canceled', error=None,
             message='Migration canceled. The original home is unchanged. Use Start if the workspace is stopped.')
        return public(op)


def handle(h, method, url):
    if not url.startswith(BASE) and url != BASE.rstrip('/'):
        return False
    if method not in ('GET', 'POST'):
        h.send_json(405, {'error': 'Method not allowed'})
        return True
    if method == 'POST' and not h.csrf_ok():
        h.send_json(403, {'error': 'Request rejected (cross-site protection).'})
        return True
    user, error = h.user(admin=True)
    if error:
        return True
    try:
        if url.rstrip('/') == BASE.rstrip('/'):
            if method != 'GET':
                h.send_json(405, {'error': 'Method not allowed'})
            else:
                h.send_json(200, {'migrations': listing()})
            return True
        wid = str(uuid.UUID(url[len(BASE):]))
        token = h.token()
        ws = volumes.workspace(token, wid)
        if not volumes.can_update(token, ws):
            raise PermissionError('You cannot update this workspace.')
        if method == 'POST':
            body = volumes.read_json(h)
            operation = cancel(ws) if body.get('cancel') is True else start(token, ws, user, body.get('target'), body.get('resume') is True)
            h.send_json(202, {'operation': operation})
        else:
            # A failed worker releases its advisory lock. A crashed replica needs no stored credentials to resume.
            with database().transaction() as lease:
                if lease.query('SELECT pg_try_advisory_xact_lock(731942, 1)')[0][0] == 't':
                    lease.query("UPDATE coder_ui_updates.workspace_migrations SET status='interrupted' WHERE workspace_id=$1::uuid AND status='running' AND updated_at < now() - interval '90 seconds'", [wid])
            op = latest(ws)
            if op and op['status'] != 'done':
                preview = dict(workspaceId=wid, workspaceName=ws['name'], sourceNode=op['sourceNode'], diskBytes=op['diskBytes'], homeUsedBytes=op.get('homeUsedBytes'), nodes=[], generatedAt=volumes.now())
            else:
                try:
                    preview, _ = plan(ws)
                except ValueError:
                    if not op:
                        raise
                    preview = dict(workspaceId=wid, workspaceName=ws['name'], sourceNode=op['target'] if op['phase'] == 'done' else op['sourceNode'], diskBytes=op['diskBytes'], homeUsedBytes=op.get('homeUsedBytes'), nodes=[], generatedAt=volumes.now())
            h.send_json(200, dict(preview, operation=public(op)))
    except PermissionError as error:
        h.send_json(403, {'error': str(error)})
    except LookupError as error:
        h.send_json(404, {'error': str(error)})
    except ValueError as error:
        h.send_json(400, {'error': str(error)})
    except Exception as error:
        LOG(event='workspace-migration-request-failed', error=str(error)[:300])
        h.send_json(503, {'error': 'Migration service is unavailable. No new migration was confirmed. Refresh to check progress.'})
    return True
