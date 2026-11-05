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



class HudLatencyTest(unittest.TestCase):
    def history(self, http):
        import threading
        import time
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        definition = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'HudHistory')
        clock = Mock(wraps=time)
        clock.monotonic.side_effect = [10, 10.025]
        scope = {'threading': threading, 'time': clock, 'http_json': http, 'CODER_URL': 'https://coder'}
        exec(compile(ast.Module(body=[definition], type_ignores=[]), 'HudHistory', 'exec'), scope)
        return scope['HudHistory']('unused', backing=Mock())

    def test_service_latency_without_workspace_connections(self):
        http = Mock(return_value=(200, 'OK'))
        self.assertAlmostEqual(self.history(http).service_latency(), 25)
        http.assert_called_once_with('https://coder/healthz', timeout=4)

    def test_failed_probe_is_missing_not_zero(self):
        for http in (Mock(return_value=(503, 'unavailable')), Mock(side_effect=TimeoutError())):
            self.assertIsNone(self.history(http).service_latency())

    def test_latency_survives_sample_storage_and_bucketing(self):
        import sqlite3
        import tempfile
        import threading
        import time
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        definition = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'HudHistory')
        scope = {
            'threading': threading, 'time': time, 'sqlite3': sqlite3,
            'HUD_SAMPLE_EVERY': 15, 'HUD_HISTORY_DAYS': 7, 'HUD_RANGES': {'1h': 3600},
            'LOGOS': None, 'CODER_URL': 'https://coder', 'http_json': Mock(return_value=(200, 'OK')),
            'cluster_usage': lambda: {'cpu': {'used': 1, 'total': 4}, 'memory': {'used': 2, 'total': 8}},
            'cluster_snapshot': lambda: {'usage': {}}, '_pod_usage_by_workspace': lambda: {},
            'node_network_counters': lambda: {},
            'hud_storage': lambda: {'used': 1, 'total': 10, 'claimed': 5, 'volumeUsed': 1},
        }
        exec(compile(ast.Module(body=[definition], type_ignores=[]), 'HudHistory', 'exec'), scope)
        with tempfile.TemporaryDirectory() as folder:
            history = scope['HudHistory'](str(pathlib.Path(folder) / 'hud.db'))
            history.service_latency = lambda: 25.5
            history.sample()
            points = history.series('1h')['points']
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]['serviceLatency'], 25.5)
        self.assertIsNone(points[0]['latency'])
        self.assertEqual(points[0]['connections'], 0)


if __name__ == '__main__':
    unittest.main()
