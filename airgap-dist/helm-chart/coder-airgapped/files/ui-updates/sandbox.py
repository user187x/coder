"""Organization-scoped network groups using the existing lockdown enforcement path."""
import contextlib
import hashlib
import ipaddress
import json
import uuid
import socket
import workspacetunnels

LOCKDOWN = None
PERSISTENCE = None


def database():
    if PERSISTENCE is None:
        raise RuntimeError('Shared sandbox storage is unavailable.')
    return PERSISTENCE.database()


def read_members(db):
    rows = db.query('SELECT workspace_id::text, organization_id::text, group_id::text, metadata::text FROM workspace_sandbox_members')
    return {wid: dict(json.loads(meta), organization_id=org, sandbox_group=group, modes=['sandbox'])
            for wid, org, group, meta in rows}


def settings():
    return read_members(database())


@contextlib.contextmanager
def member_state(write=False):
    with database().transaction() as db:
        db.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace-sandboxes', 0))")
        members = read_members(db)
        previous = set(members)
        yield members
        if write:
            for wid in previous - members.keys():
                db.query('DELETE FROM workspace_sandbox_members WHERE workspace_id=$1::uuid', [wid])
            for wid, value in members.items():
                db.query("""INSERT INTO workspace_sandbox_members(workspace_id, organization_id, group_id, metadata)
                    VALUES($1::uuid, $2::uuid, $3::uuid, $4::jsonb)
                    ON CONFLICT(workspace_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,
                    group_id=EXCLUDED.group_id, metadata=EXCLUDED.metadata, updated_at=now()""",
                    [wid, value['organization_id'], value['sandbox_group'], json.dumps(value)])


def project(members=None):
    """Publish the durable policy into the startup mount before accepting changes."""
    if members is None:
        with member_state() as current:
            return project(current)
    path = "/api/v1/namespaces/%s/configmaps" % LOCKDOWN.NAMESPACE
    for _ in range(5):
        cm = LOCKDOWN._configmap()
        existing = cm is not None
        if cm is None:
            cm = {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": LOCKDOWN.CONFIGMAP, "namespace": LOCKDOWN.NAMESPACE}, "data": {}}
        data = dict(cm.get("data") or {})
        for wid, mode in list(data.items()):
            if mode == "sandbox":
                data.pop(wid, None)
                data.pop(wid + ".meta", None)
        for wid, meta in members.items():
            if data.get(wid, "off") != "off":
                raise ValueError("Release the existing lockdown before adding a sandbox.")
            data[wid] = "sandbox"
            data[wid + ".meta"] = json.dumps(meta)
        if data == cm.get("data"):
            return
        cm["data"] = data
        status, _ = LOCKDOWN.KUBE.call("PUT" if existing else "POST", path + ("/" + LOCKDOWN.CONFIGMAP if existing else ""), cm)
        if status in (200, 201):
            return
        if status != 409:
            raise RuntimeError("Sandbox startup policy could not be published.")
    raise RuntimeError("Sandbox startup policy changed concurrently; try again.")


def network_policies(members):
    """Keep isolation attached to the workspace selector across pod replacements."""
    path = '/apis/networking.k8s.io/v1/namespaces/%s/networkpolicies' % LOCKDOWN.NAMESPACE
    status, current = LOCKDOWN.KUBE.call('GET', path + '?labelSelector=platform.coder%2Fsandbox%3Dtrue')
    if status != 200:
        raise RuntimeError('Sandbox network policies could not be read.')
    existing = {p['metadata']['name']: p for p in current.get('items', [])}
    wanted = set()
    for wid, member in members.items():
        name = 'coder-sandbox-' + wid
        wanted.add(name)
        peers = sorted(key for key, value in members.items() if value['sandbox_group'] == member['sandbox_group'])
        coder_ips, _, _ = inputs(wid, members)
        peer = {'podSelector': {'matchExpressions': [{'key': 'com.coder.workspace.id', 'operator': 'In', 'values': peers}]}}
        body = {'apiVersion': 'networking.k8s.io/v1', 'kind': 'NetworkPolicy',
            'metadata': {'name': name, 'namespace': LOCKDOWN.NAMESPACE, 'labels': {'platform.coder/sandbox': 'true'}},
            'spec': {'podSelector': {'matchLabels': {'com.coder.workspace.id': wid}}, 'policyTypes': ['Ingress', 'Egress'],
                'ingress': [{'from': [peer]}],
                'egress': [{'to': [peer]}, {'to': [{'ipBlock': {'cidr': ip + '/32'}} for ip in coder_ips.split()],
                    'ports': [{'protocol': 'TCP', 'port': port} for port in (80, 443, 8080)]}]}}
        old = existing.get(name)
        if old and old.get('spec') == body['spec']:
            continue
        if old:
            body['metadata']['resourceVersion'] = old['metadata']['resourceVersion']
        status, _ = LOCKDOWN.KUBE.call('PUT' if old else 'POST', path + ('/' + name if old else ''), body)
        if status not in (200, 201):
            raise RuntimeError('Sandbox network isolation could not be installed.')
    for name in existing.keys() - wanted:
        status, _ = LOCKDOWN.KUBE.call('DELETE', path + '/' + name)
        if status not in (200, 202, 404):
            raise RuntimeError('Sandbox network isolation could not be released.')


def group_of(workspace):
    return (LOCKDOWN.settings().get(workspace) or {}).get('sandbox_group')


def pair_allowed(source, target):
    settings = LOCKDOWN.settings()
    a = (settings.get(source) or {}).get('sandbox_group')
    b = (settings.get(target) or {}).get('sandbox_group')
    return (not a and not b) or bool(a and a == b)


def inputs(workspace, members=None):
    settings = LOCKDOWN.settings() if members is None else members
    group = (settings.get(workspace) or {}).get('sandbox_group')
    if not group:
        return '', '', ''
    members = {wid for wid, value in settings.items() if value.get('sandbox_group') == group}
    peers = sorted({str(ipaddress.ip_address(p['status']['podIP'])) for p in LOCKDOWN.running_pods()
                    if p['metadata'].get('labels', {}).get('com.coder.workspace.id') in members
                    and p.get('status', {}).get('podIP') and ':' not in p['status']['podIP']})
    with workspacetunnels.state(write=False) as tunnels:
        peers += [str(ipaddress.IPv4Address(value['address'])) for wid, value in tunnels['workspaces'].items() if wid in members]
    peers = sorted(set(peers))
    status, service = LOCKDOWN.KUBE.call('GET', '/api/v1/namespaces/%s/services/coder' % LOCKDOWN.NAMESPACE)
    if status != 200:
        raise RuntimeError('Coder control-plane addresses are unavailable.')
    coder = [service.get('spec', {}).get('clusterIP')]
    status, endpoints = LOCKDOWN.KUBE.call('GET', '/api/v1/namespaces/%s/endpoints/coder' % LOCKDOWN.NAMESPACE)
    if status != 200:
        raise RuntimeError('Coder control-plane endpoints are unavailable.')
    coder += [address.get('ip') for subset in endpoints.get('subsets', []) for address in subset.get('addresses', [])]
    coder += [entry[4][0] for entry in socket.getaddrinfo(LOCKDOWN.CODER_HOST, 443, socket.AF_INET, socket.SOCK_STREAM)]
    coder = sorted({str(ipaddress.IPv4Address(address)) for address in coder if address and ':' not in address})
    if not coder:
        raise RuntimeError('No Coder control-plane address can be allowed.')
    signature = hashlib.sha256(json.dumps([group, peers, coder]).encode()).hexdigest()[:16]
    return ' '.join(coder), ' '.join(peers), signature


def groups(organization):
    result = {}
    for wid, value in LOCKDOWN.settings().items():
        if value.get('organization_id') != organization or not value.get('sandbox_group'):
            continue
        group = result.setdefault(value['sandbox_group'], {'id': value['sandbox_group'], 'organization_id': organization, 'workspaces': []})
        group['workspaces'].append({'id': wid, 'name': value.get('workspace', wid)})
    return list(result.values())


def change(organization, workspaces, user, group=None, release=False):
    group = str(uuid.UUID(group)) if group else str(uuid.uuid4())
    if PERSISTENCE is None:
        raise RuntimeError('Shared sandbox storage is unavailable.')
    with member_state(write=True) as members:
        if any(value['sandbox_group'] == group and value['organization_id'] != organization for value in members.values()):
            raise ValueError('Sandbox groups cannot cross organizations.')
        if release:
            removed = [wid for wid, value in members.items() if value['sandbox_group'] == group and value['organization_id'] == organization]
            if not removed:
                raise LookupError('Sandbox group not found in this organization.')
            for wid in removed:
                members.pop(wid)
        else:
            for ws in workspaces:
                wid = ws['id']
                if wid in members and members[wid]['sandbox_group'] != group:
                    raise ValueError('Release the existing sandbox before moving this workspace.')
                members[wid] = {'sandbox_group': group, 'organization_id': organization, 'modes': ['sandbox'],
                    'by': user['username'], 'at': LOCKDOWN.now(), 'workspace': ws['name'], 'owner': ws['owner_name']}
        project(members)
    network_policies(settings())
    with workspacetunnels.state() as tunnels:
        for tunnel in tunnels['tunnels'].values():
            if not tunnel.get('deleted') and not pair_allowed(tunnel['source_workspace_id'], tunnel['target_workspace_id']):
                tunnel.update(deleted=True, revision=workspacetunnels.changed(tunnels))
    return group


def handle(h, method, path):
    prefix = '/__coder-ui/api/sandbox/'
    if not path.startswith(prefix):
        return False
    try:
        organization = str(uuid.UUID(path[len(prefix):]))
        user, error = h.user(admin=True)
        if error:
            return True
        if method == 'GET':
            return h.send_json(200, {'groups': groups(organization)}) or True
        if method != 'POST' or not h.csrf_ok():
            return h.send_json(403, {'error': 'Request rejected.'}) or True
        body = LOCKDOWN.read_json(h)
        release = body.get('release') is True
        ids = body.get('workspace_ids', [])
        if not isinstance(ids, list) or (not release and not 1 <= len(ids) <= 100):
            raise ValueError('Choose 1 to 100 workspaces.')
        workspaces = []
        for raw in ids:
            wid = str(uuid.UUID(raw))
            ws = LOCKDOWN.WORKSPACE_INFO(h.token(), wid)
            if not ws or ws.get('organization_id') != organization:
                raise LookupError('Workspace not found in this organization.')
            pods = LOCKDOWN.running_pods(wid)
            if not pods:
                raise ValueError('Start the workspace before adding it to a sandbox so its runtime can be verified.')
            for pod in pods:
                spec = pod.get('spec', {})
                dev = next((c for c in spec.get('containers', []) if c['name'] == 'dev'), {})
                security = dev.get('securityContext', {})
                if spec.get('hostNetwork') or spec.get('hostPID') or spec.get('hostIPC') or any('hostPath' in volume for volume in spec.get('volumes', [])) or security.get('privileged') or any(cap in ('ALL', 'NET_ADMIN', 'SYS_ADMIN', 'SYS_PTRACE') for cap in security.get('capabilities', {}).get('add', [])):
                    raise ValueError('This workspace runtime can override network isolation and cannot join a sandbox.')
                if not any(container.get('name') == 'lockdown' for container in spec.get('initContainers', [])):
                    raise ValueError('Update this workspace template to include startup network isolation before adding a sandbox.')
            workspaces.append(ws)
        previous = groups(organization)
        group = change(organization, workspaces, user, body.get('group_id'), release)
        targets = {ws['id'] for ws in workspaces}
        for old in previous:
            if old['id'] == group:
                targets.update(ws['id'] for ws in old['workspaces'])
        failures = []
        for wid in targets:
            for _, ok, message in LOCKDOWN.reconcile(wid, 'off' if release else 'sandbox'):
                if not ok:
                    failures.append(message)
        return h.send_json(200, {'groups': groups(organization), 'error': '; '.join(failures) or None}) or True
    except (ValueError, TypeError) as error:
        h.send_json(400, {'error': str(error)})
    except LookupError as error:
        h.send_json(404, {'error': str(error)})
    except RuntimeError as error:
        h.send_json(503, {'error': str(error)})
    return True
