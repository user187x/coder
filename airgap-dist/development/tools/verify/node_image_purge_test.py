"""Cleanup rejects workload references and never forces runtime image removal."""
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import nodeimagepurge as cleanup

IMAGE_ID = 'sha256:' + 'a' * 64


class NodeImagePurgeTest(unittest.TestCase):
    def call(self, method, path, body=None):
        if path == '/api/v1/nodes':
            return 200, {'items': [{'metadata': {'name': 'node'}, 'status': {'nodeInfo': {'containerRuntimeVersion': 'docker://29'}}}]}
        return 200, {'items': []}

    def test_plan_rejects_pending_and_controller_references(self):
        def protected(method, path, body=None):
            return (200, {'items': [{'spec': {'template': {'spec': {'containers': [{'image': 'old:v1'}]}}}}]}) if path.endswith('/deployments') else self.call(method, path, body)
        with self.assertRaisesRegex(ValueError, 'referenced'):
            cleanup.plan(protected, [{'names': ['old:v1'], 'nodes': ['node']}], ['old:v1'])

    def test_runtime_reference_prefixes_cannot_bypass_protection(self):
        def protected(method, path, body=None):
            if path.endswith('/deployments'):
                return 200, {'items': [{'spec': {'template': {'spec': {'containers': [{'image': 'localhost:5000/ui@sha256:' + 'a'*64}]}}}}]}
            return self.call(method, path, body)
        ref = 'docker-pullable://localhost:5000/ui@sha256:' + 'a'*64
        with self.assertRaisesRegex(ValueError, 'referenced'):
            cleanup.plan(protected, [{'names': [ref], 'nodes': ['node']}], [ref])
        self.assertEqual(cleanup.normalize('ubuntu:24.04'), cleanup.normalize('docker.io/library/ubuntu:24.04'))

    def test_workspace_inventory_does_not_label_the_helper_as_the_workspace_image(self):
        import imagebuilder
        pod = {'metadata': {'labels': {'com.coder.user.username': 'admin', 'com.coder.workspace.name': 'test'}},
               'status': {'phase': 'Running'}, 'spec': {'containers': [{'name': 'workspace-tunnel', 'image': 'helper:v1'}, {'name': 'dev', 'image': 'workspace:v1'}]}}
        store = Mock()
        store.images.return_value = []
        with patch.object(imagebuilder, 'STORE', store), patch.object(imagebuilder, 'TEMPLATES', []), patch.object(imagebuilder, 'kube_call', return_value=(200, {'items': [pod, pod]})):
            self.assertEqual(imagebuilder.images_in_use(), [{'image': 'workspace:v1', 'workspaces': ['admin/test'], 'templates': [], 'entry': None}])

    def test_failed_discovery_blocks_cleanup(self):
        with self.assertRaisesRegex(ValueError, 'Cannot verify'):
            cleanup.plan(lambda *args: (403, {}), [{'names': ['old:v1'], 'nodes': ['node']}], ['old:v1'])

    def test_review_and_worker_are_bounded(self):
        plan = cleanup.plan(self.call, [{'names': ['old:v1'], 'nodes': ['node']}], ['old:v1'])
        self.assertEqual(plan['nodes'], [{'node': 'node', 'images': ['old:v1']}])
        self.assertEqual(len(plan['review']), 64)
        call = Mock(return_value=(201, {}))
        cleanup.start(call, 'coder', 'worker@sha256:' + 'b'*64, plan, 'admin', 'cleanup')
        spec = call.call_args.args[2]['spec']
        self.assertEqual(spec['backoffLimit'], 0)
        self.assertEqual(spec['activeDeadlineSeconds'], 300)
        container = spec['template']['spec']['containers'][0]
        self.assertFalse(container['securityContext']['allowPrivilegeEscalation'])
        self.assertEqual(container['command'], ['python3', '/app/nodeimagepurge.py'])

    def test_nonforced_immutable_removal_only(self):
        runtime = Mock(side_effect=[(200, {'Id': IMAGE_ID}), (200, []), (200, [])])
        self.assertEqual(cleanup.purge(['old:v1'], runtime, lambda: set()), [{'image': 'old:v1', 'status': 'removed'}])
        self.assertEqual(runtime.call_args.args, ('DELETE', '/images/sha256%3A' + 'a'*64 + '?force=false&noprune=true'))

    def test_runtime_container_blocks_removal(self):
        runtime = Mock(side_effect=[(200, {'Id': IMAGE_ID}), (200, [{'ImageID': IMAGE_ID}])])
        with self.assertRaisesRegex(ValueError, 'runtime container'):
            cleanup.purge(['old:v1'], runtime, lambda: set())
        self.assertFalse(any(args[0] == 'DELETE' for args, _ in runtime.call_args_list))

    def test_alias_of_protected_image_blocks_removal(self):
        runtime = Mock(return_value=(200, {'Id': IMAGE_ID}))
        with self.assertRaisesRegex(ValueError, 'referenced'):
            cleanup.purge(['old:v1'], runtime, lambda: {'active:latest'})
        self.assertFalse(any(args[0] == 'DELETE' for args, _ in runtime.call_args_list))

    def test_runtime_conflict_is_not_retried_with_force(self):
        runtime = Mock(side_effect=[(200, {'Id': IMAGE_ID}), (200, []), (409, {'message': 'image is in use'})])
        with self.assertRaisesRegex(ValueError, 'Runtime refused'):
            cleanup.purge(['old:v1'], runtime, lambda: set())
        self.assertEqual(runtime.call_count, 3)

    def test_unsupported_runtime_is_blocked(self):
        def call(method, path):
            if path == '/api/v1/nodes':
                return 200, {'items': [{'metadata': {'name': 'node'}, 'status': {'nodeInfo': {'containerRuntimeVersion': 'containerd://2'}}}]}
            return self.call(method, path)
        with self.assertRaisesRegex(ValueError, 'Docker nodes only'):
            cleanup.plan(call, [{'names': ['old:v1'], 'nodes': ['node']}], ['old:v1'])


if __name__ == '__main__':
    unittest.main()
