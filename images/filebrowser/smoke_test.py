#!/usr/bin/env python3
"""Exercise an actual File Browser binary with workspace-style sources and URLs."""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


@contextmanager
def server(binary, allow):
    with tempfile.TemporaryDirectory(prefix="filebrowser-smoke-") as temporary:
        root = Path(temporary)
        home, drive = root / "home", root / "drive"
        home.mkdir()
        drive.mkdir()
        (drive / "hello.txt").write_text("cloud drive content\n")
        (home / "cloud-drive").symlink_to(drive, target_is_directory=True)
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        config = {
            "http": {"listen": "127.0.0.1", "port": port, "baseURL": "/files/"},
            "server": {"disableUpdateCheck": True, "database": {"path": str(root / "db.sqlite")},
                       "cacheDir": str(root / "cache"), "sources": [{
                           "path": str(home), "name": "home", "config": {
                               "defaultEnabled": True, "symlinkTargets": [str(drive)] if allow else [],
                           },
                       }]},
            "auth": {"methods": {"noauth": True}},
        }
        path = root / "config.yaml"
        path.write_text(json.dumps(config))
        with (root / "server.log").open("w+") as log:
            process = subprocess.Popen([str(binary), "-c", str(path), "--no-input"], cwd=root,
                                       stdout=log, stderr=subprocess.STDOUT)
            base = f"http://127.0.0.1:{port}/files"
            try:
                deadline = time.monotonic() + 30
                while True:
                    try:
                        with urllib.request.urlopen(base + "/health", timeout=1) as response:
                            assert response.status == 200
                        break
                    except (OSError, AssertionError):
                        if process.poll() is not None or time.monotonic() > deadline:
                            log.seek(0)
                            raise RuntimeError("File Browser did not become ready:\n" + log.read())
                        threading.Event().wait(0.1)
                yield base
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def request(url, data=None):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    for allow in (False, True):
        with server(args.binary.resolve(), allow) as base:
            status, listing = request(base + "/api/resources?source=home&path=/")
            assert status == 200, (status, listing)
            folders = {entry["name"] for entry in json.loads(listing).get("folders") or []}
            assert ("cloud-drive" in folders) == allow, folders
            status, body = request(base + "/api/resources?source=home&path=/cloud-drive")
            assert status == (200 if allow else 403), (status, body)
            status, body = request(base + "/api/raw?source=home&file=/cloud-drive/hello.txt")
            assert status == (200 if allow else 403), (status, body)
            if allow:
                assert body == b"cloud drive content\n", body
            status, body = request(base + "/api/resources?source=home&path=/cloud-drive/new.txt", b"written")
            assert status == (200 if allow else 403), (status, body)
            status, html = request(base + "/")
            assert status == 200, status
            assets = set(re.findall(rb'(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"', html))
            assert assets, "Embedded frontend assets are missing"
            for asset in assets:
                url = urllib.parse.urljoin(base + "/", asset.decode())
                assert url.startswith(base + "/"), url
                status, body = request(url)
                assert status == 200 and body, (url, status)
            print(f"PASS allow_targets={allow}: list, read, write, subpath, {len(assets)} embedded assets")


if __name__ == "__main__":
    main()
