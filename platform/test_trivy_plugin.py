import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import imagebuilder


class TrivyPluginTest(unittest.TestCase):
    def test_failed_upgrade_preserves_active_version(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {"enabled": True, "requestedVersion": "0.77.0", "activeVersion": "0.76.0"}
            store = Mock()
            store.setting.return_value = config
            with patch.multiple(imagebuilder, FILES=directory, STORE=store, _trivy_installing=True,
                                _trivy_install_error=""):
                current = imagebuilder.trivy_path("0.76.0")
                os.makedirs(os.path.dirname(current))
                with open(current, "wb"):
                    pass
                with patch.object(imagebuilder, "install_trivy", side_effect=ValueError("checksum mismatch")):
                    imagebuilder._install_trivy("0.77.0")
                status = imagebuilder.trivy_status()
                self.assertEqual(status["activeVersion"], "0.76.0")
                self.assertIn("checksum mismatch", status["error"])
                self.assertFalse(status["installing"])
                store.put_setting.assert_not_called()

    def test_definition_refresh_uses_configured_repositories_and_activates_both_databases(self):
        from imagebuilder import securitydata

        def download(command, **_):
            cache = Path(command[command.index("--cache-dir") + 1])
            java = "--download-java-db-only" in command
            option = "--java-db-repository" if java else "--db-repository"
            expected = "registry.internal/trivy/java:1" if java else "registry.internal/trivy/vuln:2"
            self.assertEqual(command[command.index(option) + 1], expected)
            folder = cache / ("java-db" if java else "db")
            folder.mkdir(parents=True)
            (folder / ("trivy-java.db" if java else "trivy.db")).write_bytes(b"sample database")
            (folder / "metadata.json").write_text(json.dumps({"Version": 1 if java else 2}))
            return Mock(returncode=0)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "security"
            root.mkdir()
            with patch.object(securitydata, "ROOT", str(root)), patch.object(
                    securitydata.subprocess, "run", side_effect=download):
                info = securitydata.refresh("/trivy", "0.76.0", "registry.internal/trivy/vuln:2",
                                            "registry.internal/trivy/java:1", "admin")
                self.assertEqual(securitydata.active_id(), info["id"])
                self.assertEqual(info["db"]["Version"], 2)
                self.assertEqual(info["javaDb"]["Version"], 1)

                def failed_java(command, **kwargs):
                    if "--download-java-db-only" in command:
                        return Mock(returncode=1, stderr=b"mirror unavailable")
                    return download(command, **kwargs)

                with patch.object(securitydata.subprocess, "run", side_effect=failed_java):
                    with self.assertRaisesRegex(ValueError, "mirror unavailable"):
                        securitydata.refresh("/trivy", "0.76.0", "registry.internal/trivy/vuln:2",
                                             "registry.internal/trivy/java:1", "admin")
                self.assertEqual(securitydata.active_id(), info["id"])

    def test_tracked_rescan_can_use_configured_k3d_registry(self):
        ref = "k3d-lab-registry.localhost:5501/coder/example/workspace:1"
        store = Mock()
        store.image.return_value = {"tracked": {"image": ref}, "version": 0, "spec": {}}
        store.active_build.return_value = None
        store.new_build.return_value = (42, "token")
        with patch.multiple(imagebuilder, WORKSPACE_IMAGE=ref, STORE=store, BUILDS={}), \
                patch.object(imagebuilder, "require_scanner", return_value="0.76.0"), \
                patch.object(imagebuilder, "scan_target", return_value=(ref, None)), \
                patch.object(imagebuilder, "Rescan") as rescan:
            self.assertEqual(imagebuilder.start_rescan("coder-workspace", "admin"), 42)
            self.assertEqual(rescan.return_value.scan_ref, ref.replace(":5501/", ":5000/"))
            self.assertEqual(rescan.return_value.trivy_version, "0.76.0")
            rescan.return_value.start.assert_called_once()


if __name__ == "__main__":
    unittest.main()
