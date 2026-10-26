#!/usr/bin/env python3
"""Exercise temporary QA-only admission hooks using server dry-runs of one VM fixture.

No original object receives the QA label: every workload/Secret probe is a server
 dry-run. Production admission remains namespace-wide; this test-only selector
must never be copied into a production webhook configuration.
"""
import argparse
import copy
import json
import pathlib
import subprocess
import uuid

QA_LABEL = 'platform.coder/admission-qa'


def kubectl(args, obj=None):
    return subprocess.run(['kubectl', *args], input=json.dumps(obj) if obj is not None else None,
                          text=True, capture_output=True)


def resource(kind, name, namespace):
    result = kubectl(['get', kind, name, '-n', namespace, '-o', 'json'])
    if result.returncode:
        raise RuntimeError('Required QA fixture resource is unavailable: ' + kind)
    return json.loads(result.stdout)


def hooks(namespace, backend_namespace, service, ca, suffix):
    result = []
    for mode, kind in (('mutate', 'MutatingWebhookConfiguration'), ('validate', 'ValidatingWebhookConfiguration')):
        result.append({'apiVersion': 'admissionregistration.k8s.io/v1', 'kind': kind,
            'metadata': {'name': 'coder-admission-qa-' + suffix + '-' + mode},
            'webhooks': [{'name': 'workspace-runtime-' + mode + '.qa.platform.coder',
                'admissionReviewVersions': ['v1'], 'sideEffects': 'None', 'failurePolicy': 'Fail', 'timeoutSeconds': 10,
                'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': namespace}},
                'objectSelector': {'matchLabels': {QA_LABEL: 'true'}},
                'clientConfig': {'service': {'namespace': backend_namespace, 'name': service, 'port': 443, 'path': '/runtime-' + mode}, 'caBundle': ca},
                'rules': [{'operations': ['CREATE', 'UPDATE'], 'apiGroups': [''], 'apiVersions': ['v1'], 'resources': ['pods', 'secrets'], 'scope': 'Namespaced'},
                          {'operations': ['CREATE', 'UPDATE'], 'apiGroups': ['kubevirt.io'], 'apiVersions': ['v1'], 'resources': ['virtualmachines', 'virtualmachineinstances'], 'scope': 'Namespaced'}]}]})
    return result


def run(args):
    vm = resource('vm', args.vm, args.namespace)
    vmi = resource('vmi', args.vm, args.namespace)
    # A dry-run label proves we are exercising actual API-defaulted current objects.
    for original in (vm, vmi):
        if QA_LABEL in original.get('metadata', {}).get('labels', {}):
            raise RuntimeError('The original fixture already has a QA label; refusing to alter its test scope.')
    ca_result = kubectl(['get', 'secret', args.tls_secret, '-n', args.backend_namespace, '-o', r'jsonpath={.data.ca\.crt}'])
    if ca_result.returncode or not ca_result.stdout:
        raise RuntimeError('The staged backend CA is unavailable.')
    suffix = uuid.uuid4().hex[:12]
    configurations = hooks(args.namespace, args.backend_namespace, args.service, ca_result.stdout, suffix)
    results = []
    def probe(name, command, expected, obj=None, policy_failure=True):
        process = kubectl(command, obj)
        allowed = process.returncode == 0
        denied_by_policy = 'workspace-runtime-' in process.stderr and '.qa.platform.coder' in process.stderr
        passed = allowed == expected and (expected or not policy_failure or denied_by_policy)
        results.append({'case': name, 'expected_allowed': expected, 'allowed': allowed, 'qa_policy_denial': denied_by_policy, 'passed': passed})
        print(name + ': ' + ('PASS' if passed else 'FAIL'))
        if not passed:
            # Never print API output: Secret responses can contain agent tokens.
            raise RuntimeError('A QA admission expectation failed: ' + name)
    try:
        for obj in configurations:
            result = kubectl(['create', '-f', '-'], obj)
            if result.returncode:
                raise RuntimeError('Could not register the temporary QA-only webhook.')
        label = {'metadata': {'labels': {QA_LABEL: 'true'}}}
        def patch(kind, obj, changes, actor=None):
            command = ['patch', kind, obj['metadata']['name'], '-n', args.namespace, '--type=merge', '--patch', json.dumps(changes), '--dry-run=server', '-o', 'name']
            if actor:
                command += ['--as', actor]
            return command
        probe('actual-defaulted-vm', patch('vm', vm, {**label, 'spec': {'runStrategy': 'Always'}}, 'system:serviceaccount:' + args.namespace + ':coder-ui-updates'), True)
        controller = 'system:serviceaccount:kubevirt:kubevirt-controller'
        probe('actual-owned-vmi', patch('vmi', vmi, label, controller), True)
        boot = next(volume['cloudInitNoCloud']['secretRef']['name'] for volume in vmi['spec']['volumes'] if volume['name'] == 'cloudinit')
        secret = resource('secret', boot, args.namespace)
        probe('actual-boot-secret', patch('secret', secret, label), True)
        home = next(volume['persistentVolumeClaim']['claimName'] for volume in vm['spec']['template']['spec']['volumes'] if volume['name'] == 'home')
        claim = resource('pvc', home, args.namespace)
        request_name = claim['metadata'].get('annotations', {}).get('platform.coder/home-request')
        if not request_name:
            raise RuntimeError('Actual fixture has no immutable HOME request reference.')
        request = resource('secret', request_name, args.namespace)
        probe('actual-home-request-secret', patch('secret', request, label), True)
        malformed = {'apiVersion': 'v1', 'kind': 'Secret', 'immutable': True,
            'metadata': {'name': request_name + '-bad', 'namespace': args.namespace, 'labels': {**request['metadata'].get('labels', {}), QA_LABEL: 'true'}},
            'data': request['data']}
        probe('home-request-content-address', ['create', '--dry-run=server', '-f', '-', '-o', 'name'], False, malformed)
        instance_fork = {'apiVersion': vmi['apiVersion'], 'kind': 'VirtualMachineInstance',
            'metadata': {'name': 'forked-instance-qa-' + suffix, 'namespace': args.namespace, 'labels': {**vmi['metadata'].get('labels', {}), QA_LABEL: 'true'}, 'ownerReferences': vmi['metadata']['ownerReferences']},
            'spec': copy.deepcopy(vmi['spec'])}
        probe('vmi-foreign-create-actor', ['create', '--dry-run=server', '-f', '-', '-o', 'name'], False, instance_fork)
        probe('vmi-name-fork', ['create', '--dry-run=server', '-f', '-', '-o', 'name', '--as', controller], False, instance_fork)

        negative = copy.deepcopy(label)
        negative['spec'] = {'template': {'spec': {'domain': {'cpu': {'maxSockets': 2}}}}}
        probe('vm-hardware-expansion', patch('vm', vm, negative), False)
        negative = copy.deepcopy(label)
        negative['spec'] = {'template': {'spec': {'domain': {'devices': {'hostDevices': [{'name': 'host', 'deviceName': 'example.invalid/host'}]}}}}}
        probe('vm-device-passthrough', patch('vm', vm, negative), False)
        negative = copy.deepcopy(label)
        negative['spec'] = {'template': {'metadata': {'labels': {'com.coder.organization.id': str(uuid.uuid4())}}}}
        probe('vm-cross-organization', patch('vm', vm, negative), False)
        negative = copy.deepcopy(label)
        volumes = copy.deepcopy(vm['spec']['template']['spec']['volumes'])
        next(volume for volume in volumes if volume['name'] == 'home')['persistentVolumeClaim']['claimName'] = 'foreign-qa-claim-' + suffix
        negative['spec'] = {'template': {'spec': {'volumes': volumes}}}
        probe('vm-foreign-home-claim', patch('vm', vm, negative), False)
        fork = {'apiVersion': vm['apiVersion'], 'kind': 'VirtualMachine', 'metadata': {'name': 'forked-qa-' + suffix, 'namespace': args.namespace, 'labels': {**vm['metadata'].get('labels', {}), QA_LABEL: 'true'}}, 'spec': copy.deepcopy(vm['spec'])}
        probe('vm-name-fork', ['create', '--dry-run=server', '-f', '-', '-o', 'name'], False, fork)
        for name, additions in (('native-fallback', {}), ('privileged-native', {'securityContext': {'privileged': True}})):
            pod = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': name + '-qa-' + suffix, 'namespace': args.namespace, 'labels': {QA_LABEL: 'true'}}, 'spec': {'restartPolicy': 'Never', 'containers': [{'name': 'probe', 'image': 'registry.k8s.io/pause:3.10', **additions}]}}
            probe(name, ['create', '--dry-run=server', '-f', '-', '-o', 'name'], False, pod)
        return results
    finally:
        for configuration in configurations:
            kubectl(['delete', configuration['kind'], configuration['metadata']['name'], '--ignore-not-found=true'])
        output = pathlib.Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'fixture': args.vm, 'namespace': args.namespace, 'probes': results}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vm', required=True, help='Root-owned disposable real Coder VM fixture')
    parser.add_argument('--namespace', default='coder')
    parser.add_argument('--backend-namespace', default='coder-runtime-system')
    parser.add_argument('--service', default='coder-platform-webhook')
    parser.add_argument('--tls-secret', default='coder-platform-webhook-tls')
    parser.add_argument('--output', required=True, help='Sanitized JSON evidence, never Secret bodies')
    args = parser.parse_args()
    try:
        run(args)
    except RuntimeError as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
