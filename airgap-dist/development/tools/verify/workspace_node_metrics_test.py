"""Workspace-scoped node selection, aggregate metrics, and unavailable sources."""
import copy
from datetime import datetime, timedelta, timezone
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
import workspacenodemetrics as metrics


class WorkspaceNodeMetricsTest(unittest.TestCase):
    def setUp(self):
        self.org, self.wid = str(uuid.uuid4()), str(uuid.uuid4())
        self.at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.workspace = {"id": self.wid, "name": "fixture", "organization_id": self.org,
                          "latest_build": {"status": "running"}}
        self.snapshot = {"nodes": [self.node("one", "4", "8Gi"), self.node("two", "8", "16Gi")],
            "pods": [self.pod("one")], "usage": {"one": {"cpu": "500m", "memory": "2Gi"},
            "two": {"cpu": "1500m", "memory": "4Gi"}}, "usageTimes": {"one": self.at, "two": self.at}}
        metrics.setup(mock.Mock(return_value=self.workspace), mock.Mock(side_effect=lambda: self.snapshot),
                      self.quantity, mock.Mock(), infrastructure_access=mock.Mock(return_value=(200, {"deployment_stats": True})))
        patch = mock.patch.object(metrics, "summary", side_effect=lambda node: {"fs": {
            "usedBytes": 10 if node["metadata"]["name"] == "one" else 20,
            "capacityBytes": 100 if node["metadata"]["name"] == "one" else 200, "time": self.at}})
        self.summary = patch.start()
        self.addCleanup(patch.stop)
        metrics._CACHE.clear()
        self.vm_patch = mock.patch.object(metrics, "vm_context", return_value=None)
        self.vm_context = self.vm_patch.start()
        self.addCleanup(self.vm_patch.stop)

    @staticmethod
    def quantity(value):
        if value is None:
            return None
        if value.endswith("Gi"):
            return float(value[:-2]) * 1024**3
        if value.endswith("m"):
            return float(value[:-1]) / 1000
        return float(value)

    def node(self, name, cpu, memory, ready=True):
        return {"metadata": {"name": name, "uid": name + "-uid"}, "status": {
            "allocatable": {"cpu": cpu, "memory": memory},
            "conditions": [{"type": "Ready", "status": "True" if ready else "Unknown"}]}}

    def pod(self, node, wid=None):
        return {"metadata": {"labels": {"com.coder.workspace.id": wid or self.wid}},
                "spec": {"nodeName": node}, "status": {"phase": "Running"}}

    def report(self, owner=True):
        return metrics.report("fixture-token", self.org, self.wid, owner=owner)

    def test_actual_workspace_node_is_separate_from_true_cluster_aggregate(self):
        result = self.report()
        self.assertEqual(result["nodeName"], "one")
        self.assertEqual(result["workspaceName"], "fixture")
        self.assertEqual(result["node"]["cpu"]["used"], 0.5)
        self.assertEqual(result["node"]["cpu"]["total"], 4)
        self.assertEqual(result["cluster"]["cpu"]["used"], 2)
        self.assertEqual(result["cluster"]["cpu"]["total"], 12)
        self.assertEqual(result["node"]["memory"]["total"], 8 * 1024**3)
        self.assertEqual(result["cluster"]["memory"]["total"], 24 * 1024**3)
        self.assertEqual(result["node"]["disk"]["used"], 10)
        self.assertEqual(result["cluster"]["disk"]["used"], 30)
        self.assertEqual(result["cluster"]["disk"]["total"], 300)
        self.assertEqual(result["nodeCount"], 2)
        self.assertEqual(result["node"]["cpu"]["collectedAt"], self.at)
        self.assertNotIn('"two"', json.dumps(result))
        self.assertNotIn("pods", result)
        metrics.INFRASTRUCTURE_ACCESS.assert_called_once_with("fixture-token")

    def test_scope_and_organization_are_checked_before_any_cluster_access(self):
        metrics.WORKSPACE_INFO.return_value = None
        with self.assertRaises(LookupError):
            self.report()
        metrics.SNAPSHOT.assert_not_called()
        metrics.WORKSPACE_INFO.return_value = {**self.workspace, "organization_id": str(uuid.uuid4())}
        with self.assertRaises(LookupError):
            self.report()
        metrics.SNAPSHOT.assert_not_called()

    def test_owner_session_workspace_scope_cannot_read_physical_metrics(self):
        metrics.INFRASTRUCTURE_ACCESS.return_value = (200, {"deployment_stats": False})
        with mock.patch.object(metrics, "restricted_allocation", return_value={"cpu": 2, "memory": 2147483648}):
            result = self.report(owner=True)
        self.assertTrue(result["infrastructureRestricted"])
        self.assertEqual(result["allocation"]["cpu"], 2)
        for field in ("nodeName", "node", "cluster", "nodeCount"):
            self.assertIsNone(result[field])
        metrics.INFRASTRUCTURE_ACCESS.assert_called_once_with("fixture-token")
        metrics.SNAPSHOT.assert_not_called()
        self.summary.assert_not_called()

    def test_owner_scope_check_errors_fail_closed_without_snapshot(self):
        for permission in ((403, {}), (503, {}), (200, {"deployment_stats": "true"}), (200, [])):
            with self.subTest(permission=permission), mock.patch.object(metrics, "restricted_allocation", return_value={}):
                metrics.INFRASTRUCTURE_ACCESS.return_value = permission
                self.assertTrue(self.report()["infrastructureRestricted"])
        metrics.INFRASTRUCTURE_ACCESS.side_effect = RuntimeError("authcheck unavailable")
        with mock.patch.object(metrics, "restricted_allocation", return_value={}):
            self.assertTrue(self.report()["infrastructureRestricted"])
        metrics.SNAPSHOT.assert_not_called()
        self.summary.assert_not_called()
        metrics.INFRASTRUCTURE_ACCESS = None
        with mock.patch.object(metrics, "restricted_allocation", return_value={}):
            self.assertTrue(self.report()["infrastructureRestricted"])
        metrics.SNAPSHOT.assert_not_called()

    def test_member_never_checks_deployment_permission_or_snapshot(self):
        with mock.patch.object(metrics, "restricted_allocation", return_value={}):
            self.assertTrue(self.report(owner=False)["infrastructureRestricted"])
        metrics.INFRASTRUCTURE_ACCESS.assert_not_called()
        metrics.SNAPSHOT.assert_not_called()

    def test_other_workspace_or_terminating_pod_never_selects_node(self):
        self.snapshot["pods"] = [self.pod("one", str(uuid.uuid4())), self.pod("two")]
        self.snapshot["pods"][1]["metadata"]["deletionTimestamp"] = self.at
        result = self.report()
        self.assertIsNone(result["nodeName"])
        self.assertIsNone(result["node"]["cpu"]["used"])
        self.assertIn("assigned", result["node"]["cpu"]["error"])
        self.assertEqual(result["cluster"]["cpu"]["used"], 2)

    def test_stopped_and_multi_node_workspaces_do_not_fabricate_a_current_node(self):
        self.workspace["latest_build"]["status"] = "stopped"
        self.assertIsNone(self.report()["nodeName"])
        self.workspace["latest_build"]["status"] = "running"
        self.snapshot["pods"].append(self.pod("two"))
        result = self.report()
        self.assertIsNone(result["nodeName"])
        self.assertIn("multiple", result["node"]["cpu"]["error"])

    def test_missing_and_partial_live_metrics_are_not_reserved_or_zero_usage(self):
        self.snapshot["usage"] = None
        result = self.report()
        self.assertIsNone(result["node"]["cpu"]["used"])
        self.assertIsNone(result["cluster"]["memory"]["used"])
        self.assertIsNotNone(result["node"]["cpu"]["error"])
        self.snapshot["usage"] = {"one": {"cpu": "500m", "memory": "2Gi"}}
        result = self.report()
        self.assertEqual(result["node"]["cpu"]["used"], 0.5)
        self.assertIsNone(result["cluster"]["cpu"]["used"])
        self.assertEqual(result["cluster"]["cpu"]["total"], 12)
        self.assertIn("incomplete", result["cluster"]["cpu"]["error"])

    def test_stale_or_missing_timestamps_and_load_are_explicitly_unavailable(self):
        self.snapshot["usageTimes"]["one"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        result = self.report()
        self.assertIsNone(result["node"]["cpu"]["used"])
        self.assertIsNone(result["node"]["cpu"]["collectedAt"])
        for scope in ("node", "cluster"):
            self.assertIsNone(result[scope]["load"]["used"])
            self.assertIn("load average", result[scope]["load"]["error"])

    def test_trusted_node_load_is_uid_fenced_fresh_and_aggregated(self):
        for node, load in zip(self.snapshot["nodes"], (1.25, 2.5)):
            node["metadata"]["annotations"] = {"platform.coder/node-load": json.dumps({
                "nodeUID": node["metadata"]["uid"], "load1": load, "collectedAt": self.at})}
        result = self.report()
        self.assertEqual(result["node"]["load"]["used"], 1.25)
        self.assertEqual(result["cluster"]["load"]["used"], 3.75)
        self.assertEqual(result["cluster"]["load"]["total"], 12)
        self.snapshot["nodes"][1]["metadata"]["uid"] = "replaced-node"
        self.assertIsNone(self.report()["cluster"]["load"]["used"])

    def test_invalid_stale_or_unready_node_load_is_not_zero(self):
        node = self.snapshot["nodes"][0]
        for value in (float('nan'), -1, True):
            node["metadata"]["annotations"] = {"platform.coder/node-load": json.dumps({
                "nodeUID": node["metadata"]["uid"], "load1": value, "collectedAt": self.at})}
            self.assertIsNone(self.report()["node"]["load"]["used"])
        node["metadata"]["annotations"] = {"platform.coder/node-load": json.dumps({
            "nodeUID": node["metadata"]["uid"], "load1": 1, "collectedAt": "2000-01-01T00:00:00Z"})}
        self.assertIsNone(self.report()["node"]["load"]["used"])
        node["metadata"]["annotations"] = {"platform.coder/node-load": json.dumps({
            "nodeUID": node["metadata"]["uid"], "load1": 1, "collectedAt": self.at})}
        node["status"]["conditions"][0]["status"] = "Unknown"
        self.assertIsNone(self.report()["node"]["load"]["used"])

    def test_direct_kubelet_cpu_and_memory_are_genuine_timestamped_fallbacks(self):
        self.snapshot["usage"] = None
        self.summary.side_effect = lambda node: {"cpu": {"usageNanoCores": 750000000, "time": self.at},
            "memory": {"workingSetBytes": 123456, "time": self.at}}
        result = self.report()
        self.assertEqual(result["node"]["cpu"]["used"], 0.75)
        self.assertEqual(result["node"]["memory"]["used"], 123456)
        self.assertEqual(result["cluster"]["cpu"]["used"], 1.5)
        self.assertIsNone(result["node"]["disk"]["used"])

    def test_unready_nodes_are_excluded_from_cluster_and_unavailable_as_node_live_usage(self):
        self.snapshot["nodes"][0]["status"]["conditions"][0]["status"] = "Unknown"
        result = self.report()
        self.assertEqual(result["nodeCount"], 1)
        self.assertIsNone(result["node"]["cpu"]["used"])
        self.assertIn("not Ready", result["node"]["cpu"]["error"])
        self.assertEqual(result["cluster"]["cpu"]["total"], 8)

    def test_disk_is_unavailable_when_one_node_summary_fails(self):
        self.summary.side_effect = lambda node: None if node["metadata"]["name"] == "two" else {
            "fs": {"usedBytes": 10, "capacityBytes": 100, "time": self.at}}
        result = self.report()
        self.assertEqual(result["node"]["disk"]["used"], 10)
        self.assertIsNone(result["cluster"]["disk"]["used"])
        self.assertIsNotNone(result["cluster"]["disk"]["error"])

    def test_no_ready_nodes_have_unknown_not_zero_aggregate_capacity(self):
        self.snapshot["nodes"] = []
        result = self.report()
        self.assertEqual(result["nodeCount"], 0)
        self.assertIsNone(result["cluster"]["cpu"]["total"])
        self.assertIsNone(result["cluster"]["cpu"]["used"])

    def test_endpoint_requires_workspace_read_and_never_admin_role(self):
        handler = mock.Mock()
        handler.user.return_value = ({"id": "member", "roles": []}, None)
        handler.token.return_value = "member-token"
        metrics.handle(handler, "GET", "/__coder-ui/api/organizations/" + self.org + "/workspaces/" + self.wid + "/node-metrics")
        self.assertEqual(handler.send_json.call_args.args[0], 200)
        self.assertTrue(handler.send_json.call_args.args[1]["infrastructureRestricted"])
        self.assertIsNone(handler.send_json.call_args.args[1]["node"])
        metrics.SNAPSHOT.assert_not_called()
        self.summary.assert_not_called()
        handler.user.assert_called_once_with()
        metrics.WORKSPACE_INFO.assert_called_once_with("member-token", self.wid)

    def test_members_receive_only_owned_allocation_without_physical_reads(self):
        pod = self.pod("private-physical-node")
        pod["metadata"].update(namespace="fixture", name="private-pod")
        pod["spec"].update(containers=[{"name": "dev", "resources": {"limits": {"cpu": "250m", "memory": "2Gi"}},
            "volumeMounts": [{"name": "home", "mountPath": "/home/coder"}]}],
            volumes=[{"name": "home", "persistentVolumeClaim": {"claimName": "owned-home"}}])
        claim = {"metadata": {"uid": "owned-claim", "labels": {"com.coder.workspace.id": self.wid}},
                 "status": {"capacity": {"storage": "1Gi"}}, "spec": {"volumeName": "private-pv"}}
        pv = {"spec": {"claimRef": {"uid": "owned-claim"}, "hostPath": {"path": "/private-host-path"}}}
        metrics.KUBE.call.side_effect = [(200, {"items": [pod, self.pod("another-private-node", str(uuid.uuid4()))]}), (200, claim), (200, pv)]
        result = self.report(owner=False)
        self.assertEqual(result["allocation"]["cpu"], 0.25)
        self.assertEqual(result["allocation"]["memory"], 2 * 1024**3)
        self.assertEqual(result["allocation"]["disk"], 1024**3)
        for field in ("nodeName", "nodeCount", "node", "cluster"):
            self.assertIsNone(result[field])
        for secret in ("private-physical-node", "another-private-node", "/private-host-path", "private-pod", "private-pv"):
            self.assertNotIn(secret, json.dumps(result))
        metrics.SNAPSHOT.assert_not_called()
        self.summary.assert_not_called()
        self.assertEqual(metrics.KUBE.call.call_args_list[0].args, ("GET", "/api/v1/pods?labelSelector=com.coder.workspace.id%3D" + self.wid))

    def test_only_deployment_owner_credentials_receive_physical_metrics(self):
        for role in ("member", "user-admin", "organization-admin"):
            with self.subTest(role=role):
                handler = mock.Mock()
                handler.user.return_value = ({"id": "fixture", "roles": [role]}, None)
                handler.token.return_value = "fixture-token"
                metrics.handle(handler, "GET", "/__coder-ui/api/organizations/" + self.org + "/workspaces/" + self.wid + "/node-metrics")
                self.assertTrue(handler.send_json.call_args.args[1]["infrastructureRestricted"])
                metrics.SNAPSHOT.assert_not_called()
                self.summary.assert_not_called()
        handler = mock.Mock()
        handler.user.return_value = ({"id": "fixture", "roles": ["owner"]}, None)
        handler.token.return_value = "fixture-owner-token"
        metrics.handle(handler, "GET", "/__coder-ui/api/organizations/" + self.org + "/workspaces/" + self.wid + "/node-metrics")
        self.assertFalse(handler.send_json.call_args.args[1]["infrastructureRestricted"])
        self.assertEqual(handler.send_json.call_args.args[1]["nodeName"], "one")
        self.assertGreater(metrics.SNAPSHOT.call_count, 0)

    def test_restricted_workspace_authorization_precedes_all_kubernetes_reads(self):
        metrics.WORKSPACE_INFO.return_value = None
        with self.assertRaises(LookupError):
            self.report(owner=False)
        metrics.SNAPSHOT.assert_not_called()
        metrics.KUBE.call.assert_not_called()


    def test_workspace_allocation_uses_container_limits_and_owned_home_pvc(self):
        pod = self.pod("one")
        pod["metadata"]["namespace"] = "coder"
        pod["spec"].update(containers=[{"name": "dev", "resources": {"limits": {"cpu": "250m", "memory": "2Gi"}},
            "volumeMounts": [{"name": "home", "mountPath": "/home/coder"}]}],
            volumes=[{"name": "home", "persistentVolumeClaim": {"claimName": "fixture-home"}}])
        self.snapshot["pods"] = [pod]
        claim = {"metadata": {"uid": "claim-uid", "labels": {"com.coder.workspace.id": self.wid}},
                 "status": {"capacity": {"storage": "1Gi"}}, "spec": {"volumeName": "fixture-pv"}}
        volume = {"spec": {"claimRef": {"uid": "claim-uid"}, "hostPath": {"path": "/not-returned"}}}
        metrics.KUBE.call.side_effect = [(200, claim), (200, volume)]
        result = self.report()["allocation"]
        self.assertEqual(result, {"cpu": 0.25, "memory": 2 * 1024**3, "disk": 1024**3, "diskEnforced": False,
            "source": {"cpu": "container-limit", "memory": "container-limit", "disk": "pvc-capacity"}})
        self.assertNotIn("hostPath", json.dumps(result))
        claim["metadata"]["labels"]["com.coder.workspace.id"] = "another-workspace"
        metrics.KUBE.call.side_effect = [(200, claim)]
        self.assertIsNone(self.report()["allocation"]["disk"])

    def test_zero_missing_or_ambiguous_container_limits_are_not_zero_maximums(self):
        pod = self.pod("one")
        pod["spec"]["containers"] = [{"name": "dev", "resources": {"limits": {"cpu": "0"}}}]
        result = metrics.allocation([pod], self.wid)
        self.assertIsNone(result["cpu"])
        self.assertIsNone(result["memory"])
        self.assertIsNone(result["disk"])
        self.assertEqual(result["source"]["cpu"], "unknown")
        self.assertIsNone(metrics.allocation([pod, pod], self.wid)["cpu"])

    def test_metric_numbers_reject_nonfinite_and_preserve_real_zero(self):
        for value in (float("inf"), float("nan"), True, -1, None):
            self.assertIsNone(metrics.number(value))
        self.assertEqual(metrics.number(0), 0)
        self.assertIsNone(metrics.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))


class WorkspaceVMMetricsTest(unittest.TestCase):
    def setUp(self):
        from test_vmprofile import fixture, lookup
        self.profile, self.secret, self.vm = fixture()
        self.wid = self.profile["workspace_id"]
        self.workspace = {"id": self.wid, "organization_id": self.profile["organization_id"],
                          "owner_id": self.profile["workspace_owner_id"]}
        self.vm["metadata"].update(name="coder-vm-" + self.wid, namespace="coder",
                                  labels=self.secret["metadata"]["labels"])
        self.vmi = {"metadata": {"labels": copy.deepcopy(self.secret["metadata"]["labels"]),
            "ownerReferences": [{"kind": "VirtualMachine", "uid": "vm-uid", "controller": True}]},
            "spec": copy.deepcopy(self.vm["spec"]["template"]["spec"]),
            "status": {"phase": "Running", "nodeName": "actual-host-node",
                "currentCPUTopology": {"cores": 2, "sockets": 1, "threads": 1},
                "memory": {"guestCurrent": "2Gi"}}}
        self.claim = lookup(self.secret)("/persistentvolumeclaims/home")
        def call(method, path):
            if "/virtualmachines/" in path:
                return 200, self.vm
            if "/virtualmachineinstances/" in path:
                return 200, self.vmi
            if "/secrets/" in path:
                return 200, self.secret
            if "/persistentvolumeclaims/" in path:
                return 200, self.claim
            raise AssertionError(path)
        metrics.setup(mock.Mock(return_value=self.workspace), mock.Mock(), WorkspaceNodeMetricsTest.quantity, mock.Mock(), infrastructure_access=mock.Mock(return_value=(200, {"deployment_stats": True})))
        metrics.KUBE.call.side_effect = call

    def test_current_hardware_ignores_desired_vm_and_launcher_overhead(self):
        self.vm["spec"]["template"]["spec"]["domain"]["cpu"]["cores"] = 8
        result = metrics.vm_context(self.workspace, self.wid)
        self.assertEqual(result["nodeName"], "actual-host-node")
        assigned = result["allocation"]
        self.assertEqual(assigned["cpu"], 2)
        self.assertEqual(assigned["memory"], 2147483648)
        self.assertEqual(assigned["memoryReserved"], self.profile["reserved_memory_bytes"])
        self.assertEqual(assigned["memoryUsable"], self.profile["memory_bytes"]-self.profile["reserved_memory_bytes"])
        self.assertEqual(assigned["disk"], 10000000000)
        self.assertTrue(assigned["diskEnforced"])
        self.assertEqual(assigned["source"], {"cpu": "vm-topology", "memory": "vm-memory", "disk": "guest-block-capacity"})
        result = metrics.report("member-token", self.workspace["organization_id"], self.wid)
        self.assertIsNone(result["nodeName"])
        self.assertEqual(result["allocation"]["cpu"], 2)
        metrics.SNAPSHOT.assert_not_called()
        self.assertNotIn("actual-host-node", json.dumps(result))
        self.assertNotIn(self.profile["agent"]["token"], json.dumps(result))
        metrics.SNAPSHOT.return_value = {"nodes": [], "pods": []}
        self.assertEqual(metrics.report("owner-token", self.workspace["organization_id"], self.wid, owner=True)["nodeName"], "actual-host-node")

    def test_unowned_migrating_missing_or_unacknowledged_hardware_is_unavailable(self):
        original = copy.deepcopy(self.vmi)
        for change in (lambda v: v["metadata"]["ownerReferences"][0].update(uid="wrong"),
                       lambda v: v["metadata"]["labels"].update({"com.coder.user.id": str(uuid.uuid4())}),
                       lambda v: v["status"].update(migrationState={"completed": False}),
                       lambda v: v["status"].update(currentCPUTopology={"cores": 8,"sockets":1,"threads":1}),
                       lambda v: v["status"].update(memory={}),
                       lambda v: v["status"].update(activePods={"old":"node-a","new":"node-b"}),
                       lambda v: v["spec"]["volumes"][-1]["cloudInitNoCloud"]["secretRef"].update(name="unsealed")):
            self.vmi = copy.deepcopy(original)
            change(self.vmi)
            result = metrics.vm_context(self.workspace, self.wid)
            self.assertIsNone(result["allocation"]["cpu"])
            self.assertIsNone(result["nodeName"])

    def test_foreign_home_claim_never_becomes_assigned_block_capacity(self):
        self.claim["metadata"]["labels"] = {}
        result = metrics.vm_context(self.workspace, self.wid)
        self.assertEqual(result["allocation"]["cpu"], 2)
        self.assertIsNone(result["allocation"]["disk"])


if __name__ == "__main__":
    unittest.main()
