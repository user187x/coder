"""Framed filesystem copy for an offline home volume; runs only in isolated helper pods."""
import base64
import errno
import hashlib
import json
import os
import pathlib
import shutil
import stat
import struct
import sys

CHUNK = 256 * 1024


def entries(root):
    yield '.', root
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        files.sort()
        for name in sorted(dirs + files):
            path = os.path.join(folder, name)
            yield os.path.relpath(path, root), path


def metadata(name, path, links):
    info = os.lstat(path)
    item = dict(name=name, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid,
                gid=info.st_gid, mtime=info.st_mtime_ns,
                attrs={key: base64.b64encode(os.getxattr(path, key, follow_symlinks=False)).decode()
                       for key in sorted(os.listxattr(path, follow_symlinks=False))})
    if stat.S_ISDIR(info.st_mode):
        item['kind'] = 'dir'
    elif stat.S_ISLNK(info.st_mode):
        item.update(kind='link', target=os.readlink(path))
    elif stat.S_ISREG(info.st_mode):
        identity = (info.st_dev, info.st_ino)
        if identity in links:
            item.update(kind='hardlink', target=links[identity])
        else:
            links[identity] = name
            item.update(kind='file', size=info.st_size)
    elif stat.S_ISFIFO(info.st_mode):
        item['kind'] = 'fifo'
    else:
        raise ValueError('Unsupported special file: %s. Remove it before retrying migration.' % name)
    return item


def send(root, output):
    links = {}
    for name, path in entries(root):
        item = metadata(name, path, links)
        encoded = json.dumps(item, sort_keys=True, separators=(',', ':')).encode()
        output(struct.pack('>I', len(encoded)) + encoded)
        if item['kind'] == 'file':
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
            with os.fdopen(fd, 'rb', buffering=0) as source:
                offset = 0
                while offset < item['size']:
                    try:
                        data_offset = os.lseek(fd, offset, os.SEEK_DATA)
                        offset = max(offset, data_offset // CHUNK * CHUNK)
                    except OSError as error:
                        if error.errno == errno.ENXIO:
                            break
                        if error.errno not in (errno.EINVAL, errno.ENOTSUP):
                            raise
                    source.seek(offset)
                    size = min(CHUNK, item['size'] - offset)
                    data = source.read(size)
                    if len(data) != size:
                        raise ValueError('Source file changed while copying: ' + name)
                    # Fixed block boundaries make the digest independent of filesystem extents.
                    if data.count(0) != len(data):
                        output(struct.pack('>QI', offset, size) + data)
                    offset += size
                output(struct.pack('>QI', item['size'], 0))
    output(struct.pack('>I', 0))


def digest(root):
    value = hashlib.sha256()
    send(root, value.update)
    return value.hexdigest()


def exact(stream, size):
    result = bytearray()
    while len(result) < size:
        data = stream.read(size - len(result))
        if not data:
            raise ValueError('Incomplete migration stream')
        result.extend(data)
    return bytes(result)


def safe_path(root, name):
    if name == '.':
        return root
    parts = pathlib.PurePosixPath(name)
    if parts.is_absolute() or '..' in parts.parts or not parts.parts:
        raise ValueError('Invalid path in migration stream')
    path = os.path.join(root, name)
    parent = os.path.dirname(path)
    while parent != root:
        if os.path.islink(parent) or not os.path.isdir(parent):
            raise ValueError('Migration path traverses a link or missing directory')
        parent = os.path.dirname(parent)
    return path


def apply(item, path):
    os.chown(path, item['uid'], item['gid'], follow_symlinks=False)
    if item['kind'] != 'link':
        os.chmod(path, item['mode'])
    for key in os.listxattr(path, follow_symlinks=False):
        if key not in item['attrs']:
            os.removexattr(path, key, follow_symlinks=False)
    for key, value in item['attrs'].items():
        os.setxattr(path, key, base64.b64decode(value), follow_symlinks=False)
    os.utime(path, ns=(item['mtime'], item['mtime']), follow_symlinks=False)


def receive(root, stream):
    # This mount is a new staging volume. The original home is never writable here.
    for entry in os.scandir(root):
        if entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path)
        else:
            os.unlink(entry.path)
    directories = []
    seen = set()
    while True:
        size = struct.unpack('>I', exact(stream, 4))[0]
        if not size:
            break
        if size > 8 * 1024 * 1024:
            raise ValueError('Migration metadata is too large')
        item = json.loads(exact(stream, size))
        name = item['name']
        if name in seen:
            raise ValueError('Duplicate migration entry')
        path = safe_path(root, name)
        kind = item['kind']
        if name == '.' and kind != 'dir':
            raise ValueError('Invalid migration root')
        if kind == 'dir':
            if name != '.':
                os.mkdir(path, 0o700)
            directories.append((item, path))
        elif kind == 'file':
            with open(path, 'xb') as dest:
                end = 0
                while True:
                    offset, size = struct.unpack('>QI', exact(stream, 12))
                    if not size:
                        if offset != item['size']:
                            raise ValueError('Invalid migration file terminator')
                        break
                    if size > CHUNK or offset < end or offset + size > item['size']:
                        raise ValueError('Invalid migration file extent')
                    dest.seek(offset)
                    dest.write(exact(stream, size))
                    end = offset + size
                dest.truncate(item['size'])
                dest.flush()
                os.fsync(dest.fileno())
        elif kind == 'link':
            os.symlink(item['target'], path)
        elif kind == 'hardlink':
            target = safe_path(root, item['target'])
            if item['target'] not in seen or not stat.S_ISREG(os.lstat(target).st_mode):
                raise ValueError('Invalid hard link')
            os.link(target, path, follow_symlinks=False)
        elif kind == 'fifo':
            os.mkfifo(path)
        else:
            raise ValueError('Unsupported migration entry')
        if kind != 'dir':
            apply(item, path)
        seen.add(name)
    if '.' not in seen:
        raise ValueError('Missing migration root')
    for item, path in reversed(directories):
        apply(item, path)
    os.sync()
    print(digest(root), flush=True)


if __name__ == '__main__':
    mode, root = sys.argv[1:]
    if mode == 'send':
        send(root, sys.stdout.buffer.write)
    elif mode == 'receive':
        receive(root, sys.stdin.buffer)
    elif mode == 'digest':
        print(digest(root), flush=True)
    else:
        raise ValueError('Unknown migration mode')
