"""Bundled workspace HTML must never share the dashboard origin."""
import pathlib
import re
import unittest

TEMPLATE = pathlib.Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/charts/coder-workspace/files/main.tf"


class WorkspaceAppOriginsTest(unittest.TestCase):
    def test_every_workspace_http_app_uses_an_isolated_subdomain(self):
        text = TEMPLATE.read_text()
        apps = re.findall(r'resource "coder_app" "([^"]+)" \{(.*?)(?=\nresource |\Z)', text, re.S)
        self.assertTrue(apps)
        for name, body in apps:
            with self.subTest(app=name):
                self.assertRegex(body, r"subdomain\s*=\s*true\b")
        self.assertNotIn(".main/apps/novnc/websockify", text)
        self.assertNotIn(".main/apps/chromium/websockify", text)
        self.assertEqual(text.count("&path=websockify"), 2)


if __name__ == "__main__":
    unittest.main()
