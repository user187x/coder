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


class QuotaExcludedUsersTest(unittest.TestCase):
    account_id = "11111111-1111-4111-8111-111111111111"
    other_id = "22222222-2222-4222-8222-222222222222"

    def settings(self, excluded=None):
        return ui.clean_quota({"default": {key: 0 for key in ui.QUOTA_KEYS}, "exemptAdmins": False,
                               "excludedUsers": [self.account_id] if excluded is None else excluded})

    def test_settings_round_trip_and_old_settings(self):
        self.assertEqual(ui.clean_quota({})["excludedUsers"], [])
        settings = self.settings([self.account_id, self.account_id.upper(), self.other_id])
        self.assertEqual(settings["excludedUsers"], [self.account_id, self.other_id])
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)):
            self.assertEqual(ui.quota_settings(), settings)
        for invalid in (None, "username", ["username"], [True], [{}], [self.account_id] * 5001):
            with self.subTest(invalid=type(invalid).__name__), self.assertRaises(ValueError):
                ui.clean_quota({"excludedUsers": invalid})

    def test_exclusion_follows_identity_and_removal_restores_enforcement(self):
        for excluded, allowed in (([self.account_id], True), ([], False)):
            with mock.patch.object(ui, "quota_settings", return_value=self.settings(excluded)), \
                 mock.patch.object(ui, "quota_workspaces", return_value=[]), \
                 mock.patch.object(ui.quotaextras, "limits", side_effect=lambda limits, *_: {"limits": limits}):
                for name in ("original-name", "renamed-account"):
                    result = ui.quota_check("session", {"id": self.account_id, "username": name, "roles": []},
                                            {"owner": "me", "owner_id": self.account_id})
                    self.assertEqual(result["allowed"], allowed)

    def test_excluded_requester_does_not_exempt_other_owner(self):
        with mock.patch.object(ui, "quota_settings", return_value=self.settings()), \
             mock.patch.object(ui, "quota_workspaces", return_value=[]), \
             mock.patch.object(ui, "_coder_get", return_value=(200, {"id": self.other_id, "username": "other", "roles": []})), \
             mock.patch.object(ui.quotaextras, "limits", side_effect=lambda limits, *_: {"limits": limits}):
            caller = {"id": self.account_id, "username": "excluded", "roles": []}
            self.assertFalse(ui.quota_check("session", caller, {"owner": "other", "owner_id": self.other_id})["allowed"])
            self.assertFalse(ui.quota_check("session", caller, {"owner": "me", "owner_id": self.other_id})["allowed"])

    def test_admin_toggle_and_user_exclusion_are_independent(self):
        settings = self.settings()
        self.assertTrue(ui.quota_exempt(settings, self.account_id, False))
        self.assertFalse(ui.quota_exempt(settings, self.other_id, True))
        settings["exemptAdmins"] = True
        self.assertTrue(ui.quota_exempt(settings, self.other_id, True))
        self.assertFalse(ui.quota_exempt(settings, self.other_id, False))

    def test_report_and_personal_quota_recognize_exclusion(self):
        with mock.patch.object(ui, "quota_settings", return_value=self.settings()), \
             mock.patch.object(ui, "quota_workspaces", return_value=[]), \
             mock.patch.object(ui, "_coder_get", return_value=(200, {"users": [{"id": self.account_id, "username": "developer", "roles": []}]})), \
             mock.patch.object(ui, "_pod_usage_by_owner", return_value={}), \
             mock.patch.object(ui, "cluster_usage", side_effect=RuntimeError("offline")), \
             mock.patch.object(ui.quotaextras, "totals", return_value={}), \
             mock.patch.object(ui.quotaextras, "limits", side_effect=lambda limits, *_: {"limits": limits}):
            report = ui.quota_report("session")
            self.assertTrue(report["users"][0]["exempt"])
            self.assertFalse(report["users"][0]["atLimit"])
            own = ui.quota_me("session", {"id": self.account_id, "username": "developer", "roles": []})
            self.assertTrue(own["exempt"])
            self.assertFalse(own["limited"])


if __name__ == "__main__":
    unittest.main()
