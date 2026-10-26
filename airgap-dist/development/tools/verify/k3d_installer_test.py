"""Verify installer planning, ownership checks and its isolated kubeconfig workflow."""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "development/tools/release/install-coder-k3d.sh"


class K3dInstallerTest(unittest.TestCase):
    def test_plan_does_not_create_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            assets = pathlib.Path(folder) / "unused"
            result = subprocess.run([str(SCRIPT), "--plan", "--assets-dir", str(assets)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Cluster: coder-fresh", result.stdout)
            self.assertFalse(assets.exists())

    def test_invalid_domain_stops_before_install(self):
        result = subprocess.run([str(SCRIPT), "--domain", "https://bad.example", "--plan"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)

    def run_mock_install(self, owned):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            assets = root / "assets"
            assets.mkdir()
            data = root / "data"
            data.mkdir()
            binaries = root / "bin"
            binaries.mkdir()
            log = root / "calls.jsonl"
            mock = binaries / "mock"
            mock.write_text('''#!/usr/bin/env python3
import base64,json,os,pathlib,sys
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with open(os.environ['INSTALLER_TEST_LOG'],'a') as f: f.write(json.dumps([name,*args])+'\\n')
if name=='k3d':
 if args[:2]==['cluster','list']: print('[{"name":"coder-test"}]')
 elif args[:2]==['registry','list']: print('[{"name":"k3d-coder-registry.localhost"}]')
 elif args[:2]==['kubeconfig','get']: print('mock-kubeconfig')
if name=='kubectl' and 'secret' in args:
 print(base64.b64encode(b'mock-value').decode())
''')
            mock.chmod(0o755)
            for tool in ("docker", "k3d", "kubectl", "helm", "gh"):
                (binaries / tool).symlink_to(mock)
            for name in ("offline-values.example.yaml", "coder-airgapped-1.47.1.tgz"):
                (assets / name).write_text("fixture\n")
            (assets / "load-and-push.sh").write_text("#!/usr/bin/env bash\nexit 0\n")
            checksums = []
            for path in assets.iterdir():
                checksums.append(hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name)
            (assets / "OFFLINE-SHA256SUMS").write_text("\n".join(checksums) + "\n")
            if owned:
                (assets / ".k3d-coder-test-install.json").write_text(json.dumps({"cluster": "coder-test", "domain": "127.0.0.1.sslip.io", "data_dir": str(data)}))
            env = {**os.environ, "PATH": str(binaries) + os.pathsep + os.environ["PATH"], "INSTALLER_TEST_LOG": str(log)}
            result = subprocess.run([str(SCRIPT), "--cluster", "coder-test", "--assets-dir", str(assets), "--data-dir", str(data)], env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result, calls

    def test_existing_foreign_cluster_is_not_modified(self):
        result, calls = self.run_mock_install(False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("was not created by this installer", result.stderr)
        self.assertFalse(any(call[0] in ("helm", "kubectl") for call in calls))
        self.assertFalse(any("delete" in call for call in calls))

    def test_resume_uses_only_its_own_kubeconfig(self):
        result, calls = self.run_mock_install(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DONE. Open: https://coder.127.0.0.1.sslip.io", result.stdout)
        for call in calls:
            if call[0] in ("kubectl", "helm"):
                self.assertIn("--kubeconfig", call)
        self.assertFalse(any("delete" in call for call in calls))
        self.assertFalse(any("use-context" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
