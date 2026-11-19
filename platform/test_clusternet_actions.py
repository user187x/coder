"""Network object logs and disruption-budget-aware restart authorization."""
import copy
import io
import unittest
import urllib.parse
from unittest import mock
import clusternet as network


class NetworkActionsTest(unittest.TestCase):
    def setUp(self):
        self.pod = {"metadata": {"name": "coder-1", "namespace": "coder", "uid": "original-uid",
                                "labels": {"app": "coder"}, "ownerReferences": [
                                    {"kind": "ReplicaSet", "controller": True, "name": "coder"}]},
                    "spec": {"nodeName": "worker-1", "containers": [{"name": "coder"}],
                             "initContainers": [{"name": "init"}]}}
        self.kube = mock.Mock()
        self.kube.call.return_value = (200, self.pod)
        network.setup(mock.Mock(), self.kube, mock.Mock(), lambda: {"pods": [self.pod]}, None, None)
        self.body = {"namespace": "coder", "name": "coder-1", "uid": "original-uid", "confirmation": "coder-1"}
        self.query = urllib.parse.urlencode({**self.body, "type": "pod", "container": "coder"})

    def test_logs_are_bounded_timestamped_and_container_scoped(self):
        self.kube.stream.return_value = io.BytesIO(b"2026-10-31T17:00:00Z started\n")
        self.assertEqual(network.pod_logs(self.query)["text"], "2026-10-31T17:00:00Z started\n")
        path = self.kube.stream.call_args.args[0]
        options = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
        self.assertEqual(options, {"container": ["coder"], "tailLines": ["500"], "limitBytes": ["131072"],
                                   "timestamps": ["true"], "previous": ["false"]})

    def test_replaced_pod_or_invalid_container_cannot_supply_logs(self):
        for change in ({"uid": "old"}, {"container": "other"}, {"name": "../secrets"}):
            with self.subTest(change=change), self.assertRaises((LookupError, ValueError)):
                network.pod_logs(urllib.parse.urlencode({**self.body, "container": "coder", **change}))
        self.kube.stream.assert_not_called()

    def test_node_and_service_resolve_only_related_pods(self):
        other = copy.deepcopy(self.pod)
        other["metadata"].update(uid="other", namespace="elsewhere")
        other["spec"]["nodeName"] = "worker-2"
        network.SNAPSHOT = lambda: {"pods": [self.pod, other]}
        self.kube.call.return_value = (200, {"spec": {"selector": {"app": "coder"}}})
        self.assertEqual([p["uid"] for p in network.log_targets("type=service&namespace=coder&name=coder")["pods"]], ["original-uid"])
        self.kube.call.side_effect = [(200, {}), (200, {"items": [other]})]
        self.assertEqual([p["uid"] for p in network.log_targets("type=node&name=worker-2")["pods"]], ["other"])
        self.assertIn("fieldSelector=spec.nodeName%3Dworker-2", self.kube.call.call_args.args[1])

    def test_log_targets_report_the_workspace_a_pod_belongs_to(self):
        workspace = copy.deepcopy(self.pod)
        workspace["metadata"].update(uid="ws-uid", name="ws-1", labels={
            "com.coder.workspace.id": "11111111-1111-1111-1111-111111111111", "com.coder.workspace.name": "dev"})
        self.kube.call.return_value = (200, workspace)
        pod = network.log_targets("type=pod&namespace=coder&name=ws-1")["pods"][0]
        self.assertEqual((pod["workspaceId"], pod["workspaceName"]), ("11111111-1111-1111-1111-111111111111", "dev"))
        self.kube.call.return_value = (200, self.pod)
        pod = network.log_targets("type=pod&namespace=coder&name=coder-1")["pods"][0]
        self.assertIsNone(pod["workspaceId"])

    def test_delete_pod_requires_confirmation_and_uses_uid_precondition(self):
        with self.assertRaises(ValueError):
            network.delete_pod({**self.body, "confirmation": "other"}, {})
        self.kube.call.assert_not_called()
        self.kube.call.return_value = (202, {})
        self.assertTrue(network.delete_pod(self.body, {"id": "admin"})["accepted"])
        method, path, options = self.kube.call.call_args.args
        self.assertEqual((method, path), ("DELETE", "/api/v1/namespaces/coder/pods/coder-1"))
        self.assertEqual(options["preconditions"], {"uid": "original-uid"})
        self.kube.call.return_value = (409, {})
        with self.assertRaises(LookupError):
            network.delete_pod(self.body, {})

    def test_controller_manifests_follow_verified_owner_chain_and_omit_inline_credentials(self):
        pod = copy.deepcopy(self.pod)
        pod["metadata"]["ownerReferences"][0].update(apiVersion="apps/v1", uid="rs-uid")
        rs = {"metadata": {"uid": "rs-uid", "ownerReferences": [
            {"kind": "Deployment", "apiVersion": "apps/v1", "name": "coder", "uid": "deploy-uid",
             "controller": True}]}}
        deployment = {"metadata": {"name": "coder", "uid": "deploy-uid", "annotations": {"private": "token"}},
                      "spec": {"replicas": 2, "template": {"spec": {"containers": [
                          {"name": "coder", "image": "coder:test", "env": [{"name": "TOKEN", "value": "private"}]}]}}}}
        self.kube.call.side_effect = [(200, pod), (200, rs), (200, deployment)]
        result = network.pod_controllers(self.query)["controllers"]
        self.assertEqual([entry["kind"] for entry in result], ["ReplicaSet", "Deployment"])
        self.assertEqual(result[1]["manifest"]["spec"]["replicas"], 2)
        self.assertNotIn("private", str(result[1]["manifest"]))
        self.kube.call.side_effect = [(200, pod), (200, {"metadata": {"uid": "replacement"}})]
        self.assertIsNone(network.pod_controllers(self.query)["controllers"][0]["manifest"])

    def test_restart_uses_eviction_with_uid_precondition_and_audits_actor(self):
        self.kube.call.side_effect = [(200, self.pod), (201, {})]
        self.assertTrue(network.restart_pod(self.body, {"id": "admin-id"})["accepted"])
        method, path, body = self.kube.call.call_args.args
        self.assertEqual((method, path), ("POST", "/api/v1/namespaces/coder/pods/coder-1/eviction"))
        self.assertEqual(body["deleteOptions"], {"preconditions": {"uid": "original-uid"}})
        self.assertEqual(network.LOG.call_args.kwargs["user_id"], "admin-id")

    def test_restart_refuses_unmanaged_replaced_or_terminating_pod(self):
        for changes in ({"ownerReferences": []}, {"uid": "new"}, {"deletionTimestamp": "now"}):
            with self.subTest(changes=changes):
                pod = copy.deepcopy(self.pod)
                pod["metadata"].update(changes)
                self.kube.call.reset_mock()
                self.kube.call.return_value = (200, pod)
                with self.assertRaises((ValueError, LookupError)):
                    network.restart_pod(self.body, {})
                self.assertTrue(all(c.args[0] == "GET" for c in self.kube.call.call_args_list))

    def test_restart_honors_disruption_budget(self):
        self.kube.call.side_effect = [(200, self.pod), (429, {})]
        with self.assertRaisesRegex(ValueError, "disruption budget"):
            network.restart_pod(self.body, {})
        self.assertEqual(len(self.kube.call.call_args_list), 2)
        network.LOG.assert_not_called()

    def test_authentication_and_csrf_precede_kubernetes_access(self):
        for endpoint, method in (("pod-logs", "GET"), ("log-targets", "GET"), ("restart-pod", "POST"), ("edit-node", "POST"), ("node-config", "GET"), ("node-pods", "GET")):
            handler = mock.Mock()
            handler.user.return_value = (None, True)
            self.assertTrue(network.handle(handler, method, network.BASE + "/api/network/" + endpoint, self.query))
            handler.user.assert_called_once_with(admin=True)
        self.kube.call.assert_not_called()
        handler.user.return_value = ({"id": "admin"}, False)
        handler.csrf_ok.return_value = False
        network.handle(handler, "POST", network.BASE + "/api/network/restart-pod", "")
        handler.send_json.assert_called_with(403, {"error": "Cross-site request refused"})
        self.kube.call.assert_not_called()

    def test_node_pods_include_all_namespaces_sidecars_and_pagination(self):
        pod = copy.deepcopy(self.pod)
        pod["metadata"].update(namespace="kube-system", creationTimestamp="2026-01-01T00:00:00Z")
        pod["spec"]["initContainers"] = [{"name": "proxy", "restartPolicy": "Always"}]
        pod["status"] = {"phase": "Running", "containerStatuses": [{"name": "coder", "ready": True}],
                         "initContainerStatuses": [{"name": "proxy", "ready": False, "restartCount": 4,
                                                    "state": {"waiting": {"reason": "CrashLoopBackOff"}}}]}
        self.kube.call.side_effect = [(200, {"items": [pod], "metadata": {"continue": "next"}}),
                                      (200, {"items": []})]
        result = network.node_pods("")["pods"]
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["namespace"], result[0]["readyContainers"], result[0]["containers"],
                          result[0]["restarts"], result[0]["status"]), ("kube-system", 1, 2, 4, "Init:CrashLoopBackOff"))
        self.assertFalse(result[0]["ready"])
        self.assertIn("continue=next", self.kube.call.call_args.args[1])

    def test_edit_node_is_atomic_and_only_changes_supported_fields(self):
        self.kube.call.side_effect = [(200, {"metadata": {"uid": "node-uid", "resourceVersion": "42"}, "spec": {}}), (200,{})]
        body = {"name": "worker-1", "uid": "node-uid", "resourceVersion": "42", "changes": {"unschedulable": True}}
        self.assertEqual(network.edit_node(body, {"id": "admin"}), {"saved": True})
        self.assertEqual(self.kube.call.call_args.args, ("PATCH", "/api/v1/nodes/worker-1", [
            {"op": "test", "path": "/metadata/uid", "value": "node-uid"},
            {"op": "test", "path": "/metadata/resourceVersion", "value": "42"},
            {"op": "add", "path": "/spec/unschedulable", "value": True}], "application/json-patch+json"))

    def test_node_edits_refuse_stale_and_invalid_requests(self):
        self.kube.call.return_value = (200, {"metadata": {"uid": "node-uid", "resourceVersion": "42"}, "spec": {}})
        body = {"name": "worker-1", "uid": "node-uid", "resourceVersion": "42", "changes": {"labels": {"zone": "east"}}}
        for fields in ({"uid": "replaced"}, {"resourceVersion": "old"}, {"changes": {"providerID": "other"}},
                       {"changes": {"labels": {"x": 1}}}, {"changes": {"taints": [{"key": "a", "effect": "invalid"}]}},
                       {"changes": {"unschedulable": "true"}}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                network.edit_node({**body, **fields}, {"id": "admin"})
        self.assertTrue(all(c.args[0] == "GET" for c in self.kube.call.call_args_list))

    def test_node_edit_rejects_cross_site_requests(self):
        handler = mock.Mock()
        handler.user.return_value = ({"id": "admin"}, False)
        handler.csrf_ok.return_value = False
        network.handle(handler, "POST", network.BASE + "/api/network/edit-node", "")
        handler.send_json.assert_called_with(403, {"error": "Cross-site request refused"})
        self.kube.call.assert_not_called()


if __name__ == "__main__":
    unittest.main()

class StorageInventoryTest(unittest.TestCase):
    def test_inventory_preserves_bindings_and_pod_references_by_namespace(self):
        kube = mock.Mock()
        kube.call.side_effect = [
            (200, {"items": [{"metadata": {"name": "local-path"}}]}),
            (200, {"items": [{
                "metadata": {"name": "db-pv", "annotations": {"platform.coder/username": "private"}},
                "spec": {"storageClassName": "local-path", "claimRef": {"name": "data", "namespace": "database"}},
                "status": {"phase": "Bound"},
            }]}),
            (200, {"items": []}),
            (200, {"items": [{
                "metadata": {"name": "data", "namespace": namespace},
                "spec": {"storageClassName": "local-path", "volumeName": "db-pv" if namespace == "database" else None},
                "status": {"phase": "Bound" if namespace == "database" else "Pending"},
            } for namespace in ("database", "other")]}),
        ]
        pods = [{"metadata": {"name": "database-1", "namespace": "database"},
                 "spec": {"volumes": [{"persistentVolumeClaim": {"claimName": "data"}}]}}]
        with mock.patch.multiple(network, KUBE=kube, SAFE=None, QUANTITY=lambda _: 0):
            report = network.storage_report(pods)
        self.assertEqual(report["claimScope"], "all namespaces")
        self.assertEqual(report["classes"][0]["pending"], ["other/data"])
        self.assertEqual(report["volumes"][0]["claim"], "database/data")
        self.assertNotIn("user", report["volumes"][0])
        self.assertEqual(report["claims"][0]["usedBy"], ["database-1"])
        self.assertEqual(report["claims"][1]["usedBy"], [])

    def test_inventory_falls_back_to_visible_namespace(self):
        kube = mock.Mock()
        kube.call.side_effect = [(200, {"items": []})] * 3 + [(403, {}), (200, {"items": []})]
        with mock.patch.multiple(network, KUBE=kube, SAFE=None, NAMESPACE="limited"):
            report = network.storage_report([])
        self.assertEqual(report["claimScope"], "limited")
        self.assertEqual(report["claims"], [])
        kube.call.assert_called_with("GET", "/api/v1/namespaces/limited/persistentvolumeclaims")


class CloudDriveCleanupTest(unittest.TestCase):
    def test_only_retained_account_volumes_without_live_references_are_candidates(self):
        safe = mock.Mock(CLAIM_PREFIX="coder-safe-", CSI_DRIVER="s3", NAMESPACE="coder")
        owner = "12345678-1234-1234-1234-123456789012"
        name = safe.CLAIM_PREFIX + owner
        labels = {"app.kubernetes.io/name": "coder-safe", "platform.coder/user-id": owner}
        pv = {"metadata": {"uid": "pv", "labels": labels}, "spec": {
            "csi": {"driver": "s3"}, "persistentVolumeReclaimPolicy": "Retain",
            "claimRef": {"namespace": "coder", "name": name, "uid": "claim"},
        }}
        claim = {"metadata": {"uid": "claim", "labels": labels}, "spec": {"volumeName": name}}
        with mock.patch.object(network, "SAFE", safe):
            def candidate(mounted=(), owners=None):
                return network._cleanup_objects(name, pv, claim, mounted, {owner: "removed"} if owners is None else owners)

            self.assertEqual(candidate()["account"], "removed")
            self.assertIsNone(candidate(mounted={name}))
            self.assertIsNone(candidate(owners={}))
            claim["metadata"]["uid"] = "replacement"
            self.assertIsNone(candidate())
            claim["metadata"]["uid"] = "claim"
            pv["spec"]["persistentVolumeReclaimPolicy"] = "Delete"
            self.assertIsNone(candidate())

    def test_deletion_skips_a_volume_that_changed_after_review(self):
        kube = mock.Mock()
        candidate = {"name": "coder-safe-orphan", "pv": "reviewed-pv", "claim": "reviewed-claim"}
        with mock.patch.object(network, "KUBE", kube), mock.patch.object(network, "DB", mock.Mock()), \
                mock.patch.object(network, "_cleanup_candidates", return_value={
                    candidate["name"]: {**candidate, "pv": "replacement-pv"},
                }), mock.patch.object(network, "_cleanup_state", return_value={"id": "scan", "status": "deleting"}), \
                mock.patch.object(network, "_cleanup_finish") as finish:
            network._cleanup_delete("admin", {"id": "scan"}, [candidate])
            kube.call.assert_not_called()
            self.assertEqual(finish.call_args.args[2]["skipped"][0]["name"], candidate["name"])
