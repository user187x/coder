"""The optional research launcher uses the configured image and workspace template."""
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "helm-chart/coder-airgapped/files/ui-updates"))
import imagebuilder


class ResearchSandboxTest(unittest.TestCase):
    def test_list_only_offers_a_valid_configured_research_image(self):
        for image, templates, expected in [
            ("registry.example.test/research:1.5.3", [{"name": "default"}],
             {"image": "registry.example.test/research:1.5.3", "template": "default"}),
            ("", [{"name": "default"}], None),
            ("invalid image", [{"name": "default"}], None),
            ("registry.example.test/research:1.5.3", [], None),
        ]:
            with self.subTest(image=image, templates=templates):
                handler, store = Mock(), Mock()
                handler.send_json.return_value = None
                store.images.return_value = []
                with patch.object(imagebuilder, "STORE", store), \
                     patch.object(imagebuilder, "RESEARCH_IMAGE", image), \
                     patch.object(imagebuilder, "TEMPLATES", templates), \
                     patch.object(imagebuilder, "with_pit", side_effect=lambda images: images):
                    imagebuilder.route(handler, "GET", "", "", {"username": "admin"}, True, True)
                self.assertEqual(handler.send_json.call_args.args[0], 200)
                self.assertEqual(handler.send_json.call_args.args[1]["researchSandbox"], expected)

    def test_chart_research_image_is_optional_and_reaches_the_service(self):
        for image in ["", "registry.example.test/research:1.5.3"]:
            with self.subTest(image=image):
                result = subprocess.run([
                    "helm", "template", "coder", str(ROOT / "helm-chart/coder-airgapped"),
                    "--set-string", "imageBuilder.researchImage=" + image,
                ], check=True, capture_output=True, text=True)
                docs = list(yaml.safe_load_all(result.stdout))
                service = next(d for d in docs if d and d["kind"] == "Deployment"
                               and d["metadata"]["name"] == "coder-ui-updates")
                env = service["spec"]["template"]["spec"]["containers"][0]["env"]
                self.assertEqual(next(v["value"] for v in env if v["name"] == "BUILDER_RESEARCH_IMAGE"), image)


if __name__ == "__main__":
    unittest.main()
