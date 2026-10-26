"""Persistent global quota additions and existing quota integration behavior."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import uuid
from unittest import mock

SRC = os.path.normpath(os.path.join(os.path.dirname(__file__),
                                    "../../../helm-chart/coder-airgapped/files/ui-updates"))
sys.path.insert(0, SRC)
import quotaextras as extras

spec = importlib.util.spec_from_file_location("quota_ui", os.path.join(SRC, "ui-service.py"))
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


class QuotaExtrasTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patch = mock.patch.object(extras, "FILE", os.path.join(self.directory.name, "extras.json"))
        patch.start()
        self.addCleanup(patch.stop)
        self.uid, self.admin_id, self.org, self.other_org, self.rid = [str(uuid.uuid4()) for _ in range(5)]
        self.user = {"id": self.uid, "username": "developer", "roles": []}
        self.admin = {"id": self.admin_id, "username": "admin", "roles": ["owner"]}
        def send(token, method, path, body=None):
            if path == "/api/v2/authcheck":
                return 200, {key: token != "read-only" for key in body["checks"]}
            return 200, {"id": self.uid, "status": "active", "username": "developer"}
        extras.setup(mock.Mock(side_effect=send), mock.Mock())
        self.body = {"request_id": self.rid, "resources": {"workspaces": 1, "cpu": 2, "memory": 4},
                     "reason": "Temporary development project requires additional capacity."}

    def create(self, body=None, org=None, user=None):
        return extras.create("session", user or self.user, org or self.org, body or self.body)

    def approve(self, rid=None, org=None):
        return extras.review("session", self.admin, org or self.org, rid or self.rid, "approve", {})

    def test_request_approval_global_totals_and_revocation(self):
        pending = self.create()
        self.assertEqual(pending["status"], "pending")
        self.assertEqual(extras.totals(), {})
        approved = self.approve()
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(extras.totals()[self.uid], {"bonus": self.body["resources"], "activeGrantCount": 1})
        extras.review("session", self.admin, self.org, self.rid, "revoke", {"reason": "Project completed"})
        self.assertEqual(extras.totals(), {})
        with self.assertRaises(extras.Conflict):
            self.approve()

    def test_multiple_organizations_sum_by_uuid_not_username(self):
        self.create()
        self.approve()
        rid = str(uuid.uuid4())
        self.create({**self.body, "request_id": rid}, org=self.other_org)
        self.approve(rid=rid, org=self.other_org)
        effective = extras.limits({"workspaces": 3, "cpu": 8, "memory": 16}, self.uid)
        self.assertEqual(effective["limits"], {"workspaces": 5, "cpu": 12, "memory": 24})
        self.assertEqual(effective["baseLimits"], {"workspaces": 3, "cpu": 8, "memory": 16})
        self.assertEqual(effective["bonusScope"], "global")
        self.assertEqual(effective["activeGrantCount"], 2)
        self.assertEqual(extras.limits({"workspaces": 1, "cpu": 2, "memory": 4}, "someone-else")["bonus"],
                         dict.fromkeys(extras.KEYS, 0))

    def test_unlimited_stays_unlimited_and_bonus_remains_separate(self):
        self.create()
        self.approve()
        base = {"workspaces": None, "cpu": 8, "memory": None}
        result = extras.limits(base, self.uid)
        self.assertEqual(result["limits"], {"workspaces": None, "cpu": 10, "memory": None})
        self.assertEqual(result["bonus"], self.body["resources"])

    def test_request_and_approval_are_idempotent_under_concurrency(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual({r["id"] for r in pool.map(lambda _: self.create(), range(8))}, {self.rid})
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual({r["status"] for r in pool.map(lambda _: self.approve(), range(8))}, {"approved"})
        self.assertEqual(extras.totals()[self.uid]["activeGrantCount"], 1)
        with self.assertRaises(extras.Conflict):
            self.create({**self.body, "resources": {"cpu": 9}})

    def test_organization_admin_and_readonly_owner_cannot_approve_or_revoke(self):
        self.create()
        for user in (self.user, {**self.admin, "roles": ["organization-admin"]}):
            with self.assertRaises(PermissionError):
                extras.review("session", user, self.org, self.rid, "approve", {})
        with self.assertRaises(PermissionError):
            extras.review("read-only", self.admin, self.org, self.rid, "approve", {})
        self.assertEqual(extras.totals(), {})

    def test_review_rejects_cross_organization_and_inactive_target(self):
        self.create()
        with self.assertRaises(LookupError):
            self.approve(org=self.other_org)
        original = extras.SEND.side_effect
        extras.SEND.side_effect = lambda token, method, path, body=None: (
            (200, {"status": "suspended"}) if path.startswith("/api/v2/users/")
            else original(token, method, path, body))
        with self.assertRaises(ValueError):
            self.approve()

    def test_invalid_numbers_and_reasons_are_rejected(self):
        for value in (True, -1, float("nan"), float("inf"), 1000001, "2"):
            with self.assertRaises(ValueError):
                self.create({**self.body, "resources": {"cpu": value}})
        for amount in ({}, {"cpu": 0}, {"workspaces": 1.5}, {"gpu": 1}):
            with self.assertRaises(ValueError):
                self.create({**self.body, "resources": amount})
        for reason in ("", " " * 10, "x" * 2001, None):
            with self.assertRaises(ValueError):
                self.create({**self.body, "reason": reason})

    def test_listing_ownership_and_scoped_admin_read(self):
        self.create()
        self.assertEqual(len(extras.listing("session", self.user, mine=True)), 1)
        stranger = {"id": str(uuid.uuid4()), "roles": []}
        self.assertEqual(extras.listing("session", stranger, oid=self.org), [])
        with self.assertRaises(PermissionError):
            extras.listing("session", stranger)
        extras.SEND.side_effect = lambda *args: (403, {})
        self.assertEqual(extras.listing("restricted", self.admin), [])

    def test_denial_never_adds_capacity_and_request_bounds_are_enforced(self):
        self.create()
        extras.review("session", self.admin, self.org, self.rid, "deny", {})
        self.assertEqual(extras.totals(), {})
        with self.assertRaises(extras.Conflict):
            self.approve()
        for _ in range(20):
            self.create({**self.body, "request_id": str(uuid.uuid4())})
        with self.assertRaises(extras.Conflict):
            self.create({**self.body, "request_id": str(uuid.uuid4())})

    def test_private_persistence_contains_no_session_token(self):
        self.create()
        self.assertEqual(os.stat(extras.FILE).st_mode & 0o777, 0o600)
        with open(extras.FILE) as source:
            self.assertNotIn("session", source.read())
        self.assertEqual(extras.totals(), {})
        self.approve()
        self.assertEqual(extras.totals()[self.uid]["bonus"]["cpu"], 2)

    def test_csrf_rejection_happens_before_request_authentication(self):
        handler = mock.Mock()
        handler.csrf_ok.return_value = False
        extras.handle(handler, "POST", extras.BASE + "/organizations/" + self.org + "/quota-requests")
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        handler.user.assert_not_called()

    def test_quota_me_preserves_baseline_usage_and_applies_approved_addition(self):
        self.create()
        self.approve()
        settings = {"default": {"workspaces": 2, "cpu": 4, "memory": 8}, "users": {"developer": {"cpu": 6}}}
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)), \
             mock.patch.object(ui, "quota_workspaces", return_value=[{"cpu": 2, "memory": 4}]):
            result = ui.quota_me("session", self.user)
        self.assertEqual(result["baseLimits"], {"workspaces": 2, "cpu": 6, "memory": 8})
        self.assertEqual(result["limits"], {"workspaces": 3, "cpu": 8, "memory": 12})
        self.assertEqual(result["usage"], {"workspaces": 1, "cpu": 2, "memory": 4})
        self.assertEqual(result["left"], {"workspaces": 2, "cpu": 6, "memory": 8})

    def test_quota_check_uses_addition_then_revoke_refuses_same_request(self):
        self.create()
        self.approve()
        settings = {"default": {"workspaces": 1, "cpu": 4, "memory": 8}}
        body = {"owner": "me", "rich_parameter_values": [{"name": "cpu", "value": "2"},
                                                          {"name": "memory", "value": "4"}]}
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)), \
             mock.patch.object(ui, "quota_workspaces", return_value=[{"id": "existing", "cpu": 4, "memory": 8,
                  "ownerId": self.uid, "organizationId": self.org}]):
            self.assertTrue(ui.quota_check("session", self.user, body)["allowed"])
            extras.review("session", self.admin, self.org, self.rid, "revoke", {})
            self.assertFalse(ui.quota_check("session", self.user, body)["allowed"])
            replacement = ui.quota_check("session", self.user, {**body, "current_workspace_id": "existing"})
            self.assertTrue(replacement["allowed"])

    def test_quota_replacement_validates_owner_and_organization_context(self):
        settings = {"default": {"workspaces": 1, "cpu": 4, "memory": 8}}
        workspace = {"id": "existing", "cpu": 4, "memory": 8, "ownerId": self.uid, "organizationId": self.org}
        body = {"owner": "me", "owner_id": self.uid, "organization_id": self.org,
                "current_workspace_id": "existing"}
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)),              mock.patch.object(ui, "quota_workspaces", return_value=[workspace]):
            self.assertTrue(ui.quota_check("session", self.user, body)["allowed"])
            for mismatch in ({"owner_id": str(uuid.uuid4())}, {"organization_id": self.other_org},
                             {"current_workspace_id": "another-users-workspace"}):
                self.assertFalse(ui.quota_check("session", self.user, {**body, **mismatch})["allowed"])

    def test_quota_report_keeps_allocated_running_and_live_usage(self):
        self.create()
        self.approve()
        settings = {"default": {"workspaces": 3, "cpu": 6, "memory": 12}}
        workspaces = [{"id": "a", "owner": "developer", "cpu": 4, "memory": 8, "running": True},
                      {"id": "b", "owner": "developer", "cpu": 2, "memory": 4, "running": False}]
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)),              mock.patch.object(ui, "_coder_get", return_value=(200, {"users": [
                 {"id": self.uid, "username": "developer", "roles": []}]})),              mock.patch.object(ui, "quota_workspaces", return_value=workspaces),              mock.patch.object(ui, "_pod_usage_by_owner", return_value={"developer": {"cpu": 0.5, "memory": 1.25}}),              mock.patch.object(ui, "cluster_usage", side_effect=RuntimeError("metrics unavailable")):
            user = ui.quota_report("session")["users"][0]
        self.assertEqual(user["baseLimits"], {"workspaces": 3, "cpu": 6, "memory": 12})
        self.assertEqual(user["limits"], {"workspaces": 4, "cpu": 8, "memory": 16})
        self.assertEqual(user["usage"], {"workspaces": 2, "cpu": 6, "memory": 12,
            "runningCpu": 4, "runningMemory": 8, "running": 1, "liveCpu": 0.5, "liveMemory": 1.25})
        self.assertEqual(user["workspaces"], workspaces)

    def test_invalid_nonfinite_request_is_refused_not_service_unavailable(self):
        settings = {"default": {"cpu": 4}}
        with mock.patch.object(ui, "STORE", mock.Mock(get_setting=lambda *args: settings)):
            for value in ("NaN", "Infinity", "1e999"):
                result = ui.quota_check("session", self.user,
                    {"rich_parameter_values": [{"name": "cpu", "value": value}]})
                self.assertFalse(result["allowed"])
        for value in (True, "NaN", "Infinity", "1e999"):
            with self.assertRaises(ValueError):
                ui._quota_number(value, "CPU")

    def test_workspace_usage_paginates_and_preserves_organization_context(self):
        rows = [{"id": str(i), "name": "w" + str(i), "organization_id": self.org,
                 "latest_build": {}} for i in range(501)]
        responses = [(200, {"workspaces": rows[:500], "count": 501}),
                     (200, {"workspaces": rows[500:], "count": 501})]
        with mock.patch.object(ui, "_coder_get", side_effect=responses) as get:
            result = ui.quota_workspaces("session")
        self.assertEqual(len(result), 501)
        self.assertEqual(result[-1]["organizationId"], self.org)
        self.assertIn("offset=500", get.call_args_list[1].args[1])


if __name__ == "__main__":
    unittest.main()
