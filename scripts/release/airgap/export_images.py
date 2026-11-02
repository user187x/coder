#!/usr/bin/env python3
"""Export pinned release images into the project cache and refresh archive checksums."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-cache", type=Path, help="reuse verified public archives from an earlier release")
    args = parser.parse_args()
    version = (ROOT / "RELEASE_VERSION").read_text().strip()
    destination = ROOT / "build/airgap-cache" / version
    checksums = ROOT / "packaging/airgap/archive-checksums"
    records = {}
    group = None
    for line in (ROOT / "packaging/airgap/images.txt").read_text().splitlines():
        fields = line.split()
        if not fields or fields[0].startswith("#"):
            continue
        if fields[0].startswith("["):
            group = fields[0].strip("[]")
            records[group] = []
            continue
        image, expected = fields[:2]
        name = image.translate(str.maketrans("/:@", "___")) + ".tar.gz"
        target = destination / "images" / group / name
        target.parent.mkdir(parents=True, exist_ok=True)
        existing = checksums / group / "SHA256SUMS"
        known = {parts[1].lstrip("*"): parts[0] for row in existing.read_text().splitlines()
                 if len(parts := row.split()) == 2} if existing.exists() else {}
        saved = args.reuse_cache / "images" / group / name if args.reuse_cache else target
        if not image.startswith("docker.io/mrshll187/") and saved.exists() and known.get(name) == digest(saved):
            if saved.resolve() != target.resolve():
                if target.exists():
                    if digest(target) != known[name]:
                        raise ValueError(f"Existing archive differs: {target}")
                else:
                    try:
                        os.link(saved, target)
                    except OSError:
                        shutil.copyfile(saved, target)
        else:
            info, = json.loads(subprocess.check_output(["docker", "image", "inspect", image], text=True))
            approved = {info["Id"], *(ref.rsplit("@", 1)[-1] for ref in (info.get("RepoDigests") or []))}
            if expected not in approved:
                raise ValueError(f"{image} does not match pinned digest {expected}; recover its verified archive first")
            partial = target.with_suffix(target.suffix + ".partial")
            exporter = subprocess.Popen(["docker", "save", "--platform", "linux/amd64", image], stdout=subprocess.PIPE)
            try:
                with partial.open("wb") as output, gzip.GzipFile(fileobj=output, mode="wb", compresslevel=1, mtime=0) as compressed:
                    shutil.copyfileobj(exporter.stdout, compressed)
                if exporter.wait():
                    raise RuntimeError(f"docker save failed for {image}")
                partial.replace(target)
            finally:
                exporter.stdout.close()
                if exporter.poll() is None:
                    exporter.terminate()
                    exporter.wait()
                partial.unlink(missing_ok=True)
        records[group].append(f"{digest(target)}  {name}\n")
        print(f"Verified {group}/{name}", flush=True)
    for group, entries in records.items():
        text = "".join(sorted(entries))
        (checksums / group).mkdir(parents=True, exist_ok=True)
        (checksums / group / "SHA256SUMS").write_text(text)
        (destination / "images" / group / "SHA256SUMS").write_text(text)
    print(f"Release image cache: {destination}")


if __name__ == "__main__":
    main()
