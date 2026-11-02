"""Workspace operations target the agent instead of relying on a container name."""
import pathlib
import sys
import unittest
from unittest import mock

SRC = pathlib.Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/files/ui-updates"
sys.path.insert(0, str(SRC))
import kexec
import safe


class AgentContainerTest(unittest.TestCase):
    def test_token_then_dev_then_first(self):
        first, dev = {"name": "sidecar"}, {"name": "dev"}
        agent = {"name": "workspace", "env": [{"name": "CODER_AGENT_TOKEN", "valueFrom": {"secretKeyRef": {"name": "agent", "key": "token"}}}]}
        tunnel = {"name": "workspace-tunnel", "env": [{"name": "CODER_AGENT_TOKEN", "value": "runtime"}]}
        for containers, expected in [([tunnel, first, dev, agent], agent), ([first, dev], dev), ([first], first), ([], {})]:
            with self.subTest(containers=containers):
                self.assertEqual(kexec.agent_container({"spec": {"containers": containers}}), expected)

    def test_failed_lookup_never_executes(self):
        for reply in [(403, {}), (200, {"spec": {"containers": []}})]:
            with self.subTest(reply=reply), mock.patch.object(kexec.socket, "create_connection") as connection:
                with self.assertRaises(RuntimeError):
                    kexec.exec_in(mock.Mock(call=mock.Mock(return_value=reply)), "coder", "pod", "", ["id"])
                connection.assert_not_called()

    def test_cloud_drive_source_uses_agent_readiness(self):
        pod = {"metadata": {"name": "pod"}, "spec": {"containers": [
            {"name": "sidecar"}, {"name": "workspace", "env": [{"name": "CODER_AGENT_TOKEN", "value": "test"}]}]},
            "status": {"phase": "Running", "podIP": "10.0.0.1", "containerStatuses": [
                {"name": "sidecar", "ready": False}, {"name": "workspace", "ready": True}]}}
        kube = mock.Mock(call=mock.Mock(return_value=(200, {"items": [pod]})))
        with mock.patch.object(safe, "KUBE", kube), mock.patch.object(safe, "SOURCE_CONTAINER", ""), \
                mock.patch.object(safe, "restricted_workspace", return_value=False):
            self.assertEqual(safe._source_pod("workspace-id"), ("pod", "10.0.0.1"))
            pod["status"]["containerStatuses"][1]["ready"] = False
            self.assertIsNone(safe._source_pod("workspace-id"))


if __name__ == "__main__":
    unittest.main()
