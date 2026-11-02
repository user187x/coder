#!/usr/bin/env python3
"""Restore only registered root-private HOME loop devices before kubelet starts."""
import json
import os
import pathlib
import stat
import sys

sys.path.insert(0, '/usr/local/lib/coder-vm')
from vmhome import PARENT, device_for, WorkerIdentityClient, verified_node
from vmprofile import identifier


def main():
    if os.geteuid() != 0:
        raise RuntimeError('HOME devices require worker root')
    if not PARENT.exists():
        return
    identity = None
    errors = False
    for directory in sorted(PARENT.iterdir()):
        if not directory.is_dir() or directory.is_symlink():
            continue
        try:
            identifier(directory.name)
            info = directory.lstat()
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('untrusted HOME state directory')
            if directory.joinpath('operation.json').exists():
                raise RuntimeError('unfinished HOME operation must remain quarantined')
            manifest = directory / 'manifest.json'
            if not manifest.exists():
                continue
            info = manifest.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('untrusted HOME manifest')
            record = json.loads(manifest.read_text())
            if record.get('status') != 'ready' or record['workspace_id'] != directory.name or type(record['home_bytes']) is not int or record['home_bytes'] <= 0:
                raise RuntimeError('invalid HOME manifest')
            if identity is None:
                identity = WorkerIdentityClient()
            verified_node(identity, record, require_ready=False, require_local=False)
            device_for(directory, record['home_bytes'])
        except (ValueError, RuntimeError, OSError, KeyError):
            errors = True
            print(json.dumps({'workspace': directory.name, 'status': 'device-unavailable'}), file=sys.stderr)
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
