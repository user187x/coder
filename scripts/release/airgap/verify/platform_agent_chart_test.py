"""Validate the native workspace service contract in the release chart."""
import json
from pathlib import Path
import subprocess
import unittest

import yaml

CHART = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped"


class PlatformAgentChartTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rendered = subprocess.run(["helm", "template", "native-test", str(CHART), "-n", "native-test"],
                                  check=True, capture_output=True, text=True)
        cls.docs = {(d["kind"], d["metadata"]["name"]): d for d in yaml.safe_load_all(rendered.stdout) if d}

    def test_native_agent_manifest_and_startup_shell(self):
        config = json.loads(self.docs[("ConfigMap", "coder-platform-agent")]["data"]["agent.json"])
        self.assertEqual({s["display_name"] for s in config["scripts"]}, {"Certificates", "Lock Down", "Cloud Drive"})
        self.assertEqual(len({m["key"] for m in config["metadata"]}), 10)
        for script in config["scripts"]:
            with self.subTest(script=script["display_name"]):
                self.assertTrue(script["run_on_start"])
                self.assertTrue(script["start_blocks_login"])
                result = subprocess.run(["bash", "-n"], input=script["script"], text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_template_contains_only_workspace_logic(self):
        config = next(d for (kind, name), d in self.docs.items()
                      if kind == "ConfigMap" and name.endswith("-terraform"))
        main = config["data"]["main.tf"]
        self.assertNotIn("# platform:", main)
        self.assertNotIn('resource "coder_script"', main)
        self.assertNotIn('"cloud_drive" {', main)
        self.assertIn('"platform.coder/code-server-ha"', main)

    def test_native_services_require_admission(self):
        result = subprocess.run(["helm", "template", "native-test", str(CHART), "--set", "platformWebhook.enabled=false"],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("platform agent features require", result.stderr)

    def test_disabling_cloud_drive_removes_its_agent_service(self):
        result = subprocess.run(["helm", "template", "native-test", str(CHART), "--set", "global.userStorage.enabled=false"],
                                check=True, capture_output=True, text=True)
        config = next(d for d in yaml.safe_load_all(result.stdout)
                      if d and d["kind"] == "ConfigMap" and d["metadata"]["name"] == "coder-platform-agent")
        agent = json.loads(config["data"]["agent.json"])
        self.assertNotIn("Cloud Drive", [s["display_name"] for s in agent["scripts"]])
        self.assertEqual(len(agent["metadata"]), 9)


if __name__ == "__main__":
    unittest.main()
