"""Media descriptors must originate in current, enrolled infrastructure."""
import copy
import json
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import nekomedia
from test_vmprofile import fixture, lookup, IDS, IMAGE, NODE_UID

VM_UID = '00000000-0000-4000-8000-000000000007'
VMI_UID = '00000000-0000-4000-8000-000000000008'
POD_UID = '00000000-0000-4000-8000-000000000009'


class DescriptorTest(unittest.TestCase):
    def setUp(self):
        self.profile, self.secret, self.vm = fixture()
        self.vm['metadata']['uid'] = VM_UID
        self.vm['metadata']['annotations'] = {'platform.coder/desired-run-strategy': 'Always', 'com.coder.agent.id': IDS[3]}
        self.instance = {'metadata': {'uid': VMI_UID, 'ownerReferences': [{'kind': 'VirtualMachine', 'controller': True, 'uid': VM_UID}]},
                         'status': {'phase': 'Running', 'nodeName': 'worker', 'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        self.pod = {'metadata': {'uid': POD_UID, 'ownerReferences': [{'kind': 'VirtualMachineInstance', 'controller': True, 'uid': VMI_UID}]},
                    'spec': {'nodeName': 'worker'}, 'status': {'phase': 'Running', 'podIP': '10.244.1.5', 'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        self.pool = mock.Mock()
        self.pool.query.return_value = [(IDS[0], IDS[2], IDS[1], IDS[4], IDS[3])]
        self.kube = mock.Mock()
        base = lookup(self.secret)
        def call(method, path):
            self.assertEqual(method, 'GET')
            if '/virtualmachines/' in path:
                return 200, copy.deepcopy(self.vm)
            if '/virtualmachineinstances/' in path:
                return 200, copy.deepcopy(self.instance)
            if '/pods?' in path:
                return 200, {'items': [copy.deepcopy(self.pod)]}
            return 200, copy.deepcopy(base(path))
        self.kube.call.side_effect = call
        self.service = nekomedia.Service(self.kube, lambda: self.pool, 'coder', 'runtime', enabled=True,
            key='a' * 64, images=[IMAGE], relay_cidrs=['10.244.0.0/16'])

    def resolve(self):
        return self.service.descriptor(IDS[2], IDS[0], IDS[4], IDS[3])

    def test_descriptor_uses_current_launcher_and_original_worker_identity(self):
        result = self.resolve()
        self.assertEqual(result['peer'], '10.244.1.5:59000')
        self.assertEqual(result['http_origin'], 'http://127.0.0.1:9080')
        self.assertEqual(result['node_uid'], NODE_UID)
        self.assertEqual(result['vm_uid'], VM_UID)
        self.assertEqual(result['vmi_uid'], VMI_UID)
        self.assertEqual(len(self.pool.query.call_args_list), 2)

    def test_descriptor_uses_configured_generic_cpu_models(self):
        self.service.cpu_models = ('qemu64',)
        self.vm['spec']['template']['spec']['domain']['cpu']['model'] = 'qemu64'
        self.assertEqual(self.resolve()['peer'], '10.244.1.5:59000')

    def test_quarantine_or_halted_intent_denies_media(self):
        for annotation, value in (('platform.coder/desired-run-strategy', 'Halted'), ('platform.coder/quarantine-revision', IDS[4])):
            with self.subTest(annotation=annotation):
                self.vm['metadata']['annotations'][annotation] = value
                with self.assertRaises(RuntimeError):
                    self.resolve()
                self.vm['metadata']['annotations'].pop(annotation)
                self.vm['metadata']['annotations']['platform.coder/desired-run-strategy'] = 'Always'

    def test_unready_or_replaced_launcher_denies_media(self):
        self.pod['metadata']['ownerReferences'][0]['uid'] = VM_UID
        with self.assertRaises(RuntimeError):
            self.resolve()
        self.pod['metadata']['ownerReferences'][0]['uid'] = VMI_UID
        self.pod['status']['conditions'][0]['status'] = 'False'
        with self.assertRaises(RuntimeError):
            self.resolve()

    def test_original_worker_replacement_is_not_a_media_endpoint(self):
        original = self.kube.call.side_effect
        def replaced(method, path):
            code, value = original(method, path)
            if path == '/api/v1/nodes/worker':
                value['metadata']['uid'] = VM_UID
            return code, value
        self.kube.call.side_effect = replaced
        with self.assertRaises(ValueError):
            self.resolve()

    def test_policy_change_during_resolution_denies_media(self):
        self.pool.query.side_effect = [self.pool.query.return_value, []]
        with self.assertRaises(RuntimeError):
            self.resolve()

    def test_disabled_feature_never_looks_up_workspace_or_opens_guest_access(self):
        disabled = nekomedia.Service(self.kube, lambda: self.pool, 'coder', 'runtime')
        self.assertIsNone(disabled.settings(self.profile, self.vm, self.instance, self.pod))
        with self.assertRaises(RuntimeError):
            disabled.descriptor(IDS[2], IDS[0], IDS[4], IDS[3])
        self.pool.query.assert_not_called()
        self.kube.call.assert_not_called()

    def test_settings_trust_only_ready_deployment_owned_relay_pods(self):
        original = self.kube.call.side_effect
        relay = {'metadata': {'ownerReferences': [{'kind': 'ReplicaSet', 'controller': True, 'uid': 'replica'}]},
                 'spec': {'serviceAccountName': 'platform'}, 'status': {'phase': 'Running', 'podIP': '10.244.0.7', 'conditions': [{'type': 'Ready', 'status': 'True'}]}}
        spoofed = copy.deepcopy(relay)
        spoofed['metadata']['ownerReferences'][0]['uid'] = 'tenant'
        spoofed['status']['podIP'] = '10.244.0.8'
        def relays(method, path):
            if '/deployments/' in path:
                return 200, {'metadata': {'uid': 'deployment'}, 'spec': {'template': {'spec': {'serviceAccountName': 'platform'}}}}
            if '/replicasets?' in path:
                return 200, {'items': [{'metadata': {'uid': 'replica', 'ownerReferences': [{'kind': 'Deployment', 'controller': True, 'uid': 'deployment'}]}}]}
            if '/pods?' in path:
                return 200, {'items': [relay, spoofed]}
            return original(method, path)
        self.kube.call.side_effect = relays
        self.assertEqual(self.service.settings(self.profile, self.vm, self.instance, self.pod),
            {'enabled': True, 'relay_sources': ['10.244.0.7'], 'advertised_ip': '10.244.1.5'})
        relay['status']['conditions'][0]['status'] = 'False'
        with self.assertRaises(RuntimeError):
            self.service.settings(self.profile, self.vm, self.instance, self.pod)

    def test_missing_app_or_restricted_workspace_disables_guest_media(self):
        self.pool.query.return_value = []
        self.assertEqual(self.service.settings(self.profile, self.vm, self.instance, self.pod), {'enabled': False, 'relay_sources': []})
        self.kube.call.assert_not_called()

    def test_noncanonical_or_nonunicast_addresses_are_rejected(self):
        for value in ('127.0.0.1', '169.254.1.2', '224.0.0.1', '0.0.0.0', '::1', '10.01.1.2'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                nekomedia.address(value)
        self.assertEqual(nekomedia.address('100.64.1.2'), '100.64.1.2')


class HandlerTest(unittest.TestCase):
    def setUp(self):
        self.handler = mock.Mock()
        self.handler.headers = {}
        self.service = mock.Mock(key='a' * 64)
        self.path = '/__coder-ui/internal/organizations/%s/workspaces/%s/neko-media' % (IDS[2], IDS[0])
        self.query = 'build_id=%s&agent_id=%s' % (IDS[4], IDS[3])

    def test_public_or_non_ascii_credentials_never_resolve_a_descriptor(self):
        for value in ('', 'b' * 64, 'é' * 64):
            self.handler.headers['X-Coder-Media-Descriptor-Key'] = value
            self.assertTrue(nekomedia.handle(self.handler, 'GET', self.path, self.query, self.service))
            self.assertEqual(self.handler.send_json.call_args.args[0], 403)
        self.service.descriptor.assert_not_called()

    def test_duplicate_identity_query_is_rejected_before_resolution(self):
        self.handler.headers['X-Coder-Media-Descriptor-Key'] = 'a' * 64
        nekomedia.handle(self.handler, 'GET', self.path, self.query + '&agent_id=' + IDS[3], self.service)
        self.assertEqual(self.handler.send_json.call_args.args[0], 400)
        self.service.descriptor.assert_not_called()

    def test_authenticated_request_preserves_all_scoping_arguments(self):
        self.handler.headers['X-Coder-Media-Descriptor-Key'] = 'a' * 64
        nekomedia.handle(self.handler, 'GET', self.path, self.query, self.service)
        self.service.descriptor.assert_called_once_with(IDS[2], IDS[0], IDS[4], IDS[3])
        self.assertEqual(self.handler.send_json.call_args.args[0], 200)
