"""Running pod replacement follows Cloud Drive grant changes."""
import unittest
from unittest.mock import Mock, patch

import drivepeers
import safe


class RevocationTest(unittest.TestCase):
    def setUp(self):
        self.mount = {"name": "peer", "mountPath": "/mnt/cloud-drive-peers/owner"}
        self.pod = {
            "metadata": {"name": "workspace", "uid": "old-pod",
                         "ownerReferences": [{"kind": "ReplicaSet", "controller": True}]},
            "spec": {"volumes": [{"name": "peer", "persistentVolumeClaim": {"claimName": "shared"}}],
                     "containers": [{"volumeMounts": [self.mount]}]},
        }
        self.grant = {"kind": "drive", "name": "owner", "path": "", "access": "read"}
        self.kube = Mock()
        self.kube.call.return_value = (202, {})
        log = patch.object(safe, "LOG", Mock())
        self.log = log.start()
        self.addCleanup(log.stop)

    def test_revocation_replaces_pod_with_uid_precondition(self):
        with patch.object(safe, "KUBE", self.kube):
            safe.replace_pod_with_revoked_mount(self.pod, [])
        self.kube.call.assert_called_once_with(
            "DELETE", "/api/v1/namespaces/%s/pods/workspace" % safe.NAMESPACE,
            {"preconditions": {"uid": "old-pod"}},
        )
        self.log.assert_called_once_with(event="cloud-drive-revoked-mount-replaced", pod="workspace",
                                         mount="/mnt/cloud-drive-peers/owner")

    def test_write_downgrade_replaces_writable_mount(self):
        with patch.object(safe, "KUBE", self.kube):
            safe.replace_pod_with_revoked_mount(self.pod, [self.grant])
        self.kube.call.assert_called_once()

    def test_remaining_grant_preserves_pod(self):
        with patch.object(safe, "KUBE", self.kube):
            safe.replace_pod_with_revoked_mount(self.pod, [dict(self.grant, access="write"), self.grant])
            self.mount["readOnly"] = True
            safe.replace_pod_with_revoked_mount(self.pod, [self.grant])
        self.kube.call.assert_not_called()

    def test_unmanaged_pod_is_not_replaced(self):
        self.pod["metadata"]["ownerReferences"] = []
        with patch.object(safe, "KUBE", self.kube):
            safe.replace_pod_with_revoked_mount(self.pod, [])
        self.kube.call.assert_not_called()

    def test_failed_policy_read_does_not_authorize_replacement(self):
        with patch.object(drivepeers, "PERSISTENCE", None), patch("builtins.open", side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                drivepeers.active(strict=True)

    def test_failed_admission_update_prevents_replacement(self):
        self.pod["metadata"]["labels"] = {
            "com.coder.user.id": "recipient",
            "com.coder.workspace.id": "workspace",
        }
        with (
            patch.object(safe, "disconnected", return_value={}),
            patch.object(safe, "shared_now", return_value={}),
            patch.object(safe, "turned_off", return_value=None),
            patch.object(safe, "sources", return_value={}),
            patch.object(safe, "link_pods", return_value=([self.pod], [])),
            patch.object(safe, "link", return_value=False),
            patch.object(safe, "sources_once"),
            patch.object(drivepeers, "active", return_value={}),
            patch.object(safe, "publish_state", side_effect=RuntimeError("configmap unavailable")),
            patch.object(safe, "KUBE", self.kube),
        ):
            with self.assertRaisesRegex(RuntimeError, "configmap unavailable"):
                safe.links_once()
        self.kube.call.assert_not_called()
