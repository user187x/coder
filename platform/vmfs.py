"""Parse tenant filesystems only inside an isolated, unprivileged fixed appliance."""
import ctypes
import os
import math
import pathlib
import posixpath
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOTFS = pathlib.Path('/opt/coder-vmfs/rootfs')
APPLIANCE = '/opt/coder-vmfs/appliance'
MAX_SECONDS = 18000
SCRATCH_BYTES = 5 * 1073741824
MAX_APPLIANCE_ROOT = 4 * 1073741824
MAX_BOOT_BYTES = 64 * 1048576


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def regular(path, size=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (size is not None and info.st_size != size):
        os.close(fd)
        raise RuntimeError('Maintenance file identity or capacity changed.')
    return fd, info


def copy_file(source, target, size):
    source_fd, _ = regular(source, size)
    try:
        with os.fdopen(source_fd, 'rb') as src, target.open('xb') as dst:
            for block in iter(lambda: src.read(1048576), b''):
                if any(block):
                    dst.write(block)
                else:
                    dst.seek(len(block), 1)
            dst.truncate(size)
            dst.flush()
            os.fsync(dst.fileno())
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def processes(uid):
    found = []
    for path in pathlib.Path('/proc').glob('[0-9]*/status'):
        try:
            fields = path.read_text(errors='replace').splitlines()
            user = next(line for line in fields if line.startswith('Uid:')).split()[1:]
            if str(uid) in user:
                found.append(int(path.parent.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found


def stop_children(uid):
    for pid in processes(uid):
        try:
            descriptor = os.pidfd_open(pid)
        except ProcessLookupError:
            continue
        try:
            if pid in processes(uid):
                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        finally:
            os.close(descriptor)
    deadline = time.monotonic() + 10
    while processes(uid):
        if time.monotonic() > deadline:
            raise RuntimeError('Maintenance children have not exited; no disk commit is allowed.')
        time.sleep(0.05)


def available():
    for path in (ROOTFS / 'usr/bin/python3', ROOTFS / 'app/vmfs.py', ROOTFS / 'opt/coder-vmfs/appliance/kernel', ROOTFS / 'opt/coder-vmfs/appliance/initrd', ROOTFS / 'opt/coder-vmfs/appliance/root'):
        if not path.is_file():
            raise RuntimeError('The pinned filesystem maintenance appliance is unavailable.')
    root = ROOTFS / 'opt/coder-vmfs/appliance'
    root_size = (root / 'root').stat().st_size
    boot_size = (root / 'kernel').stat().st_size + (root / 'initrd').stat().st_size
    if root_size <= 0 or root_size > MAX_APPLIANCE_ROOT or boot_size <= 0 or boot_size > MAX_BOOT_BYTES:
        raise RuntimeError('The maintenance appliance exceeds its reserved scratch policy.')


def operate(raw, action, archive=None, size=None):
    """Work on a private raw copy; commit only after every isolated child exits."""
    if action not in ('grow', 'backup', 'restore'):
        raise ValueError('Unsupported maintenance operation.')
    raw = pathlib.Path(raw)
    fd, original = regular(raw)
    os.close(fd)
    if original.st_uid != 0 or original.st_mode & 0o077:
        raise RuntimeError('Maintenance requires a root-private raw disk.')
    expected = size if action == 'grow' else original.st_size
    if type(expected) is not int or expected < original.st_size or expected % 512:
        raise ValueError('Invalid maintenance disk capacity.')
    available()
    uid = 100000000 + uuid.uuid4().int % 900000000
    if processes(uid):
        raise RuntimeError('Maintenance identity is already in use.')
    with tempfile.TemporaryDirectory(prefix='vmfs-', dir=raw.parent) as folder, tempfile.TemporaryDirectory(prefix='coder-vmfs-root-') as jail:
        work = pathlib.Path(folder)
        disk = work / 'home.raw'
        copy_file(raw, disk, original.st_size)
        with disk.open('r+b') as stream:
            stream.truncate(expected)
        if action == 'restore':
            archive_fd, info = regular(archive)
            os.close(archive_fd)
            copy_file(pathlib.Path(archive), work / 'archive.tar.gz', info.st_size)
        for path in work.iterdir():
            os.chown(path, uid, uid)
            path.chmod(0o600)
        os.chown(work, uid, uid)
        process = subprocess.Popen(['/usr/bin/unshare', '--mount', '--net', '--pid', '--ipc', '--uts', '--fork', '--kill-child=KILL', '--propagation', 'private', sys.executable, __file__, '--supervise', jail, str(work), action, str(expected), str(uid)], env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'}, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)
        try:
            if process.wait(timeout=MAX_SECONDS) != 0:
                raise RuntimeError('The isolated filesystem operation failed; the original disk was not committed.')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            stop_children(uid)
        current_fd, current = regular(raw, original.st_size)
        os.close(current_fd)
        if (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
            raise RuntimeError('HOME identity changed before maintenance commit.')
        disk_fd, result = regular(disk, expected)
        os.close(disk_fd)
        if result.st_uid != uid:
            raise RuntimeError('Maintenance work disk ownership changed.')
        if action == 'backup':
            output = work / 'archive.tar.gz'
            output_fd, output_info = regular(output)
            os.close(output_fd)
            if output_info.st_size > original.st_size + 64 * 1048576:
                raise RuntimeError('Maintenance archive exceeds its capacity budget.')
            copy_file(output, pathlib.Path(archive), output_info.st_size)
            pathlib.Path(archive).chmod(0o600)
            return
        # Preserve the raw inode used by the private loop, retaining the caller's safety copy.
        source_fd, _ = regular(disk, expected)
        target_fd = os.open(raw, os.O_WRONLY | os.O_NOFOLLOW)
        try:
            identity = os.fstat(target_fd)
            if (identity.st_dev, identity.st_ino, identity.st_size) != (original.st_dev, original.st_ino, original.st_size):
                raise RuntimeError('HOME changed at the maintenance commit fence.')
            with os.fdopen(source_fd, 'rb') as source, os.fdopen(target_fd, 'wb', closefd=False) as target:
                shutil.copyfileobj(source, target, 1048576)
                target.truncate(expected)
                target.flush()
                os.fsync(target.fileno())
        finally:
            os.close(target_fd)


def supervise(jail, work, action, size, uid):
    """Build a credential-free mount/network/PID sandbox before dropping authority."""
    jail = pathlib.Path(jail)
    run('mount', '--bind', str(ROOTFS), str(jail))
    run('mount', '-o', 'remount,bind,ro', str(jail))
    for name in ('tmp', 'run', 'dev'):
        run('mount', '-t', 'tmpfs', '-o', 'nosuid,nodev,size=512m,mode=1777', 'tmpfs', str(jail / name))
    run('mount', '-t', 'proc', '-o', 'nosuid,nodev,noexec', 'proc', str(jail / 'proc'))
    for name, minor in (('null', 3), ('zero', 5), ('random', 8), ('urandom', 9)):
        device = jail / 'dev' / name
        os.mknod(device, stat.S_IFCHR | 0o666, os.makedev(1, minor))
        os.chmod(device, 0o666)
    # /dev must permit the four explicit character devices, and nothing else.
    run('mount', '-o', 'remount,nosuid,dev', str(jail / 'dev'))
    run('mount', '--bind', work, str(jail / 'work'))
    os.chroot(jail)
    os.chdir('/work')
    resource.setrlimit(resource.RLIMIT_FSIZE, (int(size) + 64 * 1048576,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NPROC, (128, 128))
    libc = ctypes.CDLL(None, use_errno=True)
    for capability in range(64):
        result = libc.prctl(24, capability, 0, 0, 0)
        if result != 0 and ctypes.get_errno() != 22:
            raise RuntimeError('Cannot drop maintenance capabilities.')
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise RuntimeError('Cannot prohibit maintenance privilege acquisition.')
    os.setgroups([])
    os.setgid(int(uid))
    os.setuid(int(uid))
    class Header(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('pid', ctypes.c_int)]
    class Capabilities(ctypes.Structure):
        _fields_ = [('effective', ctypes.c_uint32), ('permitted', ctypes.c_uint32), ('inheritable', ctypes.c_uint32)]
    header = Header(0x20080522, 0)
    capabilities = (Capabilities * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(capabilities)) != 0:
        raise RuntimeError('Cannot clear maintenance capability sets.')
    environment = {'PATH': '/usr/bin:/bin', 'HOME': '/work', 'TMPDIR': '/work', 'LIBGUESTFS_PATH': APPLIANCE, 'LIBGUESTFS_BACKEND': 'direct', 'LIBGUESTFS_BACKEND_SETTINGS': 'force_tcg', 'LIBGUESTFS_CACHEDIR': '/work'}
    os.execve('/usr/bin/python3', ['python3', '/app/vmfs.py', '--appliance', action, size], environment)


def restore_files(guest, path):
    """Apply validated normal files, then hard links, then all symbolic links."""
    import tarfile
    with tarfile.open(path, 'r:gz') as archive:
        members = {posixpath.normpath(member.name): member for member in archive}
        members.pop('.coder-backup.json', None)
        for name in guest.ls('/'):
            guest.rm_rf('/' + name)
        def destination(name):
            value = '/' + name if name != '.' else '/'
            guest.mkdir_p(posixpath.dirname(value))
            return value
        def attributes(path, member, link=False):
            signed = lambda value: value if value < 2147483648 else value - 4294967296
            guest.lchown(signed(member.uid), signed(member.gid), path)
            if not link:
                guest.chmod(member.mode & 0o7777, path)
            seconds = math.floor(member.mtime)
            nanos = int((member.mtime - seconds) * 1000000000)
            guest.utimens(path, seconds, nanos, seconds, nanos)
        directories = [(name, member) for name, member in members.items() if member.isdir()]
        for name, _ in sorted(directories, key=lambda entry: entry[0].count('/')):
            guest.mkdir_p(destination(name))
        for name, member in members.items():
            if member.isfile():
                target = destination(name)
                guest.touch(target)
                offset = 0
                with archive.extractfile(member) as source:
                    for block in iter(lambda: source.read(1048576), b''):
                        if guest.pwrite(target, block, offset) != len(block):
                            raise RuntimeError('Incomplete appliance file write.')
                        offset += len(block)
                attributes(target, member)
        for name, member in members.items():
            if member.islnk():
                guest.ln('/' + posixpath.normpath(member.linkname), destination(name))
        for name, member in members.items():
            if member.issym():
                target = destination(name)
                guest.ln_s(member.linkname, target)
                attributes(target, member, True)
        for name, member in sorted(directories, key=lambda entry: entry[0].count('/'), reverse=True):
            attributes(destination(name), member)


def appliance(action, size):
    import guestfs
    import vmbackup
    if os.getuid() == 0 or action not in ('grow', 'backup', 'restore'):
        raise RuntimeError('Invalid isolated appliance authority.')
    if action == 'restore':
        vmbackup.check_archive('/work/archive.tar.gz', size)
    guest = guestfs.GuestFS(python_return_dict=True)
    guest.set_backend('direct')
    guest.set_network(False)
    guest.set_memsize(512)
    guest.add_drive_opts('/work/home.raw', format='raw', readonly=False)
    try:
        guest.launch()
        if guest.blockdev_getsize64('/dev/sda') != size:
            raise RuntimeError('Appliance disk capacity differs.')
        if action == 'grow':
            guest.e2fsck('/dev/sda', correct=True)
            guest.resize2fs('/dev/sda')
            guest.e2fsck('/dev/sda', correct=True)
        else:
            guest.e2fsck('/dev/sda', correct=True)
            guest.mount_vfs('ro,noload,nodev,nosuid,noexec' if action == 'backup' else 'rw,nodev,nosuid,noexec', 'ext4', '/dev/sda', '/')
            if action == 'backup':
                guest.tar_out('/', '/work/archive.tar.gz', compress='gzip', numericowner=True)
            else:
                restore_files(guest, '/work/archive.tar.gz')
            guest.umount_all()
        guest.sync()
        guest.shutdown()
    finally:
        guest.close()


if __name__ == '__main__':
    try:
        if sys.argv[1] == '--supervise':
            supervise(*sys.argv[2:])
        elif sys.argv[1] == '--appliance':
            appliance(sys.argv[2], int(sys.argv[3]))
        else:
            raise ValueError('Unsupported maintenance entrypoint.')
    except BaseException:
        print('Isolated filesystem maintenance failed.', file=sys.stderr)
        sys.exit(1)
