"""Automatic HOME preparation has no dependency on an already-created VM."""
import base64
import hashlib
import json
import os
import sys
import unittest
import uuid
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmprepare


class PrepareTest(unittest.TestCase):
    def setUp(self):
        self.wid, self.org, self.owner, self.build, self.node_uid = [str(uuid.uuid4()) for _ in range(5)]
        self.request = {'version': 1, 'workspace_id': self.wid, 'organization_id': self.org,
            'workspace_owner_id': self.owner, 'build_id': self.build, 'home_bytes': 1000000000, 'node_name': ''}
        raw = json.dumps(self.request, separators=(',', ':')).encode()
        name = 'coder-vm-home-request-' + self.wid + '-' + hashlib.sha256(raw).hexdigest()[:16]
        self.secret = {'metadata': {'name':name,'labels':{'com.coder.workspace.id':self.wid,'com.coder.organization.id':self.org,'com.coder.user.id':self.owner}},'immutable': True, 'data': {'request': base64.b64encode(raw).decode()}}
        self.claim = {'metadata': {'name': 'coder-vm-' + self.wid + '-home', 'uid': 'claim-uid',
            'labels': {'com.coder.workspace.id': self.wid, 'com.coder.organization.id': self.org, 'com.coder.user.id': self.owner},
            'annotations': {'platform.coder/home-request': name, 'platform.coder/home-disk-bytes': '1000000000'}},
            'spec': {'storageClassName': 'coder-vm-home', 'volumeMode': 'Block', 'resources': {'requests': {'storage': '1G'}}},
            'status': {'phase': 'Pending'}}
        self.intent = {'workspace_id': self.wid, 'organization_id': self.org, 'owner_id': self.owner,
                       'build_id': self.build, 'transition': 'start', 'job_status': 'running'}
        self.kube = mock.Mock(side_effect=self.call)
        self.manager = vmprepare.Preparer(self.kube, 'coder', lambda *args: self.intent, mock.Mock())

    def call(self, method, path, body=None):
        if '/secrets/' in path:
            return 200, self.secret
        if '/nodes?' in path:
            return 200, {'items': [{'metadata': {'name': 'worker', 'uid': self.node_uid}, 'spec': {'taints': [
                {'key': 'platform.coder/workspace-vm-host', 'effect': 'NoSchedule'}]},
                'status': {'conditions': [{'type': 'Ready', 'status': 'True'}]}}]}
        if '/configmaps/' in path:
            return 200, {'metadata': {'resourceVersion': '7'}, 'data': {'homes.json': '{}'}}
        if '/persistentvolumeclaims/' in path:
            return 200, self.claim
        raise AssertionError((method, path))

    def test_current_pending_home_uses_fixed_prepare_without_vm_or_agent_auth(self):
        with mock.patch.object(vmprepare.vmgrow, 'run') as run:
            self.manager.prepare(self.claim)
        self.assertEqual(run.call_args.kwargs, {'action': 'prepare'})
        prepared = run.call_args.args[1]
        self.assertEqual(prepared['request']['pvc_uid'], 'claim-uid')
        self.assertEqual(prepared['request']['build_id'], self.build)
        self.assertEqual(prepared['node'], 'worker')
        self.assertEqual(prepared['request']['node_uid'], self.node_uid)
        self.assertFalse(any('/virtualmachines/' in call.args[1] for call in self.kube.call_args_list))

    def test_node_uid_is_derived_from_trusted_node_not_sealed_request(self):
        original = self.kube.side_effect
        def missing(method,path,body=None):
            status,result=original(method,path,body)
            if '/nodes?' in path:
                result['items'][0]['metadata'].pop('uid')
            return status,result
        self.kube.side_effect=missing
        with mock.patch.object(vmprepare.vmgrow,'run') as run,self.assertRaises((ValueError,KeyError)):
            self.manager.prepare(self.claim)
        run.assert_not_called()
        self.assertNotIn('node_uid',self.request)

    def test_registry_is_initialized_only_on_not_found_and_a_concurrent_creator_is_preserved(self):
        original = self.kube.side_effect
        state = {'initialized': False}
        posts = []
        def call(method, path, body=None):
            if '/configmaps/' in path:
                if not state['initialized']:
                    return 404, {}
                return 200, {'metadata': {'resourceVersion': '99'}, 'data': {'homes.json': '{"other":{"status":"ready"}}'}}
            if method == 'POST' and path.endswith('/configmaps'):
                posts.append(body)
                state['initialized'] = True
                return 409, {}
            return original(method, path, body)
        self.kube.side_effect = call
        with mock.patch.object(vmprepare.vmgrow, 'run') as run:
            self.manager.prepare(self.claim)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]['metadata']['name'], 'coder-vm-home-provenance')
        self.assertEqual(run.call_args.args[1]['request']['record_resource_version'], '99')
        self.assertFalse(any(call.args[0] in ('PATCH', 'PUT') for call in self.kube.call_args_list))

    def test_canceled_build_foreign_owner_mutable_secret_or_size_mismatch_cannot_prepare(self):
        for problem in ('build', 'owner', 'secret', 'size'):
            with self.subTest(problem=problem):
                if problem == 'build':
                    self.intent['job_status'] = 'canceled'
                elif problem == 'owner':
                    self.intent['owner_id'] = str(uuid.uuid4())
                elif problem == 'secret':
                    self.secret['immutable'] = False
                else:
                    self.claim['spec']['resources']['requests']['storage'] = '2G'
                with mock.patch.object(vmprepare.vmgrow, 'run') as run:
                    with self.assertRaises(ValueError):
                        self.manager.prepare(self.claim)
                    run.assert_not_called()
                self.intent['job_status'], self.intent['owner_id'], self.secret['immutable'] = 'running', self.owner, True

    def test_registered_or_needs_review_home_never_starts_duplicate_prepare_job(self):
        original = self.kube.side_effect
        def call(method, path, body=None):
            if '/configmaps/' in path:
                return 200, {'metadata': {'resourceVersion': '7'}, 'data': {'homes.json': json.dumps({self.wid: {'status': 'needs-review'}})}}
            return original(method, path, body)
        self.kube.side_effect = call
        with mock.patch.object(vmprepare.vmgrow, 'run') as run:
            with self.assertRaises(RuntimeError):
                self.manager.prepare(self.claim)
            run.assert_not_called()

    def test_request_reference_cannot_escape_claim_namespace(self):
        self.claim['metadata']['annotations']['platform.coder/home-request'] = '../../secrets/other'
        with self.assertRaises(ValueError):
            self.manager.request(self.claim)
        self.kube.assert_not_called()


if __name__ == '__main__':
    unittest.main()
