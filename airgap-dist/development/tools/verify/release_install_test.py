"""Release install checks: private fork images, public dependencies, optional DATAFLOW."""
import hashlib
import pathlib
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHART = ROOT / "helm-chart/coder-airgapped"
PUSH = ROOT / "development/tools/release/push-images.sh"


class ReleaseInstallTest(unittest.TestCase):
    def render(self, *settings):
        args = ["helm", "template", "fresh", str(CHART), "-n", "fresh", "-f", str(ROOT / "helm-chart/values.example.yaml")]
        for setting in settings:
            args += ["--set", setting]
        return list(yaml.safe_load_all(subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL)))

    def test_fork_registry_keeps_public_images_public(self):
        docs = self.render("global.forkRegistry=private.example/coder")
        images = []
        def collect(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key == "image" and isinstance(item, str):
                        images.append(item)
                    else:
                        collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
        collect(docs)
        self.assertTrue(any(i.startswith("private.example/coder/user187x/coder-platform:") for i in images))
        self.assertTrue(any(i.startswith("private.example/coder/user187x/coder-ui-updates:") for i in images))
        self.assertTrue(any(i.startswith("docker.io/library/python:") for i in images))
        self.assertTrue(any(i.startswith("ghcr.io/cloudnative-pg/cloudnative-pg:") for i in images))
        self.assertFalse(any(i.startswith("docker.io/user187x/") for i in images))
        self.assertFalse(any(i.startswith("private.example/coder/library/") for i in images))

    def test_dataflow_does_not_participate_in_core_install(self):
        docs = self.render("coder-workspace.dataflowImage=missing.invalid/dataflow:unavailable")
        jobs = {d["metadata"]["name"]: d for d in docs if d and d.get("kind") == "Job"}
        self.assertIn("coder-workspace-push-template", jobs)
        self.assertNotIn("coder-workspace-push-template-dataflow", jobs)
        enabled = self.render("coder-workspace.dataflowTemplate.enabled=true")
        self.assertTrue(any(d and d.get("kind") == "Job" and d["metadata"]["name"].endswith("push-template-dataflow") for d in enabled))

    def test_import_without_dataflow_does_not_require_its_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            shutil.copy(PUSH, root / "push-images.sh")
            (root / "core.tar.gz").write_bytes(b"archive fixture")
            digest = hashlib.sha256(b"archive fixture").hexdigest()
            (root / "IMAGES.txt").write_text("docker.io/user187x/coder-platform:1 core.tar.gz 1B sha256:a sha256:b\n"
                "docker.io/user187x/coder-workspace-dataflow:1 absent.tar.gz 1B sha256:c sha256:d\n")
            (root / "SHA256SUMS").write_text(f"{digest}  core.tar.gz\n{'0' * 64}  absent.tar.gz\n")
            result = subprocess.run(["bash", str(root / "push-images.sh"), "private.example/coder", "--without-dataflow", "--dry-run"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("private.example/coder/user187x/coder-platform:1", result.stdout)
            self.assertNotIn("would run: cat absent.tar.gz", result.stdout)
            (root / "core.tar.gz").write_bytes(b"damaged")
            failed = subprocess.run(["bash", str(root / "push-images.sh"), "private.example/coder", "--without-dataflow", "--dry-run"], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)


class SourceBuildTest(unittest.TestCase):
    def test_plan_defaults_to_required_images_only(self):
        script = ROOT / "development/tools/build-source-release.sh"
        result = subprocess.check_output([str(script), "private.example/coder", "--plan"], text=True)
        self.assertIn("DATAFLOW: 0", result)
        self.assertIn("Push: 0", result)
        self.assertIn("registry, MinIO", result)

    def test_plan_accepts_optional_dataflow_and_push(self):
        script = ROOT / "development/tools/build-source-release.sh"
        result = subprocess.check_output([str(script), "private.example/coder", "--dataflow", "--push", "--plan"], text=True)
        self.assertIn("DATAFLOW: 1", result)
        self.assertIn("Push: 1", result)

    def test_rejects_registry_url_before_building(self):
        script = ROOT / "development/tools/build-source-release.sh"
        result = subprocess.run([str(script), "https://private.example", "--plan"], text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("without https://", result.stderr)


if __name__ == "__main__":
    unittest.main()
