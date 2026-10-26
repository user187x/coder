"""VM profile, boot-content and controller trust-boundary regressions."""
import base64
import copy
import hashlib
import importlib.util
import json
import pathlib
import unittest

from vmprofile import ProfileError, boot_profile, home_request_profile, validate_runtime, validate_vm
from workspace_runtime import admission_review, validate_vm_profile

IDS = ['00000000-0000-4000-8000-00000000000' + str(i) for i in range(1, 6)]
IMAGE = 'registry.example/guest@sha256:' + 'a' * 64
NODE_UID = '00000000-0000-4000-8000-000000000006'


def fixture():
    profile = {'version': 1, 'build_id': IDS[4], 'cluster_namespace': 'coder', 'workspace_id': IDS[0], 'workspace_owner_id': IDS[1], 'organization_id': IDS[2],
               'cpu': 2, 'memory_bytes': 2 * 1073741824, 'reserved_memory_bytes': 536870912,
               'home_bytes': 10000000000, 'home_device': '/dev/disk/by-id/virtio-coder-home', 'home_initialize': False,
               'workspace_image': 'registry.example/workspace:latest', 'trusted_ca_pem_base64': '',
               'agent': {'token': IDS[3], 'url': 'https://coder.example', 'init_script_base64': base64.b64encode(b'#!/bin/sh\nexec coder agent\n').decode()},
               'tunnel': {'enabled': False, 'port': 51871}}
    userdata = b'#cloud-config\n' + json.dumps({'write_files': [{'path': '/etc/coder-workspace/runtime.json', 'owner': 'root:root', 'permissions': '0600', 'encoding': 'b64', 'content': base64.b64encode(json.dumps(profile).encode()).decode()}], 'runcmd': [['systemctl', 'start', 'coder-workspace.service']]}).encode()
    labels = {'com.coder.workspace.id': IDS[0], 'com.coder.user.id': IDS[1], 'com.coder.organization.id': IDS[2]}
    secret = {'metadata': {'name': 'coder-vm-' + IDS[0] + '-boot-' + hashlib.sha256(userdata).hexdigest()[:32], 'labels': labels}, 'immutable': True, 'data': {'userdata': base64.b64encode(userdata).decode()}}
    spec = {'nodeSelector': {'platform.coder/vm-ready': 'true', 'kubernetes.io/hostname': 'worker'}, 'terminationGracePeriodSeconds': 30,
            'domain': {'cpu': {'sockets': 1, 'cores': 2, 'threads': 1, 'maxSockets': 1, 'model': 'Haswell-noTSX'}, 'memory': {'guest': '2147483648', 'maxGuest': '2147483648'},
                       'resources': {'requests': {'cpu': '2', 'memory': '2147483648'}, 'limits': {'cpu': '2', 'memory': '2147483648'}},
                       'devices': {'disks': [{'name': 'root', 'disk': {'bus': 'virtio'}}, {'name': 'home', 'serial': 'coder-home', 'disk': {'bus': 'virtio'}}, {'name': 'cloudinit', 'disk': {'bus': 'virtio'}}], 'interfaces': [{'name': 'default', 'masquerade': {}}]}},
            'networks': [{'name': 'default', 'pod': {}}], 'volumes': [{'name': 'root', 'containerDisk': {'image': IMAGE, 'imagePullPolicy': 'IfNotPresent'}}, {'name': 'home', 'persistentVolumeClaim': {'claimName': 'prepared-home'}}, {'name': 'cloudinit', 'cloudInitNoCloud': {'secretRef': {'name': secret['metadata']['name']}}}]}
    vm = {'kind': 'VirtualMachine', 'metadata': {'name': 'coder-vm-' + IDS[0], 'uid': 'vm-uid', 'labels': labels}, 'spec': {'runStrategy': 'Always', 'template': {'metadata': {'labels': labels}, 'spec': spec}}}
    return profile, secret, vm


def lookup(secret):
    def fetch(path):
        profile = boot_profile(secret)
        if path == '/api/v1/nodes/worker':
            return {'metadata': {'uid': NODE_UID}, 'status': {'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        if '/persistentvolumeclaims/' in path:
            return {'metadata': {'uid': 'claim-uid', 'labels': secret['metadata']['labels'], 'annotations': {
                'platform.coder/retained-vm-home': 'true', 'platform.coder/home-disk-bytes': str(profile['home_bytes'])}},
                'spec': {'volumeMode': 'Block', 'volumeName': 'home-pv', 'resources': {'requests': {'storage': str(profile['home_bytes'])}}}}
        if '/configmaps/' in path:
            record = {key: profile[key] for key in ('workspace_id', 'workspace_owner_id', 'organization_id', 'home_bytes')}
            record.update(status='ready', claim_name='prepared-home', claim_uid='claim-uid', pv_name='home-pv', pv_uid='pv-uid', node_name='worker', node_uid=NODE_UID, initial_sha256='b' * 64)
            return {'data': {'homes.json': json.dumps({profile['workspace_id']: record})}}
        if '/persistentvolumes/' in path:
            return {'metadata': {'uid': 'pv-uid'}, 'spec': {'volumeMode': 'Block', 'capacity': {'storage': str(profile['home_bytes'])}, 'claimRef': {'uid': 'claim-uid', 'namespace': 'coder', 'name': 'prepared-home'}}}
        return secret
    return fetch


class VMProfileTest(unittest.TestCase):
    def test_canonical_profile(self):
        profile, secret, vm = fixture()
        self.assertEqual(boot_profile(secret), profile)
        self.assertEqual(validate_vm(vm, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX']), profile)

    def test_host_admission_requires_original_node_identity(self):
        profile, secret, vm = fixture()
        base = lookup(secret)
        self.assertEqual(validate_vm_profile(vm, base, 'coder', [IMAGE], ['Haswell-noTSX']), profile)
        for problem in ('missing', 'replacement'):
            with self.subTest(problem=problem):
                def fetch(path):
                    value = base(path)
                    if problem == 'missing' and '/configmaps/' in path:
                        records = json.loads(value['data']['homes.json'])
                        records[profile['workspace_id']].pop('node_uid')
                        value['data']['homes.json'] = json.dumps(records)
                    if problem == 'replacement' and '/nodes/' in path:
                        value['metadata']['uid'] = IDS[0]
                    return value
                with self.assertRaises(ProfileError):
                    validate_vm_profile(vm, fetch, 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_restrictive_cleanup_does_not_require_a_reachable_worker(self):
        profile, secret, vm = fixture()
        def fetch(path):
            if '/nodes/' in path:
                self.fail('Restrictive cleanup must not depend on worker availability.')
            return lookup(secret)(path)
        self.assertEqual(validate_vm_profile(vm, fetch, 'coder', [IMAGE], ['Haswell-noTSX'], verify_home=False), profile)

    def test_secret_swap_and_arbitrary_boot_commands_rejected(self):
        _, secret, _ = fixture()
        secret['immutable'] = False
        with self.assertRaises(ProfileError):
            boot_profile(secret)
        _, secret, _ = fixture()
        config = json.loads(base64.b64decode(secret['data']['userdata'])[len(b'#cloud-config\n'):])
        config['runcmd'] = [['sh', '-c', 'run user code outside Sysbox']]
        userdata = b'#cloud-config\n' + json.dumps(config).encode()
        secret['data']['userdata'] = base64.b64encode(userdata).decode()
        secret['metadata']['name'] = 'coder-vm-' + IDS[0] + '-boot-' + hashlib.sha256(userdata).hexdigest()[:32]
        with self.assertRaises(ProfileError):
            boot_profile(secret)

    def test_hardware_expansion_and_hooks_rejected(self):
        for key, value in [('model', 'host-model'), ('maxSockets', 2), ('threads', 2)]:
            _, secret, vm = fixture()
            vm['spec']['template']['spec']['domain']['cpu'][key] = value
            with self.subTest(key=key), self.assertRaises(ProfileError):
                validate_vm(vm, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX'])
        _, secret, vm = fixture()
        vm['spec']['template']['spec']['domain']['memory']['maxGuest'] = '4Gi'
        with self.assertRaises(ProfileError):
            validate_vm(vm, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX'])
        _, secret, vm = fixture()
        vm['spec']['template']['metadata']['annotations'] = {'hooks.kubevirt.io/hookSidecars': '[{}]'}
        with self.assertRaises(ProfileError):
            validate_vm(vm, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_unapproved_guest_and_extra_device_rejected(self):
        _, secret, vm = fixture()
        with self.assertRaises(ProfileError):
            validate_vm(vm, lookup(secret), 'coder', [], ['Haswell-noTSX'])
        vm['spec']['template']['spec']['domain']['devices']['hostDevices'] = [{'name': 'host'}]
        with self.assertRaises(ProfileError):
            validate_vm(vm, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_native_pod_fallback_and_forged_launcher_rejected(self):
        request = {'uid': 'test', 'kind': {'kind': 'Pod'}, 'operation': 'CREATE', 'userInfo': {'username': 'system:serviceaccount:coder:coder'}, 'object': {'metadata': {'ownerReferences': [{'controller': True, 'kind': 'VirtualMachineInstance', 'apiVersion': 'kubevirt.io/v1', 'name': 'coder-vm-' + IDS[0], 'uid': 'vmi-uid'}]}, 'spec': {'runtimeClassName': 'sysbox-runc'}}}
        self.assertFalse(admission_review({'request': request}, lambda _: self.fail('untrusted actor must not resolve launcher owners'), set(), 'coder', mode='vm-sysbox')['response']['allowed'])

    def test_verified_launcher_chain(self):
        _, secret, vm = fixture()
        vmi = {'kind': 'VirtualMachineInstance', 'metadata': {'name': 'coder-vm-' + IDS[0], 'uid': 'vmi-uid', 'labels': vm['spec']['template']['metadata']['labels'], 'ownerReferences': [{'controller': True, 'apiVersion': 'kubevirt.io/v1', 'kind': 'VirtualMachine', 'name': 'coder-vm-' + IDS[0], 'uid': 'vm-uid'}]}, 'spec': copy.deepcopy(vm['spec']['template']['spec'])}
        def fetch(path):
            return lookup(secret)(path) if any(resource in path for resource in ('/secrets/', '/persistentvolumeclaims/', '/persistentvolumes/', '/configmaps/', '/nodes/')) else vmi if '/virtualmachineinstances/' in path else vm
        request = {'uid': 'test', 'kind': {'kind': 'Pod'}, 'operation': 'CREATE', 'userInfo': {'username': 'system:serviceaccount:kubevirt:kubevirt-controller'}, 'object': {'metadata': {'ownerReferences': [{'controller': True, 'kind': 'VirtualMachineInstance', 'apiVersion': 'kubevirt.io/v1', 'name': 'coder-vm-' + IDS[0], 'uid': 'vmi-uid'}]}}}
        self.assertTrue(admission_review({'request': request}, fetch, set(), 'coder', mode='vm-sysbox', allowed_images=[IMAGE])['response']['allowed'])
        pod=request['object']
        pod['metadata'].update(uid='pod-uid',name='virt-launcher-fixture',namespace='coder')
        pod['spec']={'containers':[{'name':'compute','image':'trusted-launcher'}],'nodeName':'worker'}
        previous=copy.deepcopy(pod)
        request.update(operation='UPDATE',oldObject=previous)
        pod['metadata']['finalizers']=[]
        vm['spec']['runStrategy']='Halted'
        vm['spec']['template']['spec']['volumes'][-1]['cloudInitNoCloud']['secretRef']['name']='next-stop-profile'
        self.assertTrue(admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[])['response']['allowed'])
        pod['spec']['containers'].append({'name':'injected','image':'untrusted'})
        self.assertFalse(admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])['response']['allowed'])
        pod['spec']=copy.deepcopy(previous['spec'])
        request['operation']='CREATE'
        self.assertFalse(admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])['response']['allowed'])
        request['object']['metadata']['ownerReferences'][0]['uid'] = 'forged'
        self.assertFalse(admission_review({'request': request}, fetch, set(), 'coder', mode='vm-sysbox', allowed_images=[IMAGE])['response']['allowed'])

    def test_canonical_vm_and_instance_ownership_cannot_be_forked(self):
        _,secret,vm=fixture()
        vm['metadata']['name']='forked-vm'
        with self.assertRaises(ProfileError):
            validate_vm(vm,lookup(secret),'coder',[IMAGE],['Haswell-noTSX'])
        _,secret,vm=fixture()
        vmi={'kind':'VirtualMachineInstance','metadata':{'name':vm['metadata']['name'],'uid':'vmi-uid','labels':vm['spec']['template']['metadata']['labels'],'ownerReferences':[{'apiVersion':'kubevirt.io/v1','controller':True,'kind':'VirtualMachine','name':vm['metadata']['name'],'uid':'vm-uid'}]},'spec':copy.deepcopy(vm['spec']['template']['spec'])}
        def fetch(path):
            return vm if '/virtualmachines/' in path else lookup(secret)(path)
        request={'uid':'instance','operation':'CREATE','kind':{'kind':'VirtualMachineInstance'},'object':vmi,'userInfo':{'username':'system:serviceaccount:kubevirt:kubevirt-controller'}}
        check=lambda:admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])['response']['allowed']
        self.assertTrue(check())
        request['userInfo']['username']='system:serviceaccount:coder:coder'
        self.assertFalse(check())
        request['userInfo']['username']='system:serviceaccount:kubevirt:kubevirt-controller'
        vmi['metadata']['name']='forked-vmi'
        self.assertFalse(check())
        vmi['metadata']['name']=vm['metadata']['name']
        old=copy.deepcopy(vmi)
        request.update(operation='UPDATE',oldObject=old)
        request['userInfo']['username']='system:serviceaccount:coder:coder-ui-updates'
        vm['spec']['runStrategy']='Halted'
        # A stopped desired VM may already reference its next build's boot profile.
        vm['spec']['template']['spec']['volumes'][-1]['cloudInitNoCloud']['secretRef']['name']='next-profile'
        vmi['spec']['terminationGracePeriodSeconds']=0
        self.assertTrue(check())
        vmi['spec']['domain']['memory']['maxGuest']='4Gi'
        self.assertFalse(check())


    def test_revoked_images_allow_only_same_existing_halt_and_grace_zero(self):
        _,secret,vm=fixture()
        vm['metadata']['namespace']='coder'
        old=copy.deepcopy(vm)
        vm['spec']['runStrategy']='Halted'
        request={'uid':'halt','operation':'UPDATE','kind':{'kind':'VirtualMachine'},'object':vm,'oldObject':old,'userInfo':{'username':'trusted-template-author'}}
        fetch=lambda path:vm if '/virtualmachines/' in path else lookup(secret)(path)
        check=lambda:admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[])['response']['allowed']
        self.assertTrue(check())
        request['operation']='CREATE'
        self.assertFalse(check())
        request['operation']='UPDATE'
        vm['spec']['template']['spec']['domain']['cpu']['cores']=3
        self.assertFalse(check())
        vm['spec']['template']=copy.deepcopy(old['spec']['template'])
        vmi={'kind':'VirtualMachineInstance','metadata':{'name':vm['metadata']['name'],'uid':'vmi-uid','labels':vm['metadata']['labels'],'ownerReferences':[{'apiVersion':'kubevirt.io/v1','controller':True,'kind':'VirtualMachine','name':vm['metadata']['name'],'uid':'vm-uid'}]},'spec':copy.deepcopy(old['spec']['template']['spec'])}
        previous=copy.deepcopy(vmi)
        vmi['spec']['terminationGracePeriodSeconds']=0
        request.update(kind={'kind':'VirtualMachineInstance'},object=vmi,oldObject=previous,userInfo={'username':'system:serviceaccount:coder:coder-ui-updates'})
        self.assertTrue(check())
        vm['spec']['runStrategy']='Always'
        self.assertFalse(check())
        vm['spec']['runStrategy']='Halted'
        vmi['spec']['volumes'][-1]['cloudInitNoCloud']['secretRef']['name']='different-profile'
        self.assertFalse(check())


    def test_halted_pending_home_is_owned_and_only_manager_can_start_it(self):
        profile,secret,vm=fixture()
        vm['metadata']['annotations']={'platform.coder/desired-run-strategy':'Always'}
        vm['spec']['runStrategy']='Halted'
        claim_name='coder-vm-'+profile['workspace_id']+'-home'
        vm['spec']['template']['spec']['volumes'][1]['persistentVolumeClaim']['claimName']=claim_name
        pending=HomeRequestAdmissionTest().secret(home_bytes=profile['home_bytes'])
        claim=lookup(secret)('/persistentvolumeclaims/home')
        claim['metadata'].update(name=claim_name)
        claim['metadata']['annotations']={'platform.coder/home-request':pending['metadata']['name'],'platform.coder/home-disk-bytes':str(profile['home_bytes'])}
        claim['spec'].update(storageClassName='coder-vm-home')
        claim['spec'].pop('volumeName')
        def fetch(path):
            if '/persistentvolumeclaims/' in path:return claim
            if '/secrets/'+pending['metadata']['name'] in path:return pending
            if '/secrets/' in path:return secret
            self.fail('Halted pending HOME must not require ready physical provenance')
        request={'uid':'pending','operation':'CREATE','kind':{'kind':'VirtualMachine'},'object':vm,'userInfo':{'username':'system:serviceaccount:coder:coder'}}
        check=lambda:admission_review({'request':request},fetch,set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])['response']['allowed']
        self.assertTrue(check())
        claim['metadata']['labels']['com.coder.user.id']=IDS[3]
        self.assertFalse(check())
        claim['metadata']['labels']['com.coder.user.id']=profile['workspace_owner_id']
        vm['spec']['runStrategy']='Always'
        self.assertFalse(check())
        request['userInfo']['username']='system:serviceaccount:coder:coder-ui-updates'
        self.assertFalse(check())  # Even the manager cannot start an unprepared disk.
        _,secret,ready=fixture()
        ready['metadata']['annotations']={'platform.coder/desired-run-strategy':'Always'}
        request['object']=ready
        result=admission_review({'request':request},lookup(secret),set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])
        self.assertTrue(result['response']['allowed'])
        request['userInfo']['username']='system:serviceaccount:coder:coder'
        self.assertFalse(admission_review({'request':request},lookup(secret),set(),'coder',mode='vm-sysbox',allowed_images=[IMAGE])['response']['allowed'])


    def test_foreign_or_unprepared_home_rejected(self):
        _, secret, vm = fixture()
        def fetch(path):
            result = copy.deepcopy(lookup(secret)(path))
            if '/persistentvolumeclaims/' in path:
                result['metadata']['labels']['com.coder.user.id'] = IDS[3]
            return result
        with self.assertRaises(ProfileError):
            validate_vm(vm, fetch, 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_profile_cannot_add_outer_runtime_arguments(self):
        profile, _, _ = fixture()
        profile['docker_args'] = ['--privileged']
        with self.assertRaises(ProfileError):
            validate_runtime(profile)
        profile, _, _ = fixture()
        profile['agent']['url'] = 'https://coder.example/path'
        with self.assertRaises(ProfileError):
            validate_runtime(profile)

    def test_actual_kubevirt_defaults_remain_safe(self):
        for kind in ('vm', 'vmi'):
            _, secret, desired = fixture()
            obj = json.loads(pathlib.Path(__file__).with_name('testdata').joinpath('kubevirt-defaulted-' + kind + '.json').read_text())
            obj['metadata']['name'] = desired['metadata']['name']
            template = obj['spec']['template'] if kind == 'vm' else obj
            template['metadata']['labels'] = desired['spec']['template']['metadata']['labels']
            template['spec']['volumes'] = desired['spec']['template']['spec']['volumes']
            with self.subTest(kind=kind):
                validate_vm(obj, lookup(secret), 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_exclusive_home_operation_and_wrong_node_block_start(self):
        for change in ({'status': 'resizing'}, {'node_name': 'another-worker'}, {'claim_uid': 'replaced-claim'}, {'pv_uid': 'replaced-volume'}):
            _, secret, vm = fixture()
            def fetch(path):
                result = lookup(secret)(path)
                if '/configmaps/' in path:
                    records = json.loads(result['data']['homes.json'])
                    records[IDS[0]].update(change)
                    result['data']['homes.json'] = json.dumps(records)
                return result
            with self.subTest(change=change), self.assertRaises(ProfileError):
                validate_vm(vm, fetch, 'coder', [IMAGE], ['Haswell-noTSX'])

    def test_guest_docker_arguments_cannot_override_boundary(self):
        path = pathlib.Path(__file__).resolve().parents[1] / 'vmguest/runner.py'
        spec = importlib.util.spec_from_file_location('guest_runner', path)
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        profile, _, _ = fixture()
        args = runner.docker_argv(profile, pathlib.Path('/home-disk'), pathlib.Path('/runtime'), pathlib.Path('/bundle'), 'a' * 64)
        self.assertIn('--runtime=sysbox-runc', args)
        self.assertNotIn('--privileged', args)
        self.assertNotIn('/var/run/docker.sock', ' '.join(args))
        self.assertEqual(args[args.index('--memory') + 1], str(2 * 1073741824 - 536870912))
        self.assertEqual(args[args.index('--user') + 1], '1000:1000')
        self.assertEqual(args[args.index('--entrypoint') + 1], '/run/coder-vm/launch-gate')
        self.assertIn('--no-healthcheck', args)
        self.assertIn('CODER_CODE_SERVER_HA=', args)
        self.assertNotIn('CODER_CODE_SERVER_HA=0', args)
        self.assertIn('type=bind,src=/usr/local/lib/coder-vm/launch-gate,dst=/run/coder-vm/launch-gate,readonly', args)
        self.assertEqual(args[-3:], [profile['workspace_image'], '--authorization', 'a' * 64])
        profile['workspace_image'] = '--privileged'
        with self.assertRaises(ProfileError):
            runner.docker_argv(profile, pathlib.Path('/home-disk'), pathlib.Path('/runtime'), pathlib.Path('/bundle'), 'a' * 64)



class HomeRequestAdmissionTest(unittest.TestCase):
    def secret(self, **changes):
        request={'version':1,'workspace_id':IDS[0],'workspace_owner_id':IDS[1],'organization_id':IDS[2],'build_id':IDS[4],'home_bytes':1000000000,'node_name':''}
        request.update(changes)
        raw=json.dumps(request,separators=(',',':')).encode()
        return {'kind':'Secret','immutable':True,'metadata':{'name':'coder-vm-home-request-'+request['workspace_id']+'-'+hashlib.sha256(raw).hexdigest()[:16],'labels':{'com.coder.workspace.id':request['workspace_id'],'com.coder.user.id':request['workspace_owner_id'],'com.coder.organization.id':request['organization_id']}},'data':{'request':base64.b64encode(raw).decode()}}

    def test_reserved_home_request_uses_request_validator_instead_of_boot_userdata(self):
        secret=self.secret()
        request={'uid':'home-request','kind':{'kind':'Secret'},'object':secret,'userInfo':{'username':'trusted-template-author'}}
        self.assertTrue(admission_review({'request':request},lambda _:self.fail('request schema must not fetch unrelated boot secrets'),set(),'coder',mode='vm-sysbox')['response']['allowed'])
        for change in (lambda s:s.update(immutable=False),lambda s:s['metadata']['labels'].update({'com.coder.organization.id':IDS[3]}),lambda s:s['metadata'].update(name=s['metadata']['name']+'0'),lambda s:s['data'].update(userdata='bad')):
            invalid=copy.deepcopy(secret)
            change(invalid)
            request['object']=invalid
            self.assertFalse(admission_review({'request':request},lambda _:None,set(),'coder',mode='vm-sysbox')['response']['allowed'])

    def test_shared_request_capacity_and_worker_bounds(self):
        for changes in ({'home_bytes':512},{'home_bytes':True},{'home_bytes':1000000001},{'node_name':'a'*254},{'node_name':'../../node'}):
            with self.subTest(changes=changes),self.assertRaises(ProfileError):
                home_request_profile(self.secret(**changes))

if __name__ == '__main__':
    unittest.main()
