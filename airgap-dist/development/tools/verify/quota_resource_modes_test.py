"""CPU and memory quota policy modes use the authoritative request check."""
import unittest
from unittest import mock
from platform_unit_test import ui


class QuotaResourceModesTest(unittest.TestCase):
    def check(self, modes, cpu=3, memory=3, count=None, current=None, disk=10, disk_limit=None):
        settings = {"default": {"workspaces": count, "cpu": 4, "memory": 8, "disk": disk_limit},
                    "resourceModes": modes, "exemptAdmins": False}
        rows = [{"id": wid, "ownerId": "u", "organizationId": "o", "cpu": 3, "memory": 4, "disk": 10}
                for wid in ("w1", "w2")]
        body = {"owner": "me", "owner_id": "u", "organization_id": "o",
                "rich_parameter_values": [{"name": "cpu", "value": str(cpu)},
                                          {"name": "memory", "value": str(memory)}, {"name": "home_disk_size", "value": str(disk)}]}
        if current:
            body["current_workspace_id"] = current
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)), \
             mock.patch.object(ui, "quota_workspaces", return_value=rows), \
             mock.patch.object(ui.quotaextras, "limits", side_effect=lambda limits, *_: {"limits": limits}):
            return ui.quota_check("session", {"id": "u", "username": "developer", "roles": []}, body)

    def test_existing_defaults_remain_cumulative(self):
        self.assertEqual(ui.clean_quota({})["resourceModes"], {"cpu": "cumulative", "memory": "cumulative", "disk": "cumulative"})
        self.assertFalse(self.check({})["allowed"])

    def test_multiple_individually_valid_workspaces_are_allowed(self):
        modes = {"cpu": "instance", "memory": "instance"}
        self.assertTrue(self.check(modes)["allowed"])
        self.assertFalse(self.check(modes, cpu=5)["allowed"])
        self.assertFalse(self.check(modes, memory=9)["allowed"])

    def test_cpu_and_memory_modes_are_independent(self):
        self.assertFalse(self.check({"cpu": "instance", "memory": "cumulative"})["allowed"])
        self.assertFalse(self.check({"cpu": "cumulative", "memory": "instance"})["allowed"])

    def test_workspace_count_and_replacement_identity_stay_enforced(self):
        modes = {"cpu": "instance", "memory": "instance"}
        self.assertFalse(self.check(modes, count=2)["allowed"])
        self.assertTrue(self.check(modes, current="w1")["allowed"])
        self.assertFalse(self.check(modes, cpu=5, current="w1")["allowed"])
        self.assertFalse(self.check(modes, current="someone-elses-workspace")["allowed"])

    def test_disk_cumulative_and_instance_limits(self):
        modes = {"cpu": "instance", "memory": "instance"}
        self.assertFalse(self.check(modes, disk_limit=25)["allowed"])
        self.assertTrue(self.check(modes, disk_limit=30)["allowed"])
        self.assertTrue(self.check({**modes, "disk": "instance"}, disk_limit=10)["allowed"])
        self.assertFalse(self.check({**modes, "disk": "instance"}, disk=11, disk_limit=10)["allowed"])
        self.assertFalse(self.check(modes, current="w1", disk=20, disk_limit=25)["allowed"])
        self.assertTrue(self.check(modes, current="w1", disk=15, disk_limit=25)["allowed"])

    def test_invalid_disk_values_and_old_settings(self):
        self.assertIsNone(ui.clean_quota({})["default"]["disk"])
        for value in (-1, float("nan"), "invalid"):
            with self.assertRaises(ValueError):
                ui.clean_quota({"default": {"disk": value}})

    def test_stopped_workspace_uses_expanded_pvc_allocation(self):
        ws = {"id": "w1", "owner_name": "developer", "latest_build": {"id": "b1", "status": "stopped"}}
        pvc = {"metadata": {"name": "coder-w1-home"}, "spec": {"resources": {"requests": {"storage": "30G"}}}, "status": {"capacity": {"storage": "20G"}}}
        with mock.patch.object(ui, "_coder_get", side_effect=[(200, {"workspaces": [ws], "count": 1}), (200, [{"name": "home_disk_size", "value": "10"}])]), mock.patch.object(ui.CACHE, "get", return_value=None), mock.patch.object(ui.KUBE, "call", return_value=(200, {"items": [pvc]})):
            rows = ui.quota_workspaces("session")
        self.assertEqual(rows[0]["disk"], 30)
        self.assertFalse(rows[0]["running"])

    def test_storage_lookup_failure_does_not_undercount_disk(self):
        with mock.patch.object(ui, "_coder_get", return_value=(200, {"workspaces": [], "count": 0})), mock.patch.object(ui.KUBE, "call", return_value=(503, {})):
            with self.assertRaises(RuntimeError):
                ui.quota_workspaces("session")

    def test_invalid_modes_are_rejected(self):
        for modes in ({"cpu": "unlimited"}, {"workspaces": "instance"}, [], "instance"):
            with self.subTest(modes=modes), self.assertRaises(ValueError):
                ui.clean_quota({"resourceModes": modes})

    def test_usage_compares_largest_instance_and_cumulative_memory(self):
        rows = [{"cpu": 2, "memory": 4}, {"cpu": 3, "memory": 8}]
        self.assertEqual(ui.quota_usage(rows, {"cpu": "instance", "memory": "cumulative"}),
                         {"workspaces": 2, "cpu": 3, "memory": 12, "disk": 0})


if __name__ == "__main__":
    unittest.main()
