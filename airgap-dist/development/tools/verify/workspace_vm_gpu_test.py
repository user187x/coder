"""GPU preparation never enables unqualified passthrough or native shortcuts."""
import copy
import json
import hashlib
import os
import pathlib
import sys
import unittest
from unittest import mock
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[3]/'helm-chart/coder-airgapped/files/ui-updates'))
import vmgpu
from vmprofile import ProfileError
from workspace_runtime import validate_vm_profile as validate_vm
from test_vmprofile import fixture, lookup, IMAGE

PROFILE={'name':'dedicated-test','mode':'dedicated-pci','resourceName':'example.com/test-gpu','pciSelector':'10de:2236','count':1,'guestImage':IMAGE,'nodeSelector':{'platform.coder/vm-ready':'true','platform.coder/gpu-profile':'dedicated-test'}}


class GPUPreparationTest(unittest.TestCase):
    def policy(self,enabled=True):
        return {'enabled':enabled,'profiles':[copy.deepcopy(PROFILE)]}

    def test_default_and_configured_profiles_remain_disabled_and_unqualified(self):
        with mock.patch.dict(os.environ,{vmgpu.ENV:'{"enabled":false,"profiles":[]}'}):
            self.assertEqual(vmgpu.status()['state'],'disabled')
        policy=vmgpu.config(json.dumps(self.policy()))
        state=vmgpu.status(policy)
        self.assertFalse(state['enabled'])
        self.assertEqual(state['state'],'unqualified')
        self.assertIsNone(state['profiles'][0]['assignableDevices'])
        domain={'devices':{'gpus':[{'name':'gpu0','deviceName':PROFILE['resourceName']}]},'resources':{}}
        self.assertEqual(vmgpu.requested_units(domain,policy),{PROFILE['resourceName']:1})
        for enabled in (False,True):
            with mock.patch.dict(os.environ,{vmgpu.ENV:json.dumps(self.policy(enabled))}), self.assertRaisesRegex(ValueError,'unqualified' if enabled else 'disabled'):
                vmgpu.reject_vm_passthrough(domain)

    def test_profile_schema_rejects_sharing_mutable_images_and_fake_qualification(self):
        mutations=[lambda p:p.update(qualified=True),lambda p:p.update(count=True),lambda p:p.update(count=0),lambda p:p.update(mode='mig'),lambda p:p.update(resourceName='nvidia.com/mig-1g.10gb'),lambda p:p.update(guestImage='example/guest:latest'),lambda p:p.update(pciSelector='*'),lambda p:p.update(nodeSelector={'kubernetes.io/hostname':'any'})]
        for mutate in mutations:
            policy=self.policy();mutate(policy['profiles'][0])
            with self.subTest(policy=policy),self.assertRaises(ValueError):vmgpu.config(json.dumps(policy))
        for value in ('{"enabled":true,"enabled":false,"profiles":[]}','{"enabled":"false","profiles":[]}'):
            with self.assertRaises(ValueError):vmgpu.config(value)

    def test_native_aliases_and_count_bypasses_are_rejected(self):
        for resource in ('nvidia.com/gpu','example.com/H100','nvidia.com/mig-1g.10gb'):
            with self.assertRaisesRegex(ValueError,'native passthrough is disabled'):
                vmgpu.reject_native_resources({'containers':[{'resources':{'limits':{resource:1}}}]})
        policy=vmgpu.config(json.dumps(self.policy()))
        domain={'devices':{'gpus':[{'name':'gpu0','deviceName':PROFILE['resourceName']},{'name':'gpu1','deviceName':PROFILE['resourceName']}]}}
        with self.assertRaisesRegex(ValueError,'count'):vmgpu.requested_units(domain,policy)

    def test_gpu_preparation_preserves_the_qualified_v6_guest_profile_module(self):
        profile=pathlib.Path(__file__).resolve().parents[3]/'helm-chart/coder-airgapped/files/ui-updates/vmprofile.py'
        # V6 seals this source digest; changing its guest parser requires a new qualified gold image.
        self.assertEqual(hashlib.sha256(profile.read_bytes()).hexdigest(),'ec32d603943e7171af085a2998cf45758931e2813876b822584fe818fae1d894')

    def test_optional_gpu_configuration_cannot_block_cpu_vm_cleanup(self):
        runtime,secret,vm=fixture()
        with mock.patch.dict(os.environ,{vmgpu.ENV:'invalid optional GPU configuration'}):
            self.assertEqual(validate_vm(vm,lookup(secret),'coder',[IMAGE],['Haswell-noTSX']),runtime)
            vm['spec']['template']['spec']['domain']['devices']['gpus']=[{'name':'gpu0','deviceName':PROFILE['resourceName']}]
            with self.assertRaisesRegex(ProfileError,'valid JSON'):
                validate_vm(vm,lookup(secret),'coder',[IMAGE],['Haswell-noTSX'])

    def test_real_vm_validator_does_not_accept_gpu_toggle(self):
        runtime,secret,vm=fixture()
        fetch=lookup(secret)
        vm['spec']['template']['spec']['domain']['devices']['gpus']=[{'name':'gpu0','deviceName':PROFILE['resourceName']}]
        for enabled in (False,True):
            with mock.patch.dict(os.environ,{vmgpu.ENV:json.dumps(self.policy(enabled))}),self.assertRaisesRegex(ProfileError,'unqualified' if enabled else 'disabled'):
                validate_vm(vm,fetch,'coder',[IMAGE],['Haswell-noTSX'])


if __name__=='__main__':unittest.main()
