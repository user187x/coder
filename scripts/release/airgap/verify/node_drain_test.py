"""Draining a node from the HUD: cordon, then evictions (never DaemonSet or mirror pods), behind a typed confirmation."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/files/ui-updates/clusternet.py"
spec = importlib.util.spec_from_file_location("clusternet_drain", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NodeDrainTest(unittest.TestCase):
    def setUp(self):
        pod = lambda name, owner=None, mirror=False, phase="Running": {
            "metadata": {"namespace": "coder", "name": name,
                         "ownerReferences": [{"kind": owner}] if owner else [],
                         "annotations": {"kubernetes.io/config.mirror": "x"} if mirror else {}},
            "status": {"phase": phase}}
        self.pods = {"items": [pod("web", "ReplicaSet"), pod("guarded", "ReplicaSet"), pod("agent", "DaemonSet"),
                               pod("static", mirror=True), pod("done", "Job", phase="Succeeded")]}
        module.node_config = Mock(return_value={"uid": "u1", "resourceVersion": "9"})
        module.LOG = Mock()
        module.KUBE = Mock()

        def call(method, path, *args):
            if method == "PATCH":
                return 200, {}
            if method == "GET":
                return 200, self.pods
            return (429, {}) if "/guarded/" in path else (201, {})
        module.KUBE.call.side_effect = call

    def test_cordons_then_evicts_movable_pods(self):
        out = module.drain_node({"name": "agent-1", "uid": "u1", "confirmation": "agent-1"}, {"id": "admin"})
        self.assertTrue(out["cordoned"])
        self.assertEqual(out["evicted"], ["coder/web"])
        self.assertEqual(out["blocked"], ["coder/guarded"])
        self.assertEqual(sorted(out["skipped"]), ["coder/agent", "coder/static"])
        first = module.KUBE.call.call_args_list[0].args
        self.assertEqual((first[0], first[2]), ("PATCH", {"spec": {"unschedulable": True}}))

    def test_needs_the_typed_name_and_the_same_node(self):
        with self.assertRaises(ValueError):
            module.drain_node({"name": "agent-1", "uid": "u1", "confirmation": "agent"}, {})
        with self.assertRaises(ValueError):
            module.drain_node({"name": "agent-1", "uid": "other", "confirmation": "agent-1"}, {})
        module.KUBE.call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
