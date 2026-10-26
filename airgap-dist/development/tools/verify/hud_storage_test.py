"""Storage inventory must not double-count mounts or report partial measurements as totals."""
import pathlib
import ast
import sqlite3
import tempfile
import threading
import time
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import hudstorage

GIB = 1024 ** 3


class HudStorageTest(unittest.TestCase):
    def setUp(self):
        self.nodes = [dict(metadata=dict(name='one'), status=dict(conditions=[dict(type='Ready', status='True')]))]
        now = datetime.now(timezone.utc).isoformat()
        self.summaries = {'one': dict(node=dict(fs=dict(time=now, usedBytes=3*GIB, capacityBytes=10*GIB, availableBytes=6*GIB)),
            pods=[dict(volume=[dict(time=now, pvcRef=dict(namespace='coder', name='home'), usedBytes=GIB)])]*2)}
        self.kube = Mock()
        self.pvs = [dict(spec=dict(storageClassName='local', capacity=dict(storage=4*GIB)))]
        self.pvcs = [dict(metadata=dict(namespace='coder', name='home'), spec=dict(storageClassName='local', resources=dict(requests=dict(storage=2*GIB))))]
        self.kube.call.side_effect = lambda method, path: (200, dict(items=self.pvs if path.endswith('/persistentvolumes') else self.pvcs))

    def collect(self):
        return hudstorage.collect(self.kube, self.nodes, self.summaries, lambda value: value)

    def test_deduplicates_shared_mounts_and_separates_capacity_from_requests(self):
        result = self.collect()
        self.assertEqual((result['used'], result['free'], result['total']), (3, 6, 10))
        self.assertEqual((result['claimed'], result['volumeUsed'], result['maxVolume'], result['maxClaim']), (2, 1, 4, 2))
        self.assertEqual(result['classes'][0]['measuredClaims'], 1)
        self.assertEqual(result['classes'][0]['capacity'], 4)

    def test_missing_node_does_not_become_a_partial_cluster_total(self):
        self.nodes.append(dict(metadata=dict(name='two'), status=self.nodes[0]['status']))
        result = self.collect()
        self.assertIsNone(result['used'])
        self.assertEqual(result['measuredNodes'], 1)
        self.assertEqual(result['claimed'], 2)

    def test_stale_or_missing_usage_is_unknown(self):
        self.summaries['one']['node']['fs']['time'] = '2020-01-01T00:00:00Z'
        self.summaries['one']['pods'] = []
        result = self.collect()
        self.assertIsNone(result['total'])
        self.assertIsNone(result['volumeUsed'])
        self.assertIsNone(result['classes'][0]['used'])

    def test_denied_inventory_is_unavailable_not_zero(self):
        self.kube.call.return_value = (403, {})
        self.kube.call.side_effect = None
        result = self.collect()
        self.assertIsNone(result['claimed'])
        self.assertIsNone(result['volumeCount'])
        self.assertFalse(result['inventoryAvailable'])

    def test_empty_inventory_is_zero_with_no_fabricated_usage(self):
        self.pvs.clear()
        self.pvcs.clear()
        result = self.collect()
        self.assertEqual(result['claimed'], 0)
        self.assertEqual(result['volumeCount'], 0)
        self.assertIsNone(result['volumeUsed'])
        self.assertEqual(len(hudstorage.metrics(result)), 7)


class HudHistoryStorageTest(unittest.TestCase):
    def test_migrates_legacy_history_and_reads_storage_buckets(self):
        source = pathlib.Path(hudstorage.__file__).with_name('ui-service.py').read_text()
        tree = ast.parse(source)
        history = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'HudHistory')
        namespace = dict(threading=threading, sqlite3=sqlite3, time=time, HUD_SAMPLE_EVERY=15, HUD_RANGES={'1h': 3600})
        exec(compile(ast.Module(body=[history], type_ignores=[]), '<HUD history>', 'exec'), namespace)
        with tempfile.TemporaryDirectory() as folder:
            path = folder + '/hud.sqlite'
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE samples (t INTEGER PRIMARY KEY, live INTEGER, cpu REAL, cpu_ws REAL, cpu_total REAL, mem REAL, mem_ws REAL, mem_total REAL, lat_p50 REAL, lat_p95 REAL, lat_max REAL, connections INTEGER)')
            store = namespace['HudHistory'](path)
            with store.connect() as db:
                db.execute('INSERT INTO samples (t, disk_used, disk_total, disk_claimed, volume_used) VALUES (?,?,?,?,?)', (int(time.time()), 3, 10, 4, 2))
            point = store.series('1h')['points'][0]
            self.assertEqual((point['diskUsed'], point['diskTotal'], point['diskClaimed'], point['volumeUsed']), (3, 10, 4, 2))


if __name__ == '__main__':
    unittest.main()
