"""Image preparation must finish successfully before the live service is changed."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

spec = importlib.util.spec_from_file_location("update_platform", Path(__file__).resolve().parents[1] / "runtime/update-platform-service.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class PlatformUpdateTest(unittest.TestCase):
    def test_fresh_install_has_no_writer_to_replace(self):
        calls = []
        updater.prepare(lambda args: calls.append(args) or "", "image:1.5.1", "coder")
        self.assertEqual(len(calls), 1)
        self.assertIn("--ignore-not-found", calls[0])

    def test_rendered_upgrade_warms_target_without_changing_deployment(self):
        calls = []
        def run(args, body=None):
            calls.append((args, body))
            if args[:2] == ["get", "deployment"]:
                return json.dumps({"spec": {"selector": {"matchLabels": {"app": "ui"}}, "template": {"spec": {}}}})
            if args[:2] == ["get", "pods"]:
                return json.dumps({"items": [{"metadata": {}, "spec": {"nodeName": "writer-node"}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}]})
            return ""
        updater.prepare_manifest(run, {"kind": "List", "items": [
            {"kind": "Service", "metadata": {"name": "coder-ui-updates"}},
            {"kind": "Deployment", "metadata": {"name": "coder-ui-updates"}, "spec": {"template": {"spec": {
                "imagePullSecrets": [{"name": "new-registry"}],
                "containers": [{"name": "ui", "image": "new-registry/service:1.5.1", "imagePullPolicy": "Always"}],
            }}}},
        ]}, "coder")
        pod = next(json.loads(body) for args, body in calls if args[0] == "create")
        self.assertEqual(pod["spec"]["nodeName"], "writer-node")
        self.assertEqual(pod["spec"]["imagePullSecrets"], [{"name": "new-registry"}])
        self.assertEqual(pod["spec"]["containers"][0]["image"], "new-registry/service:1.5.1")
        self.assertEqual(pod["spec"]["containers"][0]["imagePullPolicy"], "Always")
        self.assertFalse(any(args[0] in ("set", "rollout") for args, _ in calls))

    def test_disabled_service_needs_no_preflight(self):
        updater.prepare_manifest(lambda args: self.fail("Unexpected kubectl call"), {"kind": "List", "items": []}, "coder")

    def test_failed_image_check_does_not_replace_running_service(self):
        for fails in (False, True):
            calls = []
            def run(args, body=None):
                calls.append((args, body))
                if args[:2] == ["get", "deployment"]:
                    return json.dumps({"spec": {"selector": {"matchLabels": {"app": "ui"}}, "template": {"spec": {}}}})
                if args[:2] == ["get", "pods"]:
                    return json.dumps({"items": [{"metadata": {}, "spec": {"nodeName": "storage-node"}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}]})
                if args[0] == "wait" and fails:
                    raise subprocess.CalledProcessError(1, args)
                return ""
            if fails:
                with self.assertRaises(subprocess.CalledProcessError):
                    updater.update(run, "image@sha256:test", "coder")
            else:
                updater.update(run, "image@sha256:test", "coder")
            self.assertEqual(any(args[0] == "set" for args, _ in calls), not fails)
            created = next(json.loads(body) for args, body in calls if args[0] == "create")
            self.assertEqual(created["spec"]["nodeName"], "storage-node")
            self.assertFalse(created["spec"]["automountServiceAccountToken"])
            self.assertNotIn("volumes", created["spec"])
            self.assertTrue(any(args[0] == "delete" for args, _ in calls))


if __name__ == "__main__":
    unittest.main()
