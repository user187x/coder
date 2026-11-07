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
