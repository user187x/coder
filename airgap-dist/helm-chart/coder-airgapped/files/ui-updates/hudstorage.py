"""HUD storage inventory in GiB, with physical filesystems separate from PVC reservations."""
import math
from datetime import datetime, timezone

GIB = 1024 ** 3


def number(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
        return None
    return value


def fresh(stats):
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(stats['time'].replace('Z', '+00:00'))).total_seconds()
        return -5 <= age <= 90
    except (KeyError, TypeError, ValueError):
        return False


def collect(kube, nodes, summaries, quantity):
    """Unknown or partial physical totals stay null; PVC usage is deduplicated across pod mounts."""
    ready = [n for n in nodes if any(c.get('type') == 'Ready' and c.get('status') == 'True'
             for c in (n.get('status') or {}).get('conditions') or [])]
    disks, volumes = [], {}
    for n in ready:
        summary = summaries.get((n.get('metadata') or {}).get('name')) or {}
        fs = (summary.get('node') or {}).get('fs') or {}
        if fresh(fs) and all(number(fs.get(k)) is not None for k in ('usedBytes', 'capacityBytes', 'availableBytes')):
            disks.append(fs)
        for pod in summary.get('pods') or []:
            for volume in pod.get('volume') or []:
                ref = volume.get('pvcRef') or {}
                key = (ref.get('namespace'), ref.get('name'))
                used = number(volume.get('usedBytes'))
                if all(key) and used is not None and fresh(volume):
                    volumes[key] = max(volumes.get(key, 0), used)
    def inventory(path):
        try:
            status, data = kube.call('GET', path)
            return data.get('items', []) if status == 200 and isinstance(data, dict) else None
        except Exception:
            return None
    pvs = inventory('/api/v1/persistentvolumes')
    pvcs = inventory('/api/v1/persistentvolumeclaims')
    classes = {}
    claims = []
    for pvc in pvcs or []:
        meta, spec = pvc.get('metadata') or {}, pvc.get('spec') or {}
        size = quantity(((spec.get('resources') or {}).get('requests') or {}).get('storage'))
        if size is None:
            continue
        size /= GIB
        name = spec.get('storageClassName') or '(none)'
        group = classes.setdefault(name, dict(name=name, claims=0, claimed=0, volumes=0, capacity=0, used=None, measuredClaims=0))
        group['claims'] += 1
        group['claimed'] += size
        claims.append((size, '%s/%s' % (meta.get('namespace'), meta.get('name'))))
        used = volumes.get((meta.get('namespace'), meta.get('name')))
        if used is not None:
            group['used'] = (group['used'] or 0) + used / GIB
            group['measuredClaims'] += 1
    capacities = []
    for pv in pvs or []:
        spec = pv.get('spec') or {}
        capacity = quantity((spec.get('capacity') or {}).get('storage'))
        if capacity is None:
            continue
        capacity /= GIB
        capacities.append(capacity)
        name = spec.get('storageClassName') or '(none)'
        group = classes.setdefault(name, dict(name=name, claims=0, claimed=0, volumes=0, capacity=0, used=None, measuredClaims=0))
        group['volumes'] += 1
        group['capacity'] += capacity
    complete = bool(ready) and len(disks) == len(ready)
    total = lambda key: sum(fs[key] for fs in disks) / GIB if complete else None
    measured = [group['used'] for group in classes.values() if group['used'] is not None]
    largest = max(claims, default=(None, ''), key=lambda claim: claim[0])
    return dict(used=total('usedBytes'), total=total('capacityBytes'), free=total('availableBytes'),
                claimed=sum(size for size, _ in claims) if pvcs is not None else None,
                volumeUsed=sum(measured) if measured else None, maxVolume=max(capacities, default=None),
                maxClaim=largest[0], maxClaimName=largest[1], volumeCount=len(pvs) if pvs is not None else None,
                measuredNodes=len(disks), readyNodes=len(ready), classes=sorted(classes.values(), key=lambda group: group['name']),
                inventoryAvailable=pvs is not None and pvcs is not None)


def metrics(storage):
    detail = '%s of %s ready node filesystems measured' % (storage['measuredNodes'], storage['readyNodes'])
    entries = [('disk-total', 'Total cluster disk', 'total', detail),
               ('disk-used', 'Total disk used', 'used', detail), ('disk-free', 'Total disk free', 'free', detail),
               ('disk-claimed', 'Disk claimed', 'claimed', 'PVC storage requests, including stopped workspaces'),
               ('max-volume', 'Maximum volume size', 'maxVolume', 'Largest existing persistent volume'),
               ('max-volume-claim', 'Largest volume claim', 'maxClaim', storage['maxClaimName']),
               ('volume-count', 'Volumes created', 'volumeCount', 'Existing persistent volumes')]
    return [dict(id=mid, label=label, group='health', value=storage[key], unit='' if key == 'volumeCount' else 'GiB',
                 detail=description, hint='Node root filesystem totals exclude additional devices. Volume reservations can use remote or thin-provisioned storage.', href='')
            for mid, label, key, description in entries]
