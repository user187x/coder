"""Health reporting retains failed pods without counting them as reservations."""
import ast
import pathlib
import unittest
import urllib.parse
from unittest.mock import Mock

import clusternet


class HealthTest(unittest.TestCase):
    def snapshot(self, pod_status):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'cluster_snapshot')
        kube = Mock()
        kube.call.side_effect = [(200, {'items': []}), pod_status, (503, {}), (200, {'gitVersion': 'test'})]
        cache = Mock()
        cache.get.return_value = None
        scope = {'KUBE': kube, 'CACHE': cache, 'urllib': urllib, 'CODER_NAMESPACE': 'coder'}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'cluster_snapshot', 'exec'), scope)
        return scope['cluster_snapshot'](), kube

    def test_failed_pods_are_separate_from_capacity_reservations(self):
        running = {'status': {'phase': 'Running'}}
        failed = {'status': {'phase': 'Failed'}}
        snapshot, kube = self.snapshot((200, {'items': [running, failed]}))
        self.assertEqual(snapshot['pods'], [running])
        self.assertEqual(snapshot['failedPods'], [failed])
        self.assertTrue(snapshot['podsAvailable'])
        self.assertNotIn('Failed', urllib.parse.unquote(kube.call.call_args_list[1].args[1]))

    def test_forbidden_pod_listing_is_unavailable(self):
        snapshot, _ = self.snapshot((403, {'message': 'forbidden'}))
        self.assertFalse(snapshot['podsAvailable'])
        self.assertEqual(snapshot['failedPods'], [])

    def test_system_pods_are_reported_separately_from_workspaces(self):
        for namespace in ('coder-system', 'coder-runtime-system'):
            pod = {'metadata': {'namespace': namespace}}
            self.assertTrue(clusternet.on_map(pod))
            pod['metadata']['labels'] = {'com.coder.workspace.id': 'workspace'}
            self.assertFalse(clusternet.on_map(pod))


if __name__ == '__main__':
    unittest.main()
