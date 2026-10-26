"""Account-authenticated S3 mounts and a durable Cloud Drive notification outbox.

Each mount signs as its workspace account and uses an owner/viewer-specific CSI
handle. Backend credentials stay here. Source-backed drives are observed by the
source server instead, whose notifications explicitly describe an observation.
"""
import contextlib
import datetime
import http.server
import json
import os
import re
import secrets
import sqlite3
import ssl
import threading
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

import drivesource
import s3client

BUCKET_PREFIX = "audit-"
ISO_LIBRARY_OWNER = "library-isos"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
MAX_XML = 4 * 1024 * 1024
CUSTOM_TEMPLATE = "39b1e189-c857-4b0c-877a-511144c18516"


def markdown_text(value):
    """Notification bodies render Markdown; names must remain literal text."""
    text = str(value).replace("\r", "\\r").replace("\n", "\\n")
    return re.sub(r"([\\`*_{}\[\]()#+.!|<>-])", r"\\\1", text)


def bounded_text(value, limit=700):
    data = str(value).encode()
    return data[:limit].decode(errors="ignore") + (" (truncated)" if len(data) > limit else "")


def inbox_query(path=None):
    """Use the repository's canonical SQL query, packaged into the service image."""
    with open(path or os.path.join(os.path.dirname(__file__), "notificationsinbox.sql")) as file:
        text = file.read().split("-- name: InsertInboxNotificationAndNotify :exec\n", 1)[1].split("-- name:", 1)[0]
    names = []

    def parameter(match):
        name = match.group(1)
        if name not in names:
            names.append(name)
        return "$%d" % (names.index(name) + 1)

    return re.sub(r"@(\w+)", parameter, text), names


def send_inbox(pool, account, notification_id, recipient, item, query):
    """Insert and notify atomically; retrying this event cannot duplicate an inbox row."""
    actor = account(item["actor"]) or {"username": item["actor"]}
    username = markdown_text(actor["username"])
    if item["action"] == "gap":
        title = "Cloud Drive observation gap"
        account_kind = "Source workspace account" if item["source"] else "Mount account"
        content = "%s %s: %s" % (account_kind, username, markdown_text(
            bounded_text(item.get("message") or "The observer restarted; transient changes may be missing.")))
    else:
        action = "added" if item["action"] == "added" else "removed" if item["action"] == "removed" else "deleted"
        title = "Cloud Drive %s %s" % (item["kind"], action)
        who = "Source workspace account %s observed" % username if item["source"] else "Mount account %s" % username
        content = "%s %s %s %s (%s bytes)." % (who, action, item["kind"], markdown_text(
            json.dumps(bounded_text(item["path"]), ensure_ascii=False)), item["size"])
    record = {"id": notification_id, "user_id": recipient, "template_id": CUSTOM_TEMPLATE,
              "targets": [], "title": title, "content": content, "actions": [], "read_at": None, "created_at": item["at"]}
    values = {**record, "targets": "{}", "icon": "", "actions": "[]",
              "channel": "inbox_notification:owner:" + recipient,
              "event": json.dumps({"kind": "new", "inbox_notification": record}, ensure_ascii=False)}
    statement, names = query
    pool.query(statement, [values[name] for name in names])


def account_id(value):
    try:
        return str(uuid.UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


class Store:
    """Credentials and event deliveries on the platform service's retained volume."""

    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", mode=0o700, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY, access_key TEXT UNIQUE NOT NULL, secret_key TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS deliveries (
                    event_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(event_id, user_id));
                CREATE TABLE IF NOT EXISTS uploads (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, owner TEXT NOT NULL, path TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
            """)
        os.chmod(path, 0o600)
        self.recover_intents()

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def credentials(self, actor):
        if not account_id(actor):
            raise ValueError("An account ID is required.")
        with self.lock, self.connect() as db:
            db.execute("INSERT OR IGNORE INTO accounts VALUES (?, ?, ?)",
                       (actor, "CD" + actor.replace("-", ""), secrets.token_urlsafe(48)))
            row = db.execute("SELECT access_key, secret_key FROM accounts WHERE id=?", (actor,)).fetchone()
        return {"accessKey": row[0], "secretKey": row[1]}

    def principal(self, access):
        with self.connect() as db:
            row = db.execute("SELECT id, secret_key FROM accounts WHERE access_key=?", (access,)).fetchone()
        if not row:
            raise drivesource.S3Fail(403, "InvalidAccessKeyId")
        return row[0], {"accessKey": access, "secretKey": row[1]}

    def record(self, event):
        """A stable source event ID is retained across polling and delivery retries."""
        if (not account_id(event.get("id")) or not account_id(event.get("actor"))
                or not account_id(event.get("owner")) or event.get("action") not in ("added", "removed", "deleted", "gap")):
            raise ValueError("Invalid Cloud Drive event identity or action.")
        if event["action"] != "gap" and (event.get("kind") not in ("file", "directory")
                                          or not isinstance(event.get("size"), int) or event["size"] < 0
                                          or len(event.get("path", "").encode()) > (4096 if event.get("source") else 1024)):
            raise ValueError("Invalid Cloud Drive event metadata.")
        if not datetime.datetime.fromisoformat(event.get("at") or "").tzinfo:
            raise ValueError("Cloud Drive events require a timestamp with a timezone.")
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO events(id,body) VALUES (?,?)",
                       (event["id"], json.dumps(event, ensure_ascii=False)))

    def upload(self, upload_id, actor, owner, path, create=False, remove=False):
        with self.connect() as db:
            if create:
                db.execute("INSERT INTO uploads VALUES (?,?,?,?)", (upload_id, actor, owner, path))
                return
            have = db.execute("SELECT 1 FROM uploads WHERE id=? AND actor=? AND owner=? AND path=?",
                              (upload_id, actor, owner, path)).fetchone()
            if not have:
                raise drivesource.S3Fail(403, "AccessDenied", "This multipart upload belongs to another mount.")
            if remove:
                db.execute("DELETE FROM uploads WHERE id=?", (upload_id,))

    def begin(self, actor, owner, path, before):
        intent = {"id": str(uuid.uuid4()), "actor": actor, "owner": owner, "path": path, "before": before}
        with self.connect() as db:
            db.execute("INSERT INTO intents VALUES (?,?)", (intent["id"], json.dumps(intent)))
        return intent

    def complete(self, intent, after):
        before = intent["before"]
        added = before is None and after is not None
        removed = before is not None and after is None
        with self.connect() as db:
            if added or removed:
                item = event(intent["actor"], intent["owner"], "added" if added else "deleted", intent["path"],
                             (after if added else before)["size"], event_id=intent["id"])
                db.execute("INSERT OR IGNORE INTO events(id,body) VALUES (?,?)", (item["id"], json.dumps(item)))
            db.execute("DELETE FROM intents WHERE id=?", (intent["id"],))

    def recover_intents(self):
        # S3 and SQLite cannot share a transaction. An interrupted operation is
        # reported as uncertain, never silently discarded or guessed from a HEAD
        # that may now describe another writer's object.
        with self.connect() as db:
            for intent_id, raw in db.execute("SELECT id,body FROM intents").fetchall():
                intent = json.loads(raw)
                item = event(intent["actor"], intent["owner"], "gap", intent["path"], 0, event_id=intent_id)
                item["message"] = "A Cloud Drive mutation was interrupted after its audit intent was saved. The backend may have committed it; the exact final change cannot be confirmed."
                db.execute("INSERT OR IGNORE INTO events(id,body) VALUES (?,?)", (intent_id, json.dumps(item)))
                db.execute("DELETE FROM intents WHERE id=?", (intent_id,))

    def pending(self):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute(
                "SELECT body FROM events WHERE delivered=0 ORDER BY rowid LIMIT 100")]

    def deliver(self, recipients, send):
        for event in self.pending():
            for recipient in recipients(event):
                with self.connect() as db:
                    done = db.execute("SELECT 1 FROM deliveries WHERE event_id=? AND user_id=?",
                                      (event["id"], recipient)).fetchone()
                if done:
                    continue
                # Coder uses this stable UUID as its inbox primary key as well.
                notification_id = str(uuid.uuid5(uuid.UUID(event["id"]), recipient))
                send(notification_id, recipient, event)
                with self.connect() as db:
                    db.execute("INSERT OR IGNORE INTO deliveries VALUES (?,?)", (event["id"], recipient))
            with self.connect() as db:
                db.execute("UPDATE events SET delivered=1 WHERE id=?", (event["id"],))


def event(actor, owner, action, path, size, source=False, event_id=None):
    return {"id": event_id or str(uuid.uuid4()), "actor": actor, "owner": owner,
            "action": action, "path": path.rstrip("/"), "kind": "directory" if path.endswith("/") else "file",
            "size": max(0, int(size)), "source": source,
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}


class Gateway:
    """A bounded S3 facade; resolve(owner) returns the existing storage client/root."""

    def __init__(self, store, resolve, permission, source, max_bytes, log):
        self.store, self.resolve, self.permission = store, resolve, permission
        self.source, self.max_bytes, self.log = source, max_bytes, log
        self.mutations = threading.RLock()
        self.cursor_lock, self.cursors = threading.Lock(), {}

    def cursor(self, actor, owner, prefix, field, value=None, token=None):
        with self.cursor_lock:
            now = time.monotonic()
            self.cursors = {key: row for key, row in self.cursors.items() if row[0] > now}
            identity = (actor, owner, prefix, field)
            if token:
                row = self.cursors.get(token)
                if not row or row[1] != identity:
                    raise drivesource.S3Fail(403, "AccessDenied", "This listing cursor belongs to another mount or prefix.")
                return row[2]
            if len(self.cursors) >= 10000:
                raise drivesource.S3Fail(503, "SlowDown", "Too many active Cloud Drive listings.")
            token = "audit-cursor:" + secrets.token_urlsafe(24)
            self.cursors[token] = (now + 300, identity, value)
            return token

    def path(self, actor, owner, key, write=False):
        if (not account_id(owner) and owner != ISO_LIBRARY_OWNER) or not key.startswith(actor + "/"):
            raise drivesource.S3Fail(403, "AccessDenied")
        path = key[len(actor) + 1:]
        trailing = path.endswith("/")
        parts = path.rstrip("/").split("/") if path.rstrip("/") else []
        if len(path.encode()) > 1024 or any(p in ("", ".", "..") or any(ord(c) < 32 for c in p) for p in parts):
            raise drivesource.S3Fail(400, "InvalidArgument")
        normalized = "/".join(parts) + ("/" if trailing and parts else "")
        if not self.permission(actor, owner, normalized.rstrip("/"), write):
            raise drivesource.S3Fail(403, "AccessDenied")
        return normalized

    def metadata(self, client, bucket, key, sse):
        if key.endswith("/"):
            objects, _ = client.list(bucket, prefix=key)
            if objects:
                return {"size": sum(int(item.get("size") or 0) for item in objects), "etag": ""}
        try:
            response = client.head(bucket, key, sse=sse)
            try:
                return {"size": int(response.headers.get("Content-Length") or 0),
                        "etag": response.headers.get("ETag", "")}
            finally:
                response.close()
                response.conn.close()
        except s3client.S3Error as error:
            if error.status == 404:
                return None
            raise

class Handler(drivesource.Handler):
    """S3 wire compatibility shares the source server's validated body reader."""

    server_version = "CloudDriveAudit/1"

    def dispatch(self):
        self.request_id, self.body_read = uuid.uuid4().hex[:16].upper(), False
        self.gateway = self.server.gateway
        self.intent = None
        raw_path, _, raw_query = self.path.partition("?")
        try:
            auth = self.headers.get("Authorization", "")
            access = auth.partition("Credential=")[2].partition("/")[0]
            actor, credentials = self.gateway.store.principal(access)
            payload = drivesource.check_signature(self, raw_path, raw_query, credentials)
            owner_bucket, _, key = urllib.parse.unquote(raw_path).lstrip("/").partition("/")
            if not owner_bucket.startswith(BUCKET_PREFIX):
                raise drivesource.S3Fail(404, "NoSuchBucket")
            owner = owner_bucket[len(BUCKET_PREFIX):]
            if not account_id(owner) and owner != ISO_LIBRARY_OWNER:
                raise drivesource.S3Fail(404, "NoSuchBucket")
            query = dict(urllib.parse.parse_qsl(raw_query, keep_blank_values=True))
            write = self.command not in ("GET", "HEAD")
            with self.gateway.mutations if write else contextlib.nullcontext():
                self.forward(actor, owner, key, query, payload)
        except (s3client.S3Error, drivesource.S3Fail) as error:
            if self.intent and isinstance(error, s3client.S3Error) and 400 <= error.status < 500:
                try:
                    self.gateway.store.complete(self.intent, self.intent["before"])
                except Exception as audit_error:
                    self.gateway.log(event="drive-audit-failure-record-failed", error=str(audit_error)[:200])
            self.fail(drivesource.S3Fail(error.status, error.code, error.message))
        except PermissionError:
            self.fail(drivesource.S3Fail(403, "AccessDenied"))
        except Exception as error:
            self.gateway.log(event="drive-audit-request-failed", error=str(error)[:200])
            self.fail(drivesource.S3Fail(503, "ServiceUnavailable", "Cloud Drive audit is unavailable."))
        finally:
            if self.unread():
                self.close_connection = True

    def forward(self, actor, owner, key, query, payload):
        write = self.command not in ("GET", "HEAD")
        client, bucket, root, sse = self.gateway.resolve(owner)
        if not key:
            if self.command == "HEAD":
                if not self.gateway.permission(actor, owner, "", False):
                    raise drivesource.S3Fail(403, "AccessDenied")
                return self.reply(200)
            if self.command == "GET" and "location" in query:
                if not self.gateway.permission(actor, owner, "", False):
                    raise drivesource.S3Fail(403, "AccessDenied")
                return self.xml(200, '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>')
            if self.command == "GET":
                return self.listing(actor, owner, client, bucket, root, query)
            if self.command == "POST" and "delete" in query:
                return self.delete_many(actor, owner, client, bucket, root, sse, payload)
            raise drivesource.S3Fail(405, "MethodNotAllowed")
        path = self.gateway.path(actor, owner, key, write)
        if not path:
            raise drivesource.S3Fail(403, "AccessDenied")
        actual = root + path
        # Only an object's ordinary version is writable; bucket policy/admin APIs
        # and version deletion are never forwarded with the backend credentials.
        allowed = {"uploads", "uploadId", "partNumber", "x-id"}
        if set(query) - allowed:
            raise drivesource.S3Fail(501, "NotImplemented")
        if "uploadId" in query:
            self.gateway.store.upload(query["uploadId"], actor, owner, path)
        final_write = self.command == "PUT" and "uploadId" not in query or self.command == "POST" and "uploadId" in query
        deletion = self.command == "DELETE" and "uploadId" not in query
        before = self.gateway.metadata(client, bucket, actual, sse) if final_write or deletion else None
        headers = {name: self.headers[name] for name in ("Range", "Content-Type", "Content-MD5", "If-Match", "If-None-Match")
                   if self.headers.get(name)}
        headers.update(s3client.sse_headers(sse))
        copy_source = self.headers.get("x-amz-copy-source")
        if copy_source:
            if "?" in copy_source:
                raise drivesource.S3Fail(501, "NotImplemented", "Copying historical versions is not supported.")
            source_bucket, _, source_key = urllib.parse.unquote(copy_source).lstrip("/").partition("/")
            if source_bucket != BUCKET_PREFIX + owner:
                raise drivesource.S3Fail(501, "NotImplemented", "Copy between Cloud Drives is not supported.")
            source_path = self.gateway.path(actor, owner, source_key, False)
            headers["x-amz-copy-source"] = urllib.parse.quote("/" + bucket + "/" + root + source_path, safe="/")
            headers.update(s3client.sse_headers(sse, copy_source=True))
            if self.headers.get("x-amz-copy-source-range"):
                headers["x-amz-copy-source-range"] = self.headers["x-amz-copy-source-range"]
        with contextlib.nullcontext():
            length = int(self.headers.get("Content-Length") or 0)
            if length > self.gateway.max_bytes or length < 0:
                raise drivesource.S3Fail(413, "EntityTooLarge")
            # The verified incoming signature binds this payload hash. Preserve
            # it in the backend signature so S3 validates streamed bytes without
            # buffering an entire workspace file on the platform's data volume.
            intent = self.gateway.store.begin(actor, owner, path, before) if (final_write or deletion) and not self.gateway.source(owner) else None
            self.intent = intent
            response = client.request(self.command, bucket, actual, list(query.items()),
                                      self.rfile if length else None, length if length else None, headers,
                                      payload_hash=payload)
            self.body_read = True
            try:
                # CompleteMultipartUpload can return a 200 XML error. It is not a
                # committed object and must not produce a notification.
                data = response.read(MAX_XML + 1) if self.command in ("PUT", "POST", "DELETE") else None
                if data is not None and len(data) > MAX_XML:
                    raise drivesource.S3Fail(503, "InvalidBackendResponse", "The backend returned oversized XML.")
                successful = not (data and ET.fromstring(data).tag.rsplit("}", 1)[-1] == "Error")
                if successful and self.command == "POST" and "uploads" in query:
                    upload_id = ET.fromstring(data).findtext(NS + "UploadId")
                    if not upload_id:
                        raise drivesource.S3Fail(503, "InvalidBackendResponse")
                    self.gateway.store.upload(upload_id, actor, owner, path, create=True)
                if successful and (final_write or deletion):
                    after = None if deletion else self.gateway.metadata(client, bucket, actual, sse)
                    if intent:
                        self.gateway.store.complete(intent, after)
                elif intent:
                    self.gateway.store.complete(intent, before)
                if successful and "uploadId" in query and self.command in ("POST", "DELETE"):
                    self.gateway.store.upload(query["uploadId"], actor, owner, path, remove=True)
                if data:
                    document = ET.fromstring(data)
                    for element in document.iter():
                        name = element.tag.rsplit("}", 1)[-1]
                        if name == "Bucket":
                            element.text = BUCKET_PREFIX + owner
                        elif name == "Key" and (element.text or "").startswith(root):
                            element.text = actor + "/" + element.text[len(root):]
                    data = ET.tostring(document)
                self.send_response(response.status)
                if data is not None:
                    self.send_header("Content-Length", str(len(data)))
                elif response.headers.get("Content-Length"):
                    self.send_header("Content-Length", response.headers["Content-Length"])
                else:
                    self.send_header("Connection", "close")
                    self.close_connection = True
                for name in ("Content-Type", "ETag", "Last-Modified", "Accept-Ranges", "Content-Range"):
                    if response.headers.get(name):
                        self.send_header(name, response.headers[name])
                self.end_headers()
                if self.command != "HEAD":
                    if data is not None:
                        self.wfile.write(data)
                    else:
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
            finally:
                response.close()
                response.conn.close()

    def listing(self, actor, owner, client, bucket, root, query):
        if set(query) - {"prefix", "delimiter", "max-keys", "marker", "list-type", "continuation-token", "start-after", "encoding-type"}:
            raise drivesource.S3Fail(501, "NotImplemented")
        mapped = dict(query)
        for name in ("prefix", "marker", "start-after"):
            if name in mapped:
                if name == "marker" and mapped[name].startswith("audit-cursor:"):
                    mapped[name] = self.gateway.cursor(actor, owner, query.get("prefix"), name, token=mapped[name])
                else:
                    mapped[name] = root + self.gateway.path(actor, owner, mapped[name], False)
        if "continuation-token" in mapped:
            mapped["continuation-token"] = self.gateway.cursor(actor, owner, query.get("prefix"), "continuation-token",
                                                              token=mapped["continuation-token"])
        if "prefix" not in mapped:
            raise drivesource.S3Fail(403, "AccessDenied")
        response = client.request("GET", bucket, query=list(mapped.items()))
        try:
            raw = response.read(MAX_XML + 1)
            if len(raw) > MAX_XML:
                raise drivesource.S3Fail(503, "InvalidBackendResponse", "The backend returned oversized XML.")
            document = ET.fromstring(raw)
        finally:
            response.close()
            response.conn.close()
        encoded = query.get("encoding-type") == "url"
        for item in list(document):
            name = item.tag.rsplit("}", 1)[-1]
            key = item.findtext(NS + "Key") or item.findtext(NS + "Prefix")
            if name in ("Contents", "CommonPrefixes") and key:
                key = urllib.parse.unquote(key) if encoded else key
                if not key.startswith(root) or not self.gateway.permission(actor, owner, key[len(root):].rstrip("/"), False):
                    document.remove(item)
        for item in document.iter():
            name = item.tag.rsplit("}", 1)[-1]
            if name in ("NextMarker", "NextContinuationToken") and item.text:
                field = "marker" if name == "NextMarker" else "continuation-token"
                value = urllib.parse.unquote(item.text) if encoded and field == "marker" else item.text
                item.text = self.gateway.cursor(actor, owner, query.get("prefix"), field, value=value)
            elif name in ("Marker", "ContinuationToken"):
                item.text = query.get("marker" if name == "Marker" else "continuation-token", "")
            elif name in ("Key", "Prefix", "StartAfter") and item.text:
                text = urllib.parse.unquote(item.text) if encoded else item.text
                if not text.startswith(root):
                    raise drivesource.S3Fail(503, "InvalidBackendResponse")
                text = actor + "/" + text[len(root):]
                item.text = urllib.parse.quote(text, safe="/") if encoded else text
            elif name == "Name":
                item.text = BUCKET_PREFIX + owner
            elif name == "KeyCount":
                item.text = str(sum(child.tag.rsplit("}", 1)[-1] in ("Contents", "CommonPrefixes") for child in document))
        self.reply(200, ET.tostring(document), "application/xml")

    def delete_many(self, actor, owner, client, bucket, root, sse, payload):
        try:
            document = ET.fromstring(self.body_bytes(payload, MAX_XML))
        except ET.ParseError:
            raise drivesource.S3Fail(400, "MalformedXML") from None
        paths = []
        for item in document:
            if item.tag.rsplit("}", 1)[-1] == "Object":
                key = item.findtext(NS + "Key") or item.findtext("Key") or ""
                path = self.gateway.path(actor, owner, key, True)
                if not path:
                    raise drivesource.S3Fail(403, "AccessDenied")
                paths.append((key, path))
        if len(paths) > 1000:
            raise drivesource.S3Fail(400, "MalformedXML")
        results = ['<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">']
        for key, path in paths:
            actual = root + path
            before = self.gateway.metadata(client, bucket, actual, sse)
            intent = self.gateway.store.begin(actor, owner, path, before) if not self.gateway.source(owner) else None
            self.intent = intent
            client.delete(bucket, actual)
            if intent:
                self.gateway.store.complete(intent, None)
            results.append("<Deleted><Key>%s</Key></Deleted>" % escape(key))
        results.append("</DeleteResult>")
        self.xml(200, "".join(results))


def serve(gateway, host, port, certificate=None, key=None):
    server = http.server.ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.gateway = gateway
    if certificate and key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certificate, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, name="drive-audit", daemon=True).start()
    return server
