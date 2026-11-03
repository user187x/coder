"""Resource choices use a single eligible node and actual pod requests."""
import unittest
from platform_unit_test import load

capacity = load("workspacecapacity", "workspacecapacity.py")
ui = load("ui_capacity", "ui-service.py")


def node(name, cpu, mem):
    return {"metadata": {"name": name}, "spec": {}, "status": {"conditions": [{"type": "Ready", "status": "True"}],
            "allocatable": {"cpu": str(cpu), "memory": f"{mem}Gi", "pods": "20"}}}


class CapacityTest(unittest.TestCase):
    def test_joint_placement_and_existing_reservation(self):
        pod = {"metadata": {"namespace": "coder", "name": "coder-test-neko-test-rs-pod", "labels": {
            "com.coder.workspace.id": "ws", "com.coder.user.username": "test", "com.coder.workspace.name": "test"}},
            "spec": {"nodeName": "a", "containers": [
                {"name": "dev", "resources": {"requests": {"cpu": "4", "memory": "2Gi"}}},
                {"name": "browser", "resources": {"requests": {"cpu": "500m", "memory": "512Mi"}}}]}}
        snapshot = {"podsAvailable": True, "nodes": [node("a", 16, 6), node("b", 4, 12)], "pods": [pod]}
        choices = capacity.available(snapshot, "neko", None, ui.quantity, "coder")
        self.assertEqual(choices[0]["memory"], 3)
        self.assertIsNotNone(capacity.check_size({"cpu": "8", "memory": "8"}, choices))
        self.assertIsNone(capacity.check_size({"cpu": "8", "memory": "2"}, choices))
        own = capacity.available(snapshot, "neko", "ws", ui.quantity, "coder", "a")
        self.assertEqual(len(own), 1)
        self.assertEqual(own[0]["memory"], 5.5)
        self.assertIsNone(capacity.check_size({"cpu": "4", "memory": "2"}, own))
        snapshot["nodes"][0]["spec"]["unschedulable"] = True
        self.assertEqual(capacity.available(snapshot, "neko", "ws", ui.quantity, "coder", "a"), [])

    def test_sidecar_init_and_overhead(self):
        spec = {"containers": [{"name": "dev", "resources": {"requests": {"cpu": "2"}}}],
                "initContainers": [{"restartPolicy": "Always", "resources": {"requests": {"cpu": "1"}}},
                                   {"resources": {"requests": {"cpu": "4"}}}], "overhead": {"cpu": "500m"}}
        self.assertEqual(capacity.pod_request(spec, "cpu", ui.quantity), 5.5)

    def test_local_disk(self):
        self.assertIn("storage", capacity.check_size({"home_disk_size": "5"}, [{"cpu": 1, "memory": 1, "gpus": 0, "disk": 4}]))
