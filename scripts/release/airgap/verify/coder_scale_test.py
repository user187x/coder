"""Central Coder scaling boundaries and optimistic concurrency."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/files/ui-updates/clusternet.py"
spec = importlib.util.spec_from_file_location("clusternet", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoderScaleTest(unittest.TestCase):
    def setUp(self):
        self.deployment = {"metadata": {"resourceVersion": "4"}, "spec": {
            "replicas": 2, "template": {"spec": {"affinity": {"podAntiAffinity": {
                "requiredDuringSchedulingIgnoredDuringExecution": [{"topologyKey": "kubernetes.io/hostname",
                "labelSelector": {"matchLabels": {"app.kubernetes.io/name": "coder"}}}]}}}}},
            "status": {"readyReplicas": 2}}
        self.hpas = {"items": []}
        node = lambda name, role, memory="16Gi", **extra: {"metadata": {"name": name, "labels": {"coder-ha-role": role}},
            "spec": extra, "status": {"allocatable": {"cpu": "8", "memory": memory},
                                      "conditions": [{"type": "Ready", "status": "True"}]}}
        self.nodes = {"items": [node("a", "control"), node("b", "control"), node("c", "control"),
                                node("edge", "edge"), node("small", "control", "1Gi")]}
        coder = lambda n: {"metadata": {"labels": {"app.kubernetes.io/name": "coder", "app.kubernetes.io/instance": "coder"}},
                           "spec": {"nodeName": n, "containers": [{"resources": {"requests": {"cpu": "1", "memory": "2Gi"}}}]}}
        self.pods = {"items": [coder("a"), coder("b")]}
        template = self.deployment["spec"]["template"]["spec"]
        template["nodeSelector"] = {"coder-ha-role": "control"}
        template["containers"] = [{"resources": {"requests": {"cpu": "1", "memory": "2Gi"}}}]
        module.QUANTITY = lambda v: None if v is None else float(str(v).replace("Gi", "e9"))
        module.LOG = Mock()
        module.KUBE = Mock()

        def call(method, path, *args):
            if "horizontalpodautoscalers" in path:
                return 200, self.hpas
            if path == "/api/v1/nodes":
                return 200, self.nodes
            if path.startswith("/api/v1/pods"):
                return 200, self.pods
            return 200, self.deployment
        module.KUBE.call.side_effect = call

    def test_reports_one_replica_per_eligible_node(self):
        out = module.coder_scale()
        self.assertEqual(out["maxReplicas"], 3, "a and b run Coder, c fits; edge is not selected and small is full")
        self.assertEqual([(n["name"], n["coder"], n["fits"]) for n in out["nodes"]],
                         [("a", True, True), ("b", True, True), ("c", False, True), ("small", False, False)])
        self.assertEqual(out["nodes"][-1]["reason"], "Not enough memory")
        self.nodes["items"][2]["spec"]["unschedulable"] = True
        self.assertEqual(module.coder_scale()["maxReplicas"], 2)

    def use_label_placement(self):
        template = self.deployment["spec"]["template"]["spec"]
        template["nodeSelector"] = {}
        term = lambda key, value: {"matchExpressions": [{"key": key, "operator": "In", "values": [value]}]}
        template["affinity"]["nodeAffinity"] = {"requiredDuringSchedulingIgnoredDuringExecution": {
            "nodeSelectorTerms": [term("coder-ha-role", "control"), term("platform.coder/central-coder", "true")]}}

    def test_counts_nodes_the_label_would_allow(self):
        self.use_label_placement()
        out = module.coder_scale()
        self.assertEqual(out["maxReplicas"], 4, "a, b, c and the edge node once labelled")
        edge = next(n for n in out["nodes"] if n["name"] == "edge")
        self.assertEqual((edge["fits"], edge["label"]), (True, True))

    def test_labels_only_the_nodes_a_scale_up_needs(self):
        self.use_label_placement()
        module.coder_scale({"replicas": 3, "resourceVersion": "4"})
        self.assertFalse(any(c.args[0] == "PATCH" for c in module.KUBE.call.call_args_list), "c is already allowed")
        module.KUBE.call.reset_mock()
        module.coder_scale({"replicas": 4, "resourceVersion": "4"})
        patches = [c.args for c in module.KUBE.call.call_args_list if c.args[0] == "PATCH"]
        self.assertEqual(patches, [("PATCH", "/api/v1/nodes/edge",
                                    {"metadata": {"labels": {"platform.coder/central-coder": "true"}}},
                                    "application/merge-patch+json")])
        self.assertEqual([c.args[2]["spec"] for c in module.KUBE.call.call_args_list if c.args[0] == "PUT"],
                         [{"replicas": 4}])

    def test_refuses_more_replicas_than_nodes(self):
        with self.assertRaises(ValueError):
            module.coder_scale({"replicas": 4, "resourceVersion": "4"})
        self.assertFalse(any(c.args[0] == "PUT" for c in module.KUBE.call.call_args_list))

    def test_scaling_uses_versioned_scale_subresource(self):
        module.coder_scale({"replicas": 3, "resourceVersion": "4"})
        writes = [c for c in module.KUBE.call.call_args_list if c.args[0] == "PUT"]
        self.assertEqual(len(writes), 1)
        self.assertTrue(writes[0].args[1].endswith("/deployments/coder/scale"))
        self.assertEqual(writes[0].args[2]["spec"], {"replicas": 3})
        self.assertEqual(writes[0].args[2]["metadata"]["resourceVersion"], "4")

    def test_invalid_counts_and_stale_version_never_write(self):
        for count in (0, 1, 11, True, 2.5, "3", None):
            with self.assertRaises(ValueError):
                module.coder_scale({"replicas": count, "resourceVersion": "4"})
        with self.assertRaises(ValueError):
            module.coder_scale({"replicas": 3, "resourceVersion": "old"})
        self.assertFalse(any(c.args[0] == "PUT" for c in module.KUBE.call.call_args_list))

    def test_requires_separate_nodes_and_no_autoscaler(self):
        self.hpas["items"] = [{"spec": {"scaleTargetRef": {"name": "coder", "kind": "Deployment"}}}]
        with self.assertRaises(ValueError):
            module.coder_scale({"replicas": 3, "resourceVersion": "4"})
        self.hpas["items"] = []
        self.deployment["spec"]["template"]["spec"]["affinity"] = {}
        with self.assertRaises(ValueError):
            module.coder_scale({"replicas": 3, "resourceVersion": "4"})
        self.assertFalse(any(c.args[0] == "PUT" for c in module.KUBE.call.call_args_list))

    def test_non_admin_and_cross_site_requests_never_write(self):
        handler = Mock()
        handler.user.return_value = (None, True)
        module.handle(handler, "POST", module.BASE + "/api/network/coder-scale", "")
        module.KUBE.call.assert_not_called()
        handler.user.assert_called_once_with(admin=True)
        handler.user.return_value = ({"id": "owner"}, None)
        handler.csrf_ok.return_value = False
        module.handle(handler, "POST", module.BASE + "/api/network/coder-scale", "")
        module.KUBE.call.assert_not_called()
        handler.send_json.assert_called_with(403, {"error": "Cross-site request refused"})


if __name__ == "__main__":
    unittest.main()
