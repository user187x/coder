"""Tests for the source-to-installer assembly boundary."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("airgap_assemble", Path(__file__).with_name("assemble.py"))
assemble = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assemble)


class AssemblyTest(unittest.TestCase):
    def test_installer_sources_are_snapshots_and_exclude_generated_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            root.mkdir()
            service = root / "platform"
            service.mkdir()
            (service / "service.py").write_text("source\n")
            (service / "service.pyc").write_bytes(b"cache")
            online = service / "online"
            online.mkdir()
            (online / "service.py").write_text("different implementation\n")
            layout = root / "packaging/airgap/source-layout.json"
            layout.parent.mkdir(parents=True)
            layout.write_text(json.dumps([{
                "source": "platform", "destination": "airgap-dist/service", "exclude": ["online"],
            }]))
            stage = Path(temporary) / "stage"
            stage.mkdir()
            with patch.object(assemble, "ROOT", root):
                assemble.assemble(stage, Path(temporary) / "cache", archives=False)
            (service / "service.py").write_text("edited afterward\n")
            output = stage / "airgap-dist/service"
            self.assertEqual((output / "service.py").read_text(), "source\n")
            self.assertFalse((output / "service.pyc").exists())
            self.assertFalse((output / "online").exists())

    def test_archives_are_optional_and_survive_stage_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            layout = root / "packaging/airgap/source-layout.json"
            layout.parent.mkdir(parents=True)
            layout.write_text("[]\n")
            cache = Path(temporary) / "cache"
            archive = cache / "images/ui/image.tar.gz"
            archive.parent.mkdir(parents=True)
            archive.write_bytes(b"saved image")
            with patch.object(assemble, "ROOT", root):
                for enabled in [False, True]:
                    with tempfile.TemporaryDirectory() as stage:
                        destination = Path(stage)
                        assemble.assemble(destination, cache, archives=enabled)
                        output = destination / "airgap-dist/helm-chart/images/ui/image.tar.gz"
                        self.assertEqual(output.exists(), enabled)
                        if enabled:
                            self.assertFalse(output.is_symlink())
                            self.assertEqual(output.read_bytes(), b"saved image")
            self.assertEqual(archive.read_bytes(), b"saved image")


if __name__ == "__main__":
    unittest.main()
