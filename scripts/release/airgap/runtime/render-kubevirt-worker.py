#!/usr/bin/env python3
"""Render the verified KubeVirt release for dedicated capable workers, without applying it."""
import argparse
import hashlib
import json
import pathlib
import re
import urllib.request

import yaml

VERSION = 'v1.8.4'
ASSETS = {'kubevirt-operator.yaml': 'd1d8264eec5b802c122bec6c54d8c3b11e119ee2a5c75602aaa8b53ea3857eda',
          'kubevirt-cr.yaml': '43106136dbce3312bdbfdeae612aacafc6c12da518d233f90645b4685d84a2af'}


def worker_placement(node=None, labels=()):
    if bool(node) == bool(labels):
        raise ValueError('select one worker hostname or one or more worker-pool labels')
    selector = {}
    if node:
        if len(node) > 253 or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?', node):
            raise ValueError('invalid worker hostname')
        selector['kubernetes.io/hostname'] = node
    for item in labels:
        key, separator, value = item.partition('=')
        parts = key.split('/')
        name = parts[-1]
        if (not separator or len(parts) > 2 or len(name) > 63
                or not re.fullmatch(r'[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?', name)
                or len(value) > 63 or (value and not re.fullmatch(r'[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?', value))):
            raise ValueError('invalid worker-pool label')
        if len(parts) == 2 and (len(parts[0]) > 253 or any(
                len(part) > 63 or not re.fullmatch(r'[a-z0-9](?:[-a-z0-9]*[a-z0-9])?', part)
                for part in parts[0].split('.'))):
            raise ValueError('invalid worker-pool label prefix')
        if key in selector:
            raise ValueError('duplicate worker-pool label')
        selector[key] = value
    if selector.get('kubernetes.io/arch', 'amd64') != 'amd64':
        raise ValueError('the qualified runtime image bundle requires amd64 workers')
    selector.setdefault('kubernetes.io/arch', 'amd64')
    return {'nodeSelector': selector, 'tolerations': [
        {'key': 'platform.coder/workspace-vm-host', 'operator': 'Exists', 'effect': 'NoSchedule'}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--node', help='Existing dedicated worker hostname')
    group.add_argument('--node-label', action='append', default=[], help='Dedicated capable worker-pool selector KEY=VALUE; repeat for multiple labels')
    parser.add_argument('--output', required=True)
    parser.add_argument('--assets', help='Previously downloaded and verified release assets for offline rendering')
    parser.add_argument('--mirror-registry', help='Previously populated private registry/repository prefix, with matching digests')
    args = parser.parse_args()
    lock = json.loads(pathlib.Path(__file__).with_name('kubevirt-v1.8.4-images.json').read_text())
    if args.mirror_registry and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]*', args.mirror_registry):
        parser.error('invalid mirror registry prefix')
    images = {component: ((args.mirror_registry.rstrip('/') + '/' + component + '@' + record['digest']) if args.mirror_registry else record['source']) for component, record in lock['images'].items()}
    try:
        placement = worker_placement(args.node, args.node_label)
    except ValueError as exc:
        parser.error(str(exc))
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    for name, expected in ASSETS.items():
        if args.assets:
            data = pathlib.Path(args.assets, name).read_bytes()
        else:
            with urllib.request.urlopen('https://github.com/kubevirt/kubevirt/releases/download/' + VERSION + '/' + name, timeout=30) as response:
                data = response.read(2097152)
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError('KubeVirt release artifact checksum differs')
        (output / name).write_bytes(data)
        documents = list(yaml.safe_load_all(data))
        if name == 'kubevirt-operator.yaml':
            deployment = next(doc for doc in documents if doc and doc.get('kind') == 'Deployment' and doc.get('metadata', {}).get('name') == 'virt-operator')
            spec = deployment['spec']['template']['spec']
            spec.pop('affinity', None)
            spec.update(placement)
            container = next(c for c in spec['containers'] if c['name'] == 'virt-operator')
            container['image'] = images['virt-operator']
            env = container.setdefault('env', [])
            env = [e for e in env if e['name'] not in ('KUBEVIRT_VERSION', 'VIRT_OPERATOR_IMAGE', 'VIRT_API_IMAGE', 'VIRT_CONTROLLER_IMAGE', 'VIRT_HANDLER_IMAGE', 'VIRT_LAUNCHER_IMAGE')]
            env.append({'name': 'KUBEVIRT_VERSION', 'value': VERSION})
            for component, image in images.items():
                env.append({'name': component.upper().replace('-', '_') + '_IMAGE', 'value': image})
            container['env'] = env
        else:
            spec = documents[0]['spec']
            spec.pop('imageTag', None)
            spec.pop('imageRegistry', None)
            spec['infra'] = {'replicas': 1, 'nodePlacement': placement}
            spec['workloads'] = {'nodePlacement': placement}
        (output / name.replace('.yaml', '-worker.yaml')).write_text(yaml.safe_dump_all(documents, sort_keys=False))
    (output / 'images.txt').write_text('\n'.join(images.values()) + '\n')
    (output / 'release-lock.json').write_text(json.dumps({'version': VERSION, 'assets_sha256': ASSETS,
        'architecture': 'amd64', 'images': images}, indent=2) + '\n')
    print('Rendered only. Verify KVM, image digests, dedicated placement and recovery before applying.')


if __name__ == '__main__':
    main()
