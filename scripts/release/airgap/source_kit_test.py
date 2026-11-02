"""Regression checks for portable source kits."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import assemble
import source_kit


class SourceKitTest(unittest.TestCase):
    def test_archived_graphics_are_available_to_the_assembler(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            files = {
                "RELEASE_VERSION": "1.2.3\n",
                "scripts/release/airgap/release/START-HERE.md": "Build instructions\n",
                "images/graphics/logo.txt": "required graphic\n",
                "images/filebrowser/upstream-2.1.2.tar.gz": "pinned source archive\n",
                "images/filebrowser/patches/coder-workspace.patch": "custom changes\n",
                "packaging/airgap/source-layout.json": json.dumps([
                    {"source": "images/graphics", "destination": "airgap-dist/development/graphics"},
                ]),
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "-c", "user.name=Test", "-c", "user.email=test@example.com",
                            "commit", "-qm", "fixture"], check=True)
            archive = source_kit.package(root, Path(temporary) / "output")
            extracted = Path(temporary) / "extracted"
            with tarfile.open(archive) as stream:
                stream.extractall(extracted, filter="data")
            source = extracted / "coder-build-kit-1.2.3"
            self.assertEqual((source / "images/filebrowser/upstream-2.1.2.tar.gz").read_text(), "pinned source archive\n")
            self.assertEqual((source / "images/filebrowser/patches/coder-workspace.patch").read_text(), "custom changes\n")
            self.assertFalse((source / "images/filebrowser/bin/filebrowser-quantum").exists())
            stage = Path(temporary) / "stage"
            stage.mkdir()
            with patch.object(assemble, "ROOT", source):
                assemble.assemble(stage, Path(temporary) / "empty-cache", archives=False)
            self.assertEqual((stage / "airgap-dist/development/graphics/logo.txt").read_text(), "required graphic\n")
            self.assertEqual((source / "RELEASE-COMMIT").read_text().strip(),
                             subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip())

    def test_recovered_input_must_match_the_manifest(self):
        path = Path(__file__).resolve().parents[3] / "images/filebrowser/restore.py"
        spec = importlib.util.spec_from_file_location("restore_filebrowser", path)
        inputs = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inputs)
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "filebrowser"
            payload.write_bytes(b"wrong binary")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                inputs.verify(payload)


if __name__ == "__main__":
    unittest.main()
