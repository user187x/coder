"""Dedicated worker placement never falls back to all cluster nodes."""
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / 'runtime/render-kubevirt-worker.py'
SPEC = importlib.util.spec_from_file_location('render_worker', PATH)
renderer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renderer)


class WorkerPlacementTest(unittest.TestCase):
    def test_selects_existing_node_or_capable_pool(self):
        self.assertEqual(renderer.worker_placement('worker-1')['nodeSelector'], {
            'kubernetes.io/hostname': 'worker-1', 'kubernetes.io/arch': 'amd64'})
        result = renderer.worker_placement(labels=['platform.coder/vm-host=true', 'kubernetes.io/arch=amd64'])
        self.assertEqual(result['nodeSelector'], {'platform.coder/vm-host': 'true', 'kubernetes.io/arch': 'amd64'})
        self.assertEqual(result['tolerations'][0]['key'], 'platform.coder/workspace-vm-host')

    def test_rejects_empty_ambiguous_or_invalid_placement(self):
        for node, labels in ((None, []), ('worker-1', ['pool=vm']), ('bad/node', []),
                             (None, ['invalid']), (None, ['a=1', 'a=2']), (None, ['bad!key=true']),
                             (None, ['bad..prefix/key=true']), (None, ['kubernetes.io/arch=arm64'])):
            with self.subTest(node=node, labels=labels), self.assertRaises(ValueError):
                renderer.worker_placement(node, labels)
