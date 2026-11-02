"""Project authoritative workspace quarantine without trusting its guest agent."""
import copy
import datetime
import json
import re
import threading
import urllib.parse
import uuid

MARKER = 'platform.coder/quarantine-revision'
DESIRED = 'platform.coder/desired-run-strategy'
COMPONENTS = ('coder_access', 'runtime', 'sessions', 'tunnels', 'cloud_drive', 'network')
LIMITATION = ('Account credentials copied outside a workspace are not revoked by workspace quarantine. '
              'Other workspaces and the account dashboard retain their own Cloud Drive access.')
TARGETS = 'coder-workspace-quarantine-targets'
PROOF = 'platform.coder/quarantine-host-proof'
ROUTE = re.compile(r'^/__coder-ui/api/organizations/([0-9a-f-]{36})/workspaces/([0-9a-f-]{36})/quarantine-enforcement$')


def handle(handler, method, path, enforcer, workspace_info):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    if method != 'GET':
        handler.send_json(405, {'error': 'Method not allowed.'})
        return True
    try:
        _, error = handler.user()
        if error:
            return True
        org, wid = (identifier(value) for value in match.groups())
        workspace = workspace_info(handler.token(), wid)
        if not workspace or workspace.get('organization_id') != org:
            handler.send_json(404, {'error': 'Workspace not found in this organization.'})
        elif enforcer is None:
            handler.send_json(503, {'error': 'Workspace quarantine enforcement is unavailable.'})
        else:
            handler.send_json(200, enforcer.status(wid, org))
    except Exception:
        handler.send_json(503, {'error': 'Workspace quarantine enforcement could not be verified.'})
    return True


class HostObservation:
    """Read fresh infrastructure observations, never infer shutdown from deletion."""

    def __init__(self, kube, namespace, runtime_namespace):
        self.kube, self.namespace, self.runtime_namespace = kube, namespace, runtime_namespace
        self.path = '/api/v1/namespaces/%s/configmaps/%s' % (runtime_namespace, TARGETS)

    def fetch(self, path):
        status, value = self.kube.call('GET', path)
        if status != 200:
            raise RuntimeError('Quarantine infrastructure lookup is unavailable.')
        return value

    def targets(self):
        status, cm = self.kube.call('GET', self.path)
        if status == 404:
            return None, {}
        if status != 200:
            raise RuntimeError('Quarantine observation targets are unavailable.')
        raw = cm.get('data', {}).get('targets.json', '{}')
        if len(raw.encode()) > 512 * 1024:
            raise RuntimeError('Quarantine observation target limit exceeded.')
        targets = json.loads(raw)
        if not isinstance(targets, dict) or len(targets) > 512:
            raise RuntimeError('Quarantine observation targets are invalid.')
        return cm, targets

    def prepare(self, vm, current):
        metadata = vm['metadata']
        wid = current['workspace_id']
        name = metadata['name']
        status, instance = self.kube.call('GET', '/apis/kubevirt.io/v1/namespaces/%s/virtualmachineinstances/%s' % (self.namespace, name))
        if status not in (200, 404):
            raise RuntimeError('Quarantine instance identity is unavailable.')
        instance = instance if status == 200 else None
        registry = self.fetch('/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % self.runtime_namespace)
        record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(wid) or {}
        labels = metadata.get('labels') or {}
        if any(record.get(field) != labels.get(label) for field, label in (
                ('workspace_id', 'com.coder.workspace.id'), ('organization_id', 'com.coder.organization.id'),
                ('workspace_owner_id', 'com.coder.user.id'))):
            raise RuntimeError('Quarantine worker placement is not verified.')
        node_name = record.get('node_name')
        if not isinstance(node_name, str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,252}', node_name):
            raise RuntimeError('Quarantine worker identity is unavailable.')
        if instance and instance.get('status', {}).get('nodeName') not in (None, '', node_name):
            raise RuntimeError('Quarantine worker placement changed.')
        node = self.fetch('/api/v1/nodes/' + urllib.parse.quote(node_name, safe=''))
        if identifier(record.get('node_uid')) != node['metadata']['uid']:
            raise RuntimeError('A replacement worker cannot prove the retained HOME worker stopped.')
        selector = urllib.parse.quote('com.coder.workspace.id=' + wid)
        pods = self.fetch('/api/v1/namespaces/%s/pods?labelSelector=%s' % (self.namespace, selector))
        pod_uids = [identifier(p['metadata']['uid']) for p in pods.get('items', []) if any(
            owner.get('controller') and owner.get('kind') == 'VirtualMachineInstance'
            for owner in p.get('metadata', {}).get('ownerReferences', []))]
        target = {'revision': identifier(current['revision']), 'vm_uid': identifier(metadata['uid']),
                  'node_name': node_name, 'node_uid': identifier(node['metadata']['uid']),
                  'launcher_pod_uids': sorted(set(pod_uids))}
        if instance:
            target['vmi_uid'] = identifier(instance['metadata']['uid'])
        firmware = vm.get('spec', {}).get('template', {}).get('spec', {}).get('domain', {}).get('firmware', {}).get('uuid')
        if firmware:
            target['firmware_uuid'] = identifier(firmware)
        for _ in range(3):
            cm, targets = self.targets()
            previous = targets.get(wid) or {}
            if previous and previous.get('node_uid') != target['node_uid']:
                raise RuntimeError('A replacement worker does not prove the previous worker stopped.')
            if all(previous.get(key) == target[key] for key in ('revision', 'vm_uid', 'node_uid')):
                target['launcher_pod_uids'] = sorted(set(target['launcher_pod_uids'] + previous.get('launcher_pod_uids', [])))
                if 'vmi_uid' not in target and previous.get('vmi_uid'):
                    target['vmi_uid'] = previous['vmi_uid']
            if len(target['launcher_pod_uids']) > 16:
                raise RuntimeError('Quarantine launcher identity limit exceeded.')
            if previous == target:
                return target
            targets[wid] = target
            raw = json.dumps(targets, sort_keys=True, separators=(',', ':'))
            if len(targets) > 512 or len(raw.encode()) > 512 * 1024:
                raise RuntimeError('Quarantine observation target limit exceeded.')
            if cm is None:
                body = {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': TARGETS, 'namespace': self.runtime_namespace},
                        'data': {'targets.json': raw}}
                status, _ = self.kube.call('POST', '/api/v1/namespaces/%s/configmaps' % self.runtime_namespace, body)
            else:
                body = {'metadata': {'uid': cm['metadata']['uid'], 'resourceVersion': cm['metadata']['resourceVersion']},
                        'data': {'targets.json': raw}}
                status, _ = self.kube.call('PATCH', self.path, body, 'application/merge-patch+json')
            if status in (200, 201):
                return target
            if status != 409:
                raise RuntimeError('Quarantine observation target could not be persisted.')
        raise RuntimeError('Quarantine observation target changed concurrently.')

    def retire(self, vm, still_released):
        """Remove only this VM's target after an explicitly released policy."""
        wid = vm['metadata']['labels']['com.coder.workspace.id']
        for _ in range(3):
            cm, targets = self.targets()
            target = targets.get(wid)
            if not target or target.get('vm_uid') != vm['metadata']['uid']:
                return
            if not still_released():
                return
            del targets[wid]
            body = {'metadata': {'uid': cm['metadata']['uid'], 'resourceVersion': cm['metadata']['resourceVersion']},
                    'data': {'targets.json': json.dumps(targets, sort_keys=True, separators=(',', ':'))}}
            status, _ = self.kube.call('PATCH', self.path, body, 'application/merge-patch+json')
            if status == 200:
                return
            if status != 409:
                raise RuntimeError('Released quarantine observation target could not be retired.')

    def __call__(self, vm, current):
        metadata = vm['metadata']
        annotations = metadata.get('annotations') or {}
        if vm.get('spec', {}).get('runStrategy') != 'Halted' or annotations.get(DESIRED) != 'Halted' or annotations.get(MARKER) != current['revision']:
            return {'verified': False}
        _, targets = self.targets()
        target = targets.get(current['workspace_id']) or {}
        if target.get('revision') != current['revision'] or target.get('vm_uid') != metadata['uid']:
            return {'verified': False}
        status, _ = self.kube.call('GET', '/apis/kubevirt.io/v1/namespaces/%s/virtualmachineinstances/%s' % (self.namespace, metadata['name']))
        if status != 404:
            return {'verified': False}
        node = self.fetch('/api/v1/nodes/' + urllib.parse.quote(target['node_name'], safe=''))
        if node['metadata']['uid'] != target['node_uid'] or not any(
                c.get('type') == 'Ready' and c.get('status') == 'True' for c in node.get('status', {}).get('conditions', [])):
            return {'verified': False}
        raw = node['metadata'].get('annotations', {}).get(PROOF, '{}')
        if len(raw.encode()) > 65536:
            return {'verified': False}
        try:
            value = json.loads(raw)
            identifier(value['boot_id'])
            observed = value.get('targets', {}).get(current['workspace_id']) or {}
            if not isinstance(observed, dict):
                return {'verified': False}
            collected = datetime.datetime.fromisoformat(value['collected_at'])
            age = (datetime.datetime.now(datetime.timezone.utc) - collected).total_seconds()
        except (ValueError, TypeError, KeyError, AttributeError):
            return {'verified': False}
        identities = ('revision', 'vm_uid', 'launcher_pod_uids', 'vmi_uid', 'firmware_uuid')
        verified = (0 <= age <= 10 and value.get('node_uid') == target['node_uid']
                    and value.get('boot_id') == node.get('status', {}).get('nodeInfo', {}).get('bootID')
                    and all(observed.get(key) == target.get(key) for key in identities)
                    and all(observed.get(key) is True for key in ('verified', 'qemu_absent', 'cgroups_absent')))
        return {'verified': verified}


def identifier(value):
    return str(uuid.UUID(str(value)))


def policy(value, workspace_id, organization_id):
    """Require an exact authoritative record, including an explicit inactive record."""
    if not isinstance(value, dict) or any(value.get(key) != expected for key, expected in (
            ('workspace_id', workspace_id), ('organization_id', organization_id))):
        raise RuntimeError('Workspace quarantine policy is unavailable.')
    for field in ('enabled', 'manual_start_required', 'release_prepared'):
        if type(value.get(field)) is not bool:
            raise RuntimeError('Workspace quarantine policy is incomplete.')
    identifier(value.get('revision'))
    return copy.deepcopy(value)


def component(state, detail):
    return {'state': state, 'detail': detail}


def report(current):
    active = current['enabled']
    holding = current['manual_start_required']
    result = {key: current[key] for key in ('organization_id', 'workspace_id', 'revision')}
    result.update(state='quarantining' if active else 'released' if holding else 'inactive',
                  checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  limitations=[LIMITATION], components={})
    result['components'] = {name: component('pending' if active else 'released',
        'Waiting for infrastructure confirmation.' if active else 'No active quarantine policy.') for name in COMPONENTS}
    if active:
        result['components']['coder_access'] = component('blocked', 'Workspace access is restricted by the persistent policy.')
        result['components']['runtime'] = component('unverified', 'Physical runtime shutdown has not been verified.')
        result['components']['network'] = component('unverified', 'Network isolation requires trusted physical runtime shutdown proof.')
    elif holding:
        for name in ('runtime', 'sessions', 'tunnels', 'cloud_drive', 'network'):
            result['components'][name] = component('released' if current['release_prepared'] else 'pending',
                'Release does not start the workspace or reconnect it.' if current['release_prepared'] else
                'Preparing durable disconnection before a new explicit Start can be accepted.')
    return result


class ReleasePreparer:
    """Acknowledge durable disconnection before a new explicit Start is accepted."""

    def __init__(self, pending, withdraw, acknowledge, log):
        self.pending, self.withdraw, self.acknowledge, self.log = pending, withdraw, acknowledge, log

    def tick(self):
        for current in self.pending():
            current = policy(current, current['workspace_id'], current['organization_id'])
            if current['enabled'] or not current['manual_start_required'] or current['release_prepared']:
                continue
            try:
                components = self.withdraw(current)
                if all(components[name]['state'] in ('revoked', 'revoking') for name in ('tunnels', 'cloud_drive')):
                    self.acknowledge(current)
            except Exception:
                self.log(event='workspace-quarantine-release', status='pending', workspace=current['workspace_id'])

    def run(self):
        stop = threading.Event()
        while not stop.wait(3):
            try:
                self.tick()
            except Exception:
                self.log(event='workspace-quarantine-release', status='unavailable')


class Enforcer:
    """Fence VM lifecycle before configuration or startup, preserving HOME data."""

    def __init__(self, kube, namespace, lookup, withdraw, observe=None):
        self.kube, self.namespace = kube, namespace
        self.lookup, self.withdraw, self.observe = lookup, withdraw, observe
        self._reports, self._prepared, self._lock = {}, {}, threading.Lock()

    def current(self, workspace_id, organization_id):
        return policy(self.lookup(workspace_id), workspace_id, organization_id)

    def remember(self, result):
        with self._lock:
            self._reports[result['workspace_id']] = copy.deepcopy(result)

    def confirmed(self, result, current):
        for name in ('runtime', 'sessions', 'network'):
            result['components'][name] = component('blocked', 'Trusted host observation confirms the workspace runtime is stopped.')
        with self._lock:
            revision, prepared = self._prepared.get(current['workspace_id'], (None, ()))
        if revision == current['revision']:
            for name in prepared:
                result['components'][name] = component('revoked', 'Managed connections are withdrawn and the workspace runtime is stopped.')
        if all(value['state'] in ('blocked', 'revoked') for value in result['components'].values()):
            result['state'] = 'quarantined'
        return result

    def status(self, workspace_id, organization_id):
        current = self.current(workspace_id, organization_id)
        with self._lock:
            previous = copy.deepcopy(self._reports.get(workspace_id))
        # A report is useful only for the same authoritative policy revision.
        # Physical proof is intentionally not cached by this accessor.
        result = report(current)
        if previous and previous['revision'] == current['revision']:
            for name in ('tunnels', 'cloud_drive'):
                previous_component = previous['components'][name]
                result['components'][name] = (component('revoking', 'Connection withdrawal requires fresh runtime shutdown proof.')
                    if previous_component['state'] == 'revoked' else previous_component)
        if current['enabled'] and self.observe:
            path = '/apis/kubevirt.io/v1/namespaces/%s/virtualmachines/coder-vm-%s' % (self.namespace, workspace_id)
            status, vm = self.kube.call('GET', path)
            if status == 200 and self.observe(vm, current).get('verified') is True and self.current(workspace_id, organization_id) == current:
                self.confirmed(result, current)
        return result

    def __call__(self, vm):
        metadata = vm.get('metadata') or {}
        labels = metadata.get('labels') or {}
        wid, org = (identifier(labels.get(key)) for key in ('com.coder.workspace.id', 'com.coder.organization.id'))
        current = self.current(wid, org)
        annotations = metadata.get('annotations') or {}
        active = current['enabled'] or current['manual_start_required']
        path = '/apis/kubevirt.io/v1/namespaces/%s/virtualmachines/%s' % (self.namespace, metadata['name'])
        if not active and MARKER not in annotations:
            if self.observe:
                try:
                    self.observe.retire(vm, lambda: self.current(wid, org) == current)
                except Exception:
                    # Stale targets can only prevent an absence claim. Cleanup
                    # availability must not block an explicitly released start.
                    pass
            return False
        result = report(current)
        self.remember(result)
        if active and self.observe:
            try:
                self.observe.prepare(vm, current)
            except Exception:
                # A missing observation must not prevent the restrictive halt.
                # No physical isolation claim is made without subsequent proof.
                pass
        desired = 'Halted'
        changed = vm.get('spec', {}).get('runStrategy') != desired or annotations.get(DESIRED) != desired
        changed = changed or (active and annotations.get(MARKER) != current['revision'])
        if active and changed:
            status, latest = self.kube.call('GET', path)
            if status != 200 or any(latest.get('metadata', {}).get(key) != metadata.get(key) for key in ('uid', 'resourceVersion')):
                return True
            if self.current(wid, org) != current:
                return True
            patch = [{'op': 'test', 'path': '/metadata/uid', 'value': metadata['uid']},
                     {'op': 'test', 'path': '/metadata/resourceVersion', 'value': metadata['resourceVersion']},
                     {'op': 'add', 'path': '/metadata/annotations/' + MARKER.replace('/', '~1'), 'value': current['revision']},
                     {'op': 'add', 'path': '/metadata/annotations/' + DESIRED.replace('/', '~1'), 'value': desired},
                     {'op': 'add', 'path': '/spec/runStrategy', 'value': desired}]
            status, _ = self.kube.call('PATCH', path, patch, 'application/json-patch+json')
            if status not in (200, 409, 422):
                raise RuntimeError('Workspace quarantine halt could not be projected.')
            return True
        if active:
            try:
                withdrawn = self.withdraw(current)
                prepared = []
                for name in ('tunnels', 'cloud_drive'):
                    result['components'][name] = copy.deepcopy(withdrawn[name])
                    if withdrawn[name]['state'] == 'revoked':
                        prepared.append(name)
                        result['components'][name] = component('revoking', 'Managed connection intent is withdrawn; waiting for physical runtime shutdown proof.')
                with self._lock:
                    self._prepared[wid] = (current['revision'], tuple(prepared))
            except Exception:
                with self._lock:
                    self._prepared[wid] = (current['revision'], ())
                for name in ('tunnels', 'cloud_drive'):
                    result['components'][name] = component('unverified', 'Connection withdrawal could not be verified; runtime halt is still requested.')
        self.remember(result)
        if active:
            # API disappearance alone is not evidence that a QEMU process stopped.
            if current['enabled'] and self.observe:
                proof = self.observe(vm, current)
                if proof.get('verified') is True and self.current(wid, org) == current:
                    self.confirmed(result, current)
                    self.remember(result)
            return True
        # Only a new explicit Start may consume the release latch. Clear the
        # projection while still halted; this call never starts a VM itself.
        if vm.get('spec', {}).get('runStrategy') != 'Halted':
            raise RuntimeError('Quarantine release requires a stopped VM.')
        if not current['release_prepared']:
            return True
        if self.current(wid, org) != current:
            return True
        patch = [{'op': 'test', 'path': '/metadata/uid', 'value': metadata['uid']},
                 {'op': 'test', 'path': '/metadata/resourceVersion', 'value': metadata['resourceVersion']},
                 {'op': 'remove', 'path': '/metadata/annotations/' + MARKER.replace('/', '~1')}]
        status, _ = self.kube.call('PATCH', path, patch, 'application/json-patch+json')
        if status not in (200, 409, 422):
            raise RuntimeError('Workspace quarantine release could not be projected.')
        return True
