"""Default-disabled dedicated GPU profile preparation; no hardware is qualified."""
import json
import os
import re

ENV = 'WORKSPACE_VM_GPU_CONFIG'
UNQUALIFIED = 'Dedicated GPU passthrough is configured but unqualified; hardware and guest Sysbox qualification is required.'
NAME = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?')
RESOURCE = re.compile(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?')
GPU_RESOURCE = re.compile(r'gpu|vgpu|mig[-_.]', re.IGNORECASE)
FIELDS = {'name', 'mode', 'resourceName', 'pciSelector', 'count', 'guestImage', 'nodeSelector'}


def config(raw=None):
    if raw is None:
        raw = os.environ.get(ENV, '{"enabled":false,"profiles":[]}')
    if not isinstance(raw, str) or len(raw.encode()) > 65536:
        raise ValueError('GPU configuration exceeds its limit.')
    def object_fields(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('GPU configuration contains duplicate fields.')
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=object_fields)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError('GPU configuration must be valid JSON.') from error
    if not isinstance(value, dict) or set(value) != {'enabled', 'profiles'} or type(value['enabled']) is not bool or not isinstance(value['profiles'], list) or len(value['profiles']) > 16:
        raise ValueError('GPU configuration requires a boolean switch and at most sixteen profiles.')
    names, resources = set(), set()
    for profile in value['profiles']:
        if not isinstance(profile, dict) or set(profile) != FIELDS:
            raise ValueError('GPU profiles require only the dedicated passthrough fields.')
        name, resource = profile['name'], profile['resourceName']
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in names:
            raise ValueError('GPU profile names must be unique DNS labels.')
        if not isinstance(resource, str) or len(resource) > 253 or not RESOURCE.fullmatch(resource) or resource in resources or resource.startswith(('kubernetes.io/', 'k8s.io/')) or re.search(r'mig|vgpu|shared|timeslic', resource, re.IGNORECASE):
            raise ValueError('GPU profiles require unique whole-device extended resources.')
        if profile['mode'] != 'dedicated-pci' or type(profile['count']) is not int or not 1 <= profile['count'] <= 8:
            raise ValueError('GPU profiles support only one to eight dedicated PCI devices.')
        if not isinstance(profile['pciSelector'], str) or not re.fullmatch(r'[a-f0-9]{4}:[a-f0-9]{4}', profile['pciSelector']):
            raise ValueError('GPU profiles require an exact PCI vendor and device selector.')
        image = profile['guestImage']
        if not isinstance(image, str) or len(image) > 512 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}', image):
            raise ValueError('GPU profiles require an immutable guest image digest.')
        if profile['nodeSelector'] != {'platform.coder/vm-ready': 'true', 'platform.coder/gpu-profile': name}:
            raise ValueError('GPU profiles require their dedicated qualified VM worker selector.')
        names.add(name)
        resources.add(resource)
    return value


def status(configuration=None):
    configuration = config() if configuration is None else configuration
    return {'requestedEnabled': configuration['enabled'], 'enabled': False,
            'state': 'unqualified' if configuration['enabled'] else 'disabled',
            'reason': UNQUALIFIED if configuration['enabled'] else 'GPU passthrough is disabled.',
            'profiles': [{'name': p['name'], 'resourceName': p['resourceName'], 'requestedDevices': p['count'],
                          'state': 'unqualified', 'assignableDevices': None} for p in configuration['profiles']]}


def requested_units(domain, configuration):
    """Count requested whole devices without claiming an allocation or qualification."""
    entries = (domain.get('devices') or {}).get('gpus')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 8:
        raise ValueError('GPU requests require one to eight dedicated devices.')
    profiles = {profile['resourceName']: profile for profile in configuration['profiles']}
    names, units = set(), {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'name', 'deviceName'} or not isinstance(entry['name'], str) or not NAME.fullmatch(entry['name']) or entry['name'] in names:
            raise ValueError('GPU requests require distinct names and approved whole-device resources.')
        resource = entry['deviceName']
        if not isinstance(resource, str) or resource not in profiles:
            raise ValueError('GPU request does not match a configured dedicated profile.')
        names.add(entry['name'])
        units[resource] = units.get(resource, 0) + 1
    if any(count != profiles[resource]['count'] for resource, count in units.items()) or len(units) != 1:
        raise ValueError('GPU device count must match one dedicated profile.')
    return units


def reject_vm_passthrough(domain):
    if not isinstance(domain, dict) or not isinstance(domain.get('devices'), dict) or not isinstance(domain.get('resources'), dict):
        raise ValueError('VM device configuration must be structured.')
    devices = domain.get('devices') or {}
    resources = domain.get('resources') or {}
    gpu = 'gpus' in devices or any(GPU_RESOURCE.search(str(key)) for section in ('requests', 'limits') for key in (resources.get(section) or {}))
    if 'hostDevices' in devices:
        raise ValueError('Arbitrary host-device passthrough is forbidden.')
    if not gpu:
        return
    configuration = config()
    if not configuration['enabled']:
        raise ValueError('GPU passthrough is disabled.')
    requested_units(domain, configuration)
    raise ValueError(UNQUALIFIED)


def reject_native_resources(spec):
    containers = (spec.get('containers') or []) + (spec.get('initContainers') or []) + (spec.get('ephemeralContainers') or [])
    if any('/' in str(key) or GPU_RESOURCE.search(str(key)) for container in containers for section in ('requests', 'limits') for key in ((container.get('resources') or {}).get(section) or {})):
        raise ValueError('Extended hardware resources require a separately qualified dedicated VM and Sysbox profile; native passthrough is disabled.')
