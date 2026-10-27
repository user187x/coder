"""Shared links live inside Cloud Drive without removing unrelated home files."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/charts/coder-workspace/files/scripts/cloud-drive.sh"


class SharedDirectoryTest(unittest.TestCase):
    def test_migrate_generated_links_and_preserve_user_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home, mount, items, peers = [root / name for name in ("home", "mount", "items", "peers")]
            for path in (home, mount, items, peers):
                path.mkdir()
            (home / "cloud-drive").symlink_to(mount)
            (items / "grant").write_text("shared content")
            old = home / "cloud-drive-shared" / "admin"
            old.mkdir(parents=True)
            (old / "selected.txt").symlink_to(items / "grant")
            (old / "keep.txt").write_text("local content")
            listing = base64.b64encode(json.dumps([{"id": "grant", "owner": "admin", "item": "selected.txt"}]).encode()).decode()
            script = SCRIPT.read_text().split("write_self() {")[0]
            for key, value in {"link": home / "cloud-drive", "mount": mount, "mode": "mount", "items": listing}.items():
                script = script.replace("${" + key + "}", str(value))
            script = script.replace("$${", "${").replace("PEERS=/mnt/cloud-drive-peers", f"PEERS='{peers}'").replace("ITEMS=/mnt/cloud-drive-items", f"ITEMS='{items}'")
            subprocess.run(["bash", "-c", script + "\nlink_shared\n"], env={**os.environ, "HOME": str(home)}, check=True, capture_output=True)
            self.assertEqual((home / "cloud-drive/Shared/admin/selected.txt").read_text(), "shared content")
            self.assertFalse((old / "selected.txt").is_symlink())
            self.assertEqual((old / "keep.txt").read_text(), "local content")
            self.assertEqual((items / "grant").read_text(), "shared content")


if __name__ == "__main__":
    unittest.main()
