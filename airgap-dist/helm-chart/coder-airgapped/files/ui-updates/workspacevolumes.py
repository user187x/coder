"""Workspace extras in the platform service: a workspace's own icon, backups of its home volume (to S3 or a file to
download) and growing its home disk. Owners and admins (whoever Coder lets update the workspace) use them from the
workspace's ⋮ menu and its Settings.

  GET  /__coder-ui/api/workspace-icons                     every workspace's own icon {workspace id: icon}
  POST /__coder-ui/api/workspace-icons/<id>                {icon}: set ("" = the template's again)
  GET  /__coder-ui/api/workspace-volumes/<id>              the home volume (size, storage class, can it grow
                                                           online), its backups and the latest disk change
  POST /__coder-ui/api/workspace-volumes/<id>/backup       {target: download | s3}
  GET  /__coder-ui/api/workspace-volumes/<id>/backups/<n>/download
  POST /__coder-ui/api/workspace-volumes/<id>/expand       {size: GB}
  GET  /__coder-ui/api/workspace-volumes/<id>/restore      the S3 backups its owner's workspaces have, to restore from
  POST /__coder-ui/api/workspace-volumes/<id>/restore/inspect  {key, mode, name} (S3), or PUT a file's first bytes
                                                           (?mode=&name=): what the backup holds, the quota's answer
  PUT  /__coder-ui/api/workspace-volumes/<id>/restore      ?mode=new|replace&name=: a backup file (the body), restored
  POST /__coder-ui/api/workspace-volumes/<id>/restore      {key, mode, name}: that S3 backup, restored

Backups: a Job mounts the home volume read-only (beside the running workspace: the volume is ReadWriteOnce, and pods
on its node share it) and streams a .tar.gz of it to the service, which writes it to S3 (Images > Settings) or keeps
it on the image builder's volume for 24 hours. Growing a disk: on a storage class that allows volume expansion
(EBS gp3 / gp2 on EKS) the volume grows in place, and the workspace restarts only if the file system needs it; on
one that does not (local-path, hostPath) the workspace is stopped, its home copied onto a bigger volume, which takes
the old one's name, and started again. The template ignores the volume's size afterwards (lifecycle ignore_changes),
so a later build never shrinks it back.

Each backup starts with what it was taken from (.coder-backup.json: the workspace, its template and parameters - CPU,
memory, disk), a gzip member of its own ahead of the home's: its first few KB say it, so a restore reads it (a range
of the S3 object, the first bytes of a file being uploaded) and asks the user quota (Health > User Quota) before
anything is downloaded or created. A restore makes a new workspace from it (the template and parameters it names; a
backup from before had none: this workspace's), or replaces this workspace's home. The backup is read to its end
first - a damaged or cut-off file, or one with an entry outside the home, is refused before anything changes; the
workspace is stopped, a Job (as root, so every owner and mode comes back) empties its home volume and unpacks the
backup into it, and the workspace starts.

The Jobs run this file: `python3 workspacevolumes.py archive SRC URL` (a .tar.gz of SRC, PUT to URL, chunked) and
`python3 workspacevolumes.py restore DST URL` (DST emptied, then the .tar.gz at URL unpacked into it).
"""
import datetime
import gzip
import io
import http.client
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import zlib
import xml.etree.ElementTree as ET

import imagebuilder as ib

BASE = "/__coder-ui"
NAMESPACE = os.environ.get("WORKSPACE_NAMESPACE", ib.NAMESPACE)
CODER_URL = os.environ.get("CODER_URL", "http://coder.coder.svc.cluster.local").rstrip("/")
KEEP_DOWNLOADS = int(os.environ.get("WORKSPACE_BACKUP_KEEP_HOURS", "24")) * 3600
MAX_DISK_GB = int(os.environ.get("WORKSPACE_DISK_MAX_GB", "2000"))   # sizes are decimal GB (10^9 bytes)
ICON_RE = re.compile(r"^(/[A-Za-z0-9_./%+-]{1,500}|https://[^\s\"'<>]{1,500})$")

META_NAME = ".coder-backup.json"   # the backup's first entry: what it was taken from
HEAD_BYTES = 256 * 1024           # enough to hold it
NAME_RE = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$")   # Coder's workspace names

LOG = HTTP_JSON = KUBE = None
QUOTA_CHECK = None   # ui-service's quota_check(token, user, body): {"allowed", "message", ...}
STORE = None
OPS = {}           # workspace id -> the running backup / disk operation (one at a time per workspace)
OPS_LOCK = threading.Lock()


def setup(log, http_json, kube):
    global LOG, HTTP_JSON, KUBE
    LOG, HTTP_JSON, KUBE = log, http_json, kube


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- storage
class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS icons (workspace_id TEXT PRIMARY KEY, icon TEXT NOT NULL, by TEXT, at TEXT);
                CREATE TABLE IF NOT EXISTS ops (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT, kind TEXT,
                    target TEXT, status TEXT, message TEXT, error TEXT, bytes INTEGER, path TEXT, bucket TEXT,
                    key TEXT, token TEXT, from_gi INTEGER, to_gi INTEGER, mode TEXT, by TEXT, created_at TEXT,
                    finished_at TEXT, label TEXT);
            """)
            if "meta" not in [r[1] for r in db.execute("PRAGMA table_info(ops)")]:
                db.execute("ALTER TABLE ops ADD COLUMN meta TEXT")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def icons(self):
        with self.connect() as db:
            return {r["workspace_id"]: r["icon"] for r in db.execute("SELECT workspace_id, icon FROM icons")}

    def set_icon(self, wid, icon, by):
        with self.connect() as db:
            if icon:
                db.execute("INSERT OR REPLACE INTO icons VALUES (?,?,?,?)", (wid, icon, by, now()))
            else:
                db.execute("DELETE FROM icons WHERE workspace_id=?", (wid,))

    def new_op(self, wid, kind, by, **fields):
        cols = ["workspace_id", "kind", "status", "by", "created_at"] + list(fields)
        vals = [wid, kind, "running", by, now()] + list(fields.values())
        with self.connect() as db:
            cur = db.execute("INSERT INTO ops (%s) VALUES (%s)" % (",".join(cols), ",".join("?" * len(cols))), vals)
            return cur.lastrowid

    def update(self, op_id, **fields):
        with self.connect() as db:
            db.execute("UPDATE ops SET %s WHERE id=?" % ",".join("%s=?" % k for k in fields),
                       list(fields.values()) + [op_id])

    def op(self, op_id=None, token=None):
        with self.connect() as db:
            r = db.execute("SELECT * FROM ops WHERE id=?" if op_id else "SELECT * FROM ops WHERE token=?",
                           (op_id or token,)).fetchone()
        return dict(r) if r else None

    def ops(self, wid, kind, limit=5):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM ops WHERE workspace_id=? AND kind=? ORDER BY id DESC "
                                                "LIMIT ?", (wid, kind, limit))]

    def expired_downloads(self):
        cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=KEEP_DOWNLOADS)
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM ops WHERE kind='backup' AND target='download' AND "
                                                "path IS NOT NULL AND created_at < ?", (cut.strftime("%Y-%m-%dT%H:%M:%SZ"),))]


def public(op):
    """An operation as the dashboard sees it (no token, no file path)."""
    out = {k: op.get(k) for k in ("id", "kind", "target", "status", "message", "error", "bytes", "bucket", "key",
                                  "mode", "by", "created_at", "finished_at")}
    out["fromGB"], out["toGB"] = op.get("from_gi"), op.get("to_gi")   # (columns named before sizes were GB)
    out["label"] = op.get("label")
    out["downloadable"] = bool(op.get("path") and op.get("status") == "done" and os.path.exists(op["path"]))
    return out


# --------------------------------------------------------------------------- Coder, as the user
def coder(token, method, path, body=None, timeout=20):
    return HTTP_JSON(CODER_URL + path, method=method, body=body, headers={"Coder-Session-Token": token},
                     timeout=timeout)


def workspace(token, wid):
    status, ws = coder(token, "GET", "/api/v2/workspaces/" + urllib.parse.quote(wid))
    if status != 200 or not isinstance(ws, dict):
        raise LookupError("No such workspace (or you cannot see it).")
    return ws


def can_update(token, ws):
    """Whoever Coder lets update the workspace: its owner, admins (Coder's own permission check)."""
    status, out = coder(token, "POST", "/api/v2/authcheck", {"checks": {"update": {
        "object": {"resource_type": "workspace", "resource_id": ws["id"], "owner_id": ws["owner_id"],
                   "organization_id": ws.get("organization_id", "")},
        "action": "update"}}})
    return status == 200 and bool((out or {}).get("update"))


def is_running(ws):
    b = ws.get("latest_build") or {}
    return b.get("transition") == "start" and b.get("status") in ("running", "starting", "pending")


def build(token, ws, transition):
    """A stop or start build (the same template version), then its end."""
    body = {"transition": transition}
    status, b = coder(token, "POST", "/api/v2/workspaces/%s/builds" % ws["id"], body)
    if status not in (200, 201):
        raise RuntimeError("Coder refused to %s the workspace: %s" % (transition, (b or {}).get("message", status)))
    deadline = time.time() + 1800
    while time.time() < deadline:
        time.sleep(3)
        status, cur = coder(token, "GET", "/api/v2/workspacebuilds/" + b["id"])
        job = (cur or {}).get("job") or {}
        if job.get("status") in ("succeeded",):
            return
        if job.get("status") in ("failed", "canceled"):
            raise RuntimeError("The %s build failed: %s" % (transition, job.get("error") or job.get("status")))
    raise RuntimeError("The %s build did not finish in 30 minutes." % transition)


# --------------------------------------------------------------------------- Kubernetes
def pvc_name(wid):
    return "coder-%s-home" % wid


def get_pvc(name):
    status, pvc = ib.kube_call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name))
    return pvc if status == 200 else None


def gb(q):
    """'25Gi' / '10G' / bytes -> decimal GB, to one place (25Gi = 26.8 GB)."""
    return round(ib_quantity(q) / 1e9, 1)


def ib_quantity(q):
    m = re.match(r"^([0-9.]+)([A-Za-z]*)$", str(q or "").strip())
    if not m:
        return 0
    n, unit = float(m.group(1)), m.group(2)
    mult = {"": 1, "Ki": 1024, "Mi": 1024 ** 2, "Gi": 1024 ** 3, "Ti": 1024 ** 4, "K": 1e3, "k": 1e3, "M": 1e6,
            "G": 1e9, "T": 1e12}.get(unit, 1)
    return n * mult


def volume_info(wid):
    pvc = get_pvc(pvc_name(wid))
    if not pvc:
        return None
    sc_name = (pvc.get("spec") or {}).get("storageClassName") or ""
    expandable = False
    if sc_name:
        status, sc = ib.kube_call("GET", "/apis/storage.k8s.io/v1/storageclasses/" + urllib.parse.quote(sc_name))
        expandable = status == 200 and bool((sc or {}).get("allowVolumeExpansion"))
    cap = ((pvc.get("status") or {}).get("capacity") or {}).get("storage")
    req = (((pvc.get("spec") or {}).get("resources") or {}).get("requests") or {}).get("storage")
    conditions = [c.get("type") for c in (pvc.get("status") or {}).get("conditions") or []]
    return {"name": pvc["metadata"]["name"], "sizeGB": gb(cap or req), "requestedGB": gb(req),
            "storageClass": sc_name, "expandable": expandable, "phase": (pvc.get("status") or {}).get("phase"),
            "conditions": conditions}


def workspace_node(wid):
    """The node of the workspace's running pod: a Job that mounts its volume beside it must run there (a
    ReadWriteOnce volume such as EBS is attached to one node)."""
    sel = urllib.parse.quote("com.coder.workspace.id=%s,app.kubernetes.io/name=coder-workspace" % wid)
    status, pods = ib.kube_call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (NAMESPACE, sel))
    for p in (pods or {}).get("items") or [] if status == 200 else []:
        if (p.get("status") or {}).get("phase") == "Running" and (p.get("spec") or {}).get("nodeName"):
            return p["spec"]["nodeName"]
    return None


def job_body(name, op_id, containers, volumes, root=False, node=None):
    ctx = ({"runAsUser": 0, "runAsGroup": 0, "seccompProfile": {"type": "RuntimeDefault"}} if root else
           {"runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000, "seccompProfile": {"type": "RuntimeDefault"}})
    spec = {"restartPolicy": "Never", "securityContext": ctx, "containers": containers, "volumes": volumes}
    if node:
        spec["nodeName"] = node
    if ib.PULL_SECRETS:
        spec["imagePullSecrets"] = ib.PULL_SECRETS
    return {"apiVersion": "batch/v1", "kind": "Job",
            "metadata": {"name": name, "namespace": NAMESPACE,
                         "labels": {"app.kubernetes.io/part-of": "coder", "coder.workspace-volume-op": str(op_id)}},
            "spec": {"backoffLimit": 0, "ttlSecondsAfterFinished": 3600, "activeDeadlineSeconds": 6 * 3600,
                     "template": {"metadata": {"labels": {"coder.workspace-volume-op": str(op_id)}}, "spec": spec}}}


def run_job(body, timeout=6 * 3600):
    """Starts the Job and waits for it: None when it succeeded, else why it did not."""
    name = body["metadata"]["name"]
    status, out = ib.kube_call("POST", "/apis/batch/v1/namespaces/%s/jobs" % NAMESPACE, body)
    if status not in (200, 201):
        return "could not start the Job (HTTP %s): %s" % (status, str(out)[:300])
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            time.sleep(3)
            status, job = ib.kube_call("GET", "/apis/batch/v1/namespaces/%s/jobs/%s" % (NAMESPACE, name))
            st = (job or {}).get("status") or {}
            if st.get("succeeded"):
                return None
            if st.get("failed"):
                return "the Job failed: " + job_log(name)
        return "the Job did not finish in time"
    finally:
        ib.kube_call("DELETE", "/apis/batch/v1/namespaces/%s/jobs/%s?propagationPolicy=Background" % (NAMESPACE, name))


def job_log(name):
    status, pods = ib.kube_call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("job-name=" + name)))
    for p in (pods or {}).get("items") or []:
        try:
            r = KUBE.stream("/api/v1/namespaces/%s/pods/%s/log?tailLines=20" % (NAMESPACE, p["metadata"]["name"]),
                            timeout=20)
            return r.read().decode("utf-8", "replace").strip()[-600:] or "(no output)"
        except Exception:  # noqa: BLE001
            pass
    return "(no log)"


def tools_container(name, command, mounts, root=False):
    sc = {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}}
    if root:
        # copying keeps every file's owner and mode
        sc["capabilities"]["add"] = ["CHOWN", "DAC_OVERRIDE", "DAC_READ_SEARCH", "FOWNER", "FSETID"]
    return {"name": name, "image": ib.TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent", "command": command,
            # the service's own image: its code in /app
            "securityContext": sc, "volumeMounts": mounts,
            "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"memory": "512Mi"}}}


# --------------------------------------------------------------------------- backups
def start_backup(token, ws, target, user):
    wid = ws["id"]
    if target == "s3":
        cfg = ib.s3_settings(True)
        if not (cfg.get("bucket") and cfg.get("accessKey") and cfg.get("secretKey") and cfg.get("region")):
            raise ValueError("S3 is not set up (Templates > Images > Settings).")
    elif target != "download":
        raise ValueError("A backup goes to S3 or to a download.")
    if not get_pvc(pvc_name(wid)):
        raise ValueError("This workspace has no home volume.")
    with OPS_LOCK:
        if wid in OPS:
            raise ValueError("Another backup, restore or disk change of this workspace is running.")
        tok = secrets.token_urlsafe(32)
        op_id = STORE.new_op(wid, "backup", user, target=target, token=tok, message="Starting the copy",
                             label="%s/%s" % (ws["owner_name"], ws["name"]), meta=json.dumps(backup_meta(token, ws)))
        OPS[wid] = op_id
    threading.Thread(target=run_backup, args=(ws, op_id, tok), daemon=True).start()
    LOG(event="workspace-backup", workspace=ws["name"], owner=ws["owner_name"], target=target, by=user)
    return op_id


def build_parameters(token, ws):
    build_id = (ws.get("latest_build") or {}).get("id")
    status, params = coder(token, "GET", "/api/v2/workspacebuilds/%s/parameters" % build_id) if build_id else (0, None)
    return [{"name": p.get("name"), "value": p.get("value")} for p in params if isinstance(p, dict)] \
        if status == 200 and isinstance(params, list) else []


def backup_meta(token, ws):
    """What a backup is taken from: a restore makes a workspace like it, and asks the quota first."""
    b = ws.get("latest_build") or {}
    info = volume_info(ws["id"]) or {}
    return {"version": 1, "workspace": ws.get("name"), "owner": ws.get("owner_name"),
            "template": {"id": ws.get("template_id"), "name": ws.get("template_name"),
                         "displayName": ws.get("template_display_name") or ws.get("template_name")},
            "templateVersionId": b.get("template_version_id"), "parameters": build_parameters(token, ws),
            "homeGB": info.get("sizeGB"), "takenAt": now()}


def meta_member(meta):
    """The backup's first gzip member: a tar entry ./.coder-backup.json (no end marker - the home's entries follow,
    in a member of their own; gzip and tar read the two as one)."""
    data = json.dumps(meta, indent=1).encode()
    info = tarfile.TarInfo("./" + META_NAME)
    info.size, info.mode, info.mtime, info.uid, info.gid = len(data), 0o600, int(time.time()), 1000, 1000
    return gzip.compress(info.tobuf(format=tarfile.GNU_FORMAT) + data + b"\0" * (-len(data) % 512))


def read_meta(head):
    """A backup's .coder-backup.json, from its first bytes; None for a backup without one (from before)."""
    try:
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = d.decompress(head, 64 * 1024)
        with tarfile.open(fileobj=io.BytesIO(raw + b"\0" * 1024), mode="r:") as tf:
            m = tf.next()
            if m is None or m.name.removeprefix("./") != META_NAME or not m.isfile() or m.size > 60 * 1024:
                return None
            meta = json.loads(tf.extractfile(m).read())
        return meta if isinstance(meta, dict) else None
    except (zlib.error, tarfile.TarError, ValueError, OSError, EOFError):
        return None


def run_backup(ws, op_id, tok):
    wid = ws["id"]
    try:
        url = "%s%s/internal/volumes/%s/archive" % (ib.SERVICE_URL, BASE, tok)
        body = job_body("coder-home-backup-%d" % op_id, op_id, [tools_container(
            "archive", ["python3", "/app/workspacevolumes.py", "archive", "/home/coder", url],
            [{"name": "home", "mountPath": "/home/coder", "readOnly": True}])],
            [{"name": "home", "persistentVolumeClaim": {"claimName": pvc_name(wid), "readOnly": True}}],
            node=workspace_node(wid))
        STORE.update(op_id, message="Copying the home volume")
        err = run_job(body)
        op = STORE.op(op_id)
        if err or op["status"] != "done":
            STORE.update(op_id, status="failed", finished_at=now(),
                         error=(err or op.get("error") or "The archive did not arrive.")[:1000])
    except Exception as e:  # noqa: BLE001
        STORE.update(op_id, status="failed", error=str(e)[:1000], finished_at=now())
    finally:
        with OPS_LOCK:
            OPS.pop(wid, None)


class Chunked:
    """The body of a chunked request (Transfer-Encoding: chunked), as a file to read."""

    def __init__(self, rfile):
        self.rfile, self.left, self.done = rfile, 0, False

    def read(self, n=65536):
        if self.done:
            return b""
        if self.left == 0:
            line = self.rfile.readline(1024).strip()
            size = int(line.split(b";")[0] or b"0", 16)
            if size == 0:
                while self.rfile.readline(1024).strip():
                    pass
                self.done = True
                return b""
            self.left = size
        data = self.rfile.read(min(n, self.left))
        self.left -= len(data)
        if self.left == 0:
            self.rfile.readline(4)
        return data


def receive_archive(h, op):
    """The Job's PUT: the .tar.gz, to S3 or a file (as it arrives; nothing is held in memory)."""
    ws_name = re.sub(r"[^A-Za-z0-9_.-]", "-", op["workspace_id"])
    src = Chunked(h.rfile) if "chunked" in (h.headers.get("Transfer-Encoding") or "").lower() else None
    left = None if src else int(h.headers.get("Content-Length") or 0)

    def chunks():
        nonlocal left
        while True:
            if src:
                d = src.read()
            else:
                if left <= 0:
                    return
                d = h.rfile.read(min(65536, left))
                left -= len(d)
            if not d:
                return
            yield d

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    total = 0
    meta = json.loads(op.get("meta") or "null")

    def with_meta():
        if meta:
            yield meta_member(meta)
        yield from chunks()

    try:
        if op["target"] == "s3":
            cfg = ib.s3_settings(True)
            label = re.sub(r"[^A-Za-z0-9_./-]", "-", op.get("label") or ws_name)
            key = "%sworkspaces/%s/%s.tar.gz" % (cfg.get("prefix") or "", label, stamp)
            up = ib.S3Upload(cfg, key)
            try:
                for d in with_meta():
                    up.write(d)
                    total += len(d)
                    if total % (256 * 1024 * 1024) < len(d):
                        STORE.update(op["id"], bytes=total)
                up.close()
            except Exception:
                up.abort()
                raise
            STORE.update(op["id"], status="done", bytes=total, bucket=cfg["bucket"], key=key, finished_at=now(),
                         message="In S3")
        else:
            folder = os.path.join(ib.FILES, "workspace-backups")
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, "%d-%s.tar.gz" % (op["id"], stamp))
            with open(path + ".part", "wb") as f:
                for d in with_meta():
                    f.write(d)
                    total += len(d)
                    if total % (256 * 1024 * 1024) < len(d):
                        STORE.update(op["id"], bytes=total)
            os.replace(path + ".part", path)
            STORE.update(op["id"], status="done", bytes=total, path=path, finished_at=now(),
                         message="Ready to download (kept %d hours)" % (KEEP_DOWNLOADS // 3600))
        h.send_json(200, {"ok": True, "bytes": total})
    except OSError as e:
        STORE.update(op["id"], status="failed", error=("No room left for the download: %s" % e
                                                       if e.errno == 28 else str(e))[:1000], finished_at=now())
        h.send_json(500, {"error": str(e)})


def cleanup_loop():
    while True:
        try:
            for op in STORE.expired_downloads():
                try:
                    os.remove(op["path"])
                except OSError:
                    pass
                STORE.update(op["id"], path=None, message="Expired (downloads are kept %d hours)" %
                             (KEEP_DOWNLOADS // 3600))
        except Exception as e:  # noqa: BLE001
            LOG(event="workspace-backup-cleanup-failed", error=str(e)[:300])
        time.sleep(600)


# --------------------------------------------------------------------------- disk expansion
def start_expand(token, ws, size, user):
    wid = ws["id"]
    info = volume_info(wid)
    if not info:
        raise ValueError("This workspace has no home volume.")
    if not isinstance(size, int) or size <= info["sizeGB"] or size > MAX_DISK_GB:
        raise ValueError("A whole number of GB larger than now (%g GB), up to %d GB." % (info["sizeGB"], MAX_DISK_GB))
    mode = "online" if info["expandable"] else "copy"
    with OPS_LOCK:
        if wid in OPS:
            raise ValueError("Another backup, restore or disk change of this workspace is running.")
        op_id = STORE.new_op(wid, "disk", user, from_gi=info["sizeGB"], to_gi=size, mode=mode,
                             message="Starting")
        OPS[wid] = op_id
    threading.Thread(target=run_expand, args=(token, ws, op_id, info, size, mode), daemon=True).start()
    LOG(event="workspace-disk-expand", workspace=ws["name"], owner=ws["owner_name"], size=size, mode=mode, by=user)
    return op_id


def run_expand(token, ws, op_id, info, size, mode):
    wid = ws["id"]
    try:
        if mode == "online":
            expand_online(token, ws, op_id, info, size)
        else:
            expand_by_copy(token, ws, op_id, info, size)
        STORE.update(op_id, status="done", finished_at=now(), message="The home disk is %d GB" % size)
    except Exception as e:  # noqa: BLE001
        STORE.update(op_id, status="failed", error=str(e)[:1500], finished_at=now())
        LOG(event="workspace-disk-expand-failed", workspace=ws["name"], error=str(e)[:300])
    finally:
        with OPS_LOCK:
            OPS.pop(wid, None)


def expand_online(token, ws, op_id, info, size):
    STORE.update(op_id, message="Growing the volume")
    status, out = KUBE.call("PATCH", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, info["name"]),
                            {"spec": {"resources": {"requests": {"storage": "%dG" % size}}}},
                            "application/merge-patch+json")
    if status != 200:
        raise RuntimeError("Kubernetes refused to grow the volume: %s" % ((out or {}).get("message") or status))
    deadline = time.time() + 1800
    restarted = False
    while time.time() < deadline:
        time.sleep(5)
        cur = volume_info(ws["id"]) or {}
        if cur.get("sizeGB", 0) >= size and "FileSystemResizePending" not in cur.get("conditions", []):
            return
        if "FileSystemResizePending" in cur.get("conditions", []) and not restarted:
            # the file system grows when the volume is mounted again
            fresh = workspace(token, ws["id"])
            if is_running(fresh):
                STORE.update(op_id, message="Restarting the workspace so its file system grows")
                build(token, fresh, "stop")
                build(token, fresh, "start")
            restarted = True
    raise RuntimeError("The volume did not reach %d GB in 30 minutes (storage class %s)." % (size, info["storageClass"]))


def wait_gone(path, timeout=600):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, _ = ib.kube_call("GET", path)
        if status == 404:
            return
        time.sleep(3)
    raise RuntimeError("%s was not deleted in time." % path.rsplit("/", 1)[-1])


def wait_no_pods(wid, timeout=900):
    sel = urllib.parse.quote("com.coder.workspace.id=%s,app.kubernetes.io/name=coder-workspace" % wid)
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, pods = ib.kube_call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (NAMESPACE, sel))
        if status == 200 and not (pods or {}).get("items"):
            return
        time.sleep(3)
    raise RuntimeError("The workspace's pod did not go away.")


def new_pvc_body(old, name, size, temp=False):
    """A PVC like `old` (its labels and annotations, so Terraform and the dashboard know it), of `size` GB; a
    temporary one only says whose copy it is."""
    md = old["metadata"]
    keep = lambda d: {k: v for k, v in (d or {}).items() if not re.match(  # noqa: E731
        r"^(pv\.kubernetes\.io|volume\.kubernetes\.io|volume\.beta\.kubernetes\.io|kubectl\.kubernetes\.io)/", k)}
    spec = {"accessModes": old["spec"].get("accessModes") or ["ReadWriteOnce"],
            "resources": {"requests": {"storage": "%dG" % size}}}
    if old["spec"].get("storageClassName"):
        spec["storageClassName"] = old["spec"]["storageClassName"]
    if old["spec"].get("volumeMode"):
        spec["volumeMode"] = old["spec"]["volumeMode"]
    labels = ({"app.kubernetes.io/part-of": "coder", "coder.workspace-volume-copy-of": md["name"][:63]} if temp
              else keep(md.get("labels")))
    return {"apiVersion": "v1", "kind": "PersistentVolumeClaim",
            "metadata": {"name": name, "namespace": NAMESPACE, "labels": labels,
                         "annotations": {} if temp else keep(md.get("annotations"))}, "spec": spec}


def copy_job(op_id, step, src, dst):
    """`cp -a` of one volume onto another (as root, so every owner and mode is kept), then a check that they match."""
    script = ("set -e; cp -a /from/. /to/; chown \"$(stat -c %u:%g /from)\" /to; chmod \"$(stat -c %a /from)\" /to; "
              "a=$(cd /from && find . | wc -l); b=$(cd /to && find . | wc -l); "
              "echo \"files: $a -> $b\"; [ \"$a\" -le \"$b\" ]")
    return job_body("coder-home-%s-%d" % (step, op_id), op_id,
                    [tools_container("copy", ["sh", "-c", script],
                                     [{"name": "from", "mountPath": "/from", "readOnly": True},
                                      {"name": "to", "mountPath": "/to"}], root=True)],
                    [{"name": "from", "persistentVolumeClaim": {"claimName": src, "readOnly": True}},
                     {"name": "to", "persistentVolumeClaim": {"claimName": dst}}], root=True)


def expand_by_copy(token, ws, op_id, info, size):
    name = info["name"]
    temp = "%s-grow-%d" % (name, op_id)
    pvcs = "/api/v1/namespaces/%s/persistentvolumeclaims" % NAMESPACE
    fresh = workspace(token, ws["id"])
    was_running = is_running(fresh)
    if was_running:
        STORE.update(op_id, message="Stopping the workspace")
        build(token, fresh, "stop")
    wait_no_pods(ws["id"])
    old = get_pvc(name)
    STORE.update(op_id, message="Copying the home volume onto a %d GB one" % size)
    status, out = ib.kube_call("POST", pvcs, new_pvc_body(old, temp, size, temp=True))
    if status not in (200, 201):
        raise RuntimeError("Could not create the new volume: %s" % ((out or {}).get("message") or status))
    err = run_job(copy_job(op_id, "copy", name, temp))
    if err:
        ib.kube_call("DELETE", "%s/%s" % (pvcs, temp))
        raise RuntimeError("The copy failed, nothing was changed (the workspace stays stopped): " + err)
    # from here the data is safe on the new volume: it takes the old one's name
    STORE.update(op_id, message="Swapping the volumes")
    ib.kube_call("DELETE", "%s/%s" % (pvcs, name))
    wait_gone("%s/%s" % (pvcs, name))
    status, out = ib.kube_call("POST", pvcs, new_pvc_body(old, name, size))
    if status not in (200, 201):
        raise RuntimeError("Could not recreate %s: %s. The home is safe on %s." % (
            name, (out or {}).get("message") or status, temp))
    err = run_job(copy_job(op_id, "back", temp, name))
    if err:
        raise RuntimeError("The copy onto %s failed: %s. The home is safe on %s." % (name, err, temp))
    ib.kube_call("DELETE", "%s/%s" % (pvcs, temp))
    if was_running:
        STORE.update(op_id, message="Starting the workspace")
        build(token, workspace(token, ws["id"]), "start")


# --------------------------------------------------------------------------- restores
def s3_ready(cfg):
    return bool(cfg.get("bucket") and cfg.get("accessKey") and cfg.get("secretKey") and cfg.get("region"))


def s3_prefix(cfg, owner):
    """Where the backups of `owner`'s workspaces are (receive_archive's key: <prefix>workspaces/<owner>/<name>/)."""
    return "%sworkspaces/%s/" % (cfg.get("prefix") or "", re.sub(r"[^A-Za-z0-9_./-]", "-", owner))


def s3_backups(ws):
    """The S3 backups a restore for `ws` may use - its owner's workspaces' - newest first; None without S3."""
    cfg = ib.s3_settings(True)
    if not s3_ready(cfg):
        return None
    prefix = s3_prefix(cfg, ws["owner_name"])
    _, _, body = ib.s3_request(cfg, "GET", "", "list-type=2&prefix=" + urllib.parse.quote(prefix, safe="-_.~"))
    out = []
    for c in ET.fromstring(body).iter():
        if not c.tag.endswith("Contents"):
            continue
        f = {e.tag.rsplit("}", 1)[-1]: e.text for e in c}
        key = f.get("Key") or ""
        if key.endswith(".tar.gz"):
            out.append({"key": key, "workspace": key[len(prefix):].split("/")[0], "bytes": int(f.get("Size") or 0),
                        "modified": f.get("LastModified")})
    return sorted(out, key=lambda x: x["modified"] or "", reverse=True)


def s3_key_ok(ws, key):
    cfg = ib.s3_settings(True)
    if not s3_ready(cfg):
        raise ValueError("S3 is not set up (Templates > Images > Settings).")
    if not (isinstance(key, str) and key.startswith(s3_prefix(cfg, ws["owner_name"])) and key.endswith(".tar.gz")
            and ".." not in key.split("/")):
        raise ValueError("Only a backup of %s's workspaces can be restored here." % ws["owner_name"])
    return cfg


def s3_head(cfg, key):
    """The first bytes of an S3 backup (a range: the rest is not downloaded)."""
    with ib.s3_open(cfg, "GET", key, headers={"Range": "bytes=0-%d" % (HEAD_BYTES - 1)}) as r:
        return r.read(HEAD_BYTES)


def restore_plan(token, user, ws, meta, mode, name):
    """What a restore would do, and the quota's answer - before anything is downloaded or created.
    mode new: a workspace `name` from the backup's template and parameters (a backup without them: this workspace's);
    mode replace: this workspace's home replaced (its template and parameters kept: the quota is not changed)."""
    if mode not in ("new", "replace"):
        raise ValueError("A restore makes a new workspace or replaces this one's home.")
    source = "backup" if meta and (meta.get("template") or {}).get("id") else "this workspace"
    template_id = (meta.get("template") or {}).get("id") if source == "backup" else ws.get("template_id")
    params = meta.get("parameters") if source == "backup" else build_parameters(token, ws)
    plan = {"mode": mode, "meta": meta, "source": source, "templateId": template_id, "parameters": params or []}
    if mode == "replace":
        plan["quota"] = {"allowed": True, "message": "This workspace keeps its template and parameters: the quota "
                                                     "does not change."}
        return plan
    if not NAME_RE.match(name or ""):
        raise ValueError("A workspace name: letters, digits and dashes, up to 32, not starting or ending with a dash.")
    status, _ = coder(token, "GET", "/api/v2/users/%s/workspace/%s" % (urllib.parse.quote(ws["owner_name"]),
                                                                       urllib.parse.quote(name)))
    if status == 200:
        raise ValueError("%s already has a workspace named %s." % (ws["owner_name"], name))
    st, t = coder(token, "GET", "/api/v2/templates/%s" % template_id) if template_id else (0, None)
    if st != 200 or not isinstance(t, dict):
        raise ValueError("The backup's template (%s) is not here any more: restore it into this workspace instead." %
                         ((meta or {}).get("template") or {}).get("displayName", "unknown"))
    plan["template"] = {"id": t["id"], "name": t.get("display_name") or t.get("name"), "activeVersionId": t.get(
        "active_version_id")}
    # only the parameters the template's current version still has (a newer one may have dropped some)
    st, rich = coder(token, "GET", "/api/v2/templateversions/%s/rich-parameters" % t.get("active_version_id"))
    names = {p.get("name") for p in rich} if st == 200 and isinstance(rich, list) else set()
    plan["parameters"] = [p for p in plan["parameters"] if p.get("name") in names]
    plan["quota"] = QUOTA_CHECK(token, user, {"owner": ws["owner_name"], "template_id": t["id"],
                                              "rich_parameter_values": plan["parameters"]}) if QUOTA_CHECK else \
        {"allowed": True, "message": "no quota service"}
    return plan


def restore_path(op_id):
    folder = os.path.join(ib.FILES, "workspace-restores")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "%d.tar.gz" % op_id)


def check_archive(path):
    """A home backup: a gzip'd tar, read to its end (a damaged or cut-off file fails here, before anything is
    replaced), every entry inside the home (no absolute path, no ..). How many entries it has."""
    n = 0
    try:
        with tarfile.open(path, "r:gz") as tf:
            for m in tf:
                parts = m.name.split("/")
                if m.name.startswith("/") or ".." in parts or (m.islnk() and (
                        m.linkname.startswith("/") or ".." in m.linkname.split("/"))):
                    raise ValueError("It has an entry outside the home: %s" % m.name[:200])
                n += m.name.removeprefix("./") != META_NAME
        with gzip.open(path, "rb") as g:   # every gzip member to its end (their checksums), past tar's end marker
            while g.read(1024 * 1024):
                pass
    except (tarfile.TarError, OSError, EOFError) as e:
        raise ValueError("Not a home backup (.tar.gz): %s" % e)
    if n == 0:
        raise ValueError("The backup is empty.")
    return n


class Refused(Exception):
    """The quota (or the plan) refuses the restore: nothing was created or changed."""


def receive_upload(h, path, on_head):
    """A backup file the browser sends (the PUT's body), to `path`; on_head(first bytes) is asked before the rest is
    taken (it raises to refuse). Its size."""
    left = int(h.headers.get("Content-Length") or 0)
    if left <= 0:
        raise ValueError("No file was sent.")
    total, head, asked = 0, b"", False
    try:
        with open(path + ".part", "wb") as f:
            while left > 0:
                d = h.rfile.read(min(1024 * 1024, left))
                if not d:
                    raise ValueError("The upload ended early.")
                left -= len(d)
                total += len(d)
                if not asked:
                    head += d
                    if len(head) >= HEAD_BYTES or left == 0:
                        on_head(head)
                        asked = True
                f.write(d)
        os.replace(path + ".part", path)
    except BaseException:
        try:
            os.remove(path + ".part")
        except OSError:
            pass
        raise
    return total


def fetch_s3(cfg, key, path):
    total = 0
    with ib.s3_open(cfg, "GET", key) as r, open(path + ".part", "wb") as f:
        while True:
            d = r.read(1024 * 1024)
            if not d:
                break
            f.write(d)
            total += len(d)
    os.replace(path + ".part", path)
    return total


def start_restore(token, ws, user, mode, name, h=None, key=None):
    """From the file in the PUT `h` or the S3 backup `key`: the quota asked first (from the backup's first bytes),
    then checked and restored in the background."""
    wid = ws["id"]
    if mode == "replace" and not get_pvc(pvc_name(wid)):
        raise ValueError("This workspace has no home volume.")
    cfg = s3_key_ok(ws, key) if key is not None else None
    plan = None
    if cfg:   # S3: the plan (and the quota) from a range of the object, before it is downloaded
        plan = restore_plan(token, user, ws, read_meta(s3_head(cfg, key)), mode, name)
        if not plan["quota"].get("allowed"):
            raise Refused(plan["quota"].get("message") or "Over your quota.")
    with OPS_LOCK:
        if wid in OPS:
            raise ValueError("Another backup, restore or disk change of this workspace is running.")
        op_id = STORE.new_op(wid, "restore", user["username"], target="s3" if key else "upload", key=key, mode=mode,
                             message="Fetching the backup from S3" if key else "Receiving the backup",
                             label="%s/%s" % (ws["owner_name"], name if mode == "new" else ws["name"]))
        OPS[wid] = op_id
    path = restore_path(op_id)
    try:
        if h is not None:
            def on_head(head):   # an upload: the plan from its first bytes, before the rest is taken
                nonlocal plan
                plan = restore_plan(token, user, ws, read_meta(head), mode, name)
                if not plan["quota"].get("allowed"):
                    raise Refused(plan["quota"].get("message") or "Over your quota.")
            STORE.update(op_id, bytes=receive_upload(h, path, on_head))
    except Exception as e:
        STORE.update(op_id, status="failed", error=str(e)[:1000], finished_at=now())
        with OPS_LOCK:
            OPS.pop(wid, None)
        if isinstance(e, (Refused, ValueError)):
            raise
        raise ValueError("The upload failed: %s" % e)
    STORE.update(op_id, meta=json.dumps(plan["meta"]) if plan["meta"] else None)
    threading.Thread(target=run_restore, args=(token, ws, op_id, path, cfg, key, plan, name), daemon=True).start()
    LOG(event="workspace-restore", workspace=ws["name"], owner=ws["owner_name"], source="s3" if key else "upload",
        mode=mode, name=name, by=user["username"])
    return op_id


def restore_job(op_id, wid, url):
    return job_body("coder-home-restore-%d" % op_id, op_id, [tools_container(
        "restore", ["python3", "/app/workspacevolumes.py", "restore", "/home/coder", url],
        [{"name": "home", "mountPath": "/home/coder"}], root=True)],
        [{"name": "home", "persistentVolumeClaim": {"claimName": pvc_name(wid)}}], root=True)


def wait_build(token, build_id, what):
    deadline = time.time() + 1800
    while time.time() < deadline:
        time.sleep(3)
        _, cur = coder(token, "GET", "/api/v2/workspacebuilds/" + build_id)
        job = (cur or {}).get("job") or {}
        if job.get("status") == "succeeded":
            return
        if job.get("status") in ("failed", "canceled"):
            raise RuntimeError("%s failed: %s" % (what, job.get("error") or job.get("status")))
    raise RuntimeError("%s did not finish in 30 minutes." % what)


def create_workspace(token, ws, plan, name):
    """The new workspace, as the backup's: its template (active version) and parameters. Coder asks the quota again."""
    status, new = coder(token, "POST", "/api/v2/users/%s/workspaces" % urllib.parse.quote(ws["owner_name"]), {
        "name": name, "template_id": plan["template"]["id"], "rich_parameter_values": plan["parameters"]}, timeout=60)
    if status not in (200, 201) or not isinstance(new, dict):
        raise RuntimeError("Coder did not create %s: %s" % (name, (new or {}).get("message") or status))
    wait_build(token, new["latest_build"]["id"], "Creating %s" % name)
    return workspace(token, new["id"])


def run_restore(token, ws, op_id, path, cfg, key, plan, name):
    target = ws
    try:
        if key:
            STORE.update(op_id, bytes=fetch_s3(cfg, key, path))
        STORE.update(op_id, message="Checking the backup")
        entries = check_archive(path)
        if plan["mode"] == "new":
            STORE.update(op_id, message="Creating the workspace %s" % name)
            target = create_workspace(token, ws, plan, name)
        fresh = workspace(token, target["id"])
        if is_running(fresh):
            STORE.update(op_id, message="Stopping %s" % target["name"])
            build(token, fresh, "stop")
        wait_no_pods(target["id"])
        if not get_pvc(pvc_name(target["id"])):
            raise RuntimeError("%s has no home volume." % target["name"])
        tok = secrets.token_urlsafe(32)
        STORE.update(op_id, token=tok, path=path, message="Restoring the home (%d files and folders)" % entries)
        err = run_job(restore_job(op_id, target["id"], "%s%s/internal/volumes/%s/restore" % (ib.SERVICE_URL, BASE,
                                                                                          tok)))
        STORE.update(op_id, token=None)
        if err:
            raise RuntimeError("The restore did not finish (%s stays stopped): %s" % (target["name"], err))
        STORE.update(op_id, message="Starting %s" % target["name"])
        build(token, workspace(token, target["id"]), "start")
        STORE.update(op_id, status="done", finished_at=now(),
                     message="Restored into %s (%d files and folders); it is starting" % (target["name"], entries))
    except Exception as e:  # noqa: BLE001
        STORE.update(op_id, status="failed", token=None, error=str(e)[:1500], finished_at=now())
        LOG(event="workspace-restore-failed", workspace=target.get("name"), error=str(e)[:300])
    finally:
        for p in (path, path + ".part"):
            try:
                os.remove(p)
            except OSError:
                pass
        STORE.update(op_id, path=None)
        with OPS_LOCK:
            OPS.pop(ws["id"], None)


def send_restore(h, op):
    """The Job's GET: the backup being restored."""
    path = op.get("path")
    if not path or not os.path.exists(path):
        h.send(404, "not found\n")
        return
    h.send_response(200)
    h.send_header("Content-Type", "application/gzip")
    h.send_header("Content-Length", str(os.path.getsize(path)))
    h.send_header("Connection", "close")
    h.end_headers()
    h.close_connection = True
    with open(path, "rb") as f:
        shutil.copyfileobj(f, h.wfile, 1024 * 1024)


# --------------------------------------------------------------------------- HTTP
def handle_internal(h, method, path):
    m = re.match(r"^%s/internal/volumes/([A-Za-z0-9_-]{20,})/(archive|restore)$" % BASE, path)
    if not m or not STORE:
        return False
    op = STORE.op(token=m.group(1))
    want = {"archive": ("backup", "PUT"), "restore": ("restore", "GET")}[m.group(2)]
    if not op or op["status"] != "running" or (op["kind"], method) != want:
        h.send(404, "not found\n")
        return True
    if op["kind"] == "restore":
        send_restore(h, op)   # the token stays until the Job ends (it may be retried)
        return True
    STORE.update(op["id"], token=None)   # one upload per token
    receive_archive(h, op)
    return True


def handle(h, method, path, query):
    """True when it answered."""
    if not (path.startswith(BASE + "/api/workspace-icons") or path.startswith(BASE + "/api/workspace-volumes")):
        return False
    if not STORE:
        h.send_json(404, {"error": "Workspace volumes need the image builder's volume (imageBuilder.enabled)."})
        return True
    # a backup file (or its first bytes) is the body, not JSON: the uploads' check for those
    binary = method == "PUT" or (method == "POST" and not (h.headers.get("Content-Type") or "").startswith(
        "application/json"))
    if method in ("POST", "PUT") and not (ib.upload_csrf_ok(h) if binary else h.csrf_ok()):
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user()
    if err:
        return True
    token = h.token()
    try:
        return route(h, method, path, user, token, query)
    except LookupError as e:
        h.send_json(404, {"error": str(e)})
    except PermissionError:
        h.send_json(403, {"error": "Only the workspace's owner and admins can do this."})
    except ValueError as e:
        h.send_json(400, {"error": str(e)})
    return True


def read_json(h):
    n = int(h.headers.get("Content-Length") or 0)
    data = json.loads(h.rfile.read(min(n, 65536)) or b"{}") if n else {}
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def route(h, method, path, user, token, query=""):
    if path == BASE + "/api/workspace-icons" and method == "GET":
        return h.send_json(200, {"icons": STORE.icons()}) or True
    m = re.match(r"^%s/api/workspace-icons/([0-9a-f-]{36})$" % BASE, path)
    if m and method == "POST":
        ws = workspace(token, m.group(1))
        if not can_update(token, ws):
            raise PermissionError
        icon = str(read_json(h).get("icon") or "").strip()
        if icon and not ICON_RE.match(icon):
            raise ValueError("An icon is a path on Coder (/icon/..., /emojis/...) or an https:// address.")
        STORE.set_icon(ws["id"], icon, user["username"])
        LOG(event="workspace-icon", workspace=ws["name"], owner=ws["owner_name"], by=user["username"])
        return h.send_json(200, {"icon": icon}) or True
    m = re.match(r"^%s/api/workspace-volumes/([0-9a-f-]{36})(/.*)?$" % BASE, path)
    if not m:
        return h.send_json(404, {"error": "not found"}) or True
    ws = workspace(token, m.group(1))
    sub = m.group(2) or ""
    allowed = can_update(token, ws)
    if not allowed:
        raise PermissionError
    if sub == "" and method == "GET":
        s3 = ib.s3_settings(True) if ib.STORE else {}
        return h.send_json(200, {
            "volume": volume_info(ws["id"]), "running": is_running(ws),
            "busy": ws["id"] in OPS,
            "backups": [public(o) for o in STORE.ops(ws["id"], "backup")],
            "disk": [public(o) for o in STORE.ops(ws["id"], "disk", 1)],
            "restores": [public(o) for o in STORE.ops(ws["id"], "restore", 3)],
            "s3": bool(s3.get("bucket") and s3.get("accessKey") and s3.get("secretKey")),
            "keepHours": KEEP_DOWNLOADS // 3600, "maxGB": MAX_DISK_GB}) or True
    if sub == "/backup" and method == "POST":
        op_id = start_backup(token, ws, str(read_json(h).get("target") or ""), user["username"])
        return h.send_json(200, {"backup": op_id}) or True
    if sub == "/restore" and method == "GET":
        return h.send_json(200, {"s3": s3_backups(ws)}) or True
    if sub == "/restore/inspect" and method in ("POST", "PUT"):
        if method == "POST":
            body = read_json(h)
            head = s3_head(s3_key_ok(ws, body.get("key")), body.get("key"))
        else:   # a file's first bytes
            q = urllib.parse.parse_qs(query)
            body = {"mode": (q.get("mode") or [""])[0], "name": (q.get("name") or [""])[0]}
            head = h.rfile.read(min(int(h.headers.get("Content-Length") or 0), HEAD_BYTES))
        plan = restore_plan(token, user, ws, read_meta(head), str(body.get("mode") or "new"), str(body.get("name") or ""))
        return h.send_json(200, {k: plan.get(k) for k in ("mode", "meta", "source", "template", "quota")}) or True
    if sub == "/restore" and method in ("PUT", "POST"):
        q = urllib.parse.parse_qs(query)
        body = {"mode": (q.get("mode") or ["new"])[0], "name": (q.get("name") or [""])[0]} if method == "PUT" \
            else read_json(h)
        try:
            op_id = start_restore(token, ws, user, str(body.get("mode") or "new"), str(body.get("name") or ""),
                                  h=h if method == "PUT" else None, key=body.get("key") if method == "POST" else None)
        except Refused as e:
            h.close_connection = True   # the rest of an upload is not read
            return h.send_json(403, {"error": str(e), "quota": True}) or True
        return h.send_json(200, {"restore": op_id}) or True
    if sub == "/expand" and method == "POST":
        size = read_json(h).get("size")
        op_id = start_expand(token, ws, int(size) if isinstance(size, (int, float)) else None, user["username"])
        return h.send_json(200, {"disk": op_id}) or True
    mb = re.match(r"^/backups/(\d+)/download$", sub)
    if mb and method == "GET":
        op = STORE.op(int(mb.group(1)))
        if not op or op["workspace_id"] != ws["id"] or not op.get("path") or not os.path.exists(op["path"]):
            raise LookupError("That backup is not here (any more).")
        size = os.path.getsize(op["path"])
        fname = "%s-%s-%s" % (ws["owner_name"], ws["name"], os.path.basename(op["path"]).split("-", 1)[1])
        h.send_response(200)
        h.send_header("Content-Type", "application/gzip")
        h.send_header("Content-Length", str(size))
        h.send_header("Content-Disposition", 'attachment; filename="%s"' % re.sub(r'[^A-Za-z0-9_.-]', "-", fname))
        h.send_header("Connection", "close")
        h.end_headers()
        h.close_connection = True
        with open(op["path"], "rb") as f:
            shutil.copyfileobj(f, h.wfile, 1024 * 1024)
        LOG(event="workspace-backup-download", workspace=ws["name"], owner=ws["owner_name"], by=user["username"])
        return True
    return h.send_json(404, {"error": "not found"}) or True


def start():
    global STORE
    if ib.ENABLED:
        STORE = Store(os.path.join(ib.FILES, "workspaces.sqlite"))
        threading.Thread(target=cleanup_loop, daemon=True).start()


# --------------------------------------------------------------------------- the Job's side
def archive(src, url):
    """A .tar.gz of SRC, streamed (chunked) to URL."""
    proc = subprocess.Popen(["tar", "-czf", "-", "-C", src, "."], stdout=subprocess.PIPE)
    u = urllib.parse.urlsplit(url)
    conn = (http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection)(
        u.hostname, u.port, timeout=600)

    def body():
        while True:
            d = proc.stdout.read(1024 * 1024)
            if not d:
                return
            yield d

    conn.request("PUT", u.path, body=body(), headers={"Content-Type": "application/gzip"}, encode_chunked=True)
    r = conn.getresponse()
    out = r.read().decode("utf-8", "replace")
    code = proc.wait()
    if code not in (0, 1):  # 1: a file changed while it was read (a live workspace); the archive is still good
        sys.exit("tar failed (%d)" % code)
    if r.status != 200:
        sys.exit("the service refused the archive: %s %s" % (r.status, out[:300]))
    print("sent:", out)


def restore(dst, url):
    """DST emptied (the home's own folder kept: its owner and mode), then the .tar.gz at URL unpacked into it, every
    owner and mode as in the backup."""
    for name in os.listdir(dst):
        p = os.path.join(dst, name)
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p)
        else:
            os.remove(p)
    tar = subprocess.Popen(["tar", "-xzpf", "-", "--numeric-owner", "--exclude=./" + META_NAME, "-C", dst],
                           stdin=subprocess.PIPE)
    with urllib.request.urlopen(url, timeout=600) as r:
        shutil.copyfileobj(r, tar.stdin, 1024 * 1024)
    tar.stdin.close()
    if tar.wait() != 0:
        sys.exit("tar failed (%d)" % tar.returncode)
    print("restored:", sum(len(f) + len(d) for _, d, f in os.walk(dst)), "files and folders")


if __name__ == "__main__":
    if sys.argv[1:2] == ["archive"]:
        archive(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["restore"]:
        restore(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
