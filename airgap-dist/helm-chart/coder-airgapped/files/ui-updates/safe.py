"""The Cloud Drive (named the safe before; its API and objects keep that name): each account's own files on S3 (the
chart's userStorage, or an S3 service an admin set in its Settings), a prefix users/<user id>/ in one bucket.

Every workspace of the account mounts it (PersistentVolumeClaim coder-safe-<user id>, ReadWriteMany, through the CSI
driver ru.yandex.s3.csi), and the Workspaces page opens it. Its owner may disconnect a workspace from it (and connect it
again; a new workspace is connected): the workspace template mounts the volume out of the way (/mnt/cloud-drive) and a
watcher in the workspace links ~/cloud-drive to it while its pod's annotation platform.coder/cloud-drive says "on" -
which it reads through the downward API, and which this module also tells it at once, by exec (the workspace's
cloud-drive.sh push: the kubelet may take a minute or more to update the annotation's file), so a change shows in the
running workspace within a second, no restart. The workspace says whether the drive is attached (its agent's metadata
cloud_drive, read from Coder's database): connections' "attachment". The disconnected workspaces are kept in
LINKS_FILE; a watcher here keeps every running workspace pod's annotation so (a pod starts "on", from its template). This module keeps, every RECONCILE_EVERY seconds: the
bucket; the Secret the safes' volumes name for mounting (coder-user-storage-mount: the keys, and an endpoint the nodes
reach - GeeseFS runs on the node, outside the cluster's DNS, so the chart's MinIO by its ClusterIP); and for every
account a PersistentVolume (Retain: removing it never removes files) and its claim.

  GET  /__coder-ui/api/safe                   the caller's safe: used, quota, where it is mounted
  GET  /__coder-ui/api/safe/list?path=a/b     a folder of it: folders and files (each file route also takes
                                              &drive=<owner id>: a Cloud Drive shared with the caller, drivepeers -
                                              only what is shared reached: a folder holding shared ones lists just
                                              those; "access" says what the caller may do there). Admins
                                              read any account's this way (list, glance, download: "adminView"),
                                              but not one its owner encrypted
  GET  /__coder-ui/api/safe/glance           it at a glance: how many files, how much, the newest (the Workspaces
                                              page's cards of what is shared with the caller: &drive=<owner id>
                                              &share=<share id>)
  GET  /__coder-ui/api/safe/download?path=    a file, as an attachment
  PUT  /__coder-ui/api/safe/upload?path=      a file (the body; Content-Length), within the quota
  POST /__coder-ui/api/safe/folder {path}     a new folder
  POST /__coder-ui/api/safe/delete {path}     a file, or a folder (path ending in /) with everything in it
  GET  /__coder-ui/api/safe/settings[?check=1]   where its files are (the backend) and whether it is connected
  POST /__coder-ui/api/safe/settings {endpoint, region, bucket, accessKey, secretKey} | {reset: true}   admins
  POST /__coder-ui/api/safe/settings/test {...}  admins: try a backend without saving it
  POST /__coder-ui/api/safe/settings/quota {quotaGiB} | {reset: true}   admins: every account's capacity
  GET  /__coder-ui/api/safe/activity             the caller's own drive: seconds since its last upload and download
       (MinIO's trace: the chart's MinIO only), for the pill's light flashing like an LED while it transfers
  POST /__coder-ui/api/safe/settings/enabled {enabled}   admins: the Cloud Drive on or off for everyone (off: every
       workspace's drive unlinked, the users' routes refused, the dashboard showing none; Admin Settings > Cloud Drive)
  GET  /__coder-ui/api/safe/connections       the caller's workspaces disconnected from it, those whose running pod
                                              predates the connections (their template version), those shared with
                                              others (never connected), whether it is encrypted, its source workspace;
                                              how the drive is in each started one (attachment: attached, waiting, ...)
  POST /__coder-ui/api/safe/connections/<workspace id> {connected}   the caller's own workspace (dis)connected
  GET  /__coder-ui/api/safe/encryption        the caller's encryption: off / encrypting / on / decrypting, how
  POST /__coder-ui/api/safe/encryption/prepare {method: password, password} | {method: pki, certificate}
                                              a new data key and its recovery kit (to download); nothing changes yet
  POST /__coder-ui/api/safe/encryption/enable {keyId, kitSaved: true}   every file re-encrypted with it (in the
                                              background; none of the caller's workspaces may have the drive)
  POST /__coder-ui/api/safe/encryption/disable {password} | {dataKey}   back to plain, proved by the password (or the
                                              data key from the recovery kit, for a certificate)
  POST /__coder-ui/api/safe/encryption/resume  a re-encryption that stopped, taken up again
  POST /__coder-ui/api/safe/source {workspace, path}   a folder of one of the caller's workspaces as their Cloud Drive
  POST /__coder-ui/api/safe/source/clear      back to the S3 storage
  GET  /__coder-ui/api/safe/source/guard?workspace=   deleting a workspace: is it the source, which are connected
  GET  /__coder-ui/api/safe/mounts?workspace=         where the Cloud Drive is mounted in one of the caller's workspaces
  POST /__coder-ui/api/safe/mounts/plan {workspace, path}       what mounting it into that folder does: the collisions
  POST /__coder-ui/api/safe/mounts/apply {workspace, path, mode, decisions}   mount it (keep-both | overwrite-all |
                                                      ask with {path: overwrite | keep} for each collision)
  POST /__coder-ui/api/safe/mounts/unmount {workspace, path}
  POST /__coder-ui/api/safe/source/release {workspace, disconnect: [ids], confirm: "delete"}   the guard confirmed
  /__coder-ui/api/safe/peers...               Cloud Drives shared between users (drivepeers.py): asked for in chat
                                              and accepted, or shared by their owner - all of a drive, a folder or a
                                              file - approved by an admin; mounted read only or read and write in the
                                              other user's workspaces from their next start

Only the owner reaches their Cloud Drive: the API serves the caller's own, and a workspace shared with other users or
groups (Coder's workspace sharing) is kept disconnected and, from its next start, mounts none (the ConfigMap
coder-cloud-drive tells the templates).

Encryption (the owner's choice): S3's server-side encryption with a key the platform makes (SSE-C, AES-256: S3 keeps no
copy; over TLS only - the chart's MinIO has TLS on 9443, its plain port 9000 is a bridge for unencrypted mounts). The key
is kept in Secret coder-cloud-drive-keys (admins can reach it) and given to the owner's mounts; the owner keeps a
recovery kit - where the files are, how much, the key wrapped with their password (openssl enc) or for their
certificate (RSA-OAEP) - which they must download before it is turned on.

A workspace folder as the Cloud Drive (the source): drivesource.py, an S3 server the platform starts in that workspace
(exec), serves the folder; the owner's other workspaces mount it (volume coder-drive-src-<owner id>) while it runs, and
the S3 storage keeps its files until the owner goes back to it. Deleting the source workspace is guarded: the dashboard
lists its connected workspaces, each confirmed, and "delete" typed.

The backend is the chart's (userStorage: its MinIO, or an S3 service of yours) until an admin sets another in the
dashboard (Cloud Drive > Settings): kept in SETTINGS_FILE on the service's volume, keys included. A new bucket takes
each account's volume over once none of its workspaces runs (files already stored stay where they were).

Only ever the caller's own prefix: paths are checked segment by segment (no "..", no control characters).

The shared library (the Images view), a prefix of the same bucket mounted read-only in workspaces (one shared volume,
ReadOnlyMany); everyone sees it, admins and template admins add and remove its files:
  - the ISO library: disk images for every workspace, library/isos/, at ~/isos (volume coder-isos).

  GET  /__coder-ui/api/isos                    the library, and the imports under way
  PUT  /__coder-ui/api/isos/upload?name=       a file (the body; Content-Length)
  POST /__coder-ui/api/isos/import {url, name}   a file the service downloads (http/https), in the background
  POST /__coder-ui/api/isos/delete {name}
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request

import drivepeers
import kexec
import kitcrypto
import s3client

BASE = "/__coder-ui"
ENABLED = os.environ.get("SAFE_ENABLED", "false").lower() == "true"
PREFIX = "users/"
MOUNT_PATH = os.environ.get("SAFE_MOUNT_PATH", "/home/coder/cloud-drive")
QUOTA_BYTES = int(float(os.environ.get("SAFE_QUOTA_GIB", "10")) * 1024 ** 3)
MAX_UPLOAD_BYTES = int(float(os.environ.get("SAFE_MAX_UPLOAD_GIB", "5")) * 1024 ** 3)
NAMESPACE = os.environ.get("SAFE_NAMESPACE", "coder")
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "")
S3_REGION = os.environ.get("S3_REGION", "")
# The endpoint the nodes mount from: an S3 service's own, or the chart's MinIO by its Service's ClusterIP.
NODE_ENDPOINT = os.environ.get("SAFE_NODE_ENDPOINT", "")
NODE_SERVICE = os.environ.get("SAFE_NODE_SERVICE", "")
NODE_PORT = int(os.environ.get("SAFE_NODE_PORT", "9000"))
# The chart's MinIO's TLS port (an encrypted Cloud Drive's key goes over TLS only), and its CA.
NODE_TLS_PORT = int(os.environ.get("SAFE_NODE_TLS_PORT", "0") or 0)
S3_CA_FILE = os.environ.get("S3_CA_FILE", "") or None
MOUNT_OPTIONS = os.environ.get("SAFE_MOUNT_OPTIONS", "--memory-limit 256 --dir-mode 0750 --file-mode 0640 --uid 1000 --gid 1000 --stat-cache-ttl 10s")
MOUNT_SECRET = "coder-user-storage-mount"
MOUNT_SECRET_TLS = "coder-user-storage-mount-tls"
CSI_DRIVER = "ru.yandex.s3.csi"
CLAIM_PREFIX = "coder-safe-"
RECONCILE_EVERY = int(os.environ.get("SAFE_RECONCILE_SECONDS", "30"))
CSRF_HEADER = ("X-Requested-With", "coder-ui")
MAX_PATH = 900
USAGE_TTL = 30
# The shared libraries, by the API's name for them: their prefix, volume, mount path, largest file, file names.
LIBRARIES = {
    "isos": {"title": "the ISO library", "noun": "ISO", "prefix": "library/isos/", "claim": "coder-isos",
             "mountPath": os.environ.get("SAFE_ISO_MOUNT_PATH", "/home/coder/isos"),
             "maxBytes": int(float(os.environ.get("SAFE_ISO_MAX_GIB", "20")) * 1024 ** 3),
             "nameRe": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,120}\.(iso|img)$", re.I),
             "nameRule": "ending in .iso or .img"},
}

SETTINGS_FILE = os.environ.get("SAFE_SETTINGS_FILE", "/data/cloud-drive.json")
# Every account's capacity as an admin set it (Cloud Drive > Settings), over the chart's (QUOTA_BYTES).
QUOTA_FILE = os.environ.get("SAFE_QUOTA_FILE", "/data/cloud-drive-quota.json")
QUOTA_GIB_RANGE = (1, 10240)
# An admin turned the Cloud Drive off for everyone (Admin Settings > Cloud Drive): {by, at}; none: on.
OFF_FILE = os.environ.get("SAFE_OFF_FILE", "/data/cloud-drive-off.json")
# The workspaces their owners disconnected: {workspace id: {owner, by, at}}.
LINKS_FILE = os.environ.get("SAFE_LINKS_FILE", "/data/cloud-drive-links.json")
LINK_ANNOTATION = "platform.coder/cloud-drive"
LINK_WATCH_SECONDS = 5
# The workspace's Cloud Drive script (scripts/cloud-drive.sh, which writes itself there at its start): told each change
# of the annotation at once (push), it answers how the drive is then (its status word).
PUSH_HELPER = "/tmp/coder-cloud-drive/cloud-drive.sh"
PUSH_RETRY, PUSH_TRIES = 3, 20  # a workspace whose script has not run yet is tried again for a minute
# A workspace's word on its drive (its agent's metadata) older than this: its agent has gone quiet ("stale").
ATTACH_FRESH = 20
WORKSPACE_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# What the workspace templates read when a workspace starts (ConfigMap STATE_CONFIGMAP, key "state", JSON): the
# workspaces shared with others (they never mount their owner's Cloud Drive), and each account's source workspace.
STATE_CONFIGMAP = "coder-cloud-drive"
# Encryption (an account's choice): its data key, kept for the mounts and the dashboard in Secret KEYS_SECRET (admins
# can reach it, nobody else); how it was set up in ENCRYPTION_FILE (method, the key's id, a password's verifier, the
# certificate's details) - never the password.
KEYS_SECRET = "coder-cloud-drive-keys"
ENCRYPTION_FILE = os.environ.get("SAFE_ENCRYPTION_FILE", "/data/cloud-drive-encryption.json")
PASSWORD_MIN = 12
PENDING_SECONDS = 1800  # a prepared key (its recovery kit downloaded) waits this long to be turned on
CODER_ACCESS_URL = os.environ.get("CODER_ACCESS_URL", "")
# A workspace directory as an account's Cloud Drive (drivesource.py, run in that workspace): SOURCES_FILE keeps which
# (and the key its server signs with); its Service and mount Secret are coder-drive-src-<owner id>, its volume too.
SOURCES_FILE = os.environ.get("SAFE_SOURCES_FILE", "/data/cloud-drive-sources.json")
SOURCE_PREFIX = "coder-drive-src-"
SOURCE_BUCKET = "drive"
SOURCE_PORT = 9900
SOURCE_CONTAINER = os.environ.get("SAFE_SOURCE_CONTAINER", "dev")
SOURCE_HOME = "/home/coder"
SOURCE_RETRY = 30  # seconds between attempts to start a source's server

LOG = KUBE = USERS = CAN_EDIT = IS_ADMIN = WORKSPACE_INFO = SHARED = WORKSPACES = ATTACHMENT = None
# The backend's last check (every reconcile round, and on demand): connected or not, and how fast.
_status = {"connected": None, "error": None, "checkedAt": None, "latencyMs": None}
_imports = {}  # (library, file name) -> its download from a URL: {name, url, bytes, total, error, done, by, startedAt}
_usage = {}  # user id -> (time, bytes, files)
_volumes = {}  # user id -> time its volume was last seen in place
_lock = threading.Lock()
_links_lock = threading.Lock()
_crypt_lock = threading.Lock()
_pending = {}  # user id -> a prepared key: {key, keyId, method, record, at}
_jobs = {}  # user id -> encrypting or decrypting: {action, done, total, error, startedAt, finishedAt}
_shared = {"ids": {}, "at": 0}  # the workspaces shared with others: {workspace id: owner id}, as last read
_published = {"state": None}  # the ConfigMap's state as last written
_wanted = {}  # pod name -> the annotation as last set here (a retried push gives way to a newer one)
_attach_seen = {}  # workspace id -> (its status word, time): its answer to the last push
_sources_seen = {}  # owner id -> {running, pod, started, tried, error}


def setup(log, kube, users, can_edit=None, is_admin=None, workspace_info=None, shared=None, workspaces=None,
          attachment=None):
    """users(): [(id, username)] of every account (Coder's database); can_edit(user): may change the ISO library;
    is_admin(user): may change the backend; workspace_info(token, id): the workspace (Coder's API), if the session may
    see it; shared(): {workspace id: owner id} of the workspaces shared with other users or groups (Coder's
    database), None while it cannot be read; workspaces(owner id): [{id, name}] of the account's workspaces;
    attachment(owner id): [(workspace id, value, collected at, job status)] of the account's started workspaces whose
    agent reports its Cloud Drive (metadata cloud_drive, Coder's database), None while it cannot be read."""
    global LOG, KUBE, USERS, CAN_EDIT, IS_ADMIN, WORKSPACE_INFO, SHARED, WORKSPACES, ATTACHMENT
    LOG, KUBE, USERS, CAN_EDIT, IS_ADMIN, WORKSPACE_INFO, SHARED, WORKSPACES, ATTACHMENT = (
        log, kube, users, can_edit, is_admin, workspace_info, shared, workspaces, attachment)


# ---------------------------------------------------------------------------------------------------- the backend
def chart_backend():
    """The chart's storage: its MinIO (the nodes reach it by its Service's ClusterIP), or the S3 service in values."""
    return {"source": "chart", "kind": "minio" if NODE_SERVICE else "s3", "endpoint": S3_ENDPOINT,
            "region": S3_REGION, "bucket": os.environ.get("SAFE_BUCKET", "coder-user-storage"),
            "accessKey": os.environ.get("S3_ACCESS_KEY", ""), "secretKey": os.environ.get("S3_SECRET_KEY", "")}


def load_custom():
    try:
        with open(SETTINGS_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) and data.get("endpoint") else None
    except (OSError, ValueError):
        return None


def backend():
    """Where the files are: an admin's backend (Cloud Drive > Settings) over the chart's."""
    custom = load_custom()
    if not custom:
        return chart_backend()
    return {"source": "custom", "kind": "s3", "endpoint": custom["endpoint"], "region": custom.get("region", ""),
            "bucket": custom["bucket"], "accessKey": custom.get("accessKey", ""), "secretKey": custom.get("secretKey", "")}


def bucket():
    return backend()["bucket"]


def client(cfg=None):
    cfg = cfg or backend()
    ca = S3_CA_FILE if cfg.get("source") == "chart" else None
    return s3client.S3(cfg["endpoint"], cfg["region"], cfg["accessKey"], cfg["secretKey"], ca_file=ca, timeout=20)


BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")


def clean_backend(body, keep_secret=""):
    """A backend an admin gave: checked, the secret kept from before when left empty."""
    cfg = {"endpoint": str(body.get("endpoint") or "").strip().rstrip("/"), "region": str(body.get("region") or "").strip(),
           "bucket": str(body.get("bucket") or "").strip(), "accessKey": str(body.get("accessKey") or "").strip(),
           "secretKey": str(body.get("secretKey") or "") or keep_secret}
    if not re.match(r"^https?://[^\s/]+(/[^\s]*)?$", cfg["endpoint"]):
        raise ValueError("The endpoint is an http:// or https:// address, such as https://s3.us-east-1.amazonaws.com.")
    if not BUCKET_RE.match(cfg["bucket"]):
        raise ValueError("A bucket name of 3-63 lowercase letters, digits, dots and dashes.")
    if len(cfg["region"]) > 64 or not re.match(r"^[a-z0-9-]*$", cfg["region"]):
        raise ValueError("A region such as us-east-1 (or empty).")
    if not cfg["accessKey"] or not cfg["secretKey"]:
        raise ValueError("The access key and its secret.")
    return cfg


def check(cfg=None):
    """Connects to the backend: {connected, error, latencyMs, bucketExists, checkedAt}."""
    t0 = time.time()
    out = {"checkedAt": int(t0)}
    try:
        exists = client(cfg).bucket_exists((cfg or backend())["bucket"])
        out.update(connected=True, error=None, bucketExists=exists)
    except s3client.S3Error as e:
        out.update(connected=False, error="%s: %s" % (e.code or e.status, e.message or "refused"), bucketExists=None)
    except (OSError, ValueError) as e:
        out.update(connected=False, error=str(e)[:200], bucketExists=None)
    out["latencyMs"] = int((time.time() - t0) * 1000)
    return out


def settings_view(user, fresh=False):
    cfg = backend()
    if fresh or not _status.get("checkedAt"):
        _status.update(check())
    chart = chart_backend()
    return {"canEdit": bool(IS_ADMIN and IS_ADMIN(user)), "source": cfg["source"], "kind": cfg["kind"],
            "endpoint": cfg["endpoint"], "region": cfg["region"], "bucket": cfg["bucket"],
            "accessKey": cfg["accessKey"] if IS_ADMIN and IS_ADMIN(user) else "", "hasSecret": bool(cfg["secretKey"]),
            "chart": {"kind": chart["kind"], "endpoint": chart["endpoint"], "bucket": chart["bucket"]},
            "mountPath": MOUNT_PATH, "status": dict(_status), "quota": quota_view(),
            "enabled": turned_off() is None, "turnedOff": turned_off()}


def save_settings(user, body):
    if not (IS_ADMIN and IS_ADMIN(user)):
        raise PermissionError
    if body.get("reset"):
        try:
            os.remove(SETTINGS_FILE)
        except FileNotFoundError:
            pass
        LOG(event="cloud-drive-backend", action="chart", by=user["username"])
    else:
        cur = load_custom() or {}
        cfg = clean_backend(body, keep_secret=cur.get("secretKey", "") if cur.get("endpoint") else "")
        result = check(cfg)
        if not result["connected"]:
            raise ValueError("Not saved: it could not be reached (%s)." % result["error"])
        if not result["bucketExists"]:
            client(cfg).create_bucket(cfg["bucket"])
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w") as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(cfg, f)
        os.replace(tmp, SETTINGS_FILE)
        LOG(event="cloud-drive-backend", action="custom", endpoint=cfg["endpoint"], bucket=cfg["bucket"],
            by=user["username"])
    # every volume and the mount Secret looked at again now
    _volumes.clear()
    _status.update(check())
    _wake.set()
    return settings_view(user)


def turned_off():
    """{by, at} while an admin has the Cloud Drive off for everyone, else None."""
    try:
        with open(OFF_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"by": "", "at": 0}
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {"by": "", "at": 0}


def save_enabled(user, body):
    """An admin turns the Cloud Drive on or off for everyone: off, every workspace's drive is unlinked (links_once)."""
    if not (IS_ADMIN and IS_ADMIN(user)):
        raise PermissionError
    on = body.get("enabled")
    if not isinstance(on, bool):
        raise ValueError("enabled: true or false.")
    if on:
        try:
            os.remove(OFF_FILE)
        except FileNotFoundError:
            pass
    else:
        _write_json(OFF_FILE, {"by": user["username"], "at": int(time.time())})
    LOG(event="cloud-drive-enabled", enabled=on, by=user["username"])
    try:
        links_once()  # every workspace's drive linked or unlinked now, not at the watcher's next round
    except Exception as e:  # noqa: BLE001 - the watcher's next round does it
        LOG(event="cloud-drive-links-failed", error=str(e)[:200])
    _wake.set()
    return settings_view(user)


def custom_quota_gib():
    """The capacity an admin set (GiB), or None: the chart's."""
    try:
        with open(QUOTA_FILE) as f:
            gib = json.load(f).get("quotaGiB")
        return gib if isinstance(gib, int) and QUOTA_GIB_RANGE[0] <= gib <= QUOTA_GIB_RANGE[1] else None
    except (OSError, ValueError, AttributeError):
        return None


def quota_bytes():
    """Every account's capacity: an admin's, else the chart's."""
    gib = custom_quota_gib()
    return gib * 1024 ** 3 if gib else QUOTA_BYTES


def save_quota(user, body):
    """An admin sets every account's capacity (GiB), or {reset: true} for the chart's."""
    if not (IS_ADMIN and IS_ADMIN(user)):
        raise PermissionError
    if body.get("reset"):
        try:
            os.remove(QUOTA_FILE)
        except FileNotFoundError:
            pass
        LOG(event="cloud-drive-quota", action="chart", gib=QUOTA_BYTES // 1024 ** 3, by=user["username"])
        return quota_view()
    gib = body.get("quotaGiB")
    if isinstance(gib, float) and gib.is_integer():
        gib = int(gib)
    if not isinstance(gib, int) or isinstance(gib, bool) or not QUOTA_GIB_RANGE[0] <= gib <= QUOTA_GIB_RANGE[1]:
        raise ValueError("A capacity of %d to %d GiB, a whole number." % QUOTA_GIB_RANGE)
    tmp = QUOTA_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"quotaGiB": gib, "by": user["username"], "at": int(time.time())}, f)
    os.replace(tmp, QUOTA_FILE)
    LOG(event="cloud-drive-quota", action="set", gib=gib, by=user["username"])
    return quota_view()


def quota_view():
    return {"gib": quota_bytes() // 1024 ** 3, "chartGib": QUOTA_BYTES // 1024 ** 3,
            "custom": custom_quota_gib() is not None, "min": QUOTA_GIB_RANGE[0], "max": QUOTA_GIB_RANGE[1]}


def capacity():
    return "%dGi" % max(1, quota_bytes() // 1024 ** 3)


# ---------------------------------------------------------------------------------------------------- connections
def disconnected():
    """{workspace id: {owner, by, at}}: the workspaces their owners disconnected from their Cloud Drive."""
    try:
        with open(LINKS_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def link_pods(wid=None):
    """Running pods (of one workspace, or all) whose template links the Cloud Drive (they carry the annotation)."""
    label = "com.coder.workspace.id" + ("=" + wid if wid else "")
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote(label)))
    if status != 200 or not isinstance(pods, dict):
        return [], []
    linked, older = [], []
    for p in pods.get("items") or []:
        meta = p.get("metadata") or {}
        if (p.get("status") or {}).get("phase") != "Running" or meta.get("deletionTimestamp"):
            continue
        (linked if LINK_ANNOTATION in (meta.get("annotations") or {}) else older).append(p)
    return linked, older


def link(pod, want):
    """Sets the pod's annotation ("on" / "off") where it says otherwise; True when it changed."""
    meta = pod["metadata"]
    if (meta.get("annotations") or {}).get(LINK_ANNOTATION) == want:
        return False
    status, _ = KUBE.call("PATCH", "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, meta["name"]),
                          {"metadata": {"annotations": {LINK_ANNOTATION: want}}},
                          patch_type="application/merge-patch+json")
    if status != 200:
        raise RuntimeError("pod %s: HTTP %s" % (meta["name"], status))
    _wanted[meta["name"]] = want
    return True


def push_link(pod_name, wid, want):
    """The workspace told at once (its Cloud Drive script, by exec), its answer kept (attachment): True when it took
    it. False when it has no such script (a template version from before it, or a start before the script ran)."""
    try:
        code, out, err = kexec.exec_in(KUBE, NAMESPACE, pod_name, SOURCE_CONTAINER, [PUSH_HELPER, "push", want],
                                       timeout=15)
    except Exception as e:  # noqa: BLE001 - the annotation stands; the workspace follows it once its file is updated
        LOG(event="cloud-drive-push-failed", pod=pod_name, link=want, error=str(e)[:200])
        return False
    word = (out.split() or [""])[-1]
    if code != 0 or not word:
        return False
    _attach_seen[wid] = (word, time.time())
    LOG(event="cloud-drive-push", workspace=wid, pod=pod_name, link=want, status=word)
    return True


def push_soon(pod_name, wid, want, first=True):
    """push_link in the background: tried again every PUSH_RETRY seconds (PUSH_TRIES times) while the workspace's
    script is not there yet - it is written as the workspace starts - unless the annotation changed meanwhile."""
    def run():
        for i in range(PUSH_TRIES):
            if _wanted.get(pod_name, want) != want:
                return
            if (first or i) and push_link(pod_name, wid, want):
                return
            time.sleep(PUSH_RETRY)
    threading.Thread(target=run, daemon=True, name="cloud-drive-push").start()


def attachment(user_id):
    """{workspace id: word} - how the account's Cloud Drive is in each of its started workspaces whose template reports
    it: the word of its agent's metadata (scripts/cloud-drive.sh status: attached, waiting, unanswered, offline,
    shared, detached), or its answer to a push when that is newer; "starting" before a first word (its build or its
    agent still starting), "stale" when its agent has not said for ATTACH_FRESH seconds. {} while Coder's database
    cannot be read."""
    try:
        rows = ATTACHMENT(user_id) if ATTACHMENT else None
    except Exception as e:  # noqa: BLE001 - no attachment is shown then, nothing else changes
        LOG(event="cloud-drive-attachment-failed", error=str(e)[:200])
        rows = None
    now = time.time()
    for wid in [w for w, (_, at) in _attach_seen.items() if now - at > 600]:
        _attach_seen.pop(wid, None)
    out = {}
    for wid, value, collected, job in rows or []:
        words = (value or "").split()
        if job != "succeeded" or collected <= 0 or not words:
            word, at = "starting", 0
        elif now - collected > ATTACH_FRESH:
            word, at = "stale", collected
        else:
            word, at = words[0], collected
        seen = _attach_seen.get(wid)
        if seen and seen[1] > at and job == "succeeded":
            word = seen[0]
        out[wid] = word
    return out


def shared_now():
    """{workspace id: owner id} of the workspaces shared with other users or groups (Coder's workspace sharing): read
    at most every LINK_WATCH_SECONDS; the last reading while Coder's database cannot be read."""
    if SHARED and time.time() - _shared["at"] >= LINK_WATCH_SECONDS:
        try:
            got = SHARED()
            if got is not None:
                _shared.update(ids=dict(got), at=time.time())
        except Exception as e:  # noqa: BLE001 - the last reading stands
            LOG(event="cloud-drive-shared-failed", error=str(e)[:200])
    return dict(_shared["ids"])


def links_once():
    """Every running workspace pod's annotation as LINKS_FILE says (a restarted workspace starts "on"); a workspace
    shared with others is kept off - its owner's Cloud Drive is theirs alone. Then the sources' servers, and what the
    templates read (publish_state)."""
    off = disconnected()
    shared = shared_now()
    everyone_off = turned_off() is not None  # an admin turned the Cloud Drive off for everyone
    source_of = {src["workspace"]: src["path"] for src in sources().values()}
    linked, _ = link_pods()
    for pod in linked:
        wid = ((pod.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")
        # a source workspace links its own folder at once (source:<folder>), restarted or not
        want = "off" if everyone_off or wid in off or wid in shared else (
            "source:" + source_of[wid]) if wid in source_of else "on"
        if wid and link(pod, want):
            LOG(event="cloud-drive-link", workspace=wid, pod=pod["metadata"]["name"], link=want,
                shared=wid in shared, by="watcher")
            push_soon(pod["metadata"]["name"], wid, want)
    sources_once()
    publish_state(shared)


def publish_now():
    """The templates told at once (a workspace may start the next second), not on the watcher's next round."""
    if KUBE and KUBE.ok:
        try:
            publish_state(shared_now())
        except Exception as e:  # noqa: BLE001 - the watcher tries again within seconds
            LOG(event="cloud-drive-state-failed", error=str(e)[:200])


ITEM_TTL = 30
_items = {}  # (owner id, path) -> (time, "file" | "folder" | None)


def item_kind(owner_id, path, fresh=False):
    """What a path of the owner's Cloud Drive is: "file", "folder" or None (not there, or the drive unreachable) -
    cached ITEM_TTL seconds unless fresh."""
    path = clean_path(path)
    if not path:
        return "folder"
    hit = _items.get((owner_id, path))
    if hit and not fresh and time.time() - hit[0] < ITEM_TTL:
        return hit[1]
    kind = None
    try:
        s3, bkt, root, sse = drive_of(owner_id)
        try:
            s3.head(bkt, root + path, sse=sse)
            kind = "file"
        except s3client.S3Error as e:
            if e.status != 404:
                raise
            objects, prefixes = s3.list(bkt, prefix=root + path + "/", delimiter="/", limit=1)
            kind = "folder" if objects or prefixes else None
    except (DriveUnavailable, s3client.S3Error, OSError) as e:
        LOG(event="cloud-drive-item-failed", owner=owner_id, path=path, error=str(e)[:200])
    _items[(owner_id, path)] = (time.time(), kind)
    return kind


def peer_mounts():
    """{user id: [{id, owner, name, claim, readOnly, kind, path, item}]}: the Cloud Drives - or folders and files of
    them - shared with each user (drivepeers), by the volume their owner's own workspaces mount now: the S3 one, or the
    source's while it runs (none while it is stopped). A folder or file is the volume's subPath, mounted only while it
    is there (the kubelet would make a missing one a folder); item its name, for the link."""
    srcs = sources()
    out = {}
    for requester, peers in drivepeers.active().items():
        for p in peers:
            src = srcs.get(p["owner"])
            if src and not (_sources_seen.get(p["owner"]) or {}).get("running"):
                continue
            if p["kind"] != "drive" and item_kind(p["owner"], p["path"]) != p["kind"]:
                continue
            claim = (SOURCE_PREFIX if src else CLAIM_PREFIX) + p["owner"]
            mounts = out.setdefault(requester, [])
            twin = next((m for m in mounts if m["kind"] == "drive" == p["kind"] and m["owner"] == p["owner"]), None)
            if twin:  # the entire drive asked for and shared too: mounted once, the wider way
                twin["readOnly"] = twin["readOnly"] and p["access"] != "write"
                continue
            mounts.append({"id": p["id"], "owner": p["owner"], "name": p["name"], "claim": claim,
                           "readOnly": p["access"] != "write", "kind": p["kind"], "path": p["path"],
                           "item": p["path"].rsplit("/", 1)[-1] if p["path"] else ""})
    return out


def publish_state(shared):
    """The ConfigMap the workspace templates read at a start: {"shared": [workspace ids], "sources": {owner id:
    {workspace, path, running}}, "peers": {user id: [{owner, name, claim, readOnly}]}} - a shared workspace mounts no
    Cloud Drive; a source workspace serves its directory and mounts none; the owner's others mount the source's while
    it runs; a user's workspaces mount the Cloud Drives shared with them (peer_mounts)."""
    state = json.dumps({"shared": sorted(shared),
                        "sources": {owner: {"workspace": src["workspace"], "path": src["path"],
                                            "running": bool((_sources_seen.get(owner) or {}).get("running"))}
                                    for owner, src in sorted(sources().items())},
                        "peers": peer_mounts()}, sort_keys=True)
    if state == _published["state"]:
        return
    path = "/api/v1/namespaces/%s/configmaps/%s" % (NAMESPACE, STATE_CONFIGMAP)
    body = {"apiVersion": "v1", "kind": "ConfigMap",
            "metadata": {"name": STATE_CONFIGMAP, "namespace": NAMESPACE,
                         "labels": {"app.kubernetes.io/name": "coder-user-storage", "app.kubernetes.io/part-of": "coder"}},
            "data": {"state": state}}
    status, cur = KUBE.call("GET", path)
    if status == 404:
        status, out = KUBE.call("POST", "/api/v1/namespaces/%s/configmaps" % NAMESPACE, body)
    elif status == 200:
        if (cur.get("data") or {}).get("state") == state:
            _published["state"] = state
            return
        version = (cur.get("metadata") or {}).get("resourceVersion")
        if version:
            body["metadata"]["resourceVersion"] = version
        status, out = KUBE.call("PUT", path, body)
    if status not in (200, 201):
        raise RuntimeError("ConfigMap %s: HTTP %s" % (STATE_CONFIGMAP, status))
    _published["state"] = state


def _links_loop():
    last = None
    while True:
        try:
            links_once()
            last = None
        except Exception as e:  # noqa: BLE001 - reported once, retried next round
            if str(e) != last:
                LOG(event="cloud-drive-links-failed", error=str(e)[:300])
            last = str(e)
        time.sleep(LINK_WATCH_SECONDS)


def claim_holders(user_id):
    """{workspace id} of the account's workspaces whose pod (running or starting) mounts its Cloud Drive's volume -
    the S3 one or its source's."""
    if not (KUBE and KUBE.ok):
        return set()
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("com.coder.user.id=" + user_id)))
    if status != 200 or not isinstance(pods, dict):
        raise RuntimeError("pods: HTTP %s" % status)
    claims = {CLAIM_PREFIX + user_id, SOURCE_PREFIX + user_id}
    return {((p.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id") for p in pods.get("items") or []
            if (p.get("status") or {}).get("phase") not in ("Succeeded", "Failed")
            and any((v.get("persistentVolumeClaim") or {}).get("claimName") in claims
                    for v in (p.get("spec") or {}).get("volumes") or [])} - {None}


def connections(user):
    """The caller's workspaces disconnected from their Cloud Drive; those running in a pod that cannot be (from a
    template version before the connections: it takes effect when they are updated); those shared with others (never
    connected: the Cloud Drive is the owner's alone), and of them the ones whose pod still has its volume from before
    they were shared (restarted, it has none); whether it is encrypted (their workspaces show a lock); and its source
    workspace, if a directory of one is the Cloud Drive."""
    off = sorted(wid for wid, entry in disconnected().items() if entry.get("owner") == user["id"])
    shared = sorted(wid for wid, owner in shared_now().items() if owner == user["id"])
    older, exposed = [], []
    if KUBE and KUBE.ok:
        _, pods = link_pods()
        labels = [(p.get("metadata") or {}).get("labels") or {} for p in pods]
        older = sorted({lb.get("com.coder.workspace.id") for lb in labels
                        if lb.get("com.coder.user.id") == user["id"]} - {None})
        if shared:
            try:
                exposed = sorted(claim_holders(user["id"]) & set(shared))
            except RuntimeError:
                exposed = []
    src = sources().get(user["id"])
    return {"disconnected": off, "older": older, "shared": shared, "sharedWithVolume": exposed,
            "encrypted": encryption_on(user["id"]), "restart": stale_mounts(user["id"], src, set(shared)),
            "source": source_view(user["id"], src) if src else None, "attachment": attachment(user["id"])}


PEER_MOUNT_DIRS = ("/mnt/cloud-drive-peers/", "/mnt/cloud-drive-items/")


def peer_mount_path(p):
    """Where the template mounts a share (peer_mounts): a drive at /mnt/cloud-drive-peers/<owner>, a folder or file at
    /mnt/cloud-drive-items/<share id>."""
    return PEER_MOUNT_DIRS[0] + p["name"] if p.get("kind", "drive") == "drive" else PEER_MOUNT_DIRS[1] + p["id"]


def stale_mounts(user_id, src, shared):
    """The account's running workspaces whose Cloud Drive volume is not the one they would get now (a source set or
    cleared, or started while the source was stopped), or whose shared Cloud Drives (drivepeers) are not those shared
    with the account now: theirs come with a restart."""
    if not (KUBE and KUBE.ok):
        return []
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("com.coder.user.id=" + user_id)))
    out = []
    running = bool(src and (_sources_seen.get(user_id) or {}).get("running"))
    peers_now = peer_mounts().get(user_id, [])
    for p in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        meta = p.get("metadata") or {}
        wid = (meta.get("labels") or {}).get("com.coder.workspace.id")
        if not wid or (p.get("status") or {}).get("phase") != "Running" or meta.get("deletionTimestamp"):
            continue
        if LINK_ANNOTATION not in (meta.get("annotations") or {}):
            continue  # a template without the Cloud Drive's connections
        claims = {(v.get("persistentVolumeClaim") or {}).get("claimName")
                  for v in (p.get("spec") or {}).get("volumes") or []}
        # what is shared with the user: where it mounts it (read only or not), where it would now
        has_peers = {(m.get("mountPath"), bool(m.get("readOnly")))
                     for c in (p.get("spec") or {}).get("containers") or [] for m in c.get("volumeMounts") or []
                     if (m.get("mountPath") or "").startswith(PEER_MOUNT_DIRS)}
        want_peers = set() if wid in shared else {(peer_mount_path(m), m["readOnly"]) for m in peers_now}
        if has_peers != want_peers:
            out.append(wid)
            continue
        has = (SOURCE_PREFIX + user_id) if (SOURCE_PREFIX + user_id) in claims else \
              (CLAIM_PREFIX + user_id) if (CLAIM_PREFIX + user_id) in claims else None
        if wid in shared or (src and src["workspace"] == wid):
            want = None
        elif src:
            want = (SOURCE_PREFIX + user_id) if running else None
        else:
            want = CLAIM_PREFIX + user_id
        if has != want and want is not None:
            out.append(wid)
    return sorted(set(out))


def set_connected(h, user, wid, body):
    """The caller's own workspace connected to their Cloud Drive, or disconnected from it: at once in its running pod."""
    if not WORKSPACE_ID_RE.match(wid or ""):
        raise ValueError("Not a workspace id.")
    want = body.get("connected")
    if not isinstance(want, bool):
        raise ValueError("connected: true or false.")
    ws = WORKSPACE_INFO(h.token(), wid) if WORKSPACE_INFO else None
    if not ws:
        raise ValueError("There is no such workspace.")
    if ws.get("owner_id") != user["id"]:
        raise PermissionError
    if want and wid in shared_now():
        raise ValueError("This workspace is shared with others: your Cloud Drive stays out of it while it is shared.")
    with _links_lock:
        data = disconnected()
        if want:
            data.pop(wid, None)
        else:
            data[wid] = {"owner": user["id"], "by": user["username"], "at": int(time.time())}
        tmp = LINKS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, LINKS_FILE)
    applied = False
    if KUBE and KUBE.ok:
        src = {v["workspace"]: v["path"] for v in sources().values()}.get(wid)
        linked, _ = link_pods(wid)
        for pod in linked:
            state = ("source:" + src if src else "on") if want else "off"
            link(pod, state)
            _wanted[pod["metadata"]["name"]] = state
            # at once, waiting for the workspace's answer (its drive attached or not); tried again in the background
            # while its script is not there yet
            if not push_link(pod["metadata"]["name"], wid, state):
                push_soon(pod["metadata"]["name"], wid, state, first=False)
            applied = True
    LOG(event="cloud-drive-link", workspace=wid, name=ws.get("name"), connected=want, by=user["username"],
        running=applied)
    return {**connections(user), "workspace": wid, "connected": want, "applied": applied}


def root_of(user_id):
    if not re.match(r"^[0-9a-f-]{36}$", user_id or ""):
        raise PermissionError("not an account id")
    return PREFIX + user_id + "/"


def clean_path(path):
    """A path inside a safe, a/b/c (no leading or trailing slash; "" the top); ValueError for anything that could
    step outside it or that S3 or a file system would choke on."""
    path = (path or "").strip("/")
    if not path:
        return ""
    if len(path.encode()) > MAX_PATH:
        raise ValueError("That path is too long.")
    for part in path.split("/"):
        if part in ("", ".", "..") or len(part.encode()) > 255 or any(ord(c) < 32 or ord(c) == 127 for c in part):
            raise ValueError("That is not a valid name: %r" % part[:60])
    return path


# ---------------------------------------------------------------------------------------------------- reconciling
def service_ip(name):
    """The ClusterIP of a Service here, as a URL's host; RuntimeError until it has one."""
    status, svc = KUBE.call("GET", "/api/v1/namespaces/%s/services/%s" % (NAMESPACE, name))
    ip = (svc.get("spec") or {}).get("clusterIP") if status == 200 and isinstance(svc, dict) else None
    if not ip or ip == "None":
        raise RuntimeError("Service %s has no ClusterIP yet" % name)
    return "[%s]" % ip if ":" in ip else ip


def node_endpoint(tls=False):
    """Where the nodes' mounts reach the backend: an S3 service's own endpoint; the chart's MinIO by its Service's
    ClusterIP - plain through its bridge, or (tls: an encrypted Cloud Drive) on its TLS port."""
    cfg = backend()
    if cfg["source"] == "custom":
        return cfg["endpoint"]
    if NODE_ENDPOINT:
        return NODE_ENDPOINT
    if not NODE_SERVICE:
        return S3_ENDPOINT
    if tls:
        return "https://%s:%d" % (service_ip(NODE_SERVICE), NODE_TLS_PORT)
    return "http://%s:%d" % (service_ip(NODE_SERVICE), NODE_PORT)


def tls_available(cfg=None):
    """Whether the backend takes encrypted Cloud Drives (SSE-C needs TLS): the chart's MinIO with its TLS port, or an
    https endpoint; (bool, why not)."""
    cfg = cfg or backend()
    if cfg["source"] == "chart" and NODE_SERVICE:
        return (True, "") if NODE_TLS_PORT and S3_ENDPOINT.startswith("https://") else (
            False, "The chart's MinIO has no TLS here (an older chart): encryption needs it.")
    if not cfg["endpoint"].startswith("https://"):
        return False, "The Cloud Drive's storage is reached over plain HTTP: encryption needs an https endpoint."
    return True, ""


def ensure_secret(name, want, labels=None):
    """A Secret here with exactly want (text values), made or updated; True when it changed."""
    path = "/api/v1/namespaces/%s/secrets/%s" % (NAMESPACE, name)
    status, cur = KUBE.call("GET", path)
    data = {k: base64.b64encode(v.encode()).decode() for k, v in want.items()}
    body = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": name, "namespace": NAMESPACE,
                         "labels": labels or {"app.kubernetes.io/name": "coder-user-storage",
                                              "app.kubernetes.io/part-of": "coder"}},
            "data": data}
    if status == 404:
        status, out = KUBE.call("POST", "/api/v1/namespaces/%s/secrets" % NAMESPACE, body)
        if status not in (200, 201):
            raise RuntimeError("Secret %s: HTTP %s %s" % (name, status, str(out)[:200]))
        return True
    if status == 200 and (cur.get("data") or {}) != data:
        body["metadata"]["resourceVersion"] = cur["metadata"]["resourceVersion"]
        status, out = KUBE.call("PUT", path, body)
        if status != 200:
            raise RuntimeError("Secret %s: HTTP %s %s" % (name, status, str(out)[:200]))
        return True
    if status != 200:
        raise RuntimeError("Secret %s: HTTP %s" % (name, status))
    return False


def ensure_mount_secret():
    """The Secrets the safes' volumes name for mounting: the keys and the nodes' endpoint (kept up to date) - plain,
    and TLS for the encrypted ones where the backend has it."""
    cfg = backend()
    for name, tls in ((MOUNT_SECRET, False), (MOUNT_SECRET_TLS, True)):
        if tls and not tls_available(cfg)[0]:
            continue
        want = {"accessKeyID": cfg["accessKey"], "secretAccessKey": cfg["secretKey"], "endpoint": node_endpoint(tls)}
        if cfg["region"]:
            want["region"] = cfg["region"]
        if ensure_secret(name, want):
            LOG(event="safe-mount-secret", secret=name, endpoint=want["endpoint"])


def _volume_pair(name, handle, secret, options, labels, username, access="ReadWriteMany"):
    ref = {"name": secret, "namespace": NAMESPACE}
    pv = {"apiVersion": "v1", "kind": "PersistentVolume",
          "metadata": {"name": name, "labels": labels, "annotations": {"platform.coder/username": username}},
          "spec": {"capacity": {"storage": capacity()}, "accessModes": [access],
                   # Retain: deleting the volume (or the account) never deletes the files.
                   "persistentVolumeReclaimPolicy": "Retain", "storageClassName": "",
                   "claimRef": {"namespace": NAMESPACE, "name": name},
                   "csi": {"driver": CSI_DRIVER, "volumeHandle": handle,
                           "nodeStageSecretRef": ref, "nodePublishSecretRef": ref,
                           "volumeAttributes": {"capacity": capacity(), "mounter": "geesefs", "options": options}}}}
    pvc = {"apiVersion": "v1", "kind": "PersistentVolumeClaim",
           "metadata": {"name": name, "namespace": NAMESPACE, "labels": labels,
                        "annotations": {"platform.coder/username": username}},
           "spec": {"accessModes": [access], "storageClassName": "", "volumeName": name,
                    "resources": {"requests": {"storage": capacity()}}}}
    return pv, pvc


def volume_objects(user_id, username=""):
    """The account's PersistentVolume and claim on the S3 storage: with its key (and on TLS) when it is encrypted."""
    labels = {"app.kubernetes.io/name": "coder-safe", "app.kubernetes.io/part-of": "coder", "platform.coder/user-id": user_id}
    key = data_key(user_id) if encryption_on(user_id) else None
    secret, options = MOUNT_SECRET, MOUNT_OPTIONS
    if key:
        secret = MOUNT_SECRET_TLS
        options = "%s --sse-c %s" % (MOUNT_OPTIONS, base64.b64encode(key).decode())
        if backend()["source"] == "chart":
            # the nodes reach MinIO by its ClusterIP, which its certificate cannot name (GeeseFS takes no CA)
            options += " --no-verify-ssl"
    return _volume_pair(CLAIM_PREFIX + user_id, "%s/%s" % (bucket(), root_of(user_id).rstrip("/")), secret, options,
                        labels, username)


def source_volume_objects(user_id, username=""):
    """The account's volume on its source workspace's directory (that workspace's server, by its Service)."""
    labels = {"app.kubernetes.io/name": "coder-drive-source", "app.kubernetes.io/part-of": "coder",
              "platform.coder/user-id": user_id}
    return _volume_pair(SOURCE_PREFIX + user_id, "%s/%s" % (SOURCE_BUCKET, user_id), SOURCE_PREFIX + user_id,
                        MOUNT_OPTIONS, labels, username)


def volume_signature(pv):
    """What a volume mounts: its handle, its Secret, its options (a change replaces the volume, once unused)."""
    csi = (pv.get("spec") or {}).get("csi") or {}
    return (csi.get("volumeHandle"), (csi.get("nodePublishSecretRef") or {}).get("name"),
            (csi.get("volumeAttributes") or {}).get("options"))


def library_volume_objects(kind):
    """A library's volume and claim: its prefix, read-only, for every workspace."""
    lib = LIBRARIES[kind]
    labels = {"app.kubernetes.io/name": lib["claim"], "app.kubernetes.io/part-of": "coder"}
    ref = {"name": MOUNT_SECRET, "namespace": NAMESPACE}
    pv = {"apiVersion": "v1", "kind": "PersistentVolume", "metadata": {"name": lib["claim"], "labels": labels},
          "spec": {"capacity": {"storage": "%dGi" % max(1, lib["maxBytes"] // 1024 ** 3)},
                   "accessModes": ["ReadOnlyMany"], "persistentVolumeReclaimPolicy": "Retain", "storageClassName": "",
                   "claimRef": {"namespace": NAMESPACE, "name": lib["claim"]},
                   "csi": {"driver": CSI_DRIVER, "volumeHandle": "%s/%s" % (bucket(), lib["prefix"].rstrip("/")),
                           "readOnly": True, "nodeStageSecretRef": ref, "nodePublishSecretRef": ref,
                           "volumeAttributes": {"capacity": "1Gi", "mounter": "geesefs", "options": MOUNT_OPTIONS}}}}
    pvc = {"apiVersion": "v1", "kind": "PersistentVolumeClaim",
           "metadata": {"name": lib["claim"], "namespace": NAMESPACE, "labels": labels},
           "spec": {"accessModes": ["ReadOnlyMany"], "storageClassName": "", "volumeName": lib["claim"],
                    "resources": {"requests": {"storage": pv["spec"]["capacity"]["storage"]}}}}
    return pv, pvc


def claims_in_use():
    """The claims pods use now (a volume in use is not replaced)."""
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods" % NAMESPACE)
    if status != 200 or not isinstance(pods, dict):
        raise RuntimeError("pods: HTTP %s" % status)
    return {(v.get("persistentVolumeClaim") or {}).get("claimName") for p in pods.get("items") or []
            if (p.get("status") or {}).get("phase") not in ("Succeeded", "Failed")
            for v in (p.get("spec") or {}).get("volumes") or []} - {None}


def remove_volume(name):
    """A volume and its claim deleted (the files stay: Retain), waited for."""
    for path in ("/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name),
                 "/api/v1/persistentvolumes/" + name):
        status, out = KUBE.call("DELETE", path)
        if status >= 300 and status != 404:
            raise RuntimeError("delete %s: HTTP %s %s" % (path.rsplit("/", 2)[-2], status, str(out)[:200]))
    for _ in range(60):
        if KUBE.call("GET", "/api/v1/persistentvolumes/" + name)[0] == 404:
            return
        time.sleep(1)
    raise RuntimeError("the volume %s is still there" % name)


def adopt_volume(name, pv, who=""):
    """A volume kept (Retain) from an earlier install - in this namespace or another, its claim deleted with it -
    stays Released with that claim's reference, and this install's claim of the same name would never bind (every
    workspace waiting on it). Pre-bind it to this install's claim. A volume bound to a claim that still exists
    elsewhere is not taken."""
    ref = (pv.get("spec") or {}).get("claimRef") or {}
    if not ref or (ref.get("namespace") == NAMESPACE and ref.get("name") == name and not ref.get("uid")):
        return False
    phase = (pv.get("status") or {}).get("phase")
    if phase == "Bound":
        if ref.get("namespace") != NAMESPACE or ref.get("name") != name:
            return False  # another claim's, alive
        status, claim = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name))
        if status == 200 and ((claim or {}).get("metadata") or {}).get("uid") == ref.get("uid"):
            return False  # bound to this install's claim: as it should be
    elif phase not in ("Released", "Available"):
        return False
    status, out = KUBE.call("PATCH", "/api/v1/persistentvolumes/" + name,
                            {"spec": {"claimRef": {"namespace": NAMESPACE, "name": name, "uid": None,
                                                   "resourceVersion": None}}}, "application/merge-patch+json")
    if status != 200:
        raise RuntimeError("adopt the volume %s: HTTP %s %s" % (name, status, str(out)[:200]))
    LOG(event="safe-volume", user=who, adopted=name, was="%s/%s" % (ref.get("namespace"), ref.get("name")), phase=phase)
    return True


def ensure_volume(user_id, username="", objects=None, in_use=None):
    """Makes the account's volume and claim (or the given pair) where missing, and replaces them when they name another
    bucket (the backend changed) and nothing uses them; True when both are in place."""
    pv, pvc = objects or volume_objects(user_id, username)
    name = pv["metadata"]["name"]
    status, cur = KUBE.call("GET", "/api/v1/persistentvolumes/" + name)
    have = volume_signature(cur) if status == 200 and isinstance(cur, dict) else None
    if have and have[0] and have != volume_signature(pv):
        if name in (in_use if in_use is not None else claims_in_use()):
            return False  # its workspace runs: replaced once it stops
        remove_volume(name)
        LOG(event="safe-volume", user=username or user_id, replaced=have[0], now=pv["spec"]["csi"]["volumeHandle"],
            secret=volume_signature(pv)[1])
    if status == 200 and isinstance(cur, dict) and have == volume_signature(pv):
        adopt_volume(name, cur, username or user_id)
    made = []
    for get_path, post_path, obj in (
            ("/api/v1/persistentvolumes/" + name, "/api/v1/persistentvolumes", pv),
            ("/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name),
             "/api/v1/namespaces/%s/persistentvolumeclaims" % NAMESPACE, pvc)):
        status, _ = KUBE.call("GET", get_path)
        if status == 404:
            status, out = KUBE.call("POST", post_path, obj)
            if status not in (200, 201, 409):
                raise RuntimeError("%s %s: HTTP %s %s" % (obj["kind"], name, status, str(out)[:200]))
            made.append(obj["kind"])
        elif status != 200:
            raise RuntimeError("%s %s: HTTP %s" % (obj["kind"], name, status))
    if made:
        LOG(event="safe-volume", user=username or user_id, made=made)
    return True


def reconcile():
    _status.update(check())
    if not _status["connected"]:
        raise RuntimeError("the backend is not reachable: %s" % _status["error"])
    s3 = client()
    if not _status.get("bucketExists"):
        s3.create_bucket(bucket())
        LOG(event="safe-bucket", action="created", bucket=bucket())
    ensure_mount_secret()
    now = time.time()
    in_use = claims_in_use()
    for kind, lib in LIBRARIES.items():
        if now - _volumes.get(lib["claim"], 0) >= 600:
            if ensure_volume("", lib["title"], objects=library_volume_objects(kind), in_use=in_use):
                _volumes[lib["claim"]] = now
    srcs = sources()
    # Former sources' volumes, once no workspace uses them.
    status, pvs = KUBE.call("GET", "/api/v1/persistentvolumes?labelSelector=%s" % urllib.parse.quote(
        "app.kubernetes.io/name=coder-drive-source"))
    for pv in (pvs.get("items") or []) if status == 200 and isinstance(pvs, dict) else []:
        owner = (pv["metadata"].get("labels") or {}).get("platform.coder/user-id")
        if owner and owner not in srcs:
            try:
                remove_source_objects(owner, in_use)
            except Exception as e:  # noqa: BLE001 - next round
                LOG(event="cloud-drive-source-cleanup-failed", owner=owner, error=str(e)[:200])
    for user_id, username in USERS() or []:
        # Seen in place in the last 10 minutes: not asked again every round; none while its files are re-encrypted.
        if now - _volumes.get(user_id, 0) < 600 or busy(user_id) or transitioning(user_id):
            continue
        try:
            done = ensure_volume(user_id, username, in_use=in_use)
            if user_id in srcs:
                done = ensure_source_objects(user_id, username, srcs[user_id], in_use) and done
            if done:
                _volumes[user_id] = now
        except Exception as e:  # noqa: BLE001 - this account's turn comes again next round
            LOG(event="safe-volume-failed", user=username, error=str(e)[:300])


def _loop():
    last = None
    while True:
        try:
            reconcile()
            last = None
        except Exception as e:  # noqa: BLE001 - reported once, retried next round
            if str(e) != last:
                LOG(event="safe-reconcile-failed", error=str(e)[:300])
            last = str(e)
        _wake.wait(RECONCILE_EVERY)
        _wake.clear()


_wake = threading.Event()  # a new backend: the next round now


# ---------------------------------------------------------------------------------------------------- activity
# Each account's last transfer, from MinIO's admin trace (every S3 call, with its object's path - users/<id>/...):
# {user id: {"up": time, "down": time}}. The chart's MinIO only (an S3 service an admin set has no such trace).
_activity = {}
_activity_lock = threading.Lock()
UP_CALLS = ("s3.PutObject", "s3.PutObjectPart", "s3.CompleteMultipartUpload", "s3.CopyObject", "s3.CopyObjectPart")
DOWN_CALLS = ("s3.GetObject", "s3.SelectObjectContent")


def record_trace(line, bucket_name, now=None):
    """One line of MinIO's trace: an upload or a download of an account's file is that account's activity."""
    try:
        t = json.loads(line)
    except ValueError:
        return None
    fn = t.get("funcname") or t.get("funcName") or ""
    way = "up" if fn in UP_CALLS else "down" if fn in DOWN_CALLS else None
    parts = str(t.get("path") or "").split("/")
    # /<bucket>/users/<id>/...
    if not way or len(parts) < 4 or parts[1] != bucket_name or parts[2] + "/" != PREFIX:
        return None
    with _activity_lock:
        _activity.setdefault(parts[3], {})[way] = now or time.time()
    return parts[3], way


def activity(user, now=None):
    """Seconds since the caller's own last upload and download (None: none since the service started)."""
    now = now or time.time()
    with _activity_lock:
        seen = dict(_activity.get(user["id"], {}))
    return {way: (round(now - seen[way], 1) if way in seen else None) for way in ("up", "down")}


def _trace_loop():
    """Reads MinIO's admin trace (S3 calls only) for as long as the chart's MinIO is the backend; reconnects."""
    last = None
    while True:
        try:
            cfg = backend()
            if cfg["source"] != "chart" or cfg["kind"] != "minio":
                time.sleep(60)
                continue
            c = s3client.S3(cfg["endpoint"], cfg["region"], cfg["accessKey"], cfg["secretKey"], ca_file=S3_CA_FILE,
                            timeout=None)
            resp = c.request("GET", "minio/admin/v3/trace", query=[("s3", "true")])
            last = None
            buf = b""
            try:
                while True:
                    chunk = resp.read1(65536)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        if line.strip():
                            record_trace(line, cfg["bucket"])
            finally:
                resp.close()
                resp.conn.close()
        except Exception as e:  # noqa: BLE001 - reported once, tried again
            if str(e) != last:
                LOG(event="cloud-drive-trace-failed", error=str(e)[:200])
            last = str(e)
        time.sleep(10)


def start():
    if ENABLED and KUBE and KUBE.ok:
        threading.Thread(target=_loop, name="safe", daemon=True).start()
        threading.Thread(target=_links_loop, name="safe-links", daemon=True).start()
        threading.Thread(target=_trace_loop, name="safe-trace", daemon=True).start()


# ---------------------------------------------------------------------------------------------------- encryption
def _read_json(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(data, f)
    os.replace(tmp, path)


def encryption_records():
    """{user id: {state (on | encrypting | decrypting), method (password | pki), keyId, since, by, verifier
    (password), certificate (pki)}}."""
    return _read_json(ENCRYPTION_FILE)


def encryption_on(user_id):
    """Whether the account's files are encrypted (or being encrypted or decrypted: either way the key is needed)."""
    return (encryption_records().get(user_id) or {}).get("state") in ("on", "encrypting", "decrypting")


_keys = {"data": None, "at": 0}


def _keys_secret(fresh=False):
    """The data keys Secret's data {user id: base64 key}, cached 30 s."""
    if fresh or _keys["data"] is None or time.time() - _keys["at"] > 30:
        status, cur = KUBE.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (NAMESPACE, KEYS_SECRET))
        if status == 200:
            _keys.update(data={k: base64.b64decode(v).decode() for k, v in (cur.get("data") or {}).items()},
                         at=time.time())
        elif status == 404:
            _keys.update(data={}, at=time.time())
        else:
            raise DriveUnavailable("The Cloud Drive's keys cannot be read (HTTP %s)." % status)
    return dict(_keys["data"])


def data_key(user_id):
    """The account's 32-byte data key, or None."""
    text = _keys_secret().get(user_id)
    return base64.b64decode(text) if text else None


def store_key(user_id, key):
    """The account's data key kept (None: removed) in KEYS_SECRET."""
    data = _keys_secret(fresh=True)
    if key:
        data[user_id] = base64.b64encode(key).decode()
    else:
        data.pop(user_id, None)
    ensure_secret(KEYS_SECRET, data, labels={"app.kubernetes.io/name": "coder-cloud-drive-keys",
                                             "app.kubernetes.io/part-of": "coder"})
    _keys.update(data=data, at=time.time())


def transitioning(user_id):
    """Encrypting or decrypting (under way, or stopped half way: taken up again from the Cloud Drive's Encryption)."""
    return (encryption_records().get(user_id) or {}).get("state") in ("encrypting", "decrypting")


def busy(user_id):
    """The account's encryption or decryption under way, or None."""
    with _crypt_lock:
        job = _jobs.get(user_id)
        return dict(job) if job and not job.get("finishedAt") else None


def key_id(key):
    return hashlib.sha256(b"coder-cloud-drive-key-id\0" + key).hexdigest()[:16]


def _verifier(password, salt=None, iterations=kitcrypto.OPENSSL_ITER):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return {"salt": base64.b64encode(salt).decode(), "iterations": iterations, "hash": base64.b64encode(digest).decode()}


def _password_ok(record, password):
    v = record.get("verifier") or {}
    if not v or not password:
        return False
    want = _verifier(password, base64.b64decode(v["salt"]), int(v["iterations"]))["hash"]
    return hmac.compare_digest(want, v["hash"])


def encryption_view(user):
    uid = user["id"]
    rec = encryption_records().get(uid) or {}
    ok, why = tls_available()
    job = None
    with _crypt_lock:
        if uid in _jobs:
            job = dict(_jobs[uid])
    try:
        running = sorted(claim_holders(uid))
    except RuntimeError:
        running = []
    pending = _pending.get(uid)
    return {"state": rec.get("state") or "off", "method": rec.get("method"), "keyId": rec.get("keyId"),
            "since": rec.get("since"), "certificate": rec.get("certificate"), "available": ok, "unavailable": why,
            "job": job, "running": running, "source": bool(sources().get(uid)),
            "pending": {"keyId": pending["keyId"], "method": pending["method"]} if pending and
            time.time() - pending["at"] < PENDING_SECONDS else None, "passwordMin": PASSWORD_MIN}


def recovery_kit(user, key, method, wrapped, cert=None):
    """What the owner keeps to reach their files without this deployment: where they are, how much, the scheme, the
    data key wrapped with their password or for their certificate, and the steps (openssl and any S3 client)."""
    uid = user["id"]
    cfg = backend()
    try:
        objects, _ = client().list(bucket(), prefix=root_of(uid))
        size, count = sum(o["size"] for o in objects), len([o for o in objects if not o["key"].endswith("/")])
    except (s3client.S3Error, OSError):
        size = count = None
    endpoint = cfg["endpoint"]
    target = "s3://%s/%s" % (cfg["bucket"], root_of(uid))
    if method == "password":
        unwrap = ["Save the text of key.ciphertext below to cloud-drive-key.enc (its lines as they are).",
                  "openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter %d -a -in cloud-drive-key.enc "
                  "-out cloud-drive.key   (it asks for your Cloud Drive password)" % kitcrypto.OPENSSL_ITER]
    else:
        unwrap = ["Save key.ciphertext below, base64-decoded, as cloud-drive-key.bin: "
                  "base64 -d > cloud-drive-key.bin (paste it, then Ctrl-D).",
                  "Your private key as PEM, from your PKCS#12 file if that is where it is: openssl pkcs12 -in you.p12 "
                  "-nocerts -nodes -out private.pem (add -legacy for an older file).",
                  "openssl pkeyutl -decrypt -inkey private.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt "
                  "rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in cloud-drive-key.bin -out cloud-drive.key"]
    return {
        "kind": "Coder Cloud Drive recovery kit",
        "version": 1,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "deployment": CODER_ACCESS_URL or None,
        "account": {"id": uid, "username": user["username"]},
        "storage": {
            "location": target,
            "endpoint": endpoint,
            "endpointNote": "In-cluster address of the deployment's S3 storage (the chart's MinIO: Service "
                            "coder-user-storage-minio, port 9443, TLS) - from outside the cluster, its admins' route "
                            "to it." if cfg["source"] == "chart" else "The S3 service the deployment's admins set.",
            "bucket": cfg["bucket"], "prefix": root_of(uid), "region": cfg["region"] or "us-east-1",
            "objects": count, "bytes": size,
            "credentials": "The deployment's S3 keys (admins: Secret coder-user-storage-s3, or the S3 service's "
                           "own) - not in this kit.",
        },
        "encryption": {"scheme": "S3 server-side encryption with a customer-provided key (SSE-C, AES-256): every "
                                 "object of the prefix; S3 keeps no copy of the key.",
                       "keyId": key_id(key), "keyMD5": base64.b64encode(hashlib.md5(key).digest()).decode()},
        "key": {"method": method,
                "format": ("openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter %d -salt -a (your Cloud Drive "
                           "password)" % kitcrypto.OPENSSL_ITER) if method == "password" else
                          "RSA-OAEP, SHA-256 and MGF1-SHA256, for your certificate's key (base64)",
                "certificate": cert, "ciphertext": wrapped,
                "plain": "cloud-drive.key: the 32-byte data key (base64 of it: base64 -w0 cloud-drive.key)"},
        "steps": unwrap + [
            "Every file, decrypted, with the AWS CLI: aws s3 cp --recursive %s ./cloud-drive --endpoint-url %s "
            "--sse-c AES256 --sse-c-key fileb://cloud-drive.key%s" % (
                target, endpoint, " --no-verify-ssl" if cfg["source"] == "chart" else ""),
            "Or mount it: geesefs --endpoint %s --sse-c $(base64 -w0 cloud-drive.key) %s:%s ./cloud-drive" % (
                endpoint, cfg["bucket"], root_of(uid).rstrip("/")),
            "Keep this kit and the password (or the private key) apart: either alone opens nothing.",
        ],
    }


def prepare_encryption(user, body):
    """A new data key, wrapped with the owner's password (or for their certificate), and the recovery kit with it: the
    owner downloads the kit, then turns encryption on with the key's id. Nothing changes until then."""
    uid = user["id"]
    rec = encryption_records().get(uid) or {}
    if rec.get("state") in ("on", "encrypting", "decrypting"):
        raise ValueError("Your Cloud Drive is encrypted already.")
    if sources().get(uid):
        raise ValueError("Your Cloud Drive is a workspace's folder now: encryption is for its S3 storage.")
    ok, why = tls_available()
    if not ok:
        raise ValueError(why)
    method = body.get("method")
    key = secrets.token_bytes(32)
    record = {"method": method, "keyId": key_id(key)}
    if method == "password":
        password = str(body.get("password") or "")
        if len(password) < PASSWORD_MIN:
            raise ValueError("A password of at least %d characters." % PASSWORD_MIN)
        wrapped = kitcrypto.openssl_enc(key, password)
        record["verifier"] = _verifier(password)
        cert = None
    elif method == "pki":
        info = kitcrypto.certificate(str(body.get("certificate") or ""))
        wrapped = base64.b64encode(kitcrypto.rsa_oaep_encrypt(info["key"], key)).decode()
        cert = {k: info[k] for k in ("subject", "issuer", "serial", "notAfter", "fingerprint")}
        cert["bits"] = info["key"]["bits"]
        record["certificate"] = cert
    else:
        raise ValueError("method: password or pki.")
    kit = recovery_kit(user, key, method, wrapped, cert)
    _pending[uid] = {"key": key, "keyId": record["keyId"], "method": method, "record": record, "at": time.time()}
    LOG(event="cloud-drive-encryption", action="prepared", user=user["username"], method=method, key=record["keyId"])
    return {"keyId": record["keyId"], "kit": kit,
            "fileName": "cloud-drive-recovery-%s-%s.json" % (user["username"], time.strftime("%Y%m%d"))}


def _refuse_running(uid, doing):
    running = claim_holders(uid)
    if running:
        raise ValueError("Stop your workspaces first (%d still %s your Cloud Drive): %s while none of them has it."
                         % (len(running), "has" if len(running) == 1 else "have", doing))


def enable_encryption(user, body):
    """Turns encryption on with the prepared key, once its recovery kit is saved: the volume is taken away, every
    object re-encrypted with the key (in place, in the background), and the volume made again with it."""
    uid = user["id"]
    pending = _pending.get(uid)
    if not pending or time.time() - pending["at"] > PENDING_SECONDS or body.get("keyId") != pending["keyId"]:
        raise ValueError("Prepare the key again: download its recovery kit, then turn encryption on.")
    if body.get("kitSaved") is not True:
        raise ValueError("Download the recovery kit and keep it: without it (or an admin) your files cannot be "
                         "recovered.")
    with _crypt_lock:
        if uid in _jobs and not _jobs[uid].get("finishedAt"):
            raise ValueError("Your Cloud Drive is being re-encrypted already.")
        _refuse_running(uid, "it is encrypted")
        store_key(uid, pending["key"])
        records = encryption_records()
        records[uid] = {**pending["record"], "state": "encrypting", "since": int(time.time()), "by": user["username"]}
        _write_json(ENCRYPTION_FILE, records)
        _jobs[uid] = {"action": "encrypt", "done": 0, "total": 0, "error": None, "startedAt": int(time.time()),
                      "finishedAt": None}
        _pending.pop(uid, None)
    LOG(event="cloud-drive-encryption", action="encrypting", user=user["username"], key=pending["keyId"])
    threading.Thread(target=_crypt, args=(uid, user["username"], "encrypt"), daemon=True).start()
    return encryption_view(user)


def disable_encryption(user, body):
    """Turns encryption off: proved with the password (or, for a certificate, the data key from the recovery kit);
    every object decrypted in place, the volume made again without the key."""
    uid = user["id"]
    rec = encryption_records().get(uid) or {}
    if rec.get("state") != "on":
        raise ValueError("Your Cloud Drive is not encrypted." if not rec else "Wait for the re-encryption to end.")
    if rec.get("method") == "password":
        if not _password_ok(rec, str(body.get("password") or "")):
            raise PermissionError("That is not your Cloud Drive password.")
    else:
        try:
            given = base64.b64decode(str(body.get("dataKey") or "").strip(), validate=True)
        except ValueError:
            given = b""
        key = data_key(uid) or b""
        if not key or not hmac.compare_digest(given, key):
            raise PermissionError("That is not your Cloud Drive's data key (base64 of cloud-drive.key).")
    with _crypt_lock:
        if uid in _jobs and not _jobs[uid].get("finishedAt"):
            raise ValueError("Your Cloud Drive is being re-encrypted already.")
        _refuse_running(uid, "it is decrypted")
        records = encryption_records()
        records[uid] = {**rec, "state": "decrypting"}
        _write_json(ENCRYPTION_FILE, records)
        _jobs[uid] = {"action": "decrypt", "done": 0, "total": 0, "error": None, "startedAt": int(time.time()),
                      "finishedAt": None}
    LOG(event="cloud-drive-encryption", action="decrypting", user=user["username"])
    threading.Thread(target=_crypt, args=(uid, user["username"], "decrypt"), daemon=True).start()
    return encryption_view(user)


def resume_encryption(user):
    """A re-encryption that stopped (an error, or the service restarted) taken up again where it was."""
    uid = user["id"]
    rec = encryption_records().get(uid) or {}
    action = {"encrypting": "encrypt", "decrypting": "decrypt"}.get(rec.get("state"))
    if not action:
        raise ValueError("Nothing to take up again.")
    with _crypt_lock:
        if uid in _jobs and not _jobs[uid].get("finishedAt"):
            raise ValueError("It is under way.")
        _refuse_running(uid, "it goes on")
        _jobs[uid] = {"action": action, "done": 0, "total": 0, "error": None, "startedAt": int(time.time()),
                      "finishedAt": None}
    threading.Thread(target=_crypt, args=(uid, user["username"], action), daemon=True).start()
    return encryption_view(user)


def _is_encrypted(s3, bkt, key, sse):
    """Whether the object is stored with the key (a HEAD with it succeeds), else False (a plain object)."""
    try:
        s3.head(bkt, key, sse=sse)
        return True
    except s3client.S3Error as e:
        if e.status in (400, 403):
            return False
        raise


def _crypt(uid, username, action):
    """Every object of the account re-encrypted: plain -> with its key (encrypt), or back (decrypt). Each object is
    checked first, so a run that stopped is taken up where it was; the volume is away the whole time (a workspace that
    starts waits for it) and made again at the end."""
    key = data_key(uid)
    s3, bkt, root = client(), bucket(), root_of(uid)
    try:
        if not key:
            raise RuntimeError("the data key is missing")
        remove_volume(CLAIM_PREFIX + uid)
        objects, _ = s3.list(bkt, prefix=root)
        with _crypt_lock:
            _jobs[uid]["total"] = len(objects)
        for o in objects:
            encrypted = _is_encrypted(s3, bkt, o["key"], key)
            if encrypted != (action == "encrypt"):
                src, dst = (None, key) if action == "encrypt" else (key, None)
                ctype = s3.head(bkt, o["key"], sse=src).headers.get("Content-Type") or "application/octet-stream"
                s3.copy(bkt, o["key"], o["key"], o["size"], content_type=ctype, src_sse=src, dst_sse=dst)
            with _crypt_lock:
                _jobs[uid]["done"] += 1
        records = encryption_records()
        if action == "encrypt":
            records[uid] = {**records.get(uid, {}), "state": "on"}
        else:
            records.pop(uid, None)
            store_key(uid, None)
        _write_json(ENCRYPTION_FILE, records)
        with _lock:
            _usage.pop(uid, None)
        LOG(event="cloud-drive-encryption", action=action + "ed", user=username, objects=len(objects))
    except Exception as e:  # noqa: BLE001 - kept in the job: the owner sees it and takes it up again
        LOG(event="cloud-drive-encryption-failed", action=action, user=username, error=str(e)[:300])
        with _crypt_lock:
            _jobs[uid]["error"] = str(e)[:300]
    finally:
        with _crypt_lock:
            _jobs[uid]["finishedAt"] = int(time.time())
        _volumes.pop(uid, None)
        _wake.set()


# ---------------------------------------------------------------------------------------------------- a workspace as the source
def sources():
    """{owner id: {workspace, name, path, since, by, accessKey, secretKey}}: the accounts whose Cloud Drive is a
    folder of one of their workspaces."""
    return _read_json(SOURCES_FILE)


def source_config(owner, src):
    """What the source's server runs with, and its id (a change restarts it)."""
    cfg = {"root": src["path"], "bucket": SOURCE_BUCKET, "prefix": owner + "/", "accessKey": src["accessKey"],
           "secretKey": src["secretKey"], "region": "us-east-1", "port": SOURCE_PORT}
    cfg["id"] = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]
    return cfg


def source_client(src):
    return s3client.S3("http://%s%s.%s.svc:9000" % (SOURCE_PREFIX, src["owner"], NAMESPACE), "us-east-1",
                       src["accessKey"], src["secretKey"], timeout=20)


def source_view(owner, src):
    seen = _sources_seen.get(owner) or {}
    return {"workspace": src["workspace"], "name": src.get("name"), "path": src["path"], "since": src.get("since"),
            "running": bool(seen.get("running")), "error": seen.get("error"), "pod": seen.get("pod")}


def _source_pod(workspace_id):
    """The source workspace's running pod (name, IP), or None."""
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("com.coder.workspace.id=" + workspace_id)))
    for p in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        st = p.get("status") or {}
        if st.get("phase") == "Running" and not p["metadata"].get("deletionTimestamp") and st.get("podIP"):
            ready = {c.get("name"): c.get("ready") for c in st.get("containerStatuses") or []}
            if ready.get(SOURCE_CONTAINER):
                return p["metadata"]["name"], st["podIP"]
    return None


def _health(ip):
    try:
        host = "[%s]" % ip if ":" in ip else ip
        with urllib.request.urlopen("http://%s:%d/__health" % (host, SOURCE_PORT), timeout=3) as r:
            return json.loads(r.read(4096))
    except (OSError, ValueError):
        return None


# Run in the source workspace (as its user) through exec: reads its message (the server and its configuration) from
# stdin - exactly the bytes it is told of - stops a server it started before, writes both (0600, in a 0700 folder) and
# starts the server in a session of its own, so it outlives the exec.
LAUNCH = r"""
import json, os, signal, subprocess, sys, time
n = int(sys.argv[1]); data = b""
while len(data) < n:
    chunk = sys.stdin.buffer.read(n - len(data))
    if not chunk:
        break
    data += chunk
msg = json.loads(data)
home = os.environ.get("HOME") if os.environ.get("HOME", "/") != "/" else "/home/coder"
d = os.path.join(home, ".cache", "coder-cloud-drive")
os.makedirs(d, mode=0o700, exist_ok=True)
os.chmod(d, 0o700)
pidf = os.path.join(d, "server.pid")
try:
    pid = int(open(pidf).read())
    if "coder-cloud-drive" in open("/proc/%d/cmdline" % pid).read():
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.5)
except (OSError, ValueError):
    pass
if msg.get("stop"):
    print("stopped")
    sys.exit(0)
os.makedirs(msg["config"]["root"], mode=0o755, exist_ok=True)
for name, text in (("server.py", msg["server"]), ("config.json", json.dumps(msg["config"]))):
    tmp = os.path.join(d, name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, os.path.join(d, name))
log = open(os.path.join(d, "server.log"), "ab")
p = subprocess.Popen([sys.executable, os.path.join(d, "server.py"), os.path.join(d, "config.json")],
                     stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
with open(pidf, "w") as f:
    f.write(str(p.pid))
print(p.pid)
"""


def _launch(pod, message):
    data = json.dumps(message).encode()
    code, out, err = kexec.exec_in(KUBE, NAMESPACE, pod, SOURCE_CONTAINER, ["python3", "-c", LAUNCH, str(len(data))],
                                   timeout=30, stdin=data)
    if code != 0:
        raise RuntimeError((err or out or "exit %d" % code).strip()[-300:])
    return out.strip()


def _server_text():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "drivesource.py")) as f:
        return f.read()


def sources_once():
    """Each source workspace's server kept running with its configuration while the workspace runs (started through
    exec when its health says otherwise, at most every SOURCE_RETRY seconds); what is seen is kept for the views and
    the templates."""
    for owner, src in sources().items():
        seen = _sources_seen.setdefault(owner, {"running": False, "tried": 0, "error": None, "checked": 0})
        if WORKSPACES and time.time() - seen.get("checked", 0) > SOURCE_RETRY:
            seen["checked"] = time.time()
            try:
                alive = WORKSPACES(owner)
            except Exception:  # noqa: BLE001 - Coder's database unreachable: asked again later
                alive = None
            if alive is not None and src["workspace"] not in {w["id"] for w in alive}:
                # deleted past the dashboard's guard (the CLI, the API): the Cloud Drive goes back to S3
                data = sources()
                data.pop(owner, None)
                _write_json(SOURCES_FILE, data)
                _sources_seen.pop(owner, None)
                _wake.set()
                LOG(event="cloud-drive-source", action="workspace-deleted", owner=owner, workspace=src.get("name"))
                continue
        found = _source_pod(src["workspace"])
        if not found:
            seen.update(running=False, pod=None)
            continue
        pod, ip = found
        cfg = source_config(owner, src)
        health = _health(ip)
        if health and health.get("ok") and health.get("config") == cfg["id"]:
            if not seen.get("running"):
                LOG(event="cloud-drive-source", action="serving", owner=owner, workspace=src.get("name"), pod=pod)
            seen.update(running=True, pod=pod, error=None)
            continue
        seen.update(running=False, pod=pod)
        if time.time() - seen.get("tried", 0) < SOURCE_RETRY:
            continue
        seen["tried"] = time.time()
        try:
            pid = _launch(pod, {"server": _server_text(), "config": cfg})
            LOG(event="cloud-drive-source", action="started", owner=owner, workspace=src.get("name"), pod=pod, pid=pid)
            for _ in range(10):
                time.sleep(0.5)
                health = _health(ip)
                if health and health.get("config") == cfg["id"]:
                    seen.update(running=True, error=None)
                    break
            else:
                seen["error"] = "Its server did not answer (see ~/.cache/coder-cloud-drive/server.log in the workspace)."
        except Exception as e:  # noqa: BLE001 - shown on the Cloud Drive, tried again later
            seen["error"] = "Its server could not be started: %s" % str(e)[:200]
            LOG(event="cloud-drive-source-failed", owner=owner, pod=pod, error=str(e)[:300])


def ensure_source_objects(owner, username, src, in_use):
    """The source's Service (its workspace's pod, port 9000 -> the server), the Secret its volume mounts with (the
    Service's ClusterIP: the nodes have no cluster DNS) and the volume itself."""
    name = SOURCE_PREFIX + owner
    labels = {"app.kubernetes.io/name": "coder-drive-source", "app.kubernetes.io/part-of": "coder",
              "platform.coder/user-id": owner}
    svc = {"apiVersion": "v1", "kind": "Service",
           "metadata": {"name": name, "namespace": NAMESPACE, "labels": labels},
           "spec": {"selector": {"com.coder.workspace.id": src["workspace"]},
                    "ports": [{"name": "s3", "port": 9000, "targetPort": SOURCE_PORT}]}}
    path = "/api/v1/namespaces/%s/services/%s" % (NAMESPACE, name)
    status, cur = KUBE.call("GET", path)
    if status == 404:
        status, out = KUBE.call("POST", "/api/v1/namespaces/%s/services" % NAMESPACE, svc)
        if status not in (200, 201):
            raise RuntimeError("Service %s: HTTP %s %s" % (name, status, str(out)[:200]))
    elif status == 200 and (cur.get("spec") or {}).get("selector") != svc["spec"]["selector"]:
        status, out = KUBE.call("PATCH", path, {"spec": {"selector": svc["spec"]["selector"]}},
                                patch_type="application/merge-patch+json")
        if status != 200:
            raise RuntimeError("Service %s: HTTP %s" % (name, status))
    elif status != 200:
        raise RuntimeError("Service %s: HTTP %s" % (name, status))
    ensure_secret(name, {"accessKeyID": src["accessKey"], "secretAccessKey": src["secretKey"],
                         "endpoint": "http://%s:9000" % service_ip(name), "region": "us-east-1"}, labels=labels)
    return ensure_volume(owner, username, objects=source_volume_objects(owner, username), in_use=in_use)


def remove_source_objects(owner, in_use=None):
    """A former source's Service and Secret, and its volume once no workspace uses it; True when all are gone."""
    name = SOURCE_PREFIX + owner
    for path in ("/api/v1/namespaces/%s/services/%s" % (NAMESPACE, name),
                 "/api/v1/namespaces/%s/secrets/%s" % (NAMESPACE, name)):
        KUBE.call("DELETE", path)
    if KUBE.call("GET", "/api/v1/persistentvolumes/" + name)[0] == 404:
        return True
    if name in (in_use if in_use is not None else claims_in_use()):
        return False
    remove_volume(name)
    return True


SOURCE_PATH_RE = re.compile(r"^/home/coder(/[^/\0]+)+$")


def clean_source_path(path):
    """A folder of the workspace's home for the source: absolute (or relative to the home), not the home itself, not
    a hidden folder of it (~/.ssh...), not the Cloud Drive's own place."""
    path = str(path or "").strip()
    if path.startswith("~/"):
        path = SOURCE_HOME + path[1:]
    elif not path.startswith("/"):
        path = SOURCE_HOME + "/" + path
    path = os.path.normpath(path)
    if not SOURCE_PATH_RE.match(path) or len(path) > 400:
        raise ValueError("A folder in the workspace's home (/home/coder/...), other than the home itself.")
    top = path[len(SOURCE_HOME) + 1:].split("/")[0]
    if top.startswith("."):
        raise ValueError("Not a hidden folder of the home (%s)." % top)
    if path == MOUNT_PATH or path.startswith(MOUNT_PATH + "/") or MOUNT_PATH.startswith(path + "/"):
        raise ValueError("Not the Cloud Drive's own place (%s) or a folder around it." % MOUNT_PATH)
    return path


# In the workspace, as its user: the folder made if it is not there yet; then it must be a folder reached through no link.
CHECK_DIR = ("import os, sys; p = sys.argv[1]\n"
             "try:\n    os.makedirs(p, mode=0o755, exist_ok=True)\nexcept OSError:\n    pass\n"
             "print('ok' if os.path.isdir(p) and os.path.realpath(p) == p else 'no')")


def set_source(h, user, body):
    """The caller makes a folder of one of their workspaces their Cloud Drive: their other workspaces mount it (from
    their next start) while that workspace runs; the S3 storage keeps its files, unused, until the source is
    cleared."""
    uid = user["id"]
    wid = str(body.get("workspace") or "")
    if not WORKSPACE_ID_RE.match(wid):
        raise ValueError("Choose one of your workspaces.")
    ws = WORKSPACE_INFO(h.token(), wid) if WORKSPACE_INFO else None
    if not ws:
        raise ValueError("There is no such workspace.")
    if ws.get("owner_id") != uid:
        raise PermissionError
    if wid in shared_now():
        raise ValueError("That workspace is shared with others: it cannot hold your Cloud Drive.")
    if encryption_on(uid):
        raise ValueError("Your Cloud Drive is encrypted: turn encryption off first (it is for its S3 storage).")
    if busy(uid):
        raise ValueError("Your Cloud Drive is being re-encrypted: wait for it to end.")
    path = clean_source_path(body.get("path"))
    found = _source_pod(wid)
    if found:
        code, out, err = kexec.exec_in(KUBE, NAMESPACE, found[0], SOURCE_CONTAINER, ["python3", "-c", CHECK_DIR, path],
                                       timeout=15)
        if out.strip() != "ok":
            raise ValueError("%s cannot be a folder in %s: something else is there, or a link on the way." % (
                path, ws.get("name")))
    data = sources()
    old = data.get(uid)
    data[uid] = {"owner": uid, "workspace": wid, "name": ws.get("name"), "path": path, "since": int(time.time()),
                 "by": user["username"],
                 "accessKey": (old or {}).get("accessKey") or "src" + secrets.token_hex(8),
                 "secretKey": (old or {}).get("secretKey") or secrets.token_urlsafe(32)}
    _write_json(SOURCES_FILE, data)
    if old and old["workspace"] != wid:
        _stop_source_server(old["workspace"])
    _sources_seen.pop(uid, None)
    _volumes.pop(uid, None)
    _wake.set()
    publish_now()
    LOG(event="cloud-drive-source", action="set", user=user["username"], workspace=ws.get("name"), path=path)
    return connections(user)


def _stop_source_server(workspace_id):
    found = _source_pod(workspace_id)
    if found:
        try:
            _launch(found[0], {"stop": True})
        except Exception as e:  # noqa: BLE001 - the workspace's next start has no server anyway
            LOG(event="cloud-drive-source-stop-failed", workspace=workspace_id, error=str(e)[:200])


def clear_source(user, disconnect=()):
    """The caller's Cloud Drive back on its S3 storage (each workspace from its next start); the workspaces named
    disconnected from it on the way (the source's delete guard)."""
    uid = user["id"]
    data = sources()
    old = data.pop(uid, None)
    if not old:
        raise ValueError("Your Cloud Drive is not a workspace's folder.")
    _write_json(SOURCES_FILE, data)
    if disconnect:
        with _links_lock:
            links = disconnected()
            for wid in disconnect:
                links[wid] = {"owner": uid, "by": user["username"], "at": int(time.time()), "why": "source-deleted"}
            _write_json(LINKS_FILE, links)
    _stop_source_server(old["workspace"])
    _sources_seen.pop(uid, None)
    publish_now()
    try:
        remove_source_objects(uid)
    except Exception as e:  # noqa: BLE001 - the reconcile loop takes the volume away once unused
        LOG(event="cloud-drive-source-cleanup-failed", user=user["username"], error=str(e)[:200])
    _wake.set()
    LOG(event="cloud-drive-source", action="cleared", user=user["username"], workspace=old.get("name"),
        disconnected=len(disconnect))
    return connections(user)


def source_guard(user, wid):
    """For deleting a workspace: whether it is the caller's Cloud Drive source, and which of their workspaces are
    connected to it (each must be confirmed before the source is deleted)."""
    src = sources().get(user["id"])
    if not src or src["workspace"] != wid:
        return {"source": False}
    off, shared = disconnected(), shared_now()
    try:
        holding = claim_holders(user["id"])
    except RuntimeError:
        holding = set()
    connected = [{"id": w["id"], "name": w["name"], "mounted": w["id"] in holding}
                 for w in ((WORKSPACES(user["id"]) if WORKSPACES else None) or [])
                 if w["id"] != wid and w["id"] not in off and w["id"] not in shared]
    return {"source": True, "path": src["path"], "name": src.get("name"), "connected": connected}


def release_source(user, body):
    """The source's delete guard confirmed: every connected workspace named (each one confirmed), the Cloud Drive
    back on S3; the dashboard then deletes the workspace."""
    wid = str(body.get("workspace") or "")
    guard = source_guard(user, wid)
    if not guard["source"]:
        raise ValueError("That workspace is not your Cloud Drive's source.")
    confirmed = set(body.get("disconnect") or [])
    missing = [w["name"] for w in guard["connected"] if w["id"] not in confirmed]
    if missing:
        raise ValueError("Confirm each connected workspace: %s." % ", ".join(missing))
    if body.get("confirm") != "delete":
        raise ValueError('Type "delete" to confirm.')
    return clear_source(user, disconnect=[w["id"] for w in guard["connected"]])


# ---------------------------------------------------------------------------------------------------- the files
class DriveUnavailable(RuntimeError):
    """The account's files cannot be reached now (its source workspace is stopped, or they are being re-encrypted)."""


def drive_of(user_id):
    """Where the account's files are now: (S3 client, bucket, its root prefix, its SSE-C key or None) - its source
    workspace's server, or the S3 storage (with its key when encrypted)."""
    src = sources().get(user_id)
    if src:
        if not (_sources_seen.get(user_id) or {}).get("running"):
            raise DriveUnavailable("Your Cloud Drive is the folder %s of your workspace %s, which is not running: "
                                   "start it to reach your files." % (src["path"], src.get("name") or src["workspace"]))
        return source_client(src), SOURCE_BUCKET, user_id + "/", None
    job = busy(user_id)
    if job:
        raise DriveUnavailable("Your Cloud Drive is being %s (%d of %d files): it opens again when that is done."
                               % ("encrypted" if job["action"] == "encrypt" else "decrypted", job["done"], job["total"]))
    if transitioning(user_id):
        raise DriveUnavailable("Your Cloud Drive's re-encryption stopped half way: take it up again (Cloud Drive > "
                               "Encryption).")
    key = data_key(user_id) if encryption_on(user_id) else None
    if encryption_on(user_id) and not key:
        raise DriveUnavailable("Your Cloud Drive's key cannot be read now: ask an admin.")
    return client(), bucket(), root_of(user_id), key


def usage(user_id, fresh=False):
    """(bytes, files) in the account's safe, cached USAGE_TTL seconds."""
    with _lock:
        hit = _usage.get(user_id)
    if hit and not fresh and time.time() - hit[0] < USAGE_TTL:
        return hit[1], hit[2]
    s3, bkt, root, _ = drive_of(user_id)
    objects, _ = s3.list(bkt, prefix=root)
    files = [o for o in objects if not o["key"].endswith("/")]
    used = sum(o["size"] for o in objects)
    with _lock:
        _usage[user_id] = (time.time(), used, len(files))
    return used, len(files)


def summary(user):
    offline = None
    try:
        used, files = usage(user["id"])
    except DriveUnavailable as e:
        used, files, offline = 0, 0, str(e)
    src = sources().get(user["id"])
    claim = (SOURCE_PREFIX if src else CLAIM_PREFIX) + user["id"]
    status, pvc = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, claim)) \
        if KUBE and KUBE.ok else (0, None)
    bound = status == 200 and ((pvc or {}).get("status") or {}).get("phase") == "Bound"
    return {"enabled": True, "mountPath": MOUNT_PATH, "usedBytes": used, "files": files,
            "quotaBytes": None if src else quota_bytes(), "maxUploadBytes": MAX_UPLOAD_BYTES,
            "volume": "ready" if bound else "pending", "offline": offline,
            "encrypted": encryption_on(user["id"]), "source": source_view(user["id"], src) if src else None,
            "shared": shared_capacity(user["id"])}


def shared_capacity(user_id):
    """The entire Cloud Drives shared with the user read and write: room they can use besides their own -
    [{owner, ownerName, quotaBytes (None: a source workspace's folder), usedBytes (None: unreachable now)}]."""
    out = []
    srcs = sources()
    for p in drivepeers.active().get(user_id, []):
        if p["kind"] != "drive" or p["access"] != "write":
            continue
        try:
            used, _ = usage(p["owner"])
        except (DriveUnavailable, s3client.S3Error, OSError):
            used = None
        out.append({"owner": p["owner"], "ownerName": p["name"],
                    "quotaBytes": None if srcs.get(p["owner"]) else quota_bytes(), "usedBytes": used})
    return out


def listing(user, path):
    """A folder of the caller's safe: its folders and files, folders first, by name."""
    path = clean_path(path)
    s3, bkt, root, _ = drive_of(user["id"])
    prefix = root + (path + "/" if path else "")
    objects, prefixes = s3.list(bkt, prefix=prefix, delimiter="/")
    folders = sorted({p[len(prefix):].rstrip("/") for p in prefixes if p != prefix}, key=str.lower)
    files = sorted(({"name": o["key"][len(prefix):], "size": o["size"], "modified": o["modified"]}
                    for o in objects if o["key"] != prefix and not o["key"].endswith("/")), key=lambda f: f["name"].lower())
    return {"path": path, "folders": [{"name": f} for f in folders], "files": files}


GLANCE_NEWEST = 8


def glance(user, owner=None, share=None):
    """A Cloud Drive at a glance (the card of what is shared with the caller): how many files, how much they take, and
    the newest few, from one listing (of the whole drive, which also refreshes its usage; or of the shared folder, or
    the shared file). owner: the drive's owner's account ({id, username, name}) when it is shared with the caller;
    share: that share (drivepeers, public form), when only a folder or file of it is."""
    s3, bkt, root, sse = drive_of(user["id"])
    kind, top = (share or {}).get("kind") or "drive", (share or {}).get("path") or ""
    if kind == "file":
        try:
            head = s3.head(bkt, root + top, sse=sse)
            objects = [{"key": root + top, "size": int(head.headers.get("Content-Length") or 0),
                        "modified": head.headers.get("Last-Modified")}]
        except s3client.S3Error as e:
            if e.status != 404:
                raise
            objects = []
    else:
        objects, _ = s3.list(bkt, prefix=root + (top + "/" if top else ""))
    files = [o for o in objects if not o["key"].endswith("/")]
    used = sum(o["size"] for o in objects)
    if kind == "drive":
        with _lock:
            _usage[user["id"]] = (time.time(), used, len(files))
    newest = sorted(files, key=lambda o: o["modified"] or "", reverse=True)[:GLANCE_NEWEST]
    return {"files": len(files), "usedBytes": used,
            "newest": [{"path": o["key"][len(root):], "size": o["size"], "modified": o["modified"]} for o in newest],
            "owner": {k: (owner or {}).get(k) for k in ("id", "username", "name")} if owner else None,
            "share": {k: share.get(k) for k in ("id", "kind", "path", "access")} if share else None}


def shared_listing(owner_id, viewer_id, path):
    """A folder of a Cloud Drive shared with the viewer, as far as it is shared: all of it where a share reaches it
    ("access" read or write); a folder on the way to shared ones lists just those ("access" None; each entry's own
    access, None for a folder on the way)."""
    path = clean_path(path)
    access = drivepeers.access_at(viewer_id, owner_id, path)
    if access:
        return {**listing({"id": owner_id}, path), "access": access}
    below = path + "/" if path else ""
    folders, files = {}, {}
    for sh in drivepeers.shares_of(viewer_id, owner_id):
        top = sh["path"]
        if not top.startswith(below) or top == path:
            continue
        rest = top[len(below):]
        head = rest.split("/", 1)[0]
        if "/" in rest:
            folders.setdefault(head, None)
        elif sh["kind"] == "folder":
            folders[head] = "write" if "write" in (folders.get(head), sh["access"]) else sh["access"]
        else:
            files[head] = "write" if "write" in (files.get(head), sh["access"]) else sh["access"]
    if not folders and not files:
        raise PermissionError("That is not shared with you.")
    real = listing({"id": owner_id}, path)
    return {"path": path, "access": None,
            "folders": [dict(f, access=folders[f["name"]]) for f in real["folders"] if f["name"] in folders],
            "files": [dict(f, access=files[f["name"]]) for f in real["files"] if f["name"] in files]}


def upload_csrf_ok(h):
    """Writes come from the dashboard itself: its header, and the browser's same-origin markers."""
    if h.headers.get(CSRF_HEADER[0]) != CSRF_HEADER[1]:
        return False
    origin = h.headers.get("Origin")
    if origin and urllib.parse.urlsplit(origin).netloc != h.headers.get("Host"):
        return False
    return h.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")


def read_json(h, limit=8192):
    n = int(h.headers.get("Content-Length") or 0)
    if not 0 < n <= limit:
        raise ValueError("Expected a JSON object.")
    data = json.loads(h.rfile.read(n))
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def download(h, user, path):
    path = clean_path(path)
    if not path:
        raise ValueError("Choose a file.")
    s3, bkt, root, key = drive_of(user["id"])
    resp = s3.get(bkt, root + path, sse=key)
    try:
        name = path.rsplit("/", 1)[-1]
        ascii_name = re.sub(r'[^A-Za-z0-9._ -]', "_", name) or "download"
        h.send_response(200)
        h.send_header("Content-Type", "application/octet-stream")
        h.send_header("Content-Length", resp.headers.get("Content-Length", "0"))
        h.send_header("Content-Disposition", "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (
            ascii_name, urllib.parse.quote(name, safe="")))
        h.send_header("Cache-Control", "no-store")
        h.send_header("X-Content-Type-Options", "nosniff")
        h.end_headers()
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            h.wfile.write(chunk)
    finally:
        resp.close()
        resp.conn.close()


def upload(h, user, path):
    path = clean_path(path)
    if not path:
        raise ValueError("Name the file.")
    length = int(h.headers.get("Content-Length") or -1)
    if length < 0:
        raise ValueError("The upload needs a Content-Length.")
    if length > MAX_UPLOAD_BYTES:
        return h.send_json(413, {"error": "That file is larger than the %d GiB an upload may be." % (MAX_UPLOAD_BYTES // 1024 ** 3)})
    s3, bkt, root, sse = drive_of(user["id"])
    key = root + path
    if bkt != SOURCE_BUCKET:  # a source workspace's folder has its volume's room, not the quota
        used, _ = usage(user["id"], fresh=True)
        existing = 0
        try:
            existing = int(s3.head(bkt, key, sse=sse).headers.get("Content-Length") or 0)
        except s3client.S3Error as e:
            if e.status != 404:
                raise
        quota = quota_bytes()
        if used - existing + length > quota:
            return h.send_json(413, {"error": "Your Cloud Drive holds %s; this file would take it past its %s." % (
                human(used), human(quota))})
    s3.put_large(bkt, key, h.rfile, length, sse=sse)
    with _lock:
        _usage.pop(user["id"], None)
    LOG(event="safe-upload", user=user["username"], path=path, bytes=length)
    return h.send_json(200, {"ok": True, "path": path, "size": length})


def make_folder(user, path):
    path = clean_path(path)
    if not path:
        raise ValueError("Name the folder.")
    s3, bkt, root, sse = drive_of(user["id"])
    s3.put(bkt, root + path + "/", b"", sse=sse)
    return {"ok": True, "path": path}


def delete(user, path):
    """A file, or a folder (path ending in "/") and everything under it."""
    folder = (path or "").endswith("/")
    path = clean_path(path)
    if not path:
        raise ValueError("Choose what to delete.")
    s3, bkt, root, _ = drive_of(user["id"])
    key = root + path
    if folder:
        objects, _ = s3.list(bkt, prefix=key + "/")
        # deepest first: a folder on a source workspace goes once it is empty
        keys = sorted((o["key"] for o in objects), key=lambda k: (-k.count("/"), k.endswith("/"), k))
        failed = s3.delete_many(bkt, keys) if keys else []
        if failed:
            raise RuntimeError("%d could not be deleted (%s)" % (len(failed), failed[0][1]))
        removed = len([k for k in keys if not k.endswith("/")])
    else:
        s3.delete(bkt, key)
        removed = 1
    with _lock:
        _usage.pop(user["id"], None)
    LOG(event="safe-delete", user=user["username"], path=path + ("/" if folder else ""), files=removed)
    return {"ok": True, "removed": removed}


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return ("%d %s" if unit == "B" else "%.1f %s") % (n, unit)
        n /= 1024.0


# ------------------------------------------------------------------------------------------------- the libraries
def library_name(kind, name):
    lib = LIBRARIES[kind]
    name = str(name or "").strip()
    if not lib["nameRe"].match(name):
        raise ValueError("A file name of letters, digits and . _ + -, %s." % lib["nameRule"])
    return name


def library(kind, user):
    lib = LIBRARIES[kind]
    prefix = lib["prefix"]
    objects, _ = client().list(bucket(), prefix=prefix)
    files = sorted(({"name": o["key"][len(prefix):], "size": o["size"], "modified": o["modified"]}
                    for o in objects if "/" not in o["key"][len(prefix):] and o["key"] != prefix),
                   key=lambda f: f["name"].lower())
    with _lock:
        imports = [dict(i) for (k, _n), i in _imports.items() if k == kind]
    return {"enabled": True, "canEdit": bool(CAN_EDIT and CAN_EDIT(user)), "mountPath": lib["mountPath"],
            "maxBytes": lib["maxBytes"], "files": files, "usedBytes": sum(f["size"] for f in files),
            "imports": sorted(imports, key=lambda i: i["startedAt"], reverse=True)}


def library_upload(kind, h, user, name):
    lib = LIBRARIES[kind]
    name = library_name(kind, name)
    length = int(h.headers.get("Content-Length") or -1)
    if length < 0:
        raise ValueError("The upload needs a Content-Length.")
    if length > lib["maxBytes"]:
        return h.send_json(413, {"error": "A%s %s can be at most %s." % (
            "n" if lib["noun"][0] in "AEIOU" else "", lib["noun"], human(lib["maxBytes"]))})
    client().put_large(bucket(), lib["prefix"] + name, h.rfile, length)
    LOG(event="library-upload", library=kind, user=user["username"], name=name, bytes=length)
    return h.send_json(200, {"ok": True, "name": name, "size": length})


def _download(kind, state, url):
    """A file from a URL into a library, in parts as it comes; its progress in state."""
    lib = LIBRARIES[kind]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "coder-platform"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or -1)
            if total < 0:
                raise ValueError("the server does not say how large the file is (no Content-Length)")
            if total > lib["maxBytes"]:
                raise ValueError("it is %s, more than the %s a%s %s may be" % (
                    human(total), human(lib["maxBytes"]), "n" if lib["noun"][0] in "AEIOU" else "", lib["noun"]))
            state["total"] = total

            def progress(n):
                state["bytes"] = n
            client().put_large(bucket(), lib["prefix"] + state["name"], resp, total, progress=progress)
        state["done"] = True
        LOG(event="library-import", library=kind, user=state["by"], name=state["name"], url=url,
            bytes=state.get("total"))
    except Exception as e:  # noqa: BLE001 - shown in the library until dismissed by the next import of the name
        state["error"] = str(e)[:300]
        LOG(event="library-import-failed", library=kind, user=state["by"], name=state["name"], error=str(e)[:300])


def library_import(kind, user, body):
    lib = LIBRARIES[kind]
    url = str(body.get("url") or "").strip()
    if not re.match(r"^https?://[^\s]+$", url):
        raise ValueError("An http:// or https:// address of the %s." % lib["noun"])
    name = library_name(kind, body.get("name") or
                        urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]))
    with _lock:
        cur = _imports.get((kind, name))
        if cur and not cur.get("done") and not cur.get("error"):
            raise ValueError("%s is being imported already." % name)
        state = {"name": name, "url": url, "bytes": 0, "total": None, "error": None, "done": False,
                 "by": user["username"], "startedAt": time.time()}
        _imports[(kind, name)] = state
    threading.Thread(target=_download, args=(kind, state, url), name="library-import", daemon=True).start()
    return {"ok": True, "name": name}


def handle_libraries(h, method, path, query):
    """The library's API (/api/isos). True when it answered."""
    kind = next((k for k in LIBRARIES if path == BASE + "/api/" + k or path.startswith(BASE + "/api/" + k + "/")),
                None)
    if kind is None:
        return False
    lib = LIBRARIES[kind]
    root = BASE + "/api/" + kind
    if not ENABLED:
        h.send_json(404, {"error": "%s needs the Cloud Drive's storage (global.userStorage)." %
                                   (lib["title"][0].upper() + lib["title"][1:])})
        return True
    if method != "GET" and not upload_csrf_ok(h):
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user()
    if err:
        return True
    q = dict(urllib.parse.parse_qsl(query or "", keep_blank_values=True))
    try:
        if method == "GET" and path == root:
            return h.send_json(200, library(kind, user)) or True
        if not (CAN_EDIT and CAN_EDIT(user)):
            raise PermissionError
        if method == "PUT" and path == root + "/upload":
            library_upload(kind, h, user, q.get("name", ""))
        elif method == "POST" and path == root + "/import":
            h.send_json(200, library_import(kind, user, read_json(h)))
        elif method == "POST" and path == root + "/delete":
            body = read_json(h)
            name = library_name(kind, body.get("name"))
            client().delete(bucket(), lib["prefix"] + name)
            with _lock:
                _imports.pop((kind, name), None)
            LOG(event="library-delete", library=kind, user=user["username"], name=name)
            h.send_json(200, {"ok": True})
        else:
            h.send_json(404, {"error": "not found"})
    except ValueError as e:
        h.send_json(400, {"error": str(e)})
    except PermissionError:
        h.send_json(403, {"error": "Only admins and template admins change %s." % lib["title"]})
    except s3client.S3Error as e:
        LOG(event="library-s3-failed", library=kind, user=user["username"], error=str(e)[:300])
        h.send_json(502, {"error": "The library's storage answered: %s" % (e.message or e.code or e.status)})
    except (OSError, RuntimeError) as e:
        h.send_json(503, {"error": "The library's storage could not be reached: %s" % str(e)[:200]})
    return True


# ---------------------------------------------------------------------------------------------------- mounts
# The Cloud Drive mounted into a folder of one of the owner's workspaces: clouddrive_cli.py (the workspace's own
# `cloud-drive` command, installed by the template) run there through exec, as the workspace's user, with --json. It
# links the Cloud Drive's entries into the folder (folders of the same name merged); a file of the same name halts it
# until the owner chooses: keep both (data-(cloud_drive).csv) or overwrite (all, or each occurrence). The code is sent
# with each call, so a workspace of an older template version can mount too.
CLI_BOOT = ("import sys; n = int(sys.argv[1]); code = sys.stdin.buffer.read(n).decode(); "
            "sys.argv = ['cloud-drive'] + sys.argv[2:]; "
            "exec(compile(code, 'cloud-drive', 'exec'), {'__name__': '__main__'})")
MOUNT_MODES = ("keep-both", "overwrite-all", "ask")
MOUNT_DECISIONS_MAX = 100000


def _cli_text():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "clouddrive_cli.py"), "rb") as f:
        return f.read()


def _mount_workspace(h, user, wid):
    """(workspace, pod) of one of the caller's running workspaces that has their Cloud Drive."""
    if not WORKSPACE_ID_RE.match(wid or ""):
        raise ValueError("Choose one of your workspaces.")
    ws = WORKSPACE_INFO(h.token(), wid) if WORKSPACE_INFO else None
    if not ws:
        raise ValueError("There is no such workspace.")
    if ws.get("owner_id") != user["id"]:
        raise PermissionError
    if wid in shared_now():
        raise ValueError("That workspace is shared with others: your Cloud Drive is not in it.")
    found = _source_pod(wid)
    if not found:
        raise ValueError("%s is not running: start it to mount your Cloud Drive there." % ws.get("name"))
    return ws, found[0]


def run_cli(pod, args, stdin=b"", timeout=180):
    """The workspace's cloud-drive command: (exit code, its JSON answer)."""
    code = _cli_text()
    rc, out, err = kexec.exec_in(KUBE, NAMESPACE, pod, SOURCE_CONTAINER,
                                 ["python3", "-c", CLI_BOOT, str(len(code))] + args + ["--json"],
                                 timeout=timeout, stdin=code + stdin)
    try:
        result = json.loads(out.strip().splitlines()[-1]) if out.strip() else None
    except ValueError:
        result = None
    if result is None:
        raise RuntimeError("the workspace answered: %s" % (err or out or "exit %s" % rc).strip()[-300:])
    if isinstance(result, dict) and result.get("error"):
        raise ValueError(result["error"])
    return rc, result


def clean_mount_path(path):
    path = str(path or "").strip()
    if not path or len(path) > 1024 or any(ord(c) < 32 for c in path):
        raise ValueError("A folder: absolute, or relative to the workspace's home (/home/coder).")
    return path


def mounts_view(h, user, wid):
    ws, pod = _mount_workspace(h, user, wid)
    _, r = run_cli(pod, ["list"])
    return dict(r, workspace=wid, name=ws.get("name"))


def mount_plan(h, user, body):
    _, pod = _mount_workspace(h, user, str(body.get("workspace") or ""))
    return run_cli(pod, ["plan", clean_mount_path(body.get("path"))])[1]


def mount_apply(h, user, body):
    ws, pod = _mount_workspace(h, user, str(body.get("workspace") or ""))
    path = clean_mount_path(body.get("path"))
    mode = body.get("mode")
    if mode not in MOUNT_MODES:
        raise ValueError("How to resolve files of the same name: " + ", ".join(MOUNT_MODES))
    decisions = body.get("decisions") or {}
    if not isinstance(decisions, dict) or len(decisions) > MOUNT_DECISIONS_MAX or not all(
            isinstance(k, str) and v in ("overwrite", "keep") for k, v in decisions.items()):
        raise ValueError("Each collision: overwrite or keep (both).")
    answers = json.dumps(decisions).encode()
    # exec's stdin never ends (v4): the command reads exactly this many bytes of it
    _, r = run_cli(pod, ["apply", path, "--mode", mode, "--decisions=-:%d" % len(answers)], stdin=answers)
    if not r.get("halted"):
        LOG(event="cloud-drive-mount", user=user["username"], workspace=ws.get("name"), path=r.get("target"),
            mode=mode, linked=r.get("linked"), kept_both=len(r.get("keptBoth") or []),
            overwritten=len(r.get("overwritten") or []))
    return r


def mount_remove(h, user, body):
    ws, pod = _mount_workspace(h, user, str(body.get("workspace") or ""))
    _, r = run_cli(pod, ["unmount", clean_mount_path(body.get("path"))])
    LOG(event="cloud-drive-unmount", user=user["username"], workspace=ws.get("name"), path=r.get("target"),
        restored=r.get("restored"))
    return r


# The routes that read or write a Cloud Drive's files: a shared one's too (?drive=).
FILE_ROUTES = {BASE + "/api/safe/list", BASE + "/api/safe/glance", BASE + "/api/safe/download",
               BASE + "/api/safe/upload", BASE + "/api/safe/folder", BASE + "/api/safe/delete"}
# What an admin may do in another account's Cloud Drive (?drive=, no share of it): read.
ADMIN_VIEW_ROUTES = {BASE + "/api/safe/list", BASE + "/api/safe/glance", BASE + "/api/safe/download"}


def handle(h, method, path, query):
    """True when it answered."""
    if not path.startswith(BASE + "/api/safe"):
        return False
    if not ENABLED:
        h.send_json(404, {"error": "The Cloud Drive is not enabled on this deployment."})
        return True
    if method != "GET" and not upload_csrf_ok(h):
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user()
    if err:
        return True
    q = dict(urllib.parse.parse_qsl(query or "", keep_blank_values=True))
    # Turned off for everyone by an admin: the dashboard shows no drive (its summary says so); only the settings stay.
    if turned_off() is not None and path not in (BASE + "/api/safe/settings", BASE + "/api/safe/settings/enabled"):
        if method == "GET" and path == BASE + "/api/safe":
            h.send_json(200, {"enabled": False, "turnedOff": True})
        else:
            h.send_json(403, {"error": "The Cloud Drive is turned off for everyone (Admin Settings > Cloud Drive)."})
        return True
    shared = False
    admin_view = False
    share = None
    body = None
    viewer = user
    try:
        # Admins read any account's Cloud Drive (?drive=<owner id>, read only: Accounts' share approvals, the chat
        # console) - but not one its owner encrypted, which stays theirs alone. Through a share of it, as anyone.
        if (q.get("drive") and q["drive"] != user["id"] and path in FILE_ROUTES and IS_ADMIN and IS_ADMIN(user)
                and not drivepeers.shares_of(user["id"], q["drive"])):
            owner_id = q["drive"]
            if not drivepeers.USER_ID_RE.match(owner_id):
                raise ValueError("drive: an account's id.")
            if method != "GET" or path not in ADMIN_VIEW_ROUTES:
                raise PermissionError("Admins only read another account's Cloud Drive.")
            if encryption_on(owner_id):
                raise PermissionError("Its owner encrypted this Cloud Drive: only they open it.")
            LOG(event="cloud-drive-admin-view", admin=user["username"], owner=owner_id,
                route=path[len(BASE + "/api/safe/"):], path=q.get("path", ""))
            user = {"id": owner_id, "username": "%s (admin view)" % user["username"]}
            admin_view = True
        # What of a Cloud Drive is shared with the caller (drivepeers): its owner's files, through the same file routes
        # (?drive=<owner id>), as far as a share reaches (drivepeers.access_at, for each path): read with any, written
        # only with one shared read and write; a shared folder or file itself stays (only its owner deletes it).
        elif q.get("drive") and q["drive"] != user["id"] and path in FILE_ROUTES:
            owner_id = q["drive"]
            mine = drivepeers.shares_of(user["id"], owner_id)
            if not mine:
                raise PermissionError("That Cloud Drive is not shared with you (any more).")
            if method == "POST":
                body = read_json(h)
            target = clean_path(str((body or {}).get("path", "")) if method == "POST" else q.get("path", ""))
            if path == BASE + "/api/safe/glance":
                if q.get("share"):
                    share = next((x for x in mine if x["id"] == q["share"]), None)
                    if not share:
                        raise PermissionError("That is not shared with you (any more).")
                elif not any(x["kind"] == "drive" for x in mine):
                    raise PermissionError("Only parts of that Cloud Drive are shared with you.")
            elif path != BASE + "/api/safe/list":
                access = drivepeers.access_at(user["id"], owner_id, target)
                if not access:
                    raise PermissionError("That is not shared with you.")
                if method != "GET":
                    if access != "write":
                        raise PermissionError("That is shared with you read only.")
                    whole = any(x["kind"] == "drive" and x["access"] == "write" for x in mine)
                    if path != BASE + "/api/safe/upload" and not whole and any(x["path"] == target for x in mine):
                        raise PermissionError("That is what is shared with you: only its owner removes it.")
            user = {"id": owner_id, "username": "%s (shared)" % user["username"]}
            shared = True
        if method == "GET" and path == BASE + "/api/safe":
            h.send_json(200, summary(user))
        elif method == "GET" and path == BASE + "/api/safe/list":
            h.send_json(200, shared_listing(user["id"], viewer["id"], q.get("path", "")) if shared else
                        {**listing(user, q.get("path", "")), "access": "read", "adminView": True} if admin_view else
                        listing(user, q.get("path", "")))
        elif method == "GET" and path == BASE + "/api/safe/glance":
            h.send_json(200, glance(user, (drivepeers.USER_BY_ID and drivepeers.USER_BY_ID(user["id"]) or
                                           {"id": user["id"]}) if shared or admin_view else None, share))
        elif method == "GET" and path == BASE + "/api/safe/download":
            download(h, user, q.get("path", ""))
        elif method == "PUT" and path == BASE + "/api/safe/upload":
            upload(h, user, q.get("path", ""))
        elif method == "POST" and path == BASE + "/api/safe/folder":
            h.send_json(200, make_folder(user, (body if body is not None else read_json(h)).get("path", "")))
        elif method == "POST" and path == BASE + "/api/safe/delete":
            h.send_json(200, delete(user, str((body if body is not None else read_json(h)).get("path", ""))))
        elif method == "GET" and path == BASE + "/api/safe/settings":
            h.send_json(200, settings_view(user, fresh=q.get("check") == "1"))
        elif method == "POST" and path == BASE + "/api/safe/settings":
            h.send_json(200, save_settings(user, read_json(h)))
        elif method == "GET" and path == BASE + "/api/safe/activity":
            h.send_json(200, activity(user))
        elif method == "POST" and path == BASE + "/api/safe/settings/enabled":
            h.send_json(200, save_enabled(user, read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/settings/quota":
            h.send_json(200, save_quota(user, read_json(h)))
        elif method == "GET" and path == BASE + "/api/safe/connections":
            h.send_json(200, connections(user))
        elif method == "GET" and path == BASE + "/api/safe/encryption":
            h.send_json(200, encryption_view(user))
        elif method == "POST" and path == BASE + "/api/safe/encryption/prepare":
            h.send_json(200, prepare_encryption(user, read_json(h, limit=65536)))
        elif method == "POST" and path == BASE + "/api/safe/encryption/enable":
            h.send_json(200, enable_encryption(user, read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/encryption/disable":
            h.send_json(200, disable_encryption(user, read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/encryption/resume":
            h.send_json(200, resume_encryption(user))
        elif method == "POST" and path == BASE + "/api/safe/source":
            h.send_json(200, set_source(h, user, read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/source/clear":
            h.send_json(200, clear_source(user))
        elif method == "GET" and path == BASE + "/api/safe/source/guard":
            h.send_json(200, source_guard(user, q.get("workspace", "")))
        elif method == "POST" and path == BASE + "/api/safe/source/release":
            h.send_json(200, release_source(user, read_json(h)))
        elif method == "GET" and path == BASE + "/api/safe/mounts":
            h.send_json(200, mounts_view(h, user, q.get("workspace", "")))
        elif method == "POST" and path == BASE + "/api/safe/mounts/plan":
            h.send_json(200, mount_plan(h, user, read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/mounts/apply":
            h.send_json(200, mount_apply(h, user, read_json(h, limit=16 * 1024 * 1024)))
        elif method == "POST" and path == BASE + "/api/safe/mounts/unmount":
            h.send_json(200, mount_remove(h, user, read_json(h)))
        elif path == BASE + "/api/safe/peers" or path.startswith(BASE + "/api/safe/peers/"):
            drivepeers.handle(h, method, path, user, read_json)
        elif method == "POST" and path.startswith(BASE + "/api/safe/connections/"):
            h.send_json(200, set_connected(h, user, path[len(BASE + "/api/safe/connections/"):], read_json(h)))
        elif method == "POST" and path == BASE + "/api/safe/settings/test":
            if not (IS_ADMIN and IS_ADMIN(user)):
                raise PermissionError
            cur = load_custom() or {}
            h.send_json(200, check(clean_backend(read_json(h), keep_secret=cur.get("secretKey", "")
                                                 or (chart_backend()["secretKey"] if not cur else ""))))
        else:
            h.send_json(404, {"error": "not found"})
    except ValueError as e:
        h.send_json(400, {"error": str(e)})
    except PermissionError as e:
        h.send_json(403, {"error": "Only admins change where the Cloud Drive keeps files." if "/settings" in path
                          else str(e) or "Not yours."})
    except DriveUnavailable as e:
        h.send_json(503, {"error": "Its owner's Cloud Drive cannot be reached now (it is being re-encrypted, or "
                                   "kept in a workspace that is stopped): try again later." if shared else str(e)})
    except s3client.S3Error as e:
        if e.status == 404:
            h.send_json(404, {"error": "It is not in your Cloud Drive (any more)."})
        else:
            LOG(event="safe-s3-failed", user=user["username"], error=str(e)[:300])
            h.send_json(502, {"error": "The Cloud Drive's storage answered: %s" % (e.message or e.code or e.status)})
    except (OSError, RuntimeError) as e:
        LOG(event="safe-failed", user=user["username"], error=str(e)[:300])
        h.send_json(503, {"error": ("The workspace could not be reached: %s" if "/mounts" in path else
                                    "The Cloud Drive's storage could not be reached: %s") % str(e)[:200]})
    return True
