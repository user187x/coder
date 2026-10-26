"""Strict, content-addressed boot profiles for workspace VM isolation."""
import base64
import hashlib
import json
import re
import uuid
from urllib.parse import urlsplit


class ProfileError(ValueError):
    """A VM or boot profile can bypass the required guest boundary."""


def identifier(value):
    try:
        parsed = uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ProfileError('invalid workspace identity') from exc
    if str(parsed) != value:
        raise ProfileError('workspace identity must be canonical')
    return value


def exact(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ProfileError('unsupported profile fields')


def decoded(value, maximum):
    if not isinstance(value, str) or len(value) > maximum * 2:
        raise ProfileError('invalid encoded profile value')
    try:
        result = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ProfileError('invalid encoded profile value') from exc
    if len(result) > maximum:
        raise ProfileError('encoded profile value exceeds limit')
    return result


def integer(value, minimum=1):
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise ProfileError('profile requires positive integer resources')
    return value


def validate_runtime(profile):
    """Validate data interpreted by the root-owned guest supervisor, never shell code."""
    exact(profile, ('version', 'build_id', 'cluster_namespace', 'workspace_id', 'workspace_owner_id', 'organization_id', 'cpu',
                    'memory_bytes', 'reserved_memory_bytes', 'home_bytes', 'home_device',
                    'workspace_image', 'trusted_ca_pem_base64', 'agent', 'tunnel'),
          ('home_initialize', 'cloud_drive'))
    if type(profile['version']) is not int or profile['version'] != 1:
        raise ProfileError('unsupported VM guest profile version')
    for key in ('build_id', 'workspace_id', 'workspace_owner_id', 'organization_id'):
        identifier(profile[key])
    if not isinstance(profile['cluster_namespace'], str) or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9]*[a-z0-9])?', profile['cluster_namespace']):
        raise ProfileError('invalid trusted cluster namespace')
    integer(profile['cpu'])
    memory = integer(profile['memory_bytes'])
    reserve = integer(profile['reserved_memory_bytes'])
    if memory % 1048576 or reserve < 536870912 or memory - reserve < 536870912:
        raise ProfileError('VM memory must include an explicit usable guest OS reserve')
    integer(profile['home_bytes'])
    if profile['home_device'] != '/dev/disk/by-id/virtio-coder-home' or profile.get('home_initialize', False) is not False:
        raise ProfileError('only a prepared retained HOME disk is permitted')
    image = profile['workspace_image']
    if not isinstance(image, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]*', image):
        raise ProfileError('invalid workspace container image')
    ca = decoded(profile['trusted_ca_pem_base64'], 131072)
    if ca and (b'-----BEGIN CERTIFICATE-----' not in ca or b'PRIVATE KEY' in ca):
        raise ProfileError('invalid trusted CA bundle')
    agent = profile['agent']
    exact(agent, ('token', 'url', 'init_script_base64'))
    identifier(agent['token'])
    url = urlsplit(agent['url'])
    if url.geturl() != agent['url'] or url.path not in ('', '/') or url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ProfileError('Coder agent URL must be an HTTPS origin')
    if not decoded(agent['init_script_base64'], 1048576):
        raise ProfileError('agent initialization is empty')
    exact(profile['tunnel'], ('enabled', 'port'))
    if not isinstance(profile['tunnel']['enabled'], bool) or profile['tunnel']['port'] != 51871:
        raise ProfileError('unsupported guest tunnel profile')
    if 'cloud_drive' in profile:
        exact(profile['cloud_drive'], ('enabled',))
        if not isinstance(profile['cloud_drive']['enabled'], bool):
            raise ProfileError('invalid Cloud Drive feature state')
    return profile


def boot_profile(secret):
    """Validate immutable JSON-only cloud-init with a content-addressed name."""
    metadata = secret.get('metadata') or {}
    if secret.get('immutable') is not True:
        raise ProfileError('VM boot secret must be immutable')
    data = secret.get('data') or {}
    if set(data) != {'userdata'}:
        raise ProfileError('VM boot secret may contain only userdata')
    userdata = decoded(data['userdata'], 2097152)
    prefix = b'#cloud-config\n'
    if not userdata.startswith(prefix):
        raise ProfileError('VM boot requires canonical cloud-config JSON')
    try:
        config = json.loads(userdata[len(prefix):])
        exact(config, ('write_files', 'runcmd'))
        files = config['write_files']
        if not isinstance(files, list) or len(files) != 1:
            raise ProfileError('VM boot may write only its runtime profile')
        entry = files[0]
        exact(entry, ('path', 'owner', 'permissions', 'encoding', 'content'))
        if {k: entry[k] for k in ('path', 'owner', 'permissions', 'encoding')} != {
                'path': '/etc/coder-workspace/runtime.json', 'owner': 'root:root',
                'permissions': '0600', 'encoding': 'b64'}:
            raise ProfileError('VM boot must preserve the root-owned supervisor boundary')
        if config['runcmd'] != [['systemctl', 'start', 'coder-workspace.service']]:
            raise ProfileError('VM boot cannot run arbitrary guest commands')
        profile = validate_runtime(json.loads(decoded(entry['content'], 1048576)))
    except (ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, ProfileError):
            raise
        raise ProfileError('invalid VM boot profile') from exc
    name = 'coder-vm-' + profile['workspace_id'] + '-boot-' + hashlib.sha256(userdata).hexdigest()[:32]
    if metadata.get('name') != name:
        raise ProfileError('VM boot secret name must seal its exact content')
    labels = metadata.get('labels') or {}
    for label, field in (('com.coder.workspace.id', 'workspace_id'),
                         ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'workspace_owner_id')):
        if labels.get(label) != profile[field]:
            raise ProfileError('VM boot profile identity differs from its owner')
    return profile


def home_request_profile(secret):
    """Validate the content-addressed request consumed only by the root provisioner."""
    metadata = secret.get('metadata') or {}
    if secret.get('immutable') is not True or set(secret.get('data') or {}) != {'request'}:
        raise ProfileError('HOME request must be immutable with one bounded request')
    raw = decoded(secret['data']['request'], 16384)
    request = json.loads(raw)
    exact(request, ('version', 'workspace_id', 'workspace_owner_id', 'organization_id', 'build_id', 'home_bytes', 'node_name'))
    if type(request['version']) is not int or request['version'] != 1:
        raise ProfileError('unsupported HOME request version')
    for field in ('workspace_id', 'workspace_owner_id', 'organization_id', 'build_id'):
        identifier(request[field])
    size = integer(request['home_bytes'])
    if size < 1000000000 or size > 99999 * 1000000000 or size % 512:
        raise ProfileError('HOME request requires a bounded sector-aligned capacity')
    if not isinstance(request['node_name'], str) or len(request['node_name']) > 253 or (request['node_name'] and not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?', request['node_name'])):
        raise ProfileError('invalid requested HOME worker')
    if metadata.get('name') != 'coder-vm-home-request-' + request['workspace_id'] + '-' + hashlib.sha256(raw).hexdigest()[:16]:
        raise ProfileError('HOME request name must seal its content')
    for label, field in (('com.coder.workspace.id', 'workspace_id'), ('com.coder.user.id', 'workspace_owner_id'), ('com.coder.organization.id', 'organization_id')):
        if (metadata.get('labels') or {}).get(label) != request[field]:
            raise ProfileError('HOME request ownership differs')
    return request


def validate_vm(obj, fetch, namespace, allowed_images, cpu_models, registry_namespace='coder-runtime-system', verify_home=True, allow_pending_home=False):
    """Validate the complete VMI guest boundary and its immutable boot provenance."""
    kind = obj.get('kind')
    if kind == 'VirtualMachine':
        exact(obj.get('spec'), ('runStrategy', 'template'))
        if obj['spec']['runStrategy'] not in ('Always', 'Halted'):
            raise ProfileError('unsupported VM lifecycle strategy')
    template = (obj.get('spec') or {}).get('template') if kind == 'VirtualMachine' else obj
    if not isinstance(template, dict):
        raise ProfileError('VM requires a template')
    annotations = (template.get('metadata') or {}).get('annotations') or {}
    safe_annotations = {'kubevirt.io/latest-observed-api-version', 'kubevirt.io/storage-observed-api-version', 'kubevirt.io/vm-generation', 'kubevirt.io/pci-topology-version'}
    if set(annotations) - safe_annotations:
        raise ProfileError('VM guest hooks and custom execution annotations are forbidden')
    spec = template.get('spec') or {}
    exact(spec, ('domain', 'volumes', 'networks', 'nodeSelector', 'terminationGracePeriodSeconds'),
          ('architecture', 'evictionStrategy', 'tolerations'))
    if spec.get('evictionStrategy') not in (None, 'None'):
        raise ProfileError('local HOME guests cannot enable live migration eviction')
    for toleration in spec.get('tolerations') or []:
        if toleration != {'key': 'platform.coder/workspace-vm-host', 'operator': 'Exists', 'effect': 'NoSchedule'} and toleration not in [{'key': 'platform.coder/workspace-vm-host', 'operator': 'Equal', 'effect': 'NoSchedule', 'value': value} for value in ('preparing', 'ready')]:
            raise ProfileError('VM tolerations are limited to the dedicated workspace host')
    if spec.get('architecture') not in (None, 'amd64'):
        raise ProfileError('only the qualified amd64 guest architecture is supported')
    if not (spec.get('nodeSelector') or {}).get('platform.coder/vm-ready') == 'true':
        raise ProfileError('VM requires a qualified virtualization worker')
    domain = spec['domain']
    exact(domain, ('cpu', 'memory', 'resources', 'devices'), ('machine', 'firmware', 'features'))
    if 'machine' in domain:
        exact(domain['machine'], ('type',))
        if not re.fullmatch(r'(?:pc-)?q35(?:-[0-9.]+)?', domain['machine']['type']):
            raise ProfileError('unsupported VM machine type')
    if 'firmware' in domain:
        exact(domain['firmware'], (), ('uuid', 'serial'))
        for value in domain['firmware'].values():
            identifier(value)
    if 'features' in domain and domain['features'] != {'acpi': {'enabled': True}}:
        raise ProfileError('unsupported VM feature overrides')
    cpu = domain['cpu']
    exact(cpu, ('sockets', 'cores', 'threads', 'maxSockets', 'model'), ('dedicatedCpuPlacement', 'isolateEmulatorThread'))
    cores = integer(cpu['cores'])
    if integer(cpu['sockets']) != 1 or integer(cpu['threads']) != 1 or integer(cpu['maxSockets']) != 1 or cpu['model'] not in cpu_models or cpu['model'] in ('host-model', 'host-passthrough'):
        raise ProfileError('VM requires bounded generic CPU topology')
    from workspace_runtime import quantity
    memory = domain['memory']
    exact(memory, ('guest', 'maxGuest'))
    memory_bytes = quantity(memory['guest'])
    if memory_bytes <= 0 or quantity(memory['maxGuest']) != memory_bytes:
        raise ProfileError('VM current and maximum RAM must equal allocation')
    resources = domain['resources']
    exact(resources, ('requests', 'limits'))
    if quantity(resources['requests'].get('cpu', '0')) != cores or quantity(resources['limits'].get('cpu', '0')) != cores or quantity(resources['requests'].get('memory', '0')) != memory_bytes:
        raise ProfileError('VM resource reservation differs from guest allocation')
    if 'memory' in resources['limits'] and quantity(resources['limits']['memory']) != memory_bytes:
        raise ProfileError('VM memory limit differs from assigned guest memory')
    if set(resources['requests']) != {'cpu', 'memory'} or set(resources['limits']) - {'cpu', 'memory'}:
        raise ProfileError('unsupported VM resource reservation')
    devices = domain['devices']
    exact(devices, ('disks', 'interfaces'), ('autoattachGraphicsDevice', 'autoattachSerialConsole'))
    disks = devices['disks']
    expected_disks = [{'name': 'root', 'disk': {'bus': 'virtio'}},
                      {'name': 'home', 'serial': 'coder-home', 'disk': {'bus': 'virtio'}},
                      {'name': 'cloudinit', 'disk': {'bus': 'virtio'}}]
    if disks != expected_disks or devices['interfaces'] != [{'name': 'default', 'masquerade': {}}] or spec['networks'] != [{'name': 'default', 'pod': {}}]:
        raise ProfileError('VM device passthrough or unbounded disks are forbidden')
    volumes = spec['volumes']
    if not isinstance(volumes, list) or len(volumes) != 3 or [v.get('name') for v in volumes] != ['root', 'home', 'cloudinit']:
        raise ProfileError('VM requires exactly its approved root, HOME and boot volumes')
    root, home, boot = volumes
    exact(root, ('name', 'containerDisk'))
    exact(root['containerDisk'], ('image',), ('imagePullPolicy',))
    if root['containerDisk']['image'] not in allowed_images or not re.search(r'@sha256:[a-f0-9]{64}$', root['containerDisk']['image']):
        raise ProfileError('VM root image is not an approved immutable Sysbox guest')
    exact(home, ('name', 'persistentVolumeClaim'))
    exact(home['persistentVolumeClaim'], ('claimName',))
    claim_name = home['persistentVolumeClaim']['claimName']
    if not isinstance(claim_name, str) or len(claim_name) > 253 or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?', claim_name):
        raise ProfileError('invalid retained HOME claim name')
    exact(boot, ('name', 'cloudInitNoCloud'))
    exact(boot['cloudInitNoCloud'], ('secretRef',))
    exact(boot['cloudInitNoCloud']['secretRef'], ('name',))
    secret_name = boot['cloudInitNoCloud']['secretRef']['name']
    if not re.fullmatch(r'coder-vm-[a-f0-9-]{36}-boot-[a-f0-9]{32}', secret_name):
        raise ProfileError('VM boot must reference a sealed immutable profile')
    secret = fetch('/api/v1/namespaces/' + namespace + '/secrets/' + secret_name)
    profile = boot_profile(secret)
    if (obj.get('metadata') or {}).get('name') != 'coder-vm-' + profile['workspace_id']:
        raise ProfileError('VM and VMI names must match their sealed workspace identity')
    if verify_home:
        claim = fetch('/api/v1/namespaces/' + namespace + '/persistentvolumeclaims/' + home['persistentVolumeClaim']['claimName'])
        claim_meta = (claim or {}).get('metadata') or {}
        if ((claim or {}).get('spec') or {}).get('volumeMode') != 'Block':
            raise ProfileError('VM HOME requires exact-sized Block mode; filesystem disk expansion is forbidden')
        claim_annotations = claim_meta.get('annotations') or {}
        if claim_meta.get('deletionTimestamp') or not claim_meta.get('uid'):
            raise ProfileError('VM HOME claim identity is unavailable')
        for label, field in (('com.coder.workspace.id', 'workspace_id'), ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'workspace_owner_id')):
            if (claim_meta.get('labels') or {}).get(label) != profile[field]:
                raise ProfileError('VM HOME claim belongs to another workspace or organization')
        if quantity((((claim.get('spec') or {}).get('resources') or {}).get('requests') or {}).get('storage', '0')) != profile['home_bytes']:
            raise ProfileError('VM HOME declared capacity differs from its sealed allocation')
        retained = claim_annotations.get('platform.coder/retained-vm-home') == 'true'
        if retained:
            if claim_annotations.get('platform.coder/home-disk-bytes') != str(profile['home_bytes']):
                raise ProfileError('VM HOME verified capacity differs from its sealed allocation')
        elif not allow_pending_home:
            raise ProfileError('VM HOME requires an independently retained prepared disk')
        else:
            if claim_name != 'coder-vm-' + profile['workspace_id'] + '-home' or claim.get('spec', {}).get('storageClassName') != 'coder-vm-home':
                raise ProfileError('Pending HOME must use its canonical managed Block claim')
            reference = claim_annotations.get('platform.coder/home-request', '')
            if not re.fullmatch('coder-vm-home-request-' + profile['workspace_id'] + '-[0-9a-f]{16}', reference):
                raise ProfileError('Pending HOME requires its sealed provisioning request')
            requested = home_request_profile(fetch('/api/v1/namespaces/' + namespace + '/secrets/' + reference))
            if any(requested[field] != profile[field] for field in ('workspace_id','organization_id','workspace_owner_id','build_id','home_bytes')):
                raise ProfileError('Pending HOME request differs from the sealed VM profile')
        if not allow_pending_home:
            registry = fetch('/api/v1/namespaces/' + registry_namespace + '/configmaps/coder-vm-home-provenance')
            try:
                record = json.loads((registry.get('data') or {}).get('homes.json', '{}')).get(profile['workspace_id']) or {}
            except (ValueError, TypeError, AttributeError) as exc:
                raise ProfileError('prepared HOME provenance is unavailable') from exc
            expected = {'workspace_id': profile['workspace_id'], 'workspace_owner_id': profile['workspace_owner_id'],
                        'organization_id': profile['organization_id'], 'claim_name': claim_name,
                        'claim_uid': claim_meta.get('uid'), 'pv_name': ((claim or {}).get('spec') or {}).get('volumeName'),
                        'home_bytes': profile['home_bytes']}
            if record.get('status') != 'ready' or not expected['claim_uid'] or not expected['pv_name'] or any(record.get(key) != value for key, value in expected.items()):
                raise ProfileError('HOME is not registered by the private prepared-disk verifier')
            if (spec.get('nodeSelector') or {}).get('kubernetes.io/hostname') != record.get('node_name') or not record.get('node_name'):
                raise ProfileError('VM HOME is registered on another qualified worker')
            if not re.fullmatch(r'[a-f0-9]{64}', str(record.get('initial_sha256', ''))):
                raise ProfileError('HOME copy verification evidence is missing')
            pv = fetch('/api/v1/persistentvolumes/' + expected['pv_name'])
            if (pv.get('metadata') or {}).get('uid') != record.get('pv_uid') or (pv.get('spec') or {}).get('volumeMode') != 'Block':
                raise ProfileError('HOME physical volume differs from its verified provenance')
            if quantity(((pv.get('spec') or {}).get('capacity') or {}).get('storage', '0')) != profile['home_bytes'] or quantity((((claim.get('spec') or {}).get('resources') or {}).get('requests') or {}).get('storage', '0')) != profile['home_bytes']:
                raise ProfileError('HOME declared capacity differs from its verified exact block allocation')
            reference = (pv.get('spec') or {}).get('claimRef') or {}
            if reference.get('uid') != expected['claim_uid'] or reference.get('namespace') != namespace or reference.get('name') != claim_name:
                raise ProfileError('HOME physical volume belongs to another claim')
    if profile['cluster_namespace'] != namespace:
        raise ProfileError('guest registry namespace differs from the protected workspace namespace')
    if profile['cpu'] != cores or profile['memory_bytes'] != memory_bytes:
        raise ProfileError('VM hardware differs from its sealed profile')
    labels = (template.get('metadata') or {}).get('labels') or {}
    for label, field in (('com.coder.workspace.id', 'workspace_id'), ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'workspace_owner_id')):
        if labels.get(label) != profile[field]:
            raise ProfileError('VM identity differs from its sealed profile')
    return profile
