#!/usr/bin/env python3
"""Assemble the installer layout from canonical repository sources."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]


def assemble(destination, cache, archives):
    """Keep installer-specific paths in generated output rather than source."""
    layout = json.loads((ROOT / "packaging/airgap/source-layout.json").read_text())
    for entry in ROOT.iterdir():
        if entry.name not in {".git", "build", "airgap-dist"}:
            (destination / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
    (destination / "build").symlink_to(ROOT / "build", target_is_directory=True)
    for entry in layout:
        if "link" in entry:
            target = destination / entry["destination"]
            target.unlink(missing_ok=True)
            target.symlink_to(entry["link"])
            continue
        source = ROOT / entry["source"]
        target = destination / entry["destination"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            excluded = ["__pycache__", "*.pyc", ".pytest_cache", *entry.get("exclude", [])]
            shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns(*excluded))
        else:
            shutil.copy2(source, target)
    if archives:
        for source in sorted((cache / "images").glob("*/*.tar.gz")):
            target = destination / "airgap-dist/helm-chart/images" / source.parent.name / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(source, target)
            except OSError:
                shutil.copyfile(source, target)
    payload = ROOT / "images/filebrowser/bin/filebrowser-quantum"
    if payload.is_file():
        shutil.copy2(payload, destination / "airgap-dist/filebrowser-quantum")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true", help="validate and preview the release")
    mode.add_argument("--unit", action="store_true", help="run the platform and chart unit suites")
    mode.add_argument("--check", action="store_true", help="check sources without image archives")
    mode.add_argument("--verify-bundle", action="store_true", help="check sources and cached image archives")
    mode.add_argument("--tool", help="run a release helper relative to scripts/release/airgap")
    parser.add_argument("--out", type=Path, help="release output directory")
    parser.add_argument("--cache-dir", type=Path, help="release cache containing images/")
    parser.add_argument("args", nargs=argparse.REMAINDER, help="helper arguments after --")
    args = parser.parse_args()
    if args.check or args.verify_bundle:
        result = subprocess.run(["python3", str(ROOT / "images/filebrowser/build.py"), "--check-source"], check=False)
        if result.returncode:
            return result.returncode
    version = (ROOT / "RELEASE_VERSION").read_text().strip()
    build = ROOT / "build"
    cache = args.cache_dir or build / "airgap-cache" / version
    build.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="airgap-source-", dir=build) as temporary:
        stage = Path(temporary)
        assemble(stage, cache, archives=not (args.check or args.unit))
        tools = stage / "airgap-dist/development/tools"
        if args.tool:
            artifact_output = (args.out or build / "airgap-artifacts" / version).resolve()
            artifact_output.mkdir(parents=True, exist_ok=True)
            (stage / "airgap-dist/dist").symlink_to(artifact_output, target_is_directory=True)
            relative = Path(args.tool)
            if relative.is_absolute() or ".." in relative.parts:
                parser.error("--tool must stay inside the release helpers")
            tool = (tools / relative).resolve()
            if not tool.is_relative_to(stage / "airgap-dist") or not tool.is_file():
                parser.error("--tool must name an existing release helper")
            extra = args.args[1:] if args.args[:1] == ["--"] else args.args
            command = (["python3"] if tool.suffix == ".py" else ["bash"]) + [str(tool), *extra]
        elif args.unit:
            command = ["python3", "-m", "unittest", "discover", "-s", str(tools / "verify"), "-p", "*_test.py"]
        elif args.check or args.verify_bundle:
            command = ["python3", str(tools / "verify/chart_checks.py")]
            if args.check:
                command.append("--source-only")
        else:
            command = ["bash", str(tools / "build-release.sh"), "--out", str((args.out or build / f"airgap/{version}").resolve())]
            if args.plan:
                command.append("--plan")
        return subprocess.run(command, cwd=stage, env={**os.environ, "CODER_SOURCE_ROOT": str(ROOT)}, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
