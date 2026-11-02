#!/usr/bin/env python3
"""Run a disposable research kernel without host privileges or network access."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def command(args, overlay, job=None):
    base = Path("/opt/coder-research/guest")
    result = ["qemu-system-x86_64", "-machine", "q35,accel=tcg", "-cpu", "max",
              "-m", str(args.memory), "-smp", str(args.cpus), "-nodefaults",
              "-display", "none", "-monitor", "none", "-serial", "stdio",
              "-nic", "none", "-no-reboot", "-kernel", str(base / "vmlinuz"),
              "-initrd", str(base / "initrd"), "-drive",
              f"file={str(overlay).replace(',', ',,')},format=qcow2,if=virtio",
              "-append", "root=/dev/vda rw console=ttyS0 panic=1 init=/usr/local/lib/coder-research/init"
              + (" research.run=1" if job else "")]
    if job:
        result += ["-drive", f"file={str(job).replace(',', ',,')},format=raw,media=cdrom,readonly=on"]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("script", nargs="?", type=Path, help="Bash script to run; omit for an interactive guest console")
    parser.add_argument("--memory", type=int, default=2048, help="Guest RAM in MiB (512-8192)")
    parser.add_argument("--cpus", type=int, default=2, help="Guest vCPUs (1-8)")
    parser.add_argument("--timeout", type=int, default=600, help="Script timeout in seconds (1-86400)")
    args = parser.parse_args()
    if not 512 <= args.memory <= 8192 or not 1 <= args.cpus <= 8 or not 1 <= args.timeout <= 86400:
        parser.error("memory, cpus, or timeout is outside its supported range")
    if args.script and not args.script.is_file():
        parser.error("script must name a regular file")
    with tempfile.TemporaryDirectory(prefix="coder-research-") as directory:
        temp = Path(directory)
        overlay = temp / "guest.qcow2"
        subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", "-F", "qcow2", "-b",
                        "/opt/coder-research/guest/guest.qcow2", str(overlay)], check=True)
        iso = None
        if args.script:
            (temp / "job").mkdir()
            shutil.copyfile(args.script, temp / "job" / "run.sh")
            iso = temp / "job.iso"
            subprocess.run(["genisoimage", "-quiet", "-R", "-o", str(iso), str(temp / "job")], check=True)
        try:
            if not args.script:
                return subprocess.run(command(args, overlay), check=False).returncode
            result = subprocess.run(command(args, overlay, iso), stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    timeout=args.timeout, check=False)
            sys.stdout.buffer.write(result.stdout)
            matches = re.findall(rb"(?:^|\n)CODER_SANDBOX_EXIT=(\d+)\r?\n", result.stdout)
            if b"Kernel panic - not syncing" in result.stdout:
                return 125
            return int(matches[-1]) if matches and result.returncode == 0 else 125
        except subprocess.TimeoutExpired as error:
            if error.stdout:
                sys.stdout.buffer.write(error.stdout)
            print("Guest script timed out; disposable guest stopped.", file=sys.stderr)
            return 124


if __name__ == "__main__":
    sys.exit(main())
