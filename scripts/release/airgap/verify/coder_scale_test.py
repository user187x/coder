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
        module.KUBE = Mock()
        module.KUBE.call.side_effect = lambda method, path, *args: (200, self.hpas if "horizontalpodautoscalers" in path else self.deployment)

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
