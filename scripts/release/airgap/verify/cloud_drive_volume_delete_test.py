"""Deleting Cloud Drive account volumes from the Network page: only unmounted account volumes, files untouched."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/files/ui-updates/clusternet.py"
spec = importlib.util.spec_from_file_location("clusternet_volumes", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CloudDriveVolumeDeleteTest(unittest.TestCase):
    def setUp(self):
        module.SAFE = Mock(ENABLED=True, CLAIM_PREFIX="coder-safe-")
        module.SAFE.claims_in_use.return_value = {"coder-safe-busy"}
        module.LOG = Mock()

    def test_deletes_unmounted_account_volumes_only(self):
        out = module.delete_cloud_drive_volumes(
            {"names": ["coder-safe-idle", "coder-safe-busy", "coder-image-registry", "coder-safe-idle"]},
            {"username": "admin"})
        self.assertEqual(out["deleted"], ["coder-safe-idle"])
        self.assertEqual([s["name"] for s in out["skipped"]], ["coder-safe-busy", "coder-image-registry"])
        module.SAFE.remove_volume.assert_called_once_with("coder-safe-idle")

    def test_refuses_bad_requests_and_a_disabled_drive(self):
        for body in ({}, {"names": []}, {"names": "coder-safe-x"}, {"names": [1]}):
            with self.assertRaises(ValueError):
                module.delete_cloud_drive_volumes(body, {})
        module.SAFE.ENABLED = False
        with self.assertRaises(ValueError):
            module.delete_cloud_drive_volumes({"names": ["coder-safe-x"]}, {})
        module.SAFE.remove_volume.assert_not_called()


if __name__ == "__main__":
    unittest.main()
