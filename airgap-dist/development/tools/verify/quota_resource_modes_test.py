"""CPU and memory quota policy modes use the authoritative request check."""
import unittest
from unittest import mock
from platform_unit_test import ui


class QuotaResourceModesTest(unittest.TestCase):
    def check(self, modes, cpu=3, memory=3, count=None, current=None):
        settings = {"default": {"workspaces": count, "cpu": 4, "memory": 8},
                    "resourceModes": modes, "exemptAdmins": False}
        rows = [{"id": wid, "ownerId": "u", "organizationId": "o", "cpu": 3, "memory": 4}
                for wid in ("w1", "w2")]
        body = {"owner": "me", "owner_id": "u", "organization_id": "o",
                "rich_parameter_values": [{"name": "cpu", "value": str(cpu)},
                                          {"name": "memory", "value": str(memory)}]}
        if current:
            body["current_workspace_id"] = current
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)), \
             mock.patch.object(ui, "quota_workspaces", return_value=rows), \
             mock.patch.object(ui.quotaextras, "limits", side_effect=lambda limits, *_: {"limits": limits}):
            return ui.quota_check("session", {"id": "u", "username": "developer", "roles": []}, body)

    def test_existing_defaults_remain_cumulative(self):
        self.assertEqual(ui.clean_quota({})["resourceModes"], {"cpu": "cumulative", "memory": "cumulative"})
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

    def test_invalid_modes_are_rejected(self):
        for modes in ({"cpu": "unlimited"}, {"workspaces": "instance"}, [], "instance"):
            with self.subTest(modes=modes), self.assertRaises(ValueError):
                ui.clean_quota({"resourceModes": modes})

    def test_usage_compares_largest_instance_and_cumulative_memory(self):
        rows = [{"cpu": 2, "memory": 4}, {"cpu": 3, "memory": 8}]
        self.assertEqual(ui.quota_usage(rows, {"cpu": "instance", "memory": "cumulative"}),
                         {"workspaces": 2, "cpu": 3, "memory": 12})


if __name__ == "__main__":
    unittest.main()
