"""Checks for complete, checksum-verified File Browser source inputs."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import build


class SourceTest(unittest.TestCase):
    def test_archive_and_patch_tampering_are_rejected(self):
        for changed in ("source.tar.gz", "workspace.patch"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                entries = []
                for name in ("source.tar.gz", "workspace.patch"):
                    content = name.encode()
                    (root / name).write_bytes(content)
                    entries.append({"path": name, "sha256": hashlib.sha256(content).hexdigest()})
                (root / "manifest.json").write_text(json.dumps({
                    "source": {"archive": entries[0], "patches": entries[1:]},
                }))
                build.verify_source(root)
                (root / changed).write_bytes(b"modified")
                with self.assertRaisesRegex(ValueError, "Source checksum mismatch"):
                    build.verify_source(root)

    def test_source_extracts_with_custom_code_tests_and_locked_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "source"
            build.extract(destination)
            for name in ("LICENSE", "frontend/package-lock.json", "backend/go.sum",
                         "backend/pkg/indexing/symlink_targets.go",
                         "backend/pkg/indexing/symlink_targets_test.go",
                         "backend/internal/web/symlink_containment_test.go",
                         "backend/internal/preview/testdata/IMG_2578.JPG"):
                self.assertTrue((destination / name).is_file(), name)
            self.assertIn("golang.org/x/net v0.60.0", (destination / "backend/go.mod").read_text())
            for name in ("frontend/public/config.generated.yaml", "backend/swagger/docs/swagger.json"):
                self.assertIn("symlinkTargets", (destination / name).read_text(), name)
            with self.assertRaises(FileExistsError):
                build.extract(destination)


if __name__ == "__main__":
    unittest.main()
