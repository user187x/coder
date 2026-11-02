#!/usr/bin/env python3
"""Recover the pinned File Browser build input from a file, image, or workspace pod."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def verify(path):
    expected = json.loads((HERE / "manifest.json").read_text())["sha256"]
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"File Browser checksum mismatch: expected {expected}, got {actual}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", type=Path)
    source.add_argument("--image", help="Docker image containing the pinned binary")
    source.add_argument("--pod", help="Workspace pod containing the pinned binary")
    parser.add_argument("--context", help="Required with --pod")
    parser.add_argument("--namespace", default="coder")
    parser.add_argument("--container", default="workspace")
    args = parser.parse_args()
    if args.pod and not args.context:
        parser.error("--pod requires an explicit --context")
    destination = HERE / "bin/filebrowser-quantum"
    destination.parent.mkdir(exist_ok=True)
    container_path = json.loads((HERE / "manifest.json").read_text())["container_path"]
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        payload = Path(temporary) / destination.name
        if args.file:
            shutil.copyfile(args.file, payload)
        elif args.image:
            container = subprocess.check_output(["docker", "create", args.image], text=True).strip()
            try:
                subprocess.run(["docker", "cp", f"{container}:{container_path}", str(payload)], check=True)
            finally:
                subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)
        else:
            with payload.open("wb") as stream:
                subprocess.run(["kubectl", "--context", args.context, "-n", args.namespace,
                                "exec", args.pod, "-c", args.container, "--", "cat", container_path],
                               stdout=stream, check=True)
        verify(payload)
        payload.chmod(0o755)
        payload.replace(destination)
    print(f"Verified {destination}")


if __name__ == "__main__":
    main()
