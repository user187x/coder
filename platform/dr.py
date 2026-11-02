"""Disaster recovery for Coder's database (General > Persistence > Disaster recovery): copies of it outside the
cluster, besides CloudNativePG's own backups (which stay in the cluster).

  - A dump to download: pg_dump (custom format) of Coder's database, streamed to the admin's browser.
  - An S3 bucket: a dump every N hours (or on demand) to <prefix>coder-db-<UTC time>.dump, the newest `keep` kept.
  - An external PostgreSQL: Coder's database copied into it every N hours (or on demand) - its schemas made afresh
    there, then pg_dump piped into pg_restore - so it holds what Coder's held at that time; it never writes back.

The dumps run in the database's primary pod (CloudNativePG's instance has pg_dump, pg_restore and psql; this service
has none) through the exec API, as postgres on its local socket; their output streams through this service to the
browser or S3 (one part at a time, never the whole dump), and the copy runs there entirely (pg_dump | pg_restore,
the external database's address given on stdin, never in a command line). Targets and their keys are kept in
SETTINGS_FILE (0600, the service's volume); each run is recorded (the last RUNS_KEPT).

  GET  /__coder-ui/api/persistence/dr               admins: the targets (no secrets), the runs, whether it can run
  GET  /__coder-ui/api/persistence/dr/dump          admins: a dump now, as a download
  POST /__coder-ui/api/persistence/dr/targets       admins: {id?, kind: s3|postgres, name, everyHours, keep, ...}
  POST /__coder-ui/api/persistence/dr/targets/delete {id}
  POST /__coder-ui/api/persistence/dr/test          admins: a target (as saved, or as given) reached?
  POST /__coder-ui/api/persistence/dr/run {id}      admins: that target now (in the background)
"""
import json
import os
import queue
import re
import threading
import time
import urllib.parse
import uuid

import kexec
import s3client

BASE = "/__coder-ui"
SETTINGS_FILE = os.environ.get("DR_SETTINGS_FILE", "/data/dr.json")
NAMESPACE = os.environ.get("WORKSPACE_NAMESPACE", "coder")
CLUSTER = os.environ.get("CODER_DB_CLUSTER", "coder-db")
CONTAINER = "postgres"
RUNS_KEPT = 50
EVERY_HOURS = (0, 168)  # 0: on demand only
KEEP_RANGE = (1, 1000)
CHECK_EVERY = 60
NAME_RE = re.compile(r"^[\w .:@()+-]{1,60}$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")

LOG = KUBE = None
_lock = threading.Lock()  # one run at a time
_state = {"running": None}  # the run under way


def setup(log, kube):
    global LOG, KUBE
    LOG, KUBE = log, kube


def db_name():
    """Coder's database's name (CODER_DB_URI's path), else app (CloudNativePG's default)."""
    uri = os.environ.get("CODER_DB_URI", "")
    path = urllib.parse.urlsplit(uri).path.lstrip("/") if uri else ""
    return path or "app"


# ---------------------------------------------------------------------------------------------------- settings
def load():
    try:
        with open(SETTINGS_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            data.setdefault("targets", [])
            data.setdefault("runs", [])
            return data
    except (OSError, ValueError):
        pass
    return {"targets": [], "runs": []}


def save(data):
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w") as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(data, f)
    os.replace(tmp, SETTINGS_FILE)


def public(target):
    """A target as the dashboard shows it: no secret, only whether there is one."""
    out = {k: v for k, v in target.items() if k not in ("secretKey", "url", "caCert")}
    if target["kind"] == "s3":
        out["hasSecret"] = bool(target.get("secretKey"))
        out["hasCa"] = bool(target.get("caCert"))
    else:
        url = urllib.parse.urlsplit(target.get("url") or "")
        out["where"] = "%s%s" % (url.hostname or "", (":%d" % url.port) if url.port else "") + (url.path or "")
        out["hasSecret"] = bool(url.password)
    return out


def _int(body, key, lo, hi, default):
    value = body.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError("%s: a whole number from %d to %d." % (key, lo, hi))
    return value


def clean_target(body, old=None):
    """A target an admin gave, checked; secrets kept from the saved one when left empty."""
    kind = body.get("kind")
    if kind not in ("s3", "postgres"):
        raise ValueError("kind: s3 or postgres.")
    if old and old["kind"] != kind:
        old = None
    name = str(body.get("name") or "").strip()
    if not NAME_RE.match(name):
        raise ValueError("A name of up to 60 letters, digits and spaces.")
    target = {"id": (old or {}).get("id") or uuid.uuid4().hex[:12], "kind": kind, "name": name,
              "enabled": body.get("enabled", True) is not False,
              "everyHours": _int(body, "everyHours", *EVERY_HOURS, 24)}
    if kind == "s3":
        endpoint = str(body.get("endpoint") or "").strip().rstrip("/")
        if not re.match(r"^https?://[^\s/]+$", endpoint):
            raise ValueError("The endpoint: http(s)://host[:port], such as https://s3.us-east-1.amazonaws.com.")
        bucket = str(body.get("bucket") or "").strip()
        if not BUCKET_RE.match(bucket):
            raise ValueError("A bucket name of 3-63 lowercase letters, digits, dots and dashes.")
        prefix = str(body.get("prefix") or "").strip().lstrip("/")
        if prefix and not prefix.endswith("/"):
            prefix += "/"
        if len(prefix) > 200 or ".." in prefix.split("/"):
            raise ValueError("A prefix such as coder-db/.")
        ca = str(body.get("caCert") or "").strip() or (old or {}).get("caCert", "")
        if ca and "-----BEGIN CERTIFICATE-----" not in ca:
            raise ValueError("The CA: a PEM certificate (or none, for a public CA).")
        target.update(endpoint=endpoint, region=str(body.get("region") or "").strip(), bucket=bucket,
                      prefix=prefix, accessKey=str(body.get("accessKey") or "").strip(),
                      secretKey=str(body.get("secretKey") or "") or (old or {}).get("secretKey", ""),
                      caCert=ca, keep=_int(body, "keep", *KEEP_RANGE, 14))
        if not target["accessKey"] or not target["secretKey"]:
            raise ValueError("The access key and its secret.")
    else:
        url = str(body.get("url") or "").strip() or (old or {}).get("url", "")
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ("postgres", "postgresql") or not u.hostname or not u.path.strip("/"):
            raise ValueError("The database: postgresql://user:password@host:5432/dbname?sslmode=require.")
        if "\n" in url or "\r" in url:
            raise ValueError("The database's address is one line.")
        target["url"] = url
    return target


# ---------------------------------------------------------------------------------------------------- the database
def primary_pod():
    """The running primary instance of Coder's CloudNativePG cluster, else LookupError."""
    selector = "cnpg.io/cluster=%s,cnpg.io/instanceRole=primary" % CLUSTER
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote(selector)))
    for p in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        if (p.get("status") or {}).get("phase") == "Running" and not p["metadata"].get("deletionTimestamp"):
            return p["metadata"]["name"]
    raise LookupError("Coder's database has no running CloudNativePG primary (%s) in %s: its dumps run there."
                      % (CLUSTER, NAMESPACE))


def dump(on_chunk):
    """pg_dump of Coder's database (custom format) handed to on_chunk as it comes; RuntimeError when it fails."""
    pod = primary_pod()
    code, err = kexec.exec_stream(KUBE, NAMESPACE, pod, CONTAINER,
                                  ["pg_dump", "--format=custom", "--dbname", db_name()], on_chunk, timeout=120)
    if code != 0:
        raise RuntimeError("pg_dump failed: %s" % (err.strip()[-300:] or "exit %d" % code))


class _Pipe:
    """The dump's chunks from the exec thread to the uploader, a few at a time (bounded: never the whole dump)."""

    def __init__(self):
        self.q = queue.Queue(maxsize=64)
        self.buf = b""
        self.done = False
        self.closed = False

    def write(self, chunk):
        if self.closed:
            raise RuntimeError("the upload stopped")
        self.q.put(chunk)

    def end(self):
        self.q.put(None)

    def read(self, n):
        while len(self.buf) < n and not self.done:
            chunk = self.q.get()
            if chunk is None:
                self.done = True
            else:
                self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def close(self):
        self.closed = True
        try:
            while True:
                self.q.get_nowait()
        except queue.Empty:
            pass


def _ca_file(target):
    return "%s.%s.ca.pem" % (SETTINGS_FILE, target["id"])


def _s3(target):
    ca_file = None
    if target.get("caCert"):
        ca_file = _ca_file(target)
        with open(ca_file, "w") as f:
            f.write(target["caCert"])
    return s3client.S3(target["endpoint"], target.get("region") or "", target["accessKey"], target["secretKey"],
                       ca_file=ca_file, timeout=120)


def to_s3(target):
    """A dump into the bucket, then the oldest beyond `keep` removed: {key, bytes, removed}."""
    s3 = _s3(target)
    key = "%scoder-db-%s.dump" % (target.get("prefix") or "", time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    pipe, failure = _Pipe(), {}

    def produce():
        try:
            dump(pipe.write)
        except Exception as e:  # noqa: BLE001 - told to the uploader
            failure["error"] = e
        finally:
            pipe.end()

    worker = threading.Thread(target=produce, daemon=True)
    worker.start()
    try:
        size = s3.put_stream(target["bucket"], key, pipe.read)
    except Exception:
        pipe.close()
        raise
    worker.join(timeout=30)
    if failure.get("error"):
        try:
            s3.delete(target["bucket"], key)  # a partial dump is not a backup
        except (s3client.S3Error, OSError):
            pass
        raise failure["error"]
    objects, _ = s3.list(target["bucket"], prefix="%scoder-db-" % (target.get("prefix") or ""))
    dumps = sorted(o["key"] for o in objects if o["key"].endswith(".dump"))
    old = dumps[:max(0, len(dumps) - int(target.get("keep") or 14))]
    if old:
        s3.delete_many(target["bucket"], old)
    return {"key": key, "bytes": size, "removed": len(old)}


# pg_dump piped into pg_restore in the database's pod: the external database's address on stdin (one line). The
# schemas of Coder's database are dropped there first, with what is in them (public made again: a dump never creates
# it, the others it does): pg_restore --clean cannot be used - for a view in a dependency loop it first puts a stub in
# its place that names types the target may not have yet (an empty database, or a copy from before a Coder upgrade
# added them), and fails.
COPY = r"""set -o pipefail
IFS= read -r URL
for s in $(psql --dbname "$DB" -Atc "select quote_ident(nspname) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'"); do
  psql --dbname "$URL" -v ON_ERROR_STOP=1 -qc "SET client_min_messages = warning; DROP SCHEMA IF EXISTS $s CASCADE;"
done
psql --dbname "$URL" -v ON_ERROR_STOP=1 -qc "CREATE SCHEMA IF NOT EXISTS public;"
pg_dump --format=custom --dbname "$DB" | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$URL"
"""
TEST = r"""IFS= read -r URL
psql "$URL" -Atc 'select version()'
"""


def to_postgres(target):
    pod = primary_pod()
    out = []
    code, err = kexec.exec_stream(KUBE, NAMESPACE, pod, CONTAINER,
                                  ["env", "DB=" + db_name(), "bash", "-c", COPY], out.append, timeout=300,
                                  stdin=(target["url"] + "\n").encode())
    if code != 0:
        raise RuntimeError("The copy failed: %s" % (err.strip()[-300:] or "exit %d" % code))
    return {"bytes": None}


def test(target):
    """{ok, detail}: the bucket there and writable by the keys / the database answering."""
    try:
        if target["kind"] == "s3":
            s3 = _s3(target)
            if not s3.bucket_exists(target["bucket"]):
                return {"ok": False, "detail": "The bucket %s is not there." % target["bucket"]}
            probe = "%s.coder-dr-probe" % (target.get("prefix") or "")
            s3.put(target["bucket"], probe, b"ok")
            s3.delete(target["bucket"], probe)
            return {"ok": True, "detail": "The bucket takes writes."}
        pod = primary_pod()
        code, out, err = kexec.exec_in(KUBE, NAMESPACE, pod, CONTAINER, ["bash", "-c", TEST], timeout=30,
                                       stdin=(target["url"] + "\n").encode())
        if code != 0:
            return {"ok": False, "detail": (err.strip() or "exit %d" % code)[-300:]}
        return {"ok": True, "detail": out.strip()[:200]}
    except (s3client.S3Error, OSError, LookupError, RuntimeError) as e:
        return {"ok": False, "detail": str(e)[:300]}


# ---------------------------------------------------------------------------------------------------- runs
def run(target_id, by):
    """Runs a target now (the caller's thread); its record."""
    data = load()
    target = next((t for t in data["targets"] if t["id"] == target_id), None)
    if not target:
        raise LookupError("There is no such target.")
    if not _lock.acquire(blocking=False):
        raise ValueError("A copy is under way: wait for it to end.")
    record = {"id": uuid.uuid4().hex[:12], "target": target["id"], "name": target["name"], "kind": target["kind"],
              "at": int(time.time()), "by": by, "ok": None, "bytes": None, "seconds": None, "error": None}
    _state["running"] = record
    t0 = time.time()
    try:
        out = to_s3(target) if target["kind"] == "s3" else to_postgres(target)
        record.update(ok=True, bytes=out.get("bytes"), key=out.get("key"))
        LOG(event="dr-run", target=target["name"], kind=target["kind"], by=by, bytes=out.get("bytes"))
    except Exception as e:  # noqa: BLE001 - recorded and shown
        record.update(ok=False, error=str(e)[:300])
        LOG(event="dr-run-failed", target=target["name"], kind=target["kind"], by=by, error=str(e)[:300])
    finally:
        record["seconds"] = round(time.time() - t0, 1)
        _state["running"] = None
        data = load()
        data["runs"] = ([record] + data["runs"])[:RUNS_KEPT]
        for t in data["targets"]:
            if t["id"] == target["id"]:
                t["lastRun"] = record["at"]
                if record["ok"]:
                    t["lastSuccess"] = record["at"]
        save(data)
        _lock.release()
    return record


def run_in_background(target_id, by):
    if _state["running"]:
        raise ValueError("A copy is under way: wait for it to end.")
    if not any(t["id"] == target_id for t in load()["targets"]):
        raise LookupError("There is no such target.")
    threading.Thread(target=lambda: run(target_id, by), daemon=True).start()


def _loop():
    """Each enabled target with a schedule, once its hours have passed since its last run."""
    while True:
        time.sleep(CHECK_EVERY)
        try:
            for t in load()["targets"]:
                every = int(t.get("everyHours") or 0)
                if t.get("enabled") and every and time.time() - int(t.get("lastRun") or 0) >= every * 3600:
                    run(t["id"], "schedule")
        except Exception as e:  # noqa: BLE001 - the next minute tries again
            if LOG:
                LOG(event="dr-schedule-failed", error=str(e)[:300])


def start():
    if KUBE and KUBE.ok:
        threading.Thread(target=_loop, name="dr", daemon=True).start()


def view():
    data = load()
    try:
        pod, why = primary_pod(), None
    except LookupError as e:
        pod, why = None, str(e)
    return {"available": bool(pod), "unavailable": why, "database": db_name(), "cluster": CLUSTER,
            "targets": [public(t) for t in data["targets"]], "runs": data["runs"][:20],
            "running": _state["running"], "everyHoursRange": list(EVERY_HOURS), "keepRange": list(KEEP_RANGE)}


def download(h, user):
    """A dump now, streamed to the browser; a dump that fails half way ends the download short (and is logged)."""
    primary_pod()  # before any header: a clear error when there is none
    name = "coder-db-%s.dump" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    h.send_response(200)
    h.send_header("Content-Type", "application/octet-stream")
    h.send_header("Content-Disposition", 'attachment; filename="%s"' % name)
    h.send_header("Cache-Control", "no-store")
    h.send_header("X-Content-Type-Options", "nosniff")
    h.send_header("Connection", "close")
    h.end_headers()
    h.close_connection = True
    sent = [0]

    def write(chunk):
        h.wfile.write(chunk)
        sent[0] += len(chunk)

    try:
        dump(write)
        LOG(event="dr-download", by=user["username"], bytes=sent[0])
    except Exception as e:  # noqa: BLE001 - the headers are out: logged
        LOG(event="dr-download-failed", by=user["username"], bytes=sent[0], error=str(e)[:300])


def handle(h, method, path, query):
    """True when it answered."""
    if not path.startswith(BASE + "/api/persistence/dr"):
        return False
    if method == "POST" and not h.csrf_ok():
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user(admin=True)
    if err:
        return True
    try:
        if method == "GET" and path == BASE + "/api/persistence/dr":
            return h.send_json(200, view()) or True
        if method == "GET" and path == BASE + "/api/persistence/dr/dump":
            download(h, user)
            return True
        if method != "POST":
            return h.send_json(405, {"error": "method not allowed"}) or True
        payload = h.body()
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object.")
        data = load()
        old = next((t for t in data["targets"] if t["id"] == payload.get("id")), None)
        if path == BASE + "/api/persistence/dr/targets":
            target = clean_target(payload, old)
            for key in ("lastRun", "lastSuccess"):
                if old and key in old:
                    target[key] = old[key]
            data["targets"] = [t for t in data["targets"] if t["id"] != target["id"]] + [target]
            save(data)
            LOG(event="dr-target", action="saved", target=target["name"], kind=target["kind"], by=user["username"])
            return h.send_json(200, view()) or True
        if path == BASE + "/api/persistence/dr/targets/delete":
            if not old:
                raise LookupError("There is no such target.")
            data["targets"] = [t for t in data["targets"] if t["id"] != old["id"]]
            save(data)
            try:
                os.remove(_ca_file(old))  # its CA, written for its client
            except OSError:
                pass
            LOG(event="dr-target", action="deleted", target=old["name"], by=user["username"])
            return h.send_json(200, view()) or True
        if path == BASE + "/api/persistence/dr/test":
            target = clean_target(payload, old) if payload.get("kind") else old
            if not target:
                raise LookupError("There is no such target.")
            return h.send_json(200, test(target)) or True
        if path == BASE + "/api/persistence/dr/run":
            run_in_background(str(payload.get("id") or ""), user["username"])
            return h.send_json(200, view()) or True
        return h.send_json(404, {"error": "not found"}) or True
    except ValueError as e:
        return h.send_json(400, {"error": str(e)}) or True
    except LookupError as e:
        return h.send_json(404, {"error": str(e)}) or True
    except Exception as e:  # noqa: BLE001
        LOG(event="dr-failed", path=path, error=str(e)[:300])
        return h.send_json(503, {"error": str(e)[:300]}) or True
