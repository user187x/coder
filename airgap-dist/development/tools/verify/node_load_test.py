"""Trusted host load observation validation."""
from datetime import datetime, timezone
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import nodeload


class NodeLoadTest(unittest.TestCase):
    def test_records_real_kernel_averages_and_identity(self):
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        self.assertEqual(nodeload.observation('1.25 2.50 3.75 1/400 20', 'node-uid', now), {
            'nodeUID': 'node-uid', 'load1': 1.25, 'load5': 2.5, 'load15': 3.75,
            'collectedAt': now.isoformat()})

    def test_rejects_invalid_kernel_readings(self):
        for value in ('', '1 2', 'nan 0 0', '-1 0 0', 'inf 0 0'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                nodeload.observation(value, 'node-uid')
