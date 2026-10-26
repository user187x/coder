#!/usr/bin/env python3
"""Run a small, fixed user CLI surface without exposing guest-root credentials."""
import fcntl
import json
import os
import pathlib
import posixpath
import subprocess
import sys
import tempfile
import time
import uuid

sys.path.insert(0, '/usr/local/lib/coder-vm')
import private_config
from vmprofile import ProfileError

CONFIG = pathlib.Path('/etc/coder-workspace')
CLI = '/opt/coder-vm-support/clouddrive_cli.py'
MAX_OUTPUT = 1048576
CHECK_SOURCE = '''import json,os,sys
p=sys.argv[1]
ok=p.startswith('/home/coder/') and not p.startswith('/home/coder/.cache/coder-cloud-drive')
if ok:
 try: os.makedirs(p,mode=0o755,exist_ok=True)
 except OSError: pass
 ok=os.path.isdir(p) and os.path.realpath(p)==p
print(json.dumps({'ok':bool(ok)}))
'''


def validate(request, runtime):
    fields = {'version', 'request_id', 'workspace_id', 'workspace_owner_id', 'organization_id', 'build_id',
              'action', 'path', 'mode', 'decisions'}
    if not isinstance(request, dict) or set(request) != fields or type(request['version']) is not int or request['version'] != 1:
        raise ProfileError('Invalid workspace file command')
    for field in ('request_id', 'workspace_id', 'workspace_owner_id', 'organization_id', 'build_id'):
        if str(uuid.UUID(request[field])) != request[field] or (field != 'request_id' and request[field] != runtime.get(field)):
            raise ProfileError('Workspace file command identity does not match its current build')
    action = request['action']
    if action not in ('list', 'plan', 'apply', 'unmount', 'check-source'):
        raise ProfileError('Unsupported workspace file command')
    path = request['path']
    if action == 'list':
        if path is not None:
            raise ProfileError('Listing accepts no path')
    elif not isinstance(path, str) or not path.startswith('/') or posixpath.normpath(path) != path or len(path.encode()) > 900 or any(ord(c) < 32 for c in path):
        raise ProfileError('Workspace path must be normalized and absolute')
    decisions = request['decisions']
    if not isinstance(decisions, dict) or len(decisions) > 100000 or not all(
            isinstance(k, str) and len(k.encode()) <= 900 and v in ('overwrite', 'keep') for k, v in decisions.items()):
        raise ProfileError('Invalid file collision decisions')
    if action == 'apply':
        if request['mode'] not in ('ask', 'keep-both', 'overwrite-all'):
            raise ProfileError('Invalid file collision mode')
    elif request['mode'] is not None or decisions:
        raise ProfileError('This command accepts no collision options')
    return request


def command(request):
    action, path = request['action'], request['path']
    if action == 'check-source':
        arguments, data = ['python3', '-c', CHECK_SOURCE, path], b''
    else:
        arguments, data = ['python3', CLI, action], b''
        if action != 'list':
            arguments.append(path)
        if action == 'apply':
            data = json.dumps(request['decisions']).encode()
            arguments.extend(['--mode', request['mode'], '--decisions=-:%d' % len(data)])
        arguments.append('--json')
    return ['docker', 'exec', '--interactive', '--user', '1000:1000', '--env', 'HOME=/home/coder',
            '--workdir', '/home/coder', 'coder-workspace', 'timeout', '--signal=TERM', '--kill-after=5', '120', *arguments], data


def execute(arguments, data):
    """Bound the result on guest disk before any bytes reach the control plane."""
    with tempfile.TemporaryFile() as input_file, tempfile.TemporaryFile() as output:
        input_file.write(data)
        input_file.seek(0)
        process = subprocess.Popen(arguments, stdin=input_file, stdout=output, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 150
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > MAX_OUTPUT:
                    raise ProfileError('Workspace file command exceeded its time or output bound')
                time.sleep(0.05)
            if os.fstat(output.fileno()).st_size > MAX_OUTPUT:
                raise ProfileError('Workspace file command returned too much data')
            output.seek(0)
            raw = output.read(MAX_OUTPUT + 1)
            result = json.loads(raw.strip().splitlines()[-1])
            if not isinstance(result, dict):
                raise ProfileError('Workspace file command returned an invalid result')
            if process.returncode or result.get('error'):
                raise ProfileError(str(result.get('error') or 'Workspace file command failed')[:1000])
            return process.returncode, result
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def main():
    request_id = None
    try:
        if os.geteuid() != 0:
            raise ProfileError('The guest user command adapter must be root-owned')
        runtime = private_config.trusted_json(CONFIG / 'runtime.json')
        request = validate(private_config.trusted_staging_json(CONFIG / 'user-command.next'), runtime)
        request_id = request['request_id']
        lock = CONFIG / 'user-command.lock'
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            private_config.verify_container(runtime)
            args, data = command(request)
            rc, result = execute(args, data)
            response = {'request_id': request_id, 'exit_code': rc, 'result': result}
    except Exception as error:
        # This adapter never reads root mount credentials or passes them to user code.
        response = {'request_id': request_id, 'error': str(error)[:1000] if isinstance(error, ProfileError) else 'Workspace file command failed'}
    private_config.atomic(CONFIG / 'user-command-result.json', json.dumps(response))
    return 0


if __name__ == '__main__':
    sys.exit(main())
