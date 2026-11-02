#!/usr/bin/env python3
"""Package committed source with an optional verified File Browser binary."""
import argparse
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile


def package(root, output, include_binary=True):
    version = subprocess.check_output(["git", "-C", str(root), "show", "HEAD:RELEASE_VERSION"], text=True).strip()
    name = f"coder-build-kit-{version}"
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"{name}.tar.gz"
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary) / name
        stage.mkdir()
        archive = subprocess.Popen(["git", "-C", str(root), "archive", "HEAD"], stdout=subprocess.PIPE)
        try:
            subprocess.run(["tar", "--exclude=docs/images", "-xf", "-", "-C", str(stage)],
                           stdin=archive.stdout, check=True)
        finally:
            archive.stdout.close()
            result = archive.wait()
        if result:
            raise RuntimeError("git archive failed")
        payload = root / "images/filebrowser/bin/filebrowser-quantum"
        if include_binary and payload.is_file():
            spec = importlib.util.spec_from_file_location("filebrowser_input", stage / "images/filebrowser/restore.py")
            inputs = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(inputs)
            inputs.verify(payload)
            destination = stage / payload.relative_to(root)
            destination.parent.mkdir(parents=True)
            shutil.copy2(payload, destination)
        revision = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True)
        (stage / "RELEASE-COMMIT").write_text(revision)
        shutil.copy2(stage / "scripts/release/airgap/release/START-HERE.md", stage / "START-HERE.md")
        with tarfile.open(target, "w:gz") as archive:
            archive.add(stage, arcname=name)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-only", action="store_true", help="omit the prebuilt binary; rebuild it from included source")
    args = parser.parse_args()
    print(package(Path(__file__).resolve().parents[3], args.output.resolve(), not args.source_only))


if __name__ == "__main__":
    main()
