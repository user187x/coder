"""Fail-closed checks for workspace runtime admission, independent of HTTP transport."""
from decimal import Decimal
import json
import re


class RuntimePolicyError(ValueError):
    """A pod does not satisfy the mandatory workspace runtime policy."""


def quantity(value):
    """Parse a finite Kubernetes CPU or memory quantity without float rounding."""
    if len(str(value)) > 128:
        raise RuntimePolicyError('resource quantity is too long')
    match = re.fullmatch(r'([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([numkKMGTPE]|[KMGTPE]i)?', str(value))
    if not match:
        raise RuntimePolicyError('invalid resource quantity')
    exponent = re.search(r'[eE]([+-]?\d+)$', match[1])
    if exponent and abs(int(exponent[1])) > 64:
        raise RuntimePolicyError('resource quantity exponent is out of range')
    suffix = match[2] or ''
    powers = {'n': Decimal('1e-9'), 'u': Decimal('1e-6'), 'm': Decimal('1e-3'), '': Decimal(1)}
    if suffix not in powers:
        powers[suffix] = Decimal(1024) ** ('KMGTPE'.index(suffix[0]) + 1) if suffix.endswith('i') else Decimal(1000) ** ('kMGTPE'.index(suffix.replace('K', 'k')) + 1)
    try:
        result = Decimal(match[1]) * powers[suffix]
    except ArithmeticError as exc:
        raise RuntimePolicyError('invalid resource quantity') from exc
    if not result.is_finite():
        raise RuntimePolicyError('resource quantity must be finite')
    return result


def validate_vm_profile(obj, fetch, namespace, allowed_images, cpu_models, registry_namespace='coder-runtime-system', verify_home=True, allow_pending_home=False):
    """Enforce host identity and GPU policy without changing the sealed guest module."""
    from vmprofile import ProfileError, identifier, validate_vm
    from vmgpu import reject_vm_passthrough
    template = (obj.get('spec') or {}).get('template') if obj.get('kind') == 'VirtualMachine' else obj
    domain = ((template or {}).get('spec') or {}).get('domain')
    try:
        reject_vm_passthrough(domain)
    except ValueError as error:
        raise ProfileError(str(error)) from None
    profile = validate_vm(obj, fetch, namespace, allowed_images, cpu_models, registry_namespace, verify_home=verify_home, allow_pending_home=allow_pending_home)
    if verify_home and not allow_pending_home:
        registry = fetch('/api/v1/namespaces/' + registry_namespace + '/configmaps/coder-vm-home-provenance')
        record = json.loads((registry.get('data') or {}).get('homes.json', '{}')).get(profile['workspace_id']) or {}
        node_uid = identifier(record.get('node_uid'))
        node_name = record.get('node_name')
        if not isinstance(node_name, str) or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?', node_name):
            raise ProfileError('HOME worker identity is unavailable')
        node = fetch('/api/v1/nodes/' + node_name)
        if not node or node.get('metadata', {}).get('uid') != node_uid:
            raise ProfileError('HOME worker was replaced; the previous worker requires fencing')
    return profile


def validate_pod(pod):
    """Reject runtime substitution and limits or capabilities that defeat isolation."""
    spec = pod.get('spec') or {}
    from vmgpu import reject_native_resources
    try:
        reject_native_resources(spec)
    except ValueError as error:
        raise RuntimePolicyError(str(error)) from None
    if spec.get('runtimeClassName') != 'sysbox-runc' or spec.get('hostUsers') is not False:
        raise RuntimePolicyError('workspace requires sysbox-runc and hostUsers=false')
    if spec.get('resources'):
        raise RuntimePolicyError('pod-level resources disable Kubernetes 1.35 static CPU pinning')
    if (spec.get('nodeSelector') or {}).get('platform.coder/runtime-ready') != 'true':
        raise RuntimePolicyError('workspace requires a verified static CPU-manager worker')
    if ((spec.get('securityContext') or {}).get('seccompProfile') or {}).get('type') == 'Unconfined':
        raise RuntimePolicyError('workspace cannot disable seccomp confinement')
    if any(spec.get(key) for key in ('hostPID', 'hostIPC', 'hostNetwork')):
        raise RuntimePolicyError('workspace cannot join host namespaces')
    names = [v.get('name') for v in spec.get('volumes') or []]
    if len(set(names)) != len(names):
        raise RuntimePolicyError('workspace cannot duplicate volume names')
    for volume in spec.get('volumes') or []:
        if volume.get('hostPath') and volume.get('name') not in ['coder-lxcfs-' + str(i) for i in range(len(PROC_PATHS))]:
            raise RuntimePolicyError('workspace hostPath aliases are forbidden')
    volumes = {v.get('name'): v for v in spec.get('volumes') or []}
    for index, path in enumerate(PROC_PATHS):
        volume = volumes.get('coder-lxcfs-' + str(index)) or {}
        if volume.get('hostPath') != {'path': '/var/lib/lxcfs' + path, 'type': 'Directory' if index == 5 else 'File'}:
            raise RuntimePolicyError('workspace requires the trusted LXCFS resource volumes')
    for container in (spec.get('containers') or []) + (spec.get('initContainers') or []) + (spec.get('ephemeralContainers') or []):
        security = container.get('securityContext') or {}
        if security.get('procMount') not in (None, 'Default'):
            raise RuntimePolicyError('workspace cannot unmask proc mounts')
        if (security.get('seccompProfile') or {}).get('type') == 'Unconfined':
            raise RuntimePolicyError('workspace cannot disable seccomp confinement')
        for index, path in enumerate(PROC_PATHS):
            mount = next((m for m in container.get('volumeMounts') or [] if m.get('mountPath') == path), {})
            if mount != {'name': 'coder-lxcfs-' + str(index), 'mountPath': path, 'readOnly': True}:
                raise RuntimePolicyError('workspace requires readonly LXCFS resource views')
        mounts = container.get('volumeMounts') or []
        targets = [mount.get('mountPath') for mount in mounts]
        if len(set(targets)) != len(targets):
            raise RuntimePolicyError('workspace cannot duplicate mount targets')
        for mount in mounts:
            if mount.get('name') in volumes and volumes[mount['name']].get('hostPath'):
                expected = next((path for index, path in enumerate(PROC_PATHS) if mount['name'] == 'coder-lxcfs-' + str(index)), None)
                if mount.get('mountPath') != expected or mount.get('readOnly') is not True or mount.get('subPath') or mount.get('subPathExpr'):
                    raise RuntimePolicyError('workspace hostPath mounts must use exact readonly resource views')
        if container.get('volumeDevices'):
            raise RuntimePolicyError('workspace cannot mount raw devices')
        for mount in container.get('volumeMounts') or []:
            if mount.get('mountPropagation') not in (None, 'None'):
                raise RuntimePolicyError('workspace cannot propagate mounts outside its namespace')
    for container in (spec.get('containers') or []) + (spec.get('initContainers') or []):
        security = container.get('securityContext') or {}
        if security.get('privileged'):
            raise RuntimePolicyError('workspace cannot request privileged mode')
        additions = (security.get('capabilities') or {}).get('add') or []
        if any(str(cap).upper().removeprefix('CAP_') in ('SYS_ADMIN', 'ALL') for cap in additions):
            raise RuntimePolicyError('workspace cannot request SYS_ADMIN or ALL capabilities')
        values = [entry for entry in container.get('env') or [] if entry.get('name') == 'SYSBOX_HONOR_CAPS']
        if len(values) != 1 or values[0].get('value') != 'TRUE' or 'valueFrom' in values[0]:
            raise RuntimePolicyError('workspace requires SYSBOX_HONOR_CAPS=TRUE')
        resources = container.get('resources') or {}
        for resource in ('cpu', 'memory'):
            limit = quantity((resources.get('limits') or {}).get(resource, '0'))
            request = quantity((resources.get('requests') or {}).get(resource, '0'))
            if limit <= 0 or request != limit:
                raise RuntimePolicyError('workspace requires Guaranteed QoS: positive cpu/memory requests equal limits')
            if resource == 'cpu' and limit != limit.to_integral_value():
                raise RuntimePolicyError('workspace containers require whole CPU cores for static CPU pinning')
    if not spec.get('containers'):
        raise RuntimePolicyError('workspace requires a container')
    for container in spec.get('ephemeralContainers') or []:
        security = container.get('securityContext') or {}
        additions = (security.get('capabilities') or {}).get('add') or []
        if security.get('privileged') or any(str(cap).upper().removeprefix('CAP_') in ('SYS_ADMIN', 'ALL') for cap in additions):
            raise RuntimePolicyError('ephemeral container cannot bypass workspace capabilities')
        values = [entry for entry in container.get('env') or [] if entry.get('name') == 'SYSBOX_HONOR_CAPS']
        if len(values) != 1 or values[0].get('value') != 'TRUE' or 'valueFrom' in values[0]:
            raise RuntimePolicyError('ephemeral container requires SYSBOX_HONOR_CAPS=TRUE')


def pod_budget(spec, kind='limits'):
    """Compute Kubernetes effective limits including restartable init sidecars."""
    result = {}
    for resource in ('cpu', 'memory'):
        regular = sum((quantity(((c.get('resources') or {}).get(kind) or {}).get(resource, '0'))
                       for c in spec.get('containers') or []), Decimal(0))
        sidecars = Decimal(0)
        peak = Decimal(0)
        for container in spec.get('initContainers') or []:
            limit = quantity(((container.get('resources') or {}).get(kind) or {}).get(resource, '0'))
            if limit < 0 or (kind == 'limits' and limit == 0):
                raise RuntimePolicyError('init container requires explicit positive limits')
            if container.get('restartPolicy') == 'Always':
                sidecars += limit
                peak = max(peak, sidecars)
            else:
                peak = max(peak, sidecars + limit)
        result[resource] = max(regular + sidecars, peak)
    return result


PROC_PATHS = ('/proc/cpuinfo', '/proc/meminfo', '/proc/stat', '/proc/swaps', '/proc/uptime',
              '/sys/devices/system/cpu')


def prepare_pod(pod):
    """Add mandatory runtime and trusted LXCFS views, preserving authored limits."""
    import copy
    result = copy.deepcopy(pod)
    spec = result.setdefault('spec', {})
    if spec.get('runtimeClassName') not in (None, 'sysbox-runc'):
        raise RuntimePolicyError('workspace runtime substitution is forbidden')
    if spec.get('hostUsers') not in (None, False):
        raise RuntimePolicyError('workspace host user namespace is forbidden')
    if spec.get('resources'):
        raise RuntimePolicyError('pod-level resources disable Kubernetes 1.35 static CPU pinning')
    selector = spec.setdefault('nodeSelector', {})
    if selector.get('platform.coder/runtime-ready') not in (None, 'true'):
        raise RuntimePolicyError('workspace cannot substitute worker readiness selector')
    selector['platform.coder/runtime-ready'] = 'true'
    spec['runtimeClassName'] = 'sysbox-runc'
    spec['hostUsers'] = False
    volumes = spec.setdefault('volumes', [])
    for index, path in enumerate(PROC_PATHS):
        volume = {'name': 'coder-lxcfs-' + str(index), 'hostPath': {
            'path': '/var/lib/lxcfs' + path, 'type': 'Directory' if index == 5 else 'File'}}
        existing = next((v for v in volumes if v.get('name') == volume['name']), None)
        if existing is not None and existing != volume:
            raise RuntimePolicyError('workspace cannot substitute LXCFS volumes')
        if existing is None:
            volumes.append(volume)
    for container in (spec.get('containers') or []) + (spec.get('initContainers') or []) + (spec.get('ephemeralContainers') or []):
        env = container.setdefault('env', [])
        existing = [entry for entry in env if entry.get('name') == 'SYSBOX_HONOR_CAPS']
        if existing and existing != [{'name': 'SYSBOX_HONOR_CAPS', 'value': 'TRUE'}]:
            raise RuntimePolicyError('workspace cannot disable honored capabilities')
        if not existing:
            env.append({'name': 'SYSBOX_HONOR_CAPS', 'value': 'TRUE'})
        mounts = container.setdefault('volumeMounts', [])
        for index, path in enumerate(PROC_PATHS):
            mount = {'name': 'coder-lxcfs-' + str(index), 'mountPath': path, 'readOnly': True}
            existing = next((m for m in mounts if m.get('mountPath') == path), None)
            if existing is not None and existing != mount:
                raise RuntimePolicyError('workspace cannot substitute virtual resource views')
            if existing is None:
                mounts.append(mount)
    for container in (spec.get('containers') or []) + (spec.get('initContainers') or []):
        resources = container.setdefault('resources', {})
        resources['requests'] = dict(resources.get('limits') or {})
    result.setdefault('metadata', {}).setdefault('annotations', {})['platform.coder/resource-budget'] = json.dumps(
        {key: str(value) for key, value in pod_budget(spec).items()}, sort_keys=True, separators=(',', ':'))
    validate_pod(result)
    return result


CONTROLLER_USERS = frozenset(('system:kube-controller-manager',
    'system:serviceaccount:kube-system:replicaset-controller',
    'system:serviceaccount:kube-system:deployment-controller',
    'system:serviceaccount:kube-system:daemon-set-controller',
    'system:serviceaccount:kube-system:statefulset-controller',
    'system:serviceaccount:kube-system:job-controller',
    'system:serviceaccount:kube-system:cronjob-controller'))
CONTROLLER_PLURALS = {'ReplicaSet': 'replicasets', 'Deployment': 'deployments',
                       'DaemonSet': 'daemonsets', 'StatefulSet': 'statefulsets'}


def platform_owned(request, fetch, trusted, namespace, trusted_admin_groups=('system:masters', 'kubeadm:cluster-admins')):
    """Verify platform controller ownership using API objects and controller identity.

    trusted maps (kind, name) to explicitly configured controller roots. Kubernetes
    administrators remain trusted; a provisioner cannot obtain an exemption by
    copying a controller UID or a platform label.
    """
    obj = request.get('object') or {}
    kind = (request.get('kind') or {}).get('kind')
    actor = (request.get('userInfo') or {}).get('username', '')
    if (kind, (obj.get('metadata') or {}).get('name')) in trusted:
        if actor not in CONTROLLER_USERS and not set(trusted_admin_groups).intersection((request.get('userInfo') or {}).get('groups') or []):
            raise RuntimePolicyError('workspace provisioner cannot mutate platform controllers')
        return True
    if actor == 'system:serviceaccount:cnpg-system:cnpg-cloudnative-pg' and kind == 'Pod':
        owners = [owner for owner in (obj.get('metadata') or {}).get('ownerReferences') or [] if owner.get('controller')]
        if len(owners) == 1 and ('Cluster', owners[0].get('name')) in trusted:
            owner = owners[0]
            if owner.get('kind') != 'Cluster' or owner.get('apiVersion') != 'postgresql.cnpg.io/v1':
                return False
            cluster = fetch('/apis/postgresql.cnpg.io/v1/namespaces/' + namespace + '/clusters/' + owner['name'])
            return bool(cluster and (cluster.get('metadata') or {}).get('uid') == owner.get('uid'))
    if actor not in CONTROLLER_USERS:
        return False
    current = obj
    current_kind = kind
    for _ in range(3):
        owners = [owner for owner in (current.get('metadata') or {}).get('ownerReferences') or []
                  if owner.get('controller')]
        if len(owners) != 1:
            return False
        owner = owners[0]
        owner_kind = owner.get('kind')
        if (current_kind, owner_kind) not in {('Pod', 'ReplicaSet'), ('Pod', 'DaemonSet'),
                                              ('Pod', 'StatefulSet'), ('ReplicaSet', 'Deployment')}:
            return False
        parent = fetch('/apis/apps/v1/namespaces/' + namespace + '/' +
                       CONTROLLER_PLURALS[owner_kind] + '/' + owner.get('name', ''))
        if not parent or (parent.get('metadata') or {}).get('uid') != owner.get('uid'):
            return False
        if current_kind == 'ReplicaSet' and owner_kind == 'Deployment':
            import copy
            actual = copy.deepcopy((current.get('spec') or {}).get('template') or {})
            expected = copy.deepcopy((parent.get('spec') or {}).get('template') or {})
            for template in (actual, expected):
                ((template.get('metadata') or {}).get('labels') or {}).pop('pod-template-hash', None)
            if actual != expected:
                return False
        if (owner_kind, owner.get('name')) in trusted:
            return True
        current, current_kind = parent, owner_kind
    return False


def existing_root_image(obj):
    """Return only the immutable root image of an already stored VM or VMI."""
    spec = (obj.get('spec') or {}).get('template', obj).get('spec') or {}
    root = next((volume for volume in spec.get('volumes', []) if volume.get('name') == 'root'), {})
    image = root.get('containerDisk', {}).get('image')
    if not isinstance(image, str) or not re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', image):
        raise RuntimePolicyError('existing workspace root image identity is unavailable')
    return image


def restrictive_vm_halt(request):
    """Recognize a halt of the same stored object without reauthorizing its profile."""
    import copy
    if request.get('operation') != 'UPDATE':
        return False
    old, obj = request.get('oldObject') or {}, request.get('object') or {}
    before_meta, metadata = old.get('metadata') or {}, obj.get('metadata') or {}
    if not metadata.get('uid') or any(before_meta.get(key) != metadata.get(key) for key in ('uid','name','namespace')):
        return False
    for key in ('com.coder.workspace.id','com.coder.organization.id','com.coder.user.id'):
        if before_meta.get('labels',{}).get(key) != metadata.get('labels',{}).get(key):
            return False
    before, after = copy.deepcopy(old.get('spec') or {}), copy.deepcopy(obj.get('spec') or {})
    if after.pop('runStrategy', None) != 'Halted' or before.pop('runStrategy', None) not in ('Always','Halted'):
        return False
    return before == after


def validate_instance_request(request, fetch, namespace, images, models, controllers, registry_namespace):
    """Only KubeVirt creates VMIs; existing owned instances permit bounded cleanup."""
    import copy
    obj = request.get('object') or {}
    operation = request.get('operation')
    actor = (request.get('userInfo') or {}).get('username')
    allowed = set(controllers)
    if operation == 'UPDATE':
        allowed.add('system:serviceaccount:' + namespace + ':coder-ui-updates')
    if actor not in allowed:
        raise RuntimePolicyError('only verified VM controllers can create or update workspace instances')
    metadata = obj.get('metadata') or {}
    owners = [owner for owner in metadata.get('ownerReferences', []) if owner.get('controller')]
    if len(owners) != 1 or owners[0].get('kind') != 'VirtualMachine' or owners[0].get('apiVersion') != 'kubevirt.io/v1':
        raise RuntimePolicyError('workspace instance requires its VM controller identity')
    owner = owners[0]
    parent = fetch('/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachines/' + owner.get('name', ''))
    if not parent or parent.get('metadata', {}).get('uid') != owner.get('uid') or parent.get('metadata', {}).get('name') != metadata.get('name'):
        raise RuntimePolicyError('workspace instance owner is no longer the current canonical VM')
    if operation == 'CREATE':
        if parent.get('metadata', {}).get('annotations', {}).get('platform.coder/quarantine-revision'):
            raise RuntimePolicyError('quarantined workspace instances cannot be created')
        profile = validate_vm_profile(obj, fetch, namespace, images, models, registry_namespace)
        if parent.get('spec', {}).get('runStrategy') != 'Always' or parent.get('metadata', {}).get('annotations', {}).get('platform.coder/desired-run-strategy', 'Always') != 'Always' or validate_vm_profile(parent, fetch, namespace, images, models, registry_namespace) != profile:
            raise RuntimePolicyError('new workspace instance must match its current running sealed VM')
        return
    if operation != 'UPDATE':
        raise RuntimePolicyError('unsupported workspace instance operation')
    old = request.get('oldObject') or {}
    if not metadata.get('uid') or old.get('metadata', {}).get('uid') != metadata['uid'] or old.get('metadata', {}).get('name') != metadata.get('name') or old.get('metadata', {}).get('ownerReferences') != metadata.get('ownerReferences'):
        raise RuntimePolicyError('workspace instance update cannot replace its owned identity')
    before, after = copy.deepcopy(old.get('spec') or {}), copy.deepcopy(obj.get('spec') or {})
    if after.get('terminationGracePeriodSeconds') == 0:
        before.pop('terminationGracePeriodSeconds', None)
        after.pop('terminationGracePeriodSeconds', None)
    if before != after:
        raise RuntimePolicyError('existing workspace instance hardware and boot profile cannot change')
    # Stopping a VM changes its desired build profile and may hold HOME exclusively.
    # An unchanged existing VMI needs no new HOME authorization to be terminated.
    cleanup_images = tuple(images)
    if obj.get('spec', {}).get('terminationGracePeriodSeconds') == 0 and parent.get('spec', {}).get('runStrategy') == 'Halted':
        cleanup_images += (existing_root_image(old),)
    profile = validate_vm_profile(obj, fetch, namespace, cleanup_images, models, registry_namespace, verify_home=False)
    previous = validate_vm_profile(old, fetch, namespace, cleanup_images, models, registry_namespace, verify_home=False)
    if profile != previous:
        raise RuntimePolicyError('existing workspace instance sealed bounds changed')
    for label, field in (('com.coder.workspace.id','workspace_id'),('com.coder.organization.id','organization_id'),('com.coder.user.id','workspace_owner_id')):
        if parent.get('metadata', {}).get('labels', {}).get(label) != profile[field]:
            raise RuntimePolicyError('workspace instance parent ownership differs')


def admission_review(body, fetch, trusted, namespace, mutate=False, trusted_admin_groups=('system:masters', 'kubeadm:cluster-admins'), mode='vm-sysbox', allowed_images=(), cpu_models=('Haswell-noTSX',), vm_controller_users=('system:serviceaccount:kubevirt:kubevirt-controller',), home_registry_namespace='coder-runtime-system'):
    """Enforce protected-namespace runtime admission without workspace opt-in labels."""
    import base64
    request = body.get('request') or {}
    response = {'uid': request.get('uid', ''), 'allowed': True}
    try:
        obj = request.get('object') or {}
        marker = 'platform.coder/applied-profile'
        if (request.get('kind') or {}).get('kind') == 'VirtualMachine':
            before = (((request.get('oldObject') or {}).get('metadata') or {}).get('annotations') or {}).get(marker)
            after = ((obj.get('metadata') or {}).get('annotations') or {}).get(marker)
            if before != after and (request.get('userInfo') or {}).get('username') != 'system:serviceaccount:' + namespace + ':coder-ui-updates':
                raise RuntimePolicyError('only the verified VM reconciler can acknowledge an applied profile')
            restriction = 'platform.coder/quarantine-revision'
            previous_restriction = (((request.get('oldObject') or {}).get('metadata') or {}).get('annotations') or {}).get(restriction)
            current_restriction = ((obj.get('metadata') or {}).get('annotations') or {}).get(restriction)
            if previous_restriction != current_restriction and (request.get('userInfo') or {}).get('username') != 'system:serviceaccount:' + namespace + ':coder-ui-updates':
                raise RuntimePolicyError('only the verified VM reconciler can change quarantine restrictions')
            if current_restriction and obj.get('spec', {}).get('runStrategy') != 'Halted':
                raise RuntimePolicyError('quarantined workspace compute must remain halted')
        kind = (request.get('kind') or {}).get('kind')
        if mode == 'vm-sysbox':
            from vmprofile import boot_profile, home_request_profile
            if kind == 'Secret':
                secret_name = ((obj.get('metadata') or {}).get('name') or '')
                if secret_name.startswith('coder-vm-home-request-'):
                    home_request_profile(obj)
                elif secret_name.startswith('coder-vm-'):
                    boot_profile(obj)
            elif kind == 'VirtualMachine':
                strategy = (obj.get('spec') or {}).get('runStrategy')
                previous_strategy = ((request.get('oldObject') or {}).get('spec') or {}).get('runStrategy')
                manager = 'system:serviceaccount:' + namespace + ':coder-ui-updates'
                if strategy == 'Always' and (request.get('operation') == 'CREATE' or previous_strategy != 'Always') and (request.get('userInfo') or {}).get('username') != manager:
                    raise RuntimePolicyError('only the verified manager may start workspace compute after HOME readiness')
                desired = (obj.get('metadata') or {}).get('annotations', {}).get('platform.coder/desired-run-strategy')
                if desired is not None and desired not in ('Always','Halted'):
                    raise RuntimePolicyError('invalid authoritative workspace run intent')
                if strategy == 'Always' and (request.get('operation') == 'CREATE' or previous_strategy != 'Always') and desired != 'Always':
                    raise RuntimePolicyError('workspace compute start requires authoritative current-build intent')
                halt = restrictive_vm_halt(request)
                images = tuple(allowed_images) + ((existing_root_image(request['oldObject']),) if halt else ())
                validate_vm_profile(obj, fetch, namespace, images, cpu_models, home_registry_namespace, verify_home=not halt, allow_pending_home=strategy == 'Halted')
            elif kind == 'VirtualMachineInstance':
                validate_instance_request(request, fetch, namespace, allowed_images, cpu_models, vm_controller_users, home_registry_namespace)
            elif not platform_owned(request, fetch, trusted, namespace, trusted_admin_groups):
                if kind != 'Pod' or not vm_launcher(request, fetch, namespace, allowed_images, cpu_models, vm_controller_users, home_registry_namespace):
                    raise RuntimePolicyError('workspace user compute requires a sealed VM with guest Sysbox; native Pods are forbidden')
            return {'apiVersion': 'admission.k8s.io/v1', 'kind': 'AdmissionReview', 'response': response}
        if mode != 'native-sysbox':
            raise RuntimePolicyError('unsupported mandatory workspace runtime mode')
        if not platform_owned(request, fetch, trusted, namespace, trusted_admin_groups):
            if kind != 'Pod':
                owners = (obj.get('metadata') or {}).get('ownerReferences') or []
                if any((owner.get('kind'), owner.get('name')) in trusted for owner in owners):
                    raise RuntimePolicyError('untrusted actor cannot create platform controller descendants')
                # Controllers are checked at Pod creation, after the existing
                # workspace mutator has supplied bounded platform init helpers.
                return {'apiVersion': 'admission.k8s.io/v1', 'kind': 'AdmissionReview', 'response': response}
            if request.get('operation') == 'CREATE' and (obj.get('spec') or {}).get('nodeName'):
                raise RuntimePolicyError('workspace cannot bypass verified worker scheduling with nodeName')
            if mutate and (request.get('operation') == 'CREATE' or request.get('subResource') == 'ephemeralcontainers'):
                after = prepare_pod(obj)
                operations = [{'op': 'replace', 'path': '/spec', 'value': after['spec']},
                              {'op': 'add', 'path': '/metadata', 'value': after['metadata']}]
                response.update(patchType='JSONPatch', patch=base64.b64encode(json.dumps(operations).encode()).decode())
            else:
                validate_pod(obj)
    except ValueError as exc:
        response.update(allowed=False, status={'code': 403, 'message': str(exc)})
    return {'apiVersion': 'admission.k8s.io/v1', 'kind': 'AdmissionReview', 'response': response}


def vm_launcher(request, fetch, namespace, allowed_images, cpu_models, controller_users, home_registry_namespace='coder-runtime-system'):
    """Trust the controller owner chain, allowing unchanged existing Pod cleanup."""
    actor = (request.get('userInfo') or {}).get('username')
    if actor not in controller_users:
        return False
    pod = request.get('object') or {}
    metadata = pod.get('metadata') or {}
    cleanup = request.get('operation') == 'UPDATE'
    if cleanup:
        old = request.get('oldObject') or {}
        previous = old.get('metadata') or {}
        if not metadata.get('uid') or any(metadata.get(key) != previous.get(key) for key in ('uid','name','namespace','ownerReferences')) or pod.get('spec') != old.get('spec'):
            return False
    owners = [owner for owner in metadata.get('ownerReferences', []) if owner.get('controller')]
    if len(owners) != 1 or owners[0].get('kind') != 'VirtualMachineInstance' or owners[0].get('apiVersion') != 'kubevirt.io/v1':
        return False
    owner = owners[0]
    vmi = fetch('/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachineinstances/' + owner.get('name', ''))
    if not vmi or (vmi.get('metadata') or {}).get('uid') != owner.get('uid'):
        return False
    images = tuple(allowed_images) + ((existing_root_image(vmi),) if cleanup else ())
    profile = validate_vm_profile(vmi, fetch, namespace, images, cpu_models, home_registry_namespace, verify_home=not cleanup)
    vm_owners = [item for item in (vmi.get('metadata') or {}).get('ownerReferences', []) if item.get('controller')]
    if len(vm_owners) != 1 or vm_owners[0].get('kind') != 'VirtualMachine' or vm_owners[0].get('apiVersion') != 'kubevirt.io/v1':
        return False
    vm_owner = vm_owners[0]
    vm = fetch('/apis/kubevirt.io/v1/namespaces/' + namespace + '/virtualmachines/' + vm_owner.get('name', ''))
    if not vm or vm.get('metadata', {}).get('uid') != vm_owner.get('uid') or vm.get('metadata', {}).get('name') != vmi.get('metadata', {}).get('name'):
        return False
    if cleanup:
        if any(vm.get('metadata', {}).get('labels', {}).get(label) != profile[field] for label,field in (('com.coder.workspace.id','workspace_id'),('com.coder.organization.id','organization_id'),('com.coder.user.id','workspace_owner_id'))):
            return False
        return True
    desired = vm.get('metadata', {}).get('annotations', {}).get('platform.coder/desired-run-strategy', vm.get('spec', {}).get('runStrategy'))
    if vm.get('spec', {}).get('runStrategy') != 'Always' or desired != 'Always' or validate_vm_profile(vm, fetch, namespace, allowed_images, cpu_models, home_registry_namespace) != profile:
        raise RuntimePolicyError('new launcher must match its current authorized running VM profile')
    return True
