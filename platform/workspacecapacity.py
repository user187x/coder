"""Resource requests available to a new workspace on each eligible Kubernetes node."""
import math
import re

GPU = 'nvidia.com/gpu'
RESOURCES = {'cpu': 'cpu', 'memory': 'memory', 'gpus': GPU}


def pod_request(spec, resource, quantity, omit_dev=False):
    def request(container):
        resources = container.get('resources') or {}
        return quantity((resources.get('requests') or {}).get(resource,
                        (resources.get('limits') or {}).get(resource))) or 0
    regular = sum(request(c) for c in spec.get('containers', []) if not (omit_dev and c['name'] == 'dev'))
    sides = peak = 0
    for c in spec.get('initContainers', []):
        value = request(c)
        peak = max(peak, sides + value)
        if c.get('restartPolicy') == 'Always':
            sides += value
    overhead = quantity((spec.get('overhead') or {}).get(resource)) or 0
    return max(peak, regular + sides) + overhead


def template_pod(pods, template, current):
    for p in pods:
        labels = p['metadata'].get('labels') or {}
        wid = labels.get('com.coder.workspace.id')
        if not wid:
            continue
        if current and wid == current:
            return p['spec']
        owner, name = labels.get('com.coder.user.username'), labels.get('com.coder.workspace.name')
        base = re.sub('[^a-z0-9-]+', '-', f'coder-{owner}-{template}-{name}'.lower()).strip('-')
        if len(base) > 52:
            base = base[:45].strip('-') + '-' + wid[:6]
        if not current and p['metadata']['name'].startswith(base + '-'):
            return p['spec']
    return {}


def matches_term(labels, expressions):
    def match(e):
        value = labels.get(e['key'])
        op, values = e['operator'], e.get('values', [])
        if op in ('Gt', 'Lt'):
            try:
                return int(value) > int(values[0]) if op == 'Gt' else int(value) < int(values[0])
            except (TypeError, ValueError, IndexError):
                return False
        return {'In': value in values, 'NotIn': value not in values,
                'Exists': value is not None, 'DoesNotExist': value is None}.get(op, False)
    return all(match(e) for e in expressions)


def eligible(node, profile):
    spec, status = node.get('spec') or {}, node['status']
    conditions = {c['type']: c['status'] for c in status.get('conditions', [])}
    if spec.get('unschedulable') or conditions.get('Ready') != 'True' or any(
            conditions.get(k) == 'True' for k in ('MemoryPressure', 'DiskPressure', 'PIDPressure')):
        return False
    for taint in spec.get('taints', []):
        if taint['effect'] in ('NoSchedule', 'NoExecute') and not any(
                t.get('effect', '') in ('', taint['effect']) and
                ((t.get('operator') == 'Exists' and t.get('key', '') in ('', taint['key'])) or
                 (t.get('operator', 'Equal') == 'Equal' and t.get('key') == taint['key'] and
                  t.get('value', '') == taint.get('value', ''))) for t in profile.get('tolerations', [])):
            return False
    labels = node['metadata'].get('labels', {})
    if any(labels.get(k) != v for k, v in profile.get('nodeSelector', {}).items()):
        return False
    required = profile.get('affinity', {}).get('nodeAffinity', {}).get('requiredDuringSchedulingIgnoredDuringExecution')
    return required is None or any(
        (t.get('matchExpressions') or t.get('matchFields')) and matches_term(labels, t.get('matchExpressions', []))
        and matches_term({'metadata.name': node['metadata']['name']}, t.get('matchFields', []))
        for t in required.get('nodeSelectorTerms', []))


def available(snapshot, template, current, quantity, namespace, bound_node=None):
    if not snapshot['podsAvailable']:
        raise ValueError('Kubernetes pod reservations are unavailable. Try again.')
    pods = snapshot['pods']
    peers = [p for p in pods if p['metadata'].get('namespace') == namespace]
    profile = template_pod(peers, template, current) or template_pod(peers, template, None)
    # A template's main container receives the selected size. Sidecars remain alongside it.
    sides = {**profile, 'initContainers': [c for c in profile.get('initContainers', []) if c.get('restartPolicy') == 'Always']}
    nodes = []
    for node in snapshot['nodes']:
        name = node['metadata']['name']
        if (bound_node and name != bound_node) or not eligible(node, profile):
            continue
        placed = [p for p in pods if p['spec'].get('nodeName') == name and not
                  (current and p['metadata'].get('namespace') == namespace and
                   p['metadata'].get('labels', {}).get('com.coder.workspace.id') == current)]
        alloc = node['status'].get('allocatable', {})
        if alloc.get('pods') is not None and len(placed) >= int(alloc['pods']):
            continue
        capacity = {}
        for key, res in RESOURCES.items():
            free = (quantity(alloc.get(res)) or 0) - sum(pod_request(p['spec'], res, quantity) for p in placed)
            if free < pod_request(profile, res, quantity, omit_dev=True):
                break
            capacity[key] = (free - pod_request(sides, res, quantity, omit_dev=True)) / (2**30 if key == 'memory' else 1)
        else:
            nodes.append({**capacity, "_name": name})
    return nodes


def check_size(values, nodes):
    try:
        want = {k: float(values.get(k) or 0) for k in RESOURCES}
        disk = float(values.get('home_disk_size') or 0)
        if any(not math.isfinite(v) or v < 0 for v in (*want.values(), disk)):
            raise ValueError
    except (TypeError, ValueError):
        return 'Workspace resource requests must be finite, nonnegative numbers.'
    fitting = [node for node in nodes if all(node[k] >= v for k, v in want.items())]
    if fitting and not any(node.get('disk', math.inf) >= disk for node in fitting):
        return 'No eligible node has sufficient storage for the requested home disk.'
    if fitting:
        return None
    best = max((node['memory'] for node in nodes if node['cpu'] >= want['cpu'] and node['gpus'] >= want['gpus']), default=0)
    return ('No eligible node can fit this workspace at its requested size '
            '(%g CPUs, %g GiB memory, %g GPUs). At this CPU and GPU selection, up to %.2f GiB of memory '
            'is available on one node. Choose a smaller size or free cluster capacity.' %
            (want['cpu'], want['memory'], want['gpus'], best))
