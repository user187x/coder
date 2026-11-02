"""Guest runner exit semantics and isolation arguments."""
import importlib.util
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("sandbox_guest", Path(__file__).with_name("sandbox-guest.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class GuestRunnerTest(unittest.TestCase):
    def test_guest_has_no_host_access_or_network(self):
        args = SimpleNamespace(memory=2048, cpus=2)
        command = runner.command(args, Path("/tmp/a,b.qcow2"), Path("/tmp/job.iso"))
        self.assertEqual(command[command.index("-nic") + 1], "none")
        self.assertEqual(command[command.index("-machine") + 1], "q35,accel=tcg")
        self.assertIn("file=/tmp/a,,b.qcow2,format=qcow2,if=virtio", command)
        self.assertFalse(any(item in command for item in ("-virtfs", "-fsdev", "-enable-kvm", "-netdev")))

    def run_script(self, output, returncode=0):
        with patch.object(sys, "argv", ["sandbox-guest", str(Path(__file__))]), \
             patch.object(subprocess, "run") as run, patch.object(sys, "stdout"):
            run.return_value = subprocess.CompletedProcess([], returncode, output)
            return runner.main()

    def test_returns_guest_script_failure(self):
        self.assertEqual(self.run_script(b"boot\nCODER_SANDBOX_EXIT=7\r\n"), 7)

    def test_missing_result_is_failure(self):
        self.assertEqual(self.run_script(b"Kernel panic\n"), 125)

    def test_panic_after_script_is_failure(self):
        self.assertEqual(self.run_script(b"\nCODER_SANDBOX_EXIT=0\nKernel panic - not syncing\n"), 125)

    def test_failed_emulator_is_failure_even_with_result(self):
        self.assertEqual(self.run_script(b"\nCODER_SANDBOX_EXIT=0\n", 1), 125)

    def test_timeout_is_failure(self):
        with patch.object(sys, "argv", ["sandbox-guest", str(Path(__file__))]), \
             patch.object(subprocess, "run") as run, patch.object(sys, "stdout"), patch.object(sys, "stderr"):
            run.side_effect = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0),
                               subprocess.TimeoutExpired("qemu", 600, output=b"boot\n")]
            self.assertEqual(runner.main(), 124)


if __name__ == "__main__":
    unittest.main()
