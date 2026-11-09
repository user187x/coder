"""The HUD node strip's health colors and metadata."""
import unittest

import hudnodes


def node(name, ready="True", conditions=(), unschedulable=False, **meta):
    return {
        "metadata": {"name": name, "labels": meta.get("labels", {}), "annotations": meta.get("annotations", {}),
                     "creationTimestamp": "2026-11-01T00:00:00Z"},
        "spec": {"unschedulable": unschedulable},
        "status": {"conditions": [{"type": "Ready", "status": ready}, *conditions],
                   "addresses": [{"type": "Hostname", "address": name},
                                 {"type": "InternalIP", "address": "10.0.0.%d" % len(name)}],
                   "nodeInfo": {"kubeletVersion": "v1.35.5+k3s1"}},
    }


class HudNodesTest(unittest.TestCase):
    def test_resources_addresses_taints_and_pods(self):
        n = node("agent-0")
        n["status"]["addresses"].append({"type": "ExternalIP", "address": "203.0.113.5"})
        n["status"]["allocatable"] = {"cpu": "4", "memory": "16"}
        n["spec"]["taints"] = [{"key": "dedicated", "value": "db", "effect": "NoSchedule"}]
        pod = lambda name, cpu, mem: {"metadata": {"namespace": "coder", "name": name}, "status": {"phase": "Running"},
                                      "spec": {"nodeName": "agent-0", "containers": [
                                          {"resources": {"requests": {"cpu": cpu, "memory": mem}}}]}}
        quantity = lambda v: None if v is None else float(v)
        (entry,) = hudnodes.summarize([n], [pod("b", "1", "2"), pod("a", "0.5", "1")],
                                      {"agent-0": {"cpu": "2", "memory": "8"}}, quantity)
        self.assertEqual((entry["internalIP"], entry["externalIP"]), ("10.0.0.7", "203.0.113.5"))
        self.assertEqual(entry["taints"], [{"key": "dedicated", "value": "db", "effect": "NoSchedule"}])
        self.assertEqual(entry["resources"]["cpu"], {"allocatable": 4, "allocated": 1.5, "used": 2})
        self.assertEqual(entry["resources"]["memory"], {"allocatable": 16, "allocated": 3, "used": 8})
        self.assertEqual(entry["podCount"], 2)
        self.assertEqual([p["name"] for p in entry["pods"]], ["a", "b"])
        (no_metrics,) = hudnodes.summarize([n], [], None, quantity)
        self.assertIsNone(no_metrics["resources"]["cpu"]["used"])

    def test_health_follows_ready_pressure_and_cordon(self):
        nodes = hudnodes.summarize([
            node("a"),
            node("b", conditions=[{"type": "MemoryPressure", "status": "True"}]),
            node("c", unschedulable=True),
            node("d", ready="False"),
            node("e", ready="Unknown"),
        ])
        self.assertEqual([n["health"] for n in nodes], ["ok", "warning", "warning", "down", "down"])
        self.assertEqual(nodes[1]["pressure"], ["MemoryPressure"])

    def test_metadata_for_hover_and_details(self):
        long_value = "x" * 500
        (entry,) = hudnodes.summarize([node("server-0", labels={"node-role.kubernetes.io/control-plane": "true"},
                                            annotations={"flannel.alpha.coreos.com/backend-data": long_value})])
        self.assertEqual(entry["ip"], "10.0.0.8")
        self.assertEqual(entry["roles"], ["control-plane"])
        self.assertEqual(entry["kubelet"], "v1.35.5+k3s1")
        self.assertEqual(len(entry["annotations"]["flannel.alpha.coreos.com/backend-data"]), hudnodes.VALUE_LIMIT)

    def test_sorted_by_name_and_workers_by_default(self):
        nodes = hudnodes.summarize([node("b"), node("a")])
        self.assertEqual([n["name"] for n in nodes], ["a", "b"])
        self.assertEqual(nodes[0]["roles"], ["worker"])


if __name__ == "__main__":
    unittest.main()
