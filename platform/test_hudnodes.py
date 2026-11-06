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
