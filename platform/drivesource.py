"""A workspace directory as its owner's Cloud Drive (safe.py, "the source"): this S3 server runs in the source workspace
(the platform service starts it there through the exec API, as the workspace's user) and serves that directory, file
for file, to the owner's other workspaces - their Cloud Drive volume mounts it with GeeseFS, as it mounts S3 - and to
the Workspaces page's Cloud Drive window. Python's standard library only (the workspace image has python3).

    python3 drivesource.py CONFIG      CONFIG (JSON, 0600): root, bucket, prefix, accessKey, secretKey, region, port

What GeeseFS and the platform's client use, and nothing more: ListObjects (v1 and v2, with or without a delimiter),
HEAD / GET (ranges) / PUT / DELETE of an object, CopyObject, multipart uploads (UploadPartCopy too), DeleteObjects,
HeadBucket, GetBucketLocation. Every request is signed (AWS Signature Version 4, headers) with the key the platform
keeps for this source; a signed payload hash and a Content-MD5 are checked. Objects are the bucket's keys under prefix
(the owner's id): key <prefix>a/b.txt is <root>/a/b.txt, a key ending in / an (empty) directory. Symbolic links,
devices and names that are not UTF-8 are left out, and nothing outside root is ever reached (each parent is resolved
and must stay under it). A write lands in a hidden file beside its target, renamed into place when complete.

GET /__health (unsigned) answers {"ok": true, "version", "config"}: the platform's check that this server runs with
its current configuration.
"""
import base64
import ctypes
import datetime
import email.utils
import hashlib
import hmac
import http.server
import json
import mimetypes
import os
import shutil
import select
import socketserver
import sqlite3
import stat
import struct
import sys
import threading
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

VERSION = "2"
NS = "http://s3.amazonaws.com/doc/2006-03-01/"
TMP = ".cloud-drive-tmp-"  # a write in progress (hidden from listings)
CHUNK = 1024 * 1024
SKEW = 15 * 60
MAX_KEYS = 1000

CFG = {}
UPLOADS = ""
CONFIG_ID = ""
AUDIT = None


class SourceAudit:
    """A durable, at-least-once filesystem observation queue. Snapshot recovery
    reports its observation gap: inotify cannot recover transient operations
    that happened while the process was stopped or its kernel queue overflowed.
    """

    CREATE, DELETE, MODIFY, ATTRIB = 0x100, 0x200, 0x2, 0x4
    MOVED_FROM, MOVED_TO, CLOSE_WRITE = 0x40, 0x80, 0x8
    DELETE_SELF, MOVE_SELF, OVERFLOW, IGNORED = 0x400, 0x800, 0x4000, 0x8000
    ISDIR, ONLYDIR, DONT_FOLLOW = 0x40000000, 0x1000000, 0x2000000
    MASK = CREATE | DELETE | MODIFY | ATTRIB | MOVED_FROM | MOVED_TO | CLOSE_WRITE | DELETE_SELF | MOVE_SELF

    def __init__(self, root, state_file):
        self.root, self.state_file = os.path.realpath(root), state_file
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.fd, self.watches, self.paths = -1, {}, {}
        self.ready, self.error = False, None
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.inotify_init1.argtypes = [ctypes.c_int]
        self.libc.inotify_init1.restype = ctypes.c_int
        self.libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self.libc.inotify_add_watch.restype = ctypes.c_int
        self.libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
        self.libc.inotify_rm_watch.restype = ctypes.c_int
        state_dir = os.path.realpath(os.path.dirname(state_file) or ".")
        if os.path.commonpath([state_dir, self.root]) == self.root:
            raise ValueError("The source contains its server control-state directory. Choose a source subfolder outside ~/.cache/coder-cloud-drive; existing files are retained.")
        os.makedirs(os.path.dirname(state_file) or ".", mode=0o700, exist_ok=True)
        fd = os.open(state_file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        os.chmod(state_file, 0o600)
        self.db = sqlite3.connect(state_file, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tree (
                path TEXT PRIMARY KEY, kind TEXT NOT NULL, device INTEGER NOT NULL,
                inode INTEGER NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
                announced INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
        """)
        self.db.commit()

    def _queue(self, action, path="", row=None, message=None):
        event = {"id": str(uuid.uuid4()), "action": action, "observedAt": iso(time.time())}
        if row is not None:
            event.update(path=path, kind=row["kind"], size=int(row["size"]))
        if message:
            event["message"] = message
        self.db.execute("INSERT INTO outbox(id,payload) VALUES (?,?)", (event["id"], json.dumps(event)))

    def _watch(self, path, directory_fd):
        # The descriptor pins the directory: replacing a parent with a symlink
        # cannot redirect this watch outside the source.
        full = "/proc/self/fd/%d" % directory_fd
        wd = self.libc.inotify_add_watch(self.fd, os.fsencode(full), self.MASK | self.ONLYDIR)
        if wd < 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code), full)
        previous = self.paths.get(path)
        if previous is not None and previous != wd:
            self.libc.inotify_rm_watch(self.fd, previous)
            self.watches.pop(previous, None)
        self.watches[wd] = path
        self.paths[path] = wd

    @staticmethod
    def _ancestors(path):
        parts = path.split("/")[:-1]
        return ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]

    @staticmethod
    def _record(st, announced=True):
        return {"kind": "directory" if stat.S_ISDIR(st.st_mode) else "file", "device": st.st_dev,
                "inode": st.st_ino, "size": 0 if stat.S_ISDIR(st.st_mode) else st.st_size,
                "mtime": st.st_mtime_ns, "announced": int(announced)}

    def _scan_directory(self, directory_fd, path):
        st = os.fstat(directory_fd)
        out = {path: self._record(st)} if path else {}
        self._watch(path, directory_fd)
        with os.scandir(directory_fd) as children:
            for child in children:
                try:
                    cs = os.stat(child.name, dir_fd=directory_fd, follow_symlinks=False)
                    if not visible(child.name, cs):
                        continue
                    rel = (path + "/" if path else "") + child.name
                    if stat.S_ISDIR(cs.st_mode):
                        fd = os.open(child.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
                        try:
                            subtree = self._scan_directory(fd, rel)
                        finally:
                            os.close(fd)
                    else:
                        subtree = {rel: self._record(cs)}
                    out.update(subtree)
                    if path:
                        out[path]["size"] += subtree[rel]["size"]
                except FileNotFoundError:
                    continue
        return out

    def _scan(self, path=""):
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        fd = os.open(os.sep, flags)
        try:
            for component in self.root.split(os.sep):
                if component:
                    child_fd = os.open(component, flags, dir_fd=fd)
                    os.close(fd)
                    fd = child_fd
            if not path:
                return self._scan_directory(fd, "")
            parts = path.split("/")
            for parent in parts[:-1]:
                child_fd = os.open(parent, flags, dir_fd=fd)
                os.close(fd)
                fd = child_fd
            st = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            if not visible(parts[-1], st):
                return {}
            if not stat.S_ISDIR(st.st_mode):
                return {path: self._record(st)}
            directory_fd = os.open(parts[-1], flags, dir_fd=fd)
            try:
                return self._scan_directory(directory_fd, path)
            finally:
                os.close(directory_fd)
        finally:
            os.close(fd)

    def _row(self, path):
        row = self.db.execute("SELECT * FROM tree WHERE path=?", (path,)).fetchone()
        return dict(row) if row else None

    def _subtree(self, path):
        prefix = path + "/"
        return {row["path"]: dict(row) for row in self.db.execute(
            "SELECT * FROM tree WHERE path=? OR substr(path,1,?)=?", (path, len(prefix), prefix))}

    def _save(self, path, row):
        self.db.execute("INSERT OR REPLACE INTO tree VALUES (?,?,?,?,?,?,?)", (
            path, row["kind"], row["device"], row["inode"], row["size"], row["mtime"], row["announced"]))

    def _parent_sizes(self, path, delta):
        for parent in self._ancestors(path):
            self.db.execute("UPDATE tree SET size=max(0,size+?) WHERE path=?", (delta, parent))

    def reconcile(self, reason=None):
        """Rebuild after a restart/overflow, retaining already queued event IDs."""
        with self.lock, self.db:
            previous_root = self.db.execute("SELECT value FROM meta WHERE key='root'").fetchone()
            old = {row["path"]: dict(row) for row in self.db.execute("SELECT * FROM tree")}
            try:
                current = self._scan()
            except FileNotFoundError:
                current = {}
            for wd, watched in list(self.watches.items()):
                if watched and (watched not in current or current[watched]["kind"] != "directory"):
                    self.libc.inotify_rm_watch(self.fd, wd)
                    self.watches.pop(wd, None)
                    self.paths.pop(watched, None)
            if previous_root and previous_root["value"] == self.root:
                if reason:
                    self._queue("gap", message=reason)
                for path in sorted(old.keys() - current.keys(), key=lambda p: (-p.count("/"), p)):
                    if old[path]["announced"]:
                        self._queue("removed", path, old[path])
                    else:
                        self._queue("gap", message="%s disappeared before a completed size was observed." % path)
                for path in sorted(current.keys() - old.keys(), key=lambda p: (p.count("/"), p)):
                    self._queue("added", path, current[path])
                for path in old.keys() & current.keys():
                    if old[path]["kind"] != current[path]["kind"]:
                        if old[path]["announced"]:
                            self._queue("removed", path, old[path])
                        self._queue("added", path, current[path])
                    elif not old[path]["announced"]:
                        self._queue("added", path, current[path])
            elif previous_root:
                self._queue("gap", message="The source directory changed. Its new contents became the observation baseline.")
            self.db.execute("DELETE FROM tree")
            for path, row in current.items():
                self._save(path, row)
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('root',?)", (self.root,))
            self.ready, self.error = True, None

    def start_watching(self):
        self.fd = self.libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        self.reconcile("The source observer resumed. Changes during its downtime were reconciled from cached metadata; transient operations may be missing.")

    def _add(self, path, complete):
        snapshot = self._scan(path)
        if not snapshot:
            return
        old = self._row(path)
        top = snapshot[path]
        if top["kind"] == "file":
            top["announced"] = int(complete or bool(old and old["announced"]))
        old_subtree = self._subtree(path)
        for missing in old_subtree.keys() - snapshot.keys():
            self._queue("removed", missing, old_subtree[missing])
            self.db.execute("DELETE FROM tree WHERE path=?", (missing,))
        for child, row in snapshot.items():
            before = old_subtree.get(child)
            if before and before["kind"] != row["kind"]:
                self._queue("removed", child, before)
                before = None
            if row["announced"] and (not before or not before["announced"]):
                self._queue("added", child, row)
            self._save(child, row)
        self._parent_sizes(path, top["size"] - (old["size"] if old else 0))

    def _remove(self, path, removed):
        rows = self._subtree(path)
        if not rows:
            self._queue("gap", message="%s disappeared before its size and identity could be observed." % path)
            return
        top_size = rows[path]["size"]
        for child in sorted(rows, key=lambda p: (-p.count("/"), p)):
            row = rows[child]
            if row["kind"] == "directory":
                row["size"] += removed.get(child, 0)
            if row["announced"]:
                self._queue("removed", child, row)
            else:
                self._queue("gap", message="%s was removed before its completed size could be observed." % child)
            self.db.execute("DELETE FROM tree WHERE path=?", (child,))
        self._parent_sizes(path, -top_size)
        for parent in self._ancestors(path):
            removed[parent] = removed.get(parent, 0) + top_size
        for wd, watched in list(self.watches.items()):
            if watched == path or watched.startswith(path + "/"):
                self.libc.inotify_rm_watch(self.fd, wd)
                self.watches.pop(wd, None)
                self.paths.pop(watched, None)

    def process(self, events):
        """Apply one kernel event batch and its outbox entries in one transaction."""
        with self.lock, self.db:
            removed = {}
            for wd, mask, name in events:
                if mask & self.OVERFLOW:
                    self.reconcile("The source observer's kernel event queue overflowed. Cached metadata was reconciled; transient operations may be missing.")
                    return
                if mask & self.IGNORED:
                    previous = self.watches.pop(wd, None)
                    if previous is not None and self.paths.get(previous) == wd:
                        self.paths.pop(previous, None)
                    continue
                base = self.watches.get(wd)
                if base is None:
                    continue
                if mask & (self.DELETE_SELF | self.MOVE_SELF):
                    if not base:
                        self.reconcile("The source root moved or was removed. Its configured path was reconciled.")
                        return
                    continue
                try:
                    name.encode("utf-8")
                except UnicodeEncodeError:
                    continue
                if not name or name.startswith(TMP) or "/" in name or name in (".", ".."):
                    continue
                path = (base + "/" if base else "") + name
                if mask & (self.DELETE | self.MOVED_FROM):
                    self._remove(path, removed)
                elif mask & (self.CREATE | self.MOVED_TO | self.MODIFY | self.ATTRIB | self.CLOSE_WRITE):
                    try:
                        if mask & self.CREATE:
                            for prior in list(removed):
                                if prior == path or prior.startswith(path + "/"):
                                    removed.pop(prior)
                        self._add(path, bool(mask & (self.MOVED_TO | self.CLOSE_WRITE | self.ISDIR)))
                    except FileNotFoundError:
                        self._queue("gap", message="%s changed before its size and identity could be observed." % path)

    def poll(self, timeout=1):
        if not select.select([self.fd], [], [], timeout)[0]:
            return False
        events = []
        while True:
            try:
                data = os.read(self.fd, 65536)
            except BlockingIOError:
                break
            offset = 0
            while offset < len(data):
                wd, mask, _, length = struct.unpack_from("iIII", data, offset)
                name = os.fsdecode(data[offset + 16:offset + 16 + length].split(b"\0", 1)[0])
                events.append((wd, mask, name))
                offset += 16 + length
        self.process(events)
        return bool(events)

    def events(self, limit=100):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute(
                "SELECT payload FROM outbox ORDER BY seq LIMIT ?", (max(1, min(1000, limit)),))]

    def acknowledge(self, ids):
        if not isinstance(ids, list) or len(ids) > 1000 or any(not isinstance(value, str) for value in ids):
            raise ValueError("ids must be a list of at most 1000 event IDs")
        with self.lock, self.db:
            self.db.executemany("DELETE FROM outbox WHERE id=?", ((value,) for value in ids))

    def health(self):
        if not self.lock.acquire(blocking=False):
            return {"ready": self.ready, "error": self.error, "pending": None}
        try:
            return {"ready": self.ready, "error": self.error,
                    "pending": self.db.execute("SELECT count(*) FROM outbox").fetchone()[0]}
        finally:
            self.lock.release()

    def run(self):
        while not self.stopped.is_set():
            try:
                self.start_watching()
                last_scan = time.monotonic()
                while not self.stopped.is_set():
                    self.poll()
                    if time.monotonic() - last_scan >= 60:
                        self.reconcile()
                        last_scan = time.monotonic()
            except Exception as exc:
                if self.stopped.is_set():
                    return
                with self.lock:
                    self.ready, self.error = False, str(exc)
                sys.stderr.write("drivesource audit failed: %s\n" % exc)
                if self.fd >= 0:
                    os.close(self.fd)
                    self.fd = -1
                self.watches.clear()
                self.paths.clear()
                self.stopped.wait(5)

    def close(self):
        self.stopped.set()
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1
        with self.lock:
            self.db.close()


class S3Fail(Exception):
    def __init__(self, status, code, message=""):
        super().__init__(message or code)
        self.status, self.code, self.message = status, code, message or code


# ---------------------------------------------------------------------------------------------------- paths
def rel_of(key):
    """The key's path under root ("" the root itself; a trailing / a directory), else S3Fail."""
    prefix = CFG["prefix"]
    if not key.startswith(prefix):
        raise S3Fail(403, "AccessDenied", "Outside this Cloud Drive.")
    rel = key[len(prefix):]
    if "\0" in rel or len(rel.encode()) > 1024:
        raise S3Fail(400, "KeyTooLongError" if "\0" not in rel else "InvalidArgument")
    parts = rel.rstrip("/").split("/") if rel.rstrip("/") else []
    for part in parts:
        if part in ("", ".", "..") or len(part.encode()) > 255 or part.startswith(TMP):
            raise S3Fail(400, "InvalidArgument", "Not a valid name: %r" % part[:60])
    return rel


def path_of(rel, make_parents=False):
    """The file system path of rel; its parent resolved and inside root (no symbolic link on the way)."""
    root = CFG["root"]
    name = rel.rstrip("/")
    full = os.path.join(root, name) if name else root
    parent = os.path.dirname(full) if name else root
    if make_parents and name:
        _make_dirs(os.path.dirname(name))
    real = os.path.realpath(parent)
    if real != parent or not (real == root or real.startswith(root + os.sep)):
        raise S3Fail(403, "AccessDenied", "Outside this Cloud Drive.")
    return full


def _make_dirs(rel_dir):
    """The directories of rel_dir under root, one by one, none a symbolic link."""
    cur = CFG["root"]
    for part in [p for p in rel_dir.split("/") if p]:
        cur = os.path.join(cur, part)
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            os.mkdir(cur, 0o755)
            continue
        if not stat.S_ISDIR(st.st_mode):
            raise S3Fail(409, "XMinioParentIsObject", "%s is a file." % part)


def etag(st):
    """Return an opaque version fingerprint, never a claimed content checksum."""
    fingerprint = '%d:%d:%d:%d:%d' % (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    return '"fs-%s"' % hashlib.sha256(fingerprint.encode()).hexdigest()


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def visible(name, st):
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return not name.startswith(TMP) and (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode))


def entries(directory):
    """[(name, stat)] of a directory's files and directories (no links, no specials), [] when it is not one."""
    out = []
    try:
        with os.scandir(directory) as it:
            for e in it:
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if visible(e.name, st):
                    out.append((e.name, st))
    except (NotADirectoryError, FileNotFoundError, PermissionError):
        return []
    return out


def walk(directory, rel):
    """Every (key-relative path, stat) under directory: files, and directories as "x/" (their own entries)."""
    for name, st in entries(directory):
        child = rel + name
        if stat.S_ISDIR(st.st_mode):
            yield child + "/", st
            yield from walk(os.path.join(directory, name), child + "/")
        else:
            yield child, st


# ---------------------------------------------------------------------------------------------------- signing
def _quote(text):
    return urllib.parse.quote(text, safe="-_.~")


def check_signature(h, raw_path, raw_query, config=None):
    """The request's Signature Version 4 (headers), else S3Fail; the signed payload hash."""
    config = CFG if config is None else config
    auth = h.headers.get("Authorization", "")
    if not auth.startswith("AWS4-HMAC-SHA256 "):
        raise S3Fail(403, "AccessDenied", "Signed requests only (AWS Signature Version 4).")
    fields = {}
    for part in auth[len("AWS4-HMAC-SHA256 "):].split(","):
        k, _, v = part.strip().partition("=")
        fields[k] = v
    try:
        access, day, region, service, term = fields["Credential"].split("/")
        signed = fields["SignedHeaders"].split(";")
        signature = fields["Signature"]
    except (KeyError, ValueError):
        raise S3Fail(400, "AuthorizationHeaderMalformed") from None
    if not hmac.compare_digest(access, config["accessKey"]):
        raise S3Fail(403, "InvalidAccessKeyId")
    amz_date = h.headers.get("x-amz-date", "")
    try:
        when = datetime.datetime.strptime(amz_date, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        raise S3Fail(403, "AccessDenied", "x-amz-date is missing.") from None
    if abs(time.time() - when.timestamp()) > SKEW or not amz_date.startswith(day):
        raise S3Fail(403, "RequestTimeTooSkewed")
    if "host" not in signed:
        raise S3Fail(403, "AccessDenied", "The host must be signed.")
    payload = h.headers.get("x-amz-content-sha256", "")
    if not payload:
        raise S3Fail(400, "InvalidRequest", "x-amz-content-sha256 is missing.")
    if payload.startswith("STREAMING-"):
        raise S3Fail(501, "NotImplemented", "Chunked (streaming) signatures are not taken: sign the payload.")
    pairs = []
    for item in raw_query.split("&") if raw_query else []:
        k, _, v = item.partition("=")
        pairs.append((_quote(urllib.parse.unquote(k)), _quote(urllib.parse.unquote(v))))
    canonical_query = "&".join("%s=%s" % kv for kv in sorted(pairs))
    canonical_headers = "".join("%s:%s\n" % (n, " ".join((h.headers.get(n) or "").split())) for n in signed)
    canonical = "\n".join([h.command, raw_path, canonical_query, canonical_headers, ";".join(signed), payload])
    scope = "%s/%s/%s/%s" % (day, region, service, term)
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = ("AWS4" + config["secretKey"]).encode()
    for part in (day, region, service, term):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest(), signature):
        raise S3Fail(403, "SignatureDoesNotMatch")
    return payload


# ---------------------------------------------------------------------------------------------------- the server
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CloudDriveSource/" + VERSION
    sys_version = ""

    def log_message(self, fmt, *args):  # one line per failure only (see fail)
        pass

    # ---- answers
    def reply(self, status, body=b"", ctype="application/xml", headers=None):
        self.send_response(status)
        self.send_header("x-amz-request-id", self.request_id)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if body or status not in (204, 304):
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def xml(self, status, body, headers=None):
        self.reply(status, ('<?xml version="1.0" encoding="UTF-8"?>\n' + body).encode(), headers=headers)

    def fail(self, e):
        sys.stderr.write("%s %s %s -> %s %s\n" % (time.strftime("%H:%M:%S"), self.command, self.path[:200], e.status,
                                                   e.code))
        body = "<Error><Code>%s</Code><Message>%s</Message><RequestId>%s</RequestId></Error>" % (
            escape(e.code), escape(e.message), self.request_id)
        self.close_connection = self.close_connection or self.unread()
        self.xml(e.status, body)

    def unread(self):
        """True when a request body was not read (the connection cannot carry another request)."""
        return int(self.headers.get("Content-Length") or 0) > 0 and not getattr(self, "body_read", False)

    # ---- the body
    def body_to(self, out, payload):
        """Copies the request body into out (a file), checking its signed SHA-256 and Content-MD5; its length."""
        if self.headers.get("Transfer-Encoding"):
            raise S3Fail(411, "MissingContentLength")
        left = int(self.headers.get("Content-Length") or 0)
        total, sha, md5 = left, hashlib.sha256(), hashlib.md5()
        while left > 0:
            chunk = self.rfile.read(min(CHUNK, left))
            if not chunk:
                raise S3Fail(400, "IncompleteBody")
            sha.update(chunk)
            md5.update(chunk)
            out.write(chunk)
            left -= len(chunk)
        self.body_read = True
        if payload not in ("UNSIGNED-PAYLOAD",) and payload != sha.hexdigest():
            raise S3Fail(400, "XAmzContentSHA256Mismatch")
        want = self.headers.get("Content-MD5")
        if want and want != base64.b64encode(md5.digest()).decode():
            raise S3Fail(400, "BadDigest")
        return total

    def body_bytes(self, payload, limit=4 * CHUNK):
        if int(self.headers.get("Content-Length") or 0) > limit:
            raise S3Fail(400, "EntityTooLarge")

        class Buf:
            data = b""

            def write(self, chunk):
                self.data += chunk

        buf = Buf()
        self.body_to(buf, payload)
        return buf.data

    # ---- dispatch
    def do_HEAD(self):
        self.dispatch()

    def do_GET(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def dispatch(self):
        self.request_id = uuid.uuid4().hex[:16].upper()
        self.body_read = False
        raw_path, _, raw_query = self.path.partition("?")
        try:
            if raw_path == "/__health" and self.command == "GET":
                self.reply(200, json.dumps({"ok": True, "version": VERSION, "config": CONFIG_ID,
                                           "audit": AUDIT.health() if AUDIT else None}).encode(),
                           "application/json")
                return
            payload = check_signature(self, raw_path, raw_query)
            query = dict(urllib.parse.parse_qsl(raw_query, keep_blank_values=True))
            if raw_path in ("/__events", "/__events/ack"):
                if AUDIT is None:
                    raise S3Fail(503, "ServiceUnavailable", "Source audit is not enabled.")
                if raw_path == "/__events" and self.command == "GET":
                    try:
                        limit = int(query.get("limit") or 100)
                    except ValueError:
                        raise S3Fail(400, "InvalidArgument", "limit must be an integer") from None
                    self.reply(200, json.dumps({"events": AUDIT.events(limit)}).encode(), "application/json")
                    return
                if raw_path == "/__events/ack" and self.command == "POST":
                    if payload == "UNSIGNED-PAYLOAD":
                        raise S3Fail(400, "InvalidRequest", "Event acknowledgement needs a signed payload.")
                    try:
                        body = json.loads(self.body_bytes(payload, limit=65536))
                        AUDIT.acknowledge(body.get("ids"))
                    except (ValueError, AttributeError):
                        raise S3Fail(400, "InvalidArgument", "ids must be a list of event IDs") from None
                    self.reply(200, b'{"ok":true}', "application/json")
                    return
                raise S3Fail(405, "MethodNotAllowed")
            parts = urllib.parse.unquote(raw_path).lstrip("/").split("/", 1)
            bucket, key = parts[0], parts[1] if len(parts) > 1 else ""
            if not bucket:
                raise S3Fail(400, "InvalidRequest", "No bucket.")
            if bucket != CFG["bucket"]:
                raise S3Fail(404, "NoSuchBucket")
            if not key:
                self.on_bucket(query, payload)
            else:
                self.on_object(key, query, payload)
            if self.unread():
                self.close_connection = True
        except S3Fail as e:
            self.fail(e)
        except PermissionError as e:
            self.fail(S3Fail(403, "AccessDenied", str(e)))
        except FileNotFoundError:
            self.fail(S3Fail(404, "NoSuchKey"))
        except OSError as e:
            self.fail(S3Fail(500, "InternalError", str(e)))

    # ---- the bucket
    def on_bucket(self, query, payload):
        cmd = self.command
        if cmd == "HEAD":
            self.reply(200)
        elif cmd == "GET" and "location" in query:
            self.xml(200, '<LocationConstraint xmlns="%s">%s</LocationConstraint>' % (NS, escape(CFG["region"])))
        elif cmd == "GET" and "uploads" in query:
            self.xml(200, '<ListMultipartUploadsResult xmlns="%s"><Bucket>%s</Bucket><IsTruncated>false'
                          '</IsTruncated></ListMultipartUploadsResult>' % (NS, escape(CFG["bucket"])))
        elif cmd == "GET" and not set(query) - {"prefix", "delimiter", "marker", "max-keys", "list-type",
                                                 "continuation-token", "start-after", "encoding-type", "fetch-owner"}:
            self.list(query)
        elif cmd == "POST" and "delete" in query:
            self.delete_many(payload)
        else:
            raise S3Fail(501, "NotImplemented")

    def list(self, query):
        v2 = query.get("list-type") == "2"
        prefix = query.get("prefix", "")
        delimiter = query.get("delimiter", "")
        if delimiter not in ("", "/"):
            raise S3Fail(501, "NotImplemented", "Only / as the delimiter.")
        try:
            max_keys = max(0, min(MAX_KEYS, int(query.get("max-keys") or MAX_KEYS)))
        except ValueError:
            raise S3Fail(400, "InvalidArgument", "max-keys") from None
        after = query.get("start-after", "") if v2 else query.get("marker", "")
        if v2 and query.get("continuation-token"):
            try:
                after = base64.urlsafe_b64decode(query["continuation-token"].encode()).decode()
            except ValueError:
                raise S3Fail(400, "InvalidArgument", "continuation-token") from None
        objects, prefixes = self.listing(prefix, delimiter)
        items = sorted([(k, st) for k, st in objects] + [(p, None) for p in prefixes], key=lambda i: i[0].encode())
        items = [i for i in items if i[0].encode() > after.encode()]
        page, truncated = items[:max_keys], len(items) > max_keys
        out = ['<ListBucketResult xmlns="%s"><Name>%s</Name><Prefix>%s</Prefix><MaxKeys>%d</MaxKeys>' % (
            NS, escape(CFG["bucket"]), escape(prefix), max_keys)]
        if delimiter:
            out.append("<Delimiter>/</Delimiter>")
        out.append("<IsTruncated>%s</IsTruncated>" % ("true" if truncated else "false"))
        if v2:
            out.append("<KeyCount>%d</KeyCount>" % len(page))
            if query.get("continuation-token"):
                out.append("<ContinuationToken>%s</ContinuationToken>" % escape(query["continuation-token"]))
            if truncated:
                out.append("<NextContinuationToken>%s</NextContinuationToken>"
                           % base64.urlsafe_b64encode(page[-1][0].encode()).decode())
        else:
            out.append("<Marker>%s</Marker>" % escape(query.get("marker", "")))
            if truncated:
                out.append("<NextMarker>%s</NextMarker>" % escape(page[-1][0]))
        for k, st in page:
            if st is None:
                out.append("<CommonPrefixes><Prefix>%s</Prefix></CommonPrefixes>" % escape(k))
            else:
                size = 0 if k.endswith("/") else st.st_size
                out.append("<Contents><Key>%s</Key><LastModified>%s</LastModified><ETag>%s</ETag><Size>%d</Size>"
                           "<StorageClass>STANDARD</StorageClass></Contents>"
                           % (escape(k), iso(st.st_mtime), escape(etag(st)), size))
        out.append("</ListBucketResult>")
        self.xml(200, "".join(out))

    def listing(self, prefix, delimiter):
        """([(key, stat)], [common prefix]) of the keys starting with prefix."""
        base = CFG["prefix"]
        if not prefix.startswith(base):
            if not base.startswith(prefix):
                return [], []
            if delimiter:  # a prefix above this Cloud Drive's: its first folder
                return [], [base[:base.index("/", len(prefix)) + 1]]
            prefix = base  # all of it
        rel = prefix[len(base):]
        head, _, partial = rel.rpartition("/")
        head = head + "/" if head else ""
        try:
            rel_of(base + head)
        except S3Fail:
            return [], []
        directory = path_of(head)
        if os.path.realpath(directory) != directory or not os.path.isdir(directory):
            return [], []
        objects, prefixes = [], []
        if not delimiter:
            if head and not partial:
                objects.append((base + head, os.lstat(directory)))
            for child, st in walk(directory, ""):
                if child.startswith(partial):
                    objects.append((base + head + child, st))
            return objects, prefixes
        if head and not partial:  # the directory's own marker, as S3 lists an existing "dir/" object
            objects.append((base + head, os.lstat(directory)))
        for name, st in entries(directory):
            if not name.startswith(partial):
                continue
            if stat.S_ISDIR(st.st_mode):
                prefixes.append(base + head + name + "/")
            else:
                objects.append((base + head + name, st))
        return objects, prefixes

    def delete_many(self, payload):
        body = self.body_bytes(payload)
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            raise S3Fail(400, "MalformedXML") from None
        quiet = (root.findtext("{%s}Quiet" % NS) or root.findtext("Quiet") or "").lower() == "true"
        out = ['<DeleteResult xmlns="%s">' % NS]
        for obj in list(root.findall("{%s}Object" % NS)) + list(root.findall("Object")):
            key = obj.findtext("{%s}Key" % NS) or obj.findtext("Key") or ""
            try:
                self.remove(key)
                if not quiet:
                    out.append("<Deleted><Key>%s</Key></Deleted>" % escape(key))
            except (S3Fail, OSError) as e:
                code = e.code if isinstance(e, S3Fail) else "InternalError"
                out.append("<Error><Key>%s</Key><Code>%s</Code><Message>%s</Message></Error>"
                           % (escape(key), code, escape(str(e))))
        out.append("</DeleteResult>")
        self.xml(200, "".join(out))

    # ---- objects
    def on_object(self, key, query, payload):
        cmd = self.command
        if cmd == "POST" and "uploads" in query:
            self.create_upload(key)
        elif cmd == "PUT" and "uploadId" in query and "partNumber" in query:
            self.upload_part(key, query, payload)
        elif cmd == "POST" and "uploadId" in query:
            self.complete_upload(key, query, payload)
        elif cmd == "DELETE" and "uploadId" in query:
            shutil.rmtree(self.upload_dir(query["uploadId"], key), ignore_errors=True)
            self.reply(204)
        elif cmd == "GET" and "uploadId" in query:
            self.list_parts(key, query)
        elif query and not set(query) <= {"versionId", "partNumber", "x-id"}:
            raise S3Fail(501, "NotImplemented")
        elif cmd in ("GET", "HEAD"):
            self.get(key)
        elif cmd == "PUT" and self.headers.get("x-amz-copy-source"):
            self.copy(key)
        elif cmd == "PUT":
            self.put(key, payload)
        elif cmd == "DELETE":
            self.remove(key)
            self.reply(204)
        else:
            raise S3Fail(405, "MethodNotAllowed")

    def stat_key(self, key):
        """(path, stat) of an existing object (a directory only as "x/"), else NoSuchKey."""
        rel = rel_of(key)
        full = path_of(rel)
        try:
            st = os.lstat(full)
        except FileNotFoundError:
            raise S3Fail(404, "NoSuchKey") from None
        if not visible(os.path.basename(full) or "x", st) or stat.S_ISDIR(st.st_mode) != key.endswith("/"):
            raise S3Fail(404, "NoSuchKey")
        return full, st

    def get(self, key):
        full, st = self.stat_key(key)
        headers = {"ETag": etag(st), "Last-Modified": email.utils.formatdate(st.st_mtime, usegmt=True),
                   "Accept-Ranges": "bytes"}
        match = self.headers.get('If-Match')
        if match is not None and '*' not in [value.strip() for value in match.split(',')] and headers['ETag'] not in [value.strip() for value in match.split(',')]:
            raise S3Fail(412, 'PreconditionFailed')
        none = self.headers.get('If-None-Match')
        if none is not None and any(value.strip() == '*' or value.strip().removeprefix('W/') == headers['ETag'] for value in none.split(',')):
            self.reply(304, headers=headers)
            return
        if stat.S_ISDIR(st.st_mode):
            self.reply(200, b"", "application/x-directory", headers)
            return
        size, start, end = st.st_size, 0, st.st_size - 1
        status = 200
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            try:
                if a == "":
                    start, end = max(0, size - int(b)), size - 1
                else:
                    start, end = int(a), min(size - 1, int(b)) if b else size - 1
            except ValueError:
                raise S3Fail(400, "InvalidRange") from None
            if start >= size or start > end:
                raise S3Fail(416, "InvalidRange")
            status = 206
            headers["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("x-amz-request-id", self.request_id)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        if self.command == "HEAD" or not length:
            return
        with open(full, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(CHUNK, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)
        if left:  # the file shrank while it was read: this response cannot be finished
            self.close_connection = True

    def target(self, key):
        """The path a write of key goes to (its directories made), checked not to clash with a directory."""
        rel = rel_of(key)
        if not rel.rstrip("/"):
            raise S3Fail(400, "InvalidArgument", "The Cloud Drive's root is not an object.")
        full = path_of(rel, make_parents=True)
        try:
            st = os.lstat(full)
            if stat.S_ISLNK(st.st_mode) or (stat.S_ISDIR(st.st_mode) and not key.endswith("/")):
                raise S3Fail(409, "XMinioObjectExistsAsDirectory", "A directory of that name is there.")
        except FileNotFoundError:
            pass
        return full

    @staticmethod
    def settle(full, tmp_path):
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, full)
        st = os.lstat(full)
        return st

    def write_new(self, full, fill):
        """fill(file) writes the content; renamed into place when complete. The new file's stat."""
        tmp_path = os.path.join(os.path.dirname(full), "%s%s" % (TMP, uuid.uuid4().hex))
        try:
            with open(tmp_path, "wb") as out:
                fill(out)
            return self.settle(full, tmp_path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def put(self, key, payload):
        full = self.target(key)
        if key.endswith("/"):
            self.body_bytes(payload, limit=0)
            try:
                os.mkdir(full, 0o755)
            except FileExistsError:
                if not os.path.isdir(full) or os.path.islink(full):
                    raise S3Fail(409, "XMinioParentIsObject") from None
            self.reply(200, headers={"ETag": etag(os.lstat(full))})
            return
        st = self.write_new(full, lambda out: self.body_to(out, payload))
        self.reply(200, headers={"ETag": etag(st)})

    def copy_source(self):
        """(path, stat) of the copy's source, and the byte range asked (or None)."""
        source = urllib.parse.unquote(self.headers["x-amz-copy-source"].split("?", 1)[0]).lstrip("/")
        bucket, _, key = source.partition("/")
        if bucket != CFG["bucket"]:
            raise S3Fail(404, "NoSuchBucket")
        full, st = self.stat_key(key)
        rng = self.headers.get("x-amz-copy-source-range", "")
        span = None
        if rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            span = (int(a), int(b))
            if span[0] > span[1] or span[1] >= st.st_size:
                raise S3Fail(416, "InvalidRange")
        return full, st, span

    @staticmethod
    def copy_bytes(src, out, span):
        with open(src, "rb") as f:
            start, left = (span[0], span[1] - span[0] + 1) if span else (0, None)
            f.seek(start)
            while left is None or left > 0:
                chunk = f.read(CHUNK if left is None else min(CHUNK, left))
                if not chunk:
                    break
                out.write(chunk)
                if left is not None:
                    left -= len(chunk)

    def copy(self, key):
        src, sst, span = self.copy_source()
        full = self.target(key)
        if stat.S_ISDIR(sst.st_mode):
            os.makedirs(full, exist_ok=True)
            st = os.lstat(full)
        elif src == full:  # in place (new metadata): nothing to move
            st = sst
        else:
            st = self.write_new(full, lambda out: self.copy_bytes(src, out, None))
        self.xml(200, '<CopyObjectResult xmlns="%s"><LastModified>%s</LastModified><ETag>%s</ETag>'
                      "</CopyObjectResult>" % (NS, iso(st.st_mtime), escape(etag(st))))

    # ---- multipart uploads (parts kept outside the served directory until completed)
    def upload_dir(self, upload_id, key):
        if not upload_id.isalnum() or len(upload_id) != 32:
            raise S3Fail(404, "NoSuchUpload")
        d = os.path.join(UPLOADS, upload_id)
        try:
            with open(os.path.join(d, "key")) as f:
                if f.read() != key:
                    raise S3Fail(404, "NoSuchUpload")
        except FileNotFoundError:
            raise S3Fail(404, "NoSuchUpload") from None
        return d

    def create_upload(self, key):
        self.target(key)
        upload_id = uuid.uuid4().hex
        d = os.path.join(UPLOADS, upload_id)
        os.makedirs(d, mode=0o700)
        with open(os.path.join(d, "key"), "w") as f:
            f.write(key)
        self.xml(200, '<InitiateMultipartUploadResult xmlns="%s"><Bucket>%s</Bucket><Key>%s</Key><UploadId>%s'
                      "</UploadId></InitiateMultipartUploadResult>" % (NS, escape(CFG["bucket"]), escape(key),
                                                                       upload_id))

    def upload_part(self, key, query, payload):
        d = self.upload_dir(query["uploadId"], key)
        try:
            number = int(query["partNumber"])
        except ValueError:
            raise S3Fail(400, "InvalidArgument", "partNumber") from None
        if not 1 <= number <= 10000:
            raise S3Fail(400, "InvalidArgument", "partNumber")
        part = os.path.join(d, "%05d" % number)
        tmp_path = part + ".tmp"
        md5 = hashlib.md5()

        class Hashing:
            def __init__(self, out):
                self.out = out

            def write(self, chunk):
                md5.update(chunk)
                self.out.write(chunk)

        with open(tmp_path, "wb") as out:
            if self.headers.get("x-amz-copy-source"):
                src, _, span = self.copy_source()
                self.copy_bytes(src, Hashing(out), span)
            else:
                self.body_to(Hashing(out), payload)
        os.replace(tmp_path, part)
        tag = '"%s"' % md5.hexdigest()
        with open(part + ".etag", "w") as f:
            f.write(tag)
        if self.headers.get("x-amz-copy-source"):
            self.xml(200, '<CopyPartResult xmlns="%s"><LastModified>%s</LastModified><ETag>%s</ETag></CopyPartResult>'
                     % (NS, iso(time.time()), escape(tag)))
        else:
            self.reply(200, headers={"ETag": tag})

    def list_parts(self, key, query):
        d = self.upload_dir(query["uploadId"], key)
        out = ['<ListPartsResult xmlns="%s"><Bucket>%s</Bucket><Key>%s</Key><UploadId>%s</UploadId>'
               "<IsTruncated>false</IsTruncated>" % (NS, escape(CFG["bucket"]), escape(key), query["uploadId"])]
        for name in sorted(os.listdir(d)):
            if name.isdigit():
                with open(os.path.join(d, name + ".etag")) as f:
                    tag = f.read()
                out.append("<Part><PartNumber>%d</PartNumber><ETag>%s</ETag><Size>%d</Size></Part>"
                           % (int(name), escape(tag), os.path.getsize(os.path.join(d, name))))
        out.append("</ListPartsResult>")
        self.xml(200, "".join(out))

    def complete_upload(self, key, query, payload):
        d = self.upload_dir(query["uploadId"], key)
        try:
            root = ET.fromstring(self.body_bytes(payload))
        except ET.ParseError:
            raise S3Fail(400, "MalformedXML") from None
        numbers = []
        for p in list(root.findall("{%s}Part" % NS)) + list(root.findall("Part")):
            n = int(p.findtext("{%s}PartNumber" % NS) or p.findtext("PartNumber") or 0)
            tag = (p.findtext("{%s}ETag" % NS) or p.findtext("ETag") or "").strip()
            part = os.path.join(d, "%05d" % n)
            try:
                with open(part + ".etag") as f:
                    if f.read().strip('"') != tag.strip('"'):
                        raise S3Fail(400, "InvalidPart")
            except FileNotFoundError:
                raise S3Fail(400, "InvalidPart") from None
            numbers.append(n)
        if not numbers or numbers != sorted(set(numbers)):
            raise S3Fail(400, "InvalidPartOrder")
        full = self.target(key)

        def fill(out):
            for n in numbers:
                with open(os.path.join(d, "%05d" % n), "rb") as f:
                    shutil.copyfileobj(f, out, CHUNK)

        st = self.write_new(full, fill)
        shutil.rmtree(d, ignore_errors=True)
        self.xml(200, '<CompleteMultipartUploadResult xmlns="%s"><Bucket>%s</Bucket><Key>%s</Key><ETag>%s</ETag>'
                      "</CompleteMultipartUploadResult>" % (NS, escape(CFG["bucket"]), escape(key), escape(etag(st))))

    def remove(self, key):
        rel = rel_of(key)
        if not rel.rstrip("/"):
            return
        full = path_of(rel)
        try:
            st = os.lstat(full)
        except FileNotFoundError:
            return  # S3: deleting what is not there succeeds
        if stat.S_ISDIR(st.st_mode):
            if key.endswith("/"):
                try:
                    os.rmdir(full)
                except OSError:
                    pass  # not empty: S3 would delete the marker and keep its objects
        elif stat.S_ISREG(st.st_mode) and not key.endswith("/"):
            os.unlink(full)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64


def clean_uploads():
    """Multipart uploads left over a day: removed."""
    while True:
        cutoff = time.time() - 86400
        try:
            names = os.listdir(UPLOADS)
        except OSError:
            names = []
        for name in names:
            d = os.path.join(UPLOADS, name)
            try:
                if os.path.getmtime(d) < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass
        time.sleep(3600)


def load(path):
    global CFG, UPLOADS, CONFIG_ID, AUDIT
    with open(path) as f:
        cfg = json.load(f)
    root = os.path.realpath(cfg["root"])
    if not os.path.isdir(root):
        raise SystemExit("drivesource: %s is not a directory" % cfg["root"])
    CFG = {"root": root, "bucket": cfg["bucket"], "prefix": cfg["prefix"], "accessKey": cfg["accessKey"],
           "secretKey": cfg["secretKey"], "region": cfg.get("region") or "us-east-1",
           "port": int(cfg.get("port") or 9900)}
    CONFIG_ID = cfg.get("id", "")
    UPLOADS = os.path.join(os.path.dirname(os.path.abspath(path)), "uploads")
    os.makedirs(UPLOADS, mode=0o700, exist_ok=True)
    AUDIT = SourceAudit(root, os.path.join(os.path.dirname(os.path.abspath(path)), "source-audit.sqlite")) \
        if cfg.get("auditEnabled") else None


def main():
    load(sys.argv[1])
    server = Server(("0.0.0.0", CFG["port"]), Handler)
    threading.Thread(target=clean_uploads, daemon=True).start()
    if AUDIT:
        threading.Thread(target=AUDIT.run, name="source-audit", daemon=True).start()
    sys.stderr.write("drivesource %s: serving %s on :%d\n" % (VERSION, CFG["root"], CFG["port"]))
    sys.stderr.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
