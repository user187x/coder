"""Fixed user CLI requests for an owned, current-build workspace VM."""
import json
import fcntl
import os
import posixpath
import uuid

from vmguest import Guest
from vmprofile import boot_profile

BUILD_INTENT = None


def _run(kube, namespace, pod_name, args, stdin=b'', timeout=180):
    def get(path):
        status, result = kube.call('GET', path)
        if status != 200:
            raise RuntimeError('The workspace VM is not ready for a user command.')
        return result
    pod = get('/api/v1/namespaces/%s/pods/%s' % (namespace, pod_name))
    wid = str(uuid.UUID(pod['metadata']['labels']['com.coder.workspace.id']))
    base = '/apis/kubevirt.io/v1/namespaces/' + namespace
    vm = get(base + '/virtualmachines/coder-vm-' + wid)
    instance = get(base + '/virtualmachineinstances/coder-vm-' + wid)
    secret_name = next(v['cloudInitNoCloud']['secretRef']['name'] for v in instance['spec']['volumes'] if v['name'] == 'cloudinit')
    profile = boot_profile(get('/api/v1/namespaces/%s/secrets/%s' % (namespace, secret_name)))
    intent = BUILD_INTENT(wid, profile['build_id']) if BUILD_INTENT else None
    if not intent or intent.get('job_status') != 'succeeded' or any(intent.get(key) != profile[field] for key, field in (
            ('workspace_id', 'workspace_id'), ('organization_id', 'organization_id'), ('owner_id', 'workspace_owner_id'), ('build_id', 'build_id'))):
        raise RuntimeError('The workspace current build is not ready for a user command.')
    if args == ['list']:
        action, path, mode, decisions = 'list', None, None, {}
    elif len(args) == 2 and args[0] in ('plan', 'unmount', 'check-source'):
        action, path, mode, decisions = args[0], args[1], None, {}
    elif len(args) == 5 and args[0] == 'apply' and args[2] == '--mode' and args[3] in ('ask', 'keep-both', 'overwrite-all') and args[4] == '--decisions=-:%d' % len(stdin):
        action, path, mode, decisions = 'apply', args[1], args[3], json.loads(stdin)
    else:
        raise ValueError('Unsupported workspace Cloud Drive command.')
    if path is not None:
        if path == '~' or path == '~coder':
            path = '/home/coder'
        elif path.startswith('~/'):
            path = '/home/coder/' + path[2:]
        elif path.startswith('~coder/'):
            path = '/home/coder/' + path[len('~coder/'):]
        elif path.startswith('~'):
            raise ValueError('Use an absolute folder or a path relative to /home/coder.')
        if not posixpath.isabs(path):
            path = '/home/coder/' + path
        path = posixpath.normpath(path)
    request = {k: profile[k] for k in ('version', 'workspace_id', 'workspace_owner_id', 'organization_id', 'build_id')}
    request.update(request_id=str(uuid.uuid4()), action=action, path=path, mode=mode, decisions=decisions)
    return Guest(kube, namespace, vm, instance, pod).user_command(request, timeout)


def run(kube, namespace, pod_name, args, stdin=b'', timeout=180):
    """Serialize a workspace's fixed request/result files across service replicas."""
    status, pod = kube.call('GET', '/api/v1/namespaces/%s/pods/%s' % (namespace, pod_name))
    if status != 200:
        raise RuntimeError('The workspace VM is not ready for a user command.')
    wid = str(uuid.UUID(pod.get('metadata', {}).get('labels', {}).get('com.coder.workspace.id', '')))
    directory = os.environ.get('VM_USER_COMMAND_LOCK_DIR', '/data/vm-user-command-locks')
    os.makedirs(directory, mode=0o700, exist_ok=True)
    fd = os.open(os.path.join(directory, wid + '.lock'), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError('Another workspace file operation is running; retry when it finishes.') from exc
        return _run(kube, namespace, pod_name, args, stdin, timeout)
    finally:
        os.close(fd)
