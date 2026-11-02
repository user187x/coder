#!/usr/bin/env python3
"""Build the pinned File Browser source and install only a verified binary."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

import restore

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def verify_source(directory=HERE):
    manifest = json.loads((directory / "manifest.json").read_text())
    source = manifest["source"]
    for entry in [source["archive"], *source["patches"]]:
        path = directory / entry["path"]
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != entry["sha256"]:
            raise ValueError(f"Source checksum mismatch: {path}")
    return manifest


def extract(destination, directory=HERE):
    manifest = verify_source(directory)
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(directory / manifest["source"]["archive"]["path"], "r:gz") as archive:
        archive.extractall(destination, filter="data")
    for patch in manifest["source"]["patches"]:
        subprocess.run(["patch", "--batch", "--forward", "--strip=1", "--directory", str(destination),
                        "--input", str((directory / patch["path"]).resolve())], check=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-source", action="store_true", help="verify source hashes without building")
    mode.add_argument("--extract", type=Path, help="extract patched source to a new directory")
    args = parser.parse_args()
    manifest = verify_source()
    if args.check_source:
        print("File Browser source hashes verified")
        return
    if args.extract:
        extract(args.extract.resolve())
        return
    build = ROOT / "build/filebrowser"
    build.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=build, prefix="source-") as temporary:
        context = Path(temporary)
        extract(context / "source")
        shutil.copyfile(HERE / "Dockerfile", context / "Dockerfile")
        output = build / "output"
        subprocess.run(["docker", "build", "--platform", "linux/amd64",
                        "--build-arg", f"VERSION={manifest['version']}",
                        "--build-arg", f"REVISION={manifest['source']['binary_revision']}",
                        "--output", f"type=local,dest={output}", str(context)], check=True)
        candidate = output / "filebrowser-quantum"
        restore.verify(candidate)
        destination = HERE / "bin/filebrowser-quantum"
        destination.parent.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            pending = Path(stream.name)
        try:
            shutil.copyfile(candidate, pending)
            pending.chmod(0o755)
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
    print(f"Built and verified {destination}")


if __name__ == "__main__":
    main()
