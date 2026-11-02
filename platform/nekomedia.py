"""Resolve infrastructure media endpoints without trusting workspace signaling."""
import hmac
import ipaddress
import json
import os
import pathlib
import re
import threading
import urllib.parse
import uuid

from workspace_runtime import validate_vm_profile

ROUTE = re.compile(r'^/__coder-ui/internal/organizations/([0-9a-f-]{36})/workspaces/([0-9a-f-]{36})/neko-media$')
HTTP_ORIGIN = 'http://127.0.0.1:9080'
UDP_PORT = 59000
QUERY = (
    "SELECT w.id::text, w.organization_id::text, w.owner_id::text, b.id::text, a.id::text "
    "FROM workspaces w JOIN users u ON u.id = w.owner_id "
    "JOIN LATERAL (SELECT wb.* FROM workspace_builds wb WHERE wb.workspace_id = w.id "
    "ORDER BY wb.build_number DESC LIMIT 1) b ON true "
    "JOIN provisioner_jobs j ON j.id = b.job_id "
    "JOIN workspace_resources r ON r.job_id = b.job_id "
    "JOIN workspace_agents a ON a.resource_id = r.id "
    "JOIN workspace_apps app ON app.agent_id = a.id "
    "LEFT JOIN workspace_quarantines q ON q.workspace_id = w.id AND q.organization_id = w.organization_id "
    "WHERE w.id = $1::uuid AND w.organization_id = $2::uuid AND b.id = $3::uuid "
    "AND ($4::uuid IS NULL OR a.id = $4::uuid) AND b.transition = 'start' AND j.job_status = 'succeeded' "
    "AND NOT w.deleted AND NOT u.deleted AND u.status = 'active' AND NOT a.deleted AND a.parent_id IS NULL "
    "AND app.slug = 'neko' AND app.url = 'http://127.0.0.1:9080' AND NOT app.external "
    "AND app.sharing_level = 'owner' AND app.subdomain "
    "AND NOT COALESCE(q.enabled OR q.manual_start_required, false)")


def identifier(value):
    canonical = str(uuid.UUID(str(value)))
    if canonical != value:
        raise ValueError('Invalid media identity.')
    return canonical


def address(value):
    parsed = ipaddress.IPv4Address(value)
    if str(parsed) != value or parsed.is_loopback or parsed.is_link_local or parsed.is_multicast or parsed.is_unspecified or parsed.is_reserved:
        raise ValueError('Invalid media endpoint.')
    return str(parsed)


def ready(obj):
    return not obj.get('metadata', {}).get('deletionTimestamp') and any(
        c.get('type') == 'Ready' and c.get('status') == 'True' for c in obj.get('status', {}).get('conditions', []))


class Service:
    """Bind media to an enrolled worker and one current running VM instance."""

    def __init__(self, kube, pool, namespace, runtime_namespace, *, enabled=False, key=None, images=(), relay_cidrs=(), cpu_models=('Haswell-noTSX',)):
        if type(enabled) is not bool or not all(isinstance(value, (list, tuple)) for value in (images, relay_cidrs, cpu_models)):
            raise ValueError('Invalid media descriptor configuration.')
        self.kube, self.pool = kube, pool
        self.namespace, self.runtime_namespace = namespace, runtime_namespace
        self.enabled, self.key, self.images = enabled, key, tuple(images)
        self.cpu_models = tuple(cpu_models)
        self.relay_cidrs = tuple(ipaddress.IPv4Network(cidr, strict=True) for cidr in relay_cidrs)
        self.slots = threading.BoundedSemaphore(8)
        if enabled and (not key or not re.fullmatch(r'[0-9a-f]{64}', key) or not images or not self.relay_cidrs):
            raise ValueError('Media descriptor configuration is incomplete.')
        if len(self.images) > 32 or any(not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', image) for image in self.images):
            raise ValueError('Media guest image allowlist is invalid.')
        if len(self.relay_cidrs) > 16 or any(cidr.prefixlen < 8 for cidr in self.relay_cidrs):
            raise ValueError('Media relay network allowlist is invalid.')
        if not self.cpu_models or len(self.cpu_models) > 16 or any(not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', model) or model in ('host', 'host-model', 'host-passthrough', 'max') for model in self.cpu_models):
            raise ValueError('Media CPU model allowlist is invalid.')

    @classmethod
    def from_env(cls, kube, pool, namespace, runtime_namespace):
        flag = os.environ.get('NEKO_MEDIA_ENABLED', 'false')
        if flag not in ('true', 'false'):
            raise ValueError('Invalid media enablement setting.')
        if flag == 'false':
            return cls(kube, pool, namespace, runtime_namespace)
        path = pathlib.Path(os.environ['NEKO_MEDIA_DESCRIPTOR_KEY_FILE'])
        if not path.is_absolute():
            raise ValueError('Media descriptor key path must be absolute.')
        with path.open('r') as stream:
            raw = stream.read(66)
        if len(raw) > 65:
            raise ValueError('Media descriptor key exceeds its bound.')
        key = raw.strip()
        return cls(kube, pool, namespace, runtime_namespace, enabled=True, key=key,
                   images=json.loads(os.environ['NEKO_MEDIA_GUEST_IMAGES']),
                   relay_cidrs=json.loads(os.environ['NEKO_MEDIA_RELAY_CIDRS']),
                   cpu_models=json.loads(os.environ.get('NEKO_MEDIA_CPU_MODELS', '["Haswell-noTSX"]')))

    def fetch(self, path):
        status, value = self.kube.call('GET', path)
        if status != 200 or not isinstance(value, dict):
            raise RuntimeError('Media infrastructure is unavailable.')
        return value

    def binding(self, org, wid, build, agent=None):
        pool = self.pool() if callable(self.pool) else self.pool
        if pool is None:
            raise RuntimeError('Media policy is unavailable.')
        params = [identifier(wid), identifier(org), identifier(build), identifier(agent) if agent else None]
        rows = pool.query(QUERY, params)
        if len(rows) != 1 or len(rows[0]) != 5:
            raise RuntimeError('Media workspace is unavailable.')
        current = dict(zip(('workspace_id', 'organization_id', 'workspace_owner_id', 'build_id', 'agent_id'), rows[0]))
        for field in current:
            identifier(current[field])
        if any(current[field] != value for field, value in (
                ('workspace_id', wid), ('organization_id', org), ('build_id', build))) or agent and current['agent_id'] != agent:
            raise RuntimeError('Media workspace identity changed.')
        return current

    def descriptor(self, org, wid, build, agent):
        if not self.enabled or not self.slots.acquire(blocking=False):
            raise RuntimeError('Media descriptors are unavailable.')
        try:
            current = self.binding(org, wid, build, agent)
            base = '/apis/kubevirt.io/v1/namespaces/%s/' % self.namespace
            vm = self.fetch(base + 'virtualmachines/coder-vm-' + wid)
            meta = vm['metadata']
            annotations = meta.get('annotations') or {}
            if vm.get('spec', {}).get('runStrategy') != 'Always' or annotations.get('platform.coder/desired-run-strategy') != 'Always' or annotations.get('platform.coder/quarantine-revision'):
                raise RuntimeError('Media workspace is stopped or restricted.')
            profile = validate_vm_profile(vm, self.fetch, self.namespace, self.images, self.cpu_models, self.runtime_namespace)
            if any(profile.get(field) != current[field] for field in ('workspace_id', 'organization_id', 'workspace_owner_id', 'build_id')) or annotations.get('com.coder.agent.id') != agent:
                raise RuntimeError('Media runtime identity changed.')
            instance = self.fetch(base + 'virtualmachineinstances/' + meta['name'])
            if instance.get('status', {}).get('phase') != 'Running' or not ready(instance) or not any(
                    o.get('kind') == 'VirtualMachine' and o.get('controller') and o.get('uid') == meta['uid']
                    for o in instance['metadata'].get('ownerReferences', [])):
                raise RuntimeError('Media instance is unavailable.')
            registry = self.fetch('/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % self.runtime_namespace)
            record = json.loads(registry['data']['homes.json'])[wid]
            if instance['status'].get('nodeName') != record['node_name']:
                raise RuntimeError('Media worker placement changed.')
            node = self.fetch('/api/v1/nodes/' + urllib.parse.quote(record['node_name'], safe=''))
            if identifier(record['node_uid']) != node['metadata']['uid'] or not ready(node):
                raise RuntimeError('Media worker is unavailable or replaced.')
            pods = self.fetch('/api/v1/namespaces/%s/pods?labelSelector=%s' % (
                self.namespace, urllib.parse.quote('com.coder.workspace.id=' + wid))).get('items', [])
            launchers = [p for p in pods if p.get('status', {}).get('phase') == 'Running' and ready(p) and any(
                o.get('kind') == 'VirtualMachineInstance' and o.get('controller') and o.get('uid') == instance['metadata']['uid']
                for o in p['metadata'].get('ownerReferences', []))]
            if len(launchers) != 1 or launchers[0].get('spec', {}).get('nodeName') != record['node_name']:
                raise RuntimeError('Media launcher is unavailable.')
            peer = address(launchers[0]['status']['podIP'])
            if self.binding(org, wid, build, agent) != current:
                raise RuntimeError('Media policy changed during resolution.')
            return {'version': 1, **current, 'node_uid': identifier(record['node_uid']),
                    'vm_uid': identifier(meta['uid']), 'vmi_uid': identifier(instance['metadata']['uid']),
                    'peer': '%s:%s' % (peer, UDP_PORT), 'http_origin': HTTP_ORIGIN}
        finally:
            self.slots.release()

    def settings(self, profile, vm, instance, launcher):
        """Publish only fixed guest ports and infrastructure-owned relay addresses."""
        if not self.enabled:
            return None
        roots = [volume.get('containerDisk', {}).get('image') for volume in vm.get('spec', {}).get('template', {}).get('spec', {}).get('volumes', []) if volume.get('name') == 'root']
        if len(roots) != 1 or roots[0] not in self.images:
            return None
        try:
            self.binding(profile['organization_id'], profile['workspace_id'], profile['build_id'])
        except RuntimeError:
            return {'enabled': False, 'relay_sources': []}
        deployment = self.fetch('/apis/apps/v1/namespaces/%s/deployments/coder' % self.namespace)
        replicas = self.fetch('/apis/apps/v1/namespaces/%s/replicasets?labelSelector=%s' % (
            self.namespace, urllib.parse.quote('app.kubernetes.io/name=coder'))).get('items', [])
        owned = {r['metadata']['uid'] for r in replicas if not r['metadata'].get('deletionTimestamp') and any(
            o.get('kind') == 'Deployment' and o.get('controller') and o.get('uid') == deployment['metadata']['uid']
            for o in r['metadata'].get('ownerReferences', []))}
        pods = self.fetch('/api/v1/namespaces/%s/pods?labelSelector=%s' % (
            self.namespace, urllib.parse.quote('app.kubernetes.io/name=coder'))).get('items', [])
        sources = set()
        account = deployment.get('spec', {}).get('template', {}).get('spec', {}).get('serviceAccountName') or 'default'
        for pod in pods:
            if not ready(pod) or pod.get('status', {}).get('phase') != 'Running' or pod.get('spec', {}).get('serviceAccountName', 'default') != account or pod.get('spec', {}).get('hostNetwork'):
                continue
            if not any(o.get('kind') == 'ReplicaSet' and o.get('controller') and o.get('uid') in owned for o in pod['metadata'].get('ownerReferences', [])):
                continue
            candidate = address(pod['status']['podIP'])
            if any(ipaddress.IPv4Address(candidate) in cidr for cidr in self.relay_cidrs):
                sources.add(candidate)
        if not sources or len(sources) > 16:
            raise RuntimeError('Trusted media relays are unavailable.')
        return {'enabled': True, 'relay_sources': sorted(sources), 'advertised_ip': address(launcher['status']['podIP'])}


def handle(handler, method, path, query, service):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    supplied = handler.headers.get('X-Coder-Media-Descriptor-Key', '')
    if not service or not service.key or not re.fullmatch(r'[0-9a-f]{64}', supplied) or not hmac.compare_digest(supplied, service.key):
        handler.send_json(403, {'error': 'Media descriptor access denied.'})
        return True
    if method != 'GET':
        handler.send_json(405, {'error': 'Method not allowed.'})
        return True
    try:
        args = urllib.parse.parse_qs(query, strict_parsing=True, max_num_fields=2)
        if set(args) != {'build_id', 'agent_id'} or any(len(values) != 1 for values in args.values()):
            raise ValueError('Invalid descriptor query.')
        org, wid = (identifier(value) for value in match.groups())
        build, agent = (identifier(args[key][0]) for key in ('build_id', 'agent_id'))
    except ValueError:
        handler.send_json(400, {'error': 'Invalid media descriptor request.'})
        return True
    try:
        handler.send_json(200, service.descriptor(org, wid, build, agent))
    except Exception:
        handler.send_json(503, {'error': 'Media workspace could not be verified.'})
    return True
