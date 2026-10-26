"""Workspace power authorization, lifecycle, and Kubernetes fencing invariants."""
import copy
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
import workspacepower as power


class WorkspacePowerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patch = mock.patch.object(power, "FILE", os.path.join(self.directory.name, "power.json"))
        patch.start()
        self.addCleanup(patch.stop)
        self.org, self.wid, self.build, self.version = [str(uuid.uuid4()) for _ in range(4)]
        self.ws = {"id": self.wid, "name": "fixture", "owner_name": "admin", "owner_id": "owner",
                   "organization_id": self.org, "latest_build": {"id": self.build, "status": "running",
                   "transition": "start", "template_version_id": self.version}}
        self.user = {"id": "owner", "roles": ["owner"]}
        power.setup(mock.Mock(return_value=(200, {self.wid: True})), lambda token, wid: self.ws,
                    mock.Mock(), "http://coder", {"owner"}, mock.Mock())
        power.KUBE.call.return_value = (404, {})

    def operation(self, action="shutdown"):
        with mock.patch.object(power.threading, "Thread"):
            response = power.start("private-session-token", self.user, self.org,
                                   {"action": action, "workspace_ids": [self.wid], "confirmation": action})
        return power.read_operation(self.org, response["id"])

    def execute(self, operation, builds, force=None):
        builds = iter(builds)
        requests = []
        def coder(token, method, path, body=None):
            requests.append((method, path, body))
            if method == "GET" and path == "/workspaces/" + self.wid:
                return {**self.ws, "latest_build": next(builds)}
            if path.endswith("/parameters"):
                return [{"name": "disk", "value": "12"}]
            if method == "POST" and path.endswith("/builds"):
                return {"id": "stop-build"}
            if method == "PATCH" and "/cancel" in path:
                return None
            raise AssertionError((method, path))
        with mock.patch.object(power, "coder", side_effect=coder), mock.patch.object(power, "permissions"), \
             mock.patch.object(power.time, "sleep"), mock.patch.object(power, "force_runtime", side_effect=force):
            power.stop_one("session", operation, operation["workspaces"][0])
        return power.read_operation(self.org, operation["id"])["workspaces"][0], requests

    def build_state(self, status, transition="start", build_id=None):
        return {**self.ws["latest_build"], "id": build_id or self.build, "status": status, "transition": transition}

    def test_shutdown_preserves_workspace_parameters_and_only_creates_stop_build(self):
        operation = self.operation()
        result, calls = self.execute(operation, [self.build_state("running"),
                                                self.build_state("stopped", "stop", "stop-build")])
        self.assertEqual(result["status"], "stopped")
        self.assertIsNone(result["physical_verified"])
        posted = [body for method, path, body in calls if method == "POST"]
        self.assertEqual(posted, [{"transition": "stop", "template_version_id": self.version,
                                  "rich_parameter_values": [{"name": "disk", "value": "12"}]}])
        self.assertFalse(any(method == "DELETE" for method, _, _ in calls))

    def test_pending_start_is_canceled_before_stop_and_not_duplicated(self):
        operation = self.operation()
        result, calls = self.execute(operation, [self.build_state("pending"), self.build_state("canceling"),
            self.build_state("canceled"), self.build_state("stopped", "stop", "stop-build")])
        self.assertEqual(result["status"], "stopped")
        canceled = [path for method, path, body in calls if method == "PATCH"]
        self.assertEqual(canceled, ["/workspacebuilds/%s/cancel?expect_status=pending" % self.build])

    def test_force_reports_api_removal_without_claiming_physical_proof(self):
        operation = self.operation("terminate")
        result, _ = self.execute(operation, [self.build_state("running"),
            self.build_state("stopped", "stop", "stop-build")], force=[(True, True), (True, True)])
        self.assertEqual(result["status"], "stopped")
        self.assertTrue(result["force_requested"])
        self.assertTrue(result["runtime_objects_removed"])
        self.assertFalse(result["physical_verified"])

    def test_unreachable_node_remains_unverified_after_objects_disappear(self):
        operation = self.operation("terminate")
        result, _ = self.execute(operation, [self.build_state("running"),
            self.build_state("stopped", "stop", "stop-build")], force=[(True, False), (True, True)])
        self.assertEqual(result["status"], "error")
        self.assertFalse(result["physical_verified"])
        self.assertIn("unverified", result["error"])

    def test_removed_runtime_is_expected_while_coder_stop_finishes(self):
        operation = self.operation("terminate")
        result, _ = self.execute(operation, [self.build_state("running"),
            self.build_state("stopping", "stop", "stop-build"), self.build_state("stopped", "stop", "stop-build")],
            force=[(True, True), None, None])
        self.assertEqual(result["status"], "stopped")
        self.assertTrue(result["runtime_objects_removed"])
        self.assertFalse(result["physical_verified"])

    def test_unreachable_node_is_not_forgotten_when_runtime_objects_are_gone(self):
        operation = self.operation("terminate")
        result, _ = self.execute(operation, [self.build_state("running"),
            self.build_state("stopped", "stop", "stop-build")], force=[(True, False), None])
        self.assertEqual(result["status"], "error")
        self.assertFalse(result["physical_verified"])

    def test_unsupported_runtime_does_not_silently_fall_back_to_graceful(self):
        operation = self.operation("terminate")
        result, calls = self.execute(operation, [self.build_state("running")], force=[None])
        self.assertEqual(result["status"], "unsupported")
        self.assertFalse(any(method == "POST" for method, _, _ in calls))

    def test_external_new_build_is_preserved(self):
        operation = self.operation("terminate")
        result, calls = self.execute(operation, [self.build_state("starting", build_id="external-new-build")])
        self.assertEqual(result["status"], "error")
        self.assertEqual(len(calls), 1)
        self.assertFalse(result["force_requested"])

    def test_existing_stop_is_adopted_without_another_build(self):
        self.ws["latest_build"] = self.build_state("stopping", "stop")
        operation = self.operation()
        result, calls = self.execute(operation, [self.build_state("stopping", "stop"),
                                                self.build_state("stopped", "stop")])
        self.assertEqual(result["status"], "stopped")
        self.assertFalse(any(method in ("POST", "PATCH") for method, _, _ in calls))

    def test_stopped_workspace_is_skipped(self):
        operation = self.operation()
        result, calls = self.execute(operation, [self.build_state("stopped", "stop")])
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(len(calls), 1)

    def test_confirmation_scope_organization_and_bound_checks_precede_actions(self):
        body = {"action": "shutdown", "workspace_ids": [self.wid], "confirmation": "terminate"}
        with self.assertRaises(ValueError):
            power.start("session", self.user, self.org, body)
        body["confirmation"] = "shutdown"
        with self.assertRaises(LookupError):
            power.start("session", self.user, str(uuid.uuid4()), body)
        power.HTTP_JSON.return_value = (200, {self.wid: False})
        with self.assertRaises(PermissionError):
            power.start("read-only-key", self.user, self.org, body)
        for ids in ([self.wid] * 101, [self.wid, self.wid], []):
            with self.assertRaises(ValueError):
                power.start("session", self.user, self.org, {**body, "workspace_ids": ids})

    def test_operations_are_private_persistent_and_interrupted_after_restart(self):
        operation = self.operation()
        with open(power.FILE) as source:
            text = source.read()
        self.assertNotIn("private-session-token", text)
        self.assertEqual(os.stat(power.FILE).st_mode & 0o777, 0o600)
        with self.assertRaises(power.Conflict):
            self.operation()
        power.setup(power.HTTP_JSON, power.WORKSPACE_INFO, power.KUBE, power.CODER_URL,
                    power.ADMIN_ROLES, power.LOG)
        recovered = power.read_operation(self.org, operation["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(recovered["workspaces"][0]["status"], "error")

    def handler(self, body=None):
        handler = mock.Mock()
        payload = json.dumps(body or {}).encode()
        handler.headers = {"Content-Length": str(len(payload))}
        handler.rfile = io.BytesIO(payload)
        handler.csrf_ok.return_value = True
        handler.user.return_value = (self.user, None)
        handler.token.return_value = "session"
        return handler

    def test_post_rejects_csrf_before_authentication_or_changes(self):
        handler = self.handler()
        handler.csrf_ok.return_value = False
        self.assertTrue(power.handle(handler, "POST", power.BASE + "/organizations/" + self.org + "/workspace-power"))
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        handler.user.assert_not_called()

    def test_nonadmin_handler_cannot_start_operation(self):
        handler = self.handler()
        handler.user.return_value = (None, True)
        with mock.patch.object(power, "start") as start:
            power.handle(handler, "POST", power.BASE + "/organizations/" + self.org + "/workspace-power")
            start.assert_not_called()
        handler.user.assert_called_once_with(admin=True)

    def test_get_operation_rejects_scoped_admin_without_workspace_read(self):
        operation = self.operation()
        handler = self.handler()
        power.HTTP_JSON.return_value = (200, {self.wid: False})
        power.handle(handler, "GET", power.BASE + "/organizations/" + self.org +
                     "/workspace-power/operation/" + operation["id"])
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        self.assertNotIn("fixture", str(handler.send_json.call_args.args[1]))

    def test_get_operation_checks_workspace_visibility_and_history_omits_inaccessible(self):
        operation = self.operation()
        handler = self.handler()
        with mock.patch.object(power, "WORKSPACE_INFO", return_value=None):
            power.handle(handler, "GET", power.BASE + "/organizations/" + self.org +
                         "/workspace-power/operation/" + operation["id"])
            self.assertEqual(handler.send_json.call_args.args[0], 403)
            power.handle(handler, "GET", power.BASE + "/organizations/" + self.org + "/workspace-power")
            self.assertEqual(handler.send_json.call_args.args, (200, {"operations": []}))

    def test_get_operation_cannot_cross_organization(self):
        operation = self.operation()
        handler = self.handler()
        power.handle(handler, "GET", power.BASE + "/organizations/" + str(uuid.uuid4()) +
                     "/workspace-power/operation/" + operation["id"])
        self.assertEqual(handler.send_json.call_args.args[0], 404)

    def vm_fixture(self, owner=True, organization=None):
        vm = {"metadata": {"uid": "vm-uid", "resourceVersion": "1", "labels": {
            "com.coder.workspace.id": self.wid, "com.coder.organization.id": organization or self.org}},
            "spec": {"runStrategy": "Always"}}
        instance = {"metadata": {"uid": "instance-uid", "resourceVersion": "2", "ownerReferences": [
            {"kind": "VirtualMachine", "controller": True, "uid": "vm-uid" if owner else "other"}]},
            "status": {"nodeName": "node"}}
        live = [instance]
        calls = []
        def call(method, path, body=None, patch_type=None):
            calls.append((method, path, body))
            if method == "GET" and "/virtualmachines/" in path:
                return 200, copy.deepcopy(vm)
            if method == "GET" and "/virtualmachineinstances/" in path:
                return (200, copy.deepcopy(live[0])) if live else (404, {})
            if method == "GET" and "/nodes/" in path:
                return 200, {"status": {"conditions": [{"type": "Ready", "status": "True"}]}}
            if method == "PATCH":
                self.assertEqual(patch_type, "application/json-patch+json")
                expected = "vm-uid" if "/virtualmachines/" in path else "instance-uid"
                self.assertEqual(body[0], {"op": "test", "path": "/metadata/uid", "value": expected})
                if expected == "vm-uid":
                    vm["spec"]["runStrategy"] = "Halted"
                else:
                    self.assertEqual(vm["spec"]["runStrategy"], "Halted")
                    self.assertEqual(body[-1]["value"], 0)
                return 200, {}
            if method == "DELETE":
                self.assertIn("/virtualmachineinstances/", path)
                self.assertEqual(vm["spec"]["runStrategy"], "Halted")
                self.assertEqual(body["preconditions"], {"uid": "instance-uid"})
                live.clear()
                return 200, {}
            raise AssertionError((method, path))
        power.KUBE.call.side_effect = call
        return vm, calls

    def test_graceful_vm_shutdown_waits_for_halted_and_instance_removal(self):
        operation = self.operation()
        with mock.patch.object(power, "vm_stopped", side_effect=[False, True]) as stopped:
            result, _ = self.execute(operation, [self.build_state("running"),
                self.build_state("stopped", "stop", "stop-build"),
                self.build_state("stopped", "stop", "stop-build")])
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(stopped.call_count, 2)

    def test_vm_force_fences_then_removes_only_instance_preserving_vm_and_storage(self):
        vm, calls = self.vm_fixture()
        self.assertEqual(power.force_runtime(self.wid, self.org), (True, True))
        self.assertEqual(vm["spec"]["runStrategy"], "Halted")
        self.assertEqual(len([c for c in calls if c[0] == "DELETE"]), 1)
        self.assertFalse(any("persistentvolume" in path or "/pods/" in path for _, path, _ in calls))

    def test_vm_force_refuses_foreign_instance_or_organization_before_mutating(self):
        for owner, org in ((False, self.org), (True, str(uuid.uuid4()))):
            _, calls = self.vm_fixture(owner, org)
            with self.assertRaises(power.Unsupported):
                power.force_runtime(self.wid, self.org)
            self.assertTrue(all(method == "GET" for method, _, _ in calls))

    def test_vm_force_refuses_replacement_uid_conflict(self):
        self.vm_fixture()
        original = power.KUBE.call.side_effect
        def call(method, path, *args):
            if method == "PATCH":
                return 409, {}
            return original(method, path, *args)
        power.KUBE.call.side_effect = call
        with self.assertRaises(RuntimeError):
            power.force_runtime(self.wid, self.org)
        self.assertFalse(any(c.args[0] == "DELETE" for c in power.KUBE.call.call_args_list))

    def kube_fixture(self, controller="ReplicaSet", ready=True):
        deployment = {"metadata": {"uid": "deployment-uid", "name": "fixture", "resourceVersion": "1"},
                      "spec": {"replicas": 1}}
        pod = {"metadata": {"uid": "pod-uid", "name": "fixture-pod", "ownerReferences": [
            {"kind": controller, "name": "fixture-rs", "uid": "rs-uid", "controller": True}]},
            "spec": {"nodeName": "node"}}
        replica = {"metadata": {"uid": "rs-uid", "ownerReferences": [
            {"kind": "Deployment", "uid": "deployment-uid", "controller": True}]}}
        pods = [pod]
        def call(method, path, body=None, patch_type=None):
            if method == "GET" and "/virtualmachines/" in path:
                return 404, {}
            if method == "GET" and "/deployments?" in path:
                self.assertIn(self.wid, path)
                return 200, {"items": [copy.deepcopy(deployment)]}
            if method == "GET" and "/pods?" in path:
                return 200, {"items": copy.deepcopy(pods)}
            if method == "GET" and "/replicasets/" in path:
                return 200, replica
            if method == "GET" and "/nodes/" in path:
                return 200, {"status": {"conditions": [{"type": "Ready", "status": "True" if ready else "Unknown"}]}}
            if method == "PATCH":
                self.assertEqual(patch_type, "application/json-patch+json")
                self.assertEqual(body[:2], [{"op": "test", "path": "/metadata/uid", "value": "deployment-uid"},
                                          {"op": "test", "path": "/metadata/resourceVersion", "value": "1"}])
                deployment["spec"]["replicas"] = 0
                return 200, deployment
            if method == "DELETE":
                self.assertIn("/pods/", path)
                self.assertEqual(deployment["spec"]["replicas"], 0)
                self.assertEqual(body["preconditions"], {"uid": "pod-uid"})
                self.assertEqual(body["gracePeriodSeconds"], 0)
                pods.clear()
                return 200, {}
            raise AssertionError((method, path))
        power.KUBE.call.side_effect = call
        return deployment, pods

    def test_force_scales_before_uid_guarded_pod_delete_and_never_touches_storage(self):
        self.kube_fixture()
        self.assertEqual(power.force_runtime(self.wid), (True, True))
        self.assertFalse(any("persistentvolume" in call.args[1] for call in power.KUBE.call.call_args_list))

    def test_force_rejects_unknown_controller_before_any_mutation(self):
        self.kube_fixture(controller="Job")
        with self.assertRaises(power.Unsupported):
            power.force_runtime(self.wid)
        self.assertTrue(all(call.args[0] == "GET" for call in power.KUBE.call.call_args_list))

    def test_force_rejects_recreated_deployment_precondition_failure(self):
        self.kube_fixture()
        original = power.KUBE.call.side_effect
        power.KUBE.call.side_effect = lambda method, *args: (409, {}) if method == "PATCH" else original(method, *args)
        with self.assertRaises(RuntimeError):
            power.force_runtime(self.wid)
        self.assertFalse(any(call.args[0] == "DELETE" for call in power.KUBE.call.call_args_list))

    def test_force_records_unreachable_node_as_unverified(self):
        self.kube_fixture(ready=False)
        self.assertEqual(power.force_runtime(self.wid), (True, False))

    def test_public_operation_excludes_internal_snapshot_fields(self):
        operation = self.operation()
        result = power.public(operation)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["completed"], 0)
        self.assertNotIn("captured_build_id", result["workspaces"][0])
        self.assertNotIn("owner_id", result["workspaces"][0])


if __name__ == "__main__":
    unittest.main()
