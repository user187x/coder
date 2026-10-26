"""Seal the trusted Neko browser client without following links or unsafe paths."""
import hashlib
import json
import pathlib
import re
import stat
import sys

LIMIT = 32 * 1024 * 1024
MANIFEST = 'coder-neko-client.json'


def normalize_entrypoints(root):
    """Remove webpack's temporary-path-dependent entrypoint names without changing JS."""
    root = pathlib.Path(root)
    index = (root / 'index.html').read_text()
    entries = sorted((root / 'js').glob('app*.js'))
    if len(entries) != 2:
        raise ValueError('Expected exactly the pinned modern and legacy app entrypoints.')
    for source in entries:
        match = re.fullmatch(r'(app(?:-legacy)?)\.[0-9a-f]{8}\.js', source.name)
        if not match or not stat.S_ISREG(source.lstat().st_mode):
            raise ValueError('Unexpected app entrypoint.')
        digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
        target = source.with_name('%s.%s.js' % (match[1], digest))
        old, new = source.relative_to(root).as_posix(), target.relative_to(root).as_posix()
        if old not in index or target.exists():
            raise ValueError('App entrypoint reference is missing or ambiguous.')
        index = index.replace(old, new)
        source.rename(target)
    (root / 'index.html').write_text(index)


def seal(root):
    root = pathlib.Path(root)
    files = {}
    total = 0
    for path in sorted(root.rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Client assets must be regular files.')
        name = path.relative_to(root).as_posix()
        if (name == MANIFEST or not re.fullmatch(r'[A-Za-z0-9_@+./-]+', name)
                or any(part in ('', '.', '..') for part in name.split('/'))):
            raise ValueError('Client asset path is invalid or reserved.')
        size = path.stat().st_size
        total += size
        if total > LIMIT:
            raise ValueError('Client assets exceed the 32 MiB limit.')
        files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not files.get('index.html') or not files.get('LICENSE-neko.txt'):
        raise ValueError('Client entrypoint and upstream license are required.')
    value = {'version': 1, 'protocol': 'neko-v3.1.6-legacy', 'relay_only': True, 'files': files}
    encoded = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    if total + len(encoded) > LIMIT:
        raise ValueError('Client assets and manifest exceed the 32 MiB limit.')
    (root / MANIFEST).write_bytes(encoded)
    return hashlib.sha256(encoded).hexdigest(), len(files), total + len(encoded)


if __name__ == '__main__':
    normalize_entrypoints(sys.argv[1])
    digest, count, size = seal(sys.argv[1])
    print('manifest_sha256=%s files=%d bytes=%d' % (digest, count, size))
