"""Bundled workspace HTML must never share the dashboard origin."""
import pathlib
import re
import unittest
from urllib.parse import parse_qs, urlsplit

TEMPLATE = pathlib.Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/charts/coder-workspace/files/main.tf"


class WorkspaceAppOriginsTest(unittest.TestCase):
    def setUp(self):
        self.apps = dict(re.findall(r'resource "coder_app" "([^"]+)" \{(.*?)(?=\nresource |\Z)', TEMPLATE.read_text(), re.S))

    def test_every_workspace_http_app_uses_an_isolated_subdomain(self):
        self.assertTrue(self.apps)
        for name, body in self.apps.items():
            with self.subTest(app=name):
                self.assertRegex(body, r"subdomain\s*=\s*true\b")

    def test_desktop_websocket_path_is_relative_to_its_app_host(self):
        url = re.search(r'\burl\s*=\s*"([^"]+)"', self.apps["novnc"]).group(1)
        self.assertEqual(parse_qs(urlsplit(url).query)["path"], ["websockify"])

    def test_filebrowser_proxy_does_not_prepend_its_base_path_twice(self):
        body = self.apps["filebrowser"]
        url = re.search(r'\burl\s*=\s*"([^"]+)"', body).group(1)
        self.assertEqual(url, "http://localhost:13339/")
        self.assertRegex(body, r'healthcheck\s*\{\s*url\s*=\s*"http://localhost:13339/@\$\{data.coder_workspace_owner.me.name\}/\$\{data.coder_workspace.me.name\}.main/apps/filebrowser/health"')


if __name__ == "__main__":
    unittest.main()
