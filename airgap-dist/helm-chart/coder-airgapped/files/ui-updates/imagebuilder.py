"""Images view (Templates > Images): workspace images built in the cluster, for workspace templates.

Imported by ui-service.py (the API below), and run on its own by the build and scan Jobs:
    python3 imagebuilder.py fetch-context URL DIR     the build Job's first step: the build context into DIR
    python3 imagebuilder.py scan REF REPORT_URL       the scan Job: trivy + image checks + FIPS checks, posted back
    python3 imagebuilder.py scan-rootfs REF REPORT_URL DIR   the same on an image's files copied out of a node's copy
    python3 imagebuilder.py copa PLAN_URL              a pit stop's lap: trivy's report, Copa's patch (beside BuildKit)

An image is a definition (spec, below) that admins (and template admins) edit in a builder; a build turns it into
<registry>/coder-images/<name>:<version> with BuildKit rootless in a Job, then a scan Job reports on its security.
Workspace templates use it as localhost:5000/coder-images/<name>:<version> (BUILDER_PULL_PREFIX).

The image the workspace template runs (BUILDER_WORKSPACE_IMAGE) is an entry too, "coder-workspace" (TRACKED_ID): kept
to the image the platform deploys, scanned from the builder's copy of it (BUILDER_BASE_IMAGE) when it is new or changed,
and read-only here. Everyone sees its security report and its add-ons (/usr/share/coder-workspace/addons.json in it)
before building on it, or using it in an enclave.

    GET  /__coder-ui/api/images                         every image (anyone signed in; editing needs EDIT_ROLES)
    POST /__coder-ui/api/images {name, description, base}        a new image (a draft)
    GET  /__coder-ui/api/images/<id>                    one image, its spec, builds and last report
    POST /__coder-ui/api/images/<id> {spec?, description?}       save the builder's changes
    POST /__coder-ui/api/images/<id>/delete             the image, its files and its tags in the registry
    POST /__coder-ui/api/images/<id>/build              build the saved spec (a new version)
    POST /__coder-ui/api/images/<id>/pit {keys?, libraries, level, maxLevel, laps}   a pit stop: Copa patches it in
                                                        place, rescans, patches again (laps), puts it back on track
    GET  /__coder-ui/api/images/<id>/pit                its latest pit stop (also in the image's view, "pit")
    GET  /__coder-ui/api/images/<id>/builds/<n>         a build's progress, steps and log tail
    POST /__coder-ui/api/images/<id>/builds/<n>/cancel
    POST /__coder-ui/api/images/<id>/builds/<n>/delete  a finished scan's record (a rescan: its row, log and report)
    PUT  /__coder-ui/api/images/<id>/files/<kind>/<name>[?install=<id>]   upload a file (kind: deb | install | dotfile)
    POST /__coder-ui/api/images/<id>/files/delete {kind, name, install?}
    GET  /__coder-ui/api/images/<id>/download           the built image as a `docker load` tarball
    POST /__coder-ui/api/images/<id>/s3 {enabled}       automatic S3 backup on / off;  /s3/backup: now
    POST /__coder-ui/api/images/apt-check {packages}    which apt packages exist in the configured sources
    GET  /__coder-ui/api/images/apt-search?q=           package names for the builder's suggestions
    POST /__coder-ui/api/images/lint {script}           shellcheck;   /format {script}: shfmt -i 1
    POST /__coder-ui/api/images/dockerfile {spec}       the Dockerfile a spec makes (the builder's review step)
    GET/POST /__coder-ui/api/images/settings            apt sources and S3 (admins)
    POST /__coder-ui/api/images/import {name, description, ref, username?, password?}   an image copied from a registry
    PUT  /__coder-ui/api/images/import-upload?name=&description=&file=   an image from a `docker save` / OCI archive
    GET  /__coder-ui/api/images/in-use                  the images workspaces run now, and the templates' own
    GET  /__coder-ui/api/images/contents                what each image of ours holds (image-contents.json, written by
                                                        development/tools/image-contents.py): the Coder fork's tree
    GET  /__coder-ui/api/images/on-nodes                every image the cluster's nodes hold (preloaded or pulled)
    POST /__coder-ui/api/images/scan {image}            scan any image: in the cluster's registry, or on a node that
                                                        holds it (no registry needed: air-gapped clusters, preloaded
                                                        images); listed as a read-only entry with its report
    GET  /__coder-ui/internal/builds/<token>/context.tar    (build Job)   POST .../report (scan Job)

The workspace templates' Workspace image choices (ConfigMap IMAGES_CONFIGMAP, key "images", JSON, kept every
IMAGES_PUBLISH_SECONDS): {"registry": [{ref, name, version, description}] - every version built or imported here that
the registry still has - and "nodes": [refs] - the platform's workspace images (coder-workspace*) the nodes keep}; a
template offers its own image, these (the nodes' of its own image's repository only) and any other image entered.
"""

import base64
import datetime
import gzip
import hashlib
import hmac
import http.client
import io
import json
import lzma
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
import urllib.error
import urllib.parse
import urllib.request

import securitydata  # noqa: E402  (next to this file: the vulnerability databases and FIPS rules)

ENABLED = os.environ.get("IMAGE_BUILDER", "") == "true"
NAMESPACE = os.environ.get("BUILDER_NAMESPACE", "coder")
FILES = os.environ.get("BUILDER_FILES", "/builder")
REGISTRY = os.environ.get("BUILDER_REGISTRY", "coder-image-registry.coder.svc:5000")
PULL_PREFIX = os.environ.get("BUILDER_PULL_PREFIX", "localhost:5000")
BUILDKIT_IMAGE = os.environ.get("BUILDER_BUILDKIT_IMAGE", "docker.io/moby/buildkit:v0.33.0-rootless")
TOOLS_IMAGE = os.environ.get("BUILDER_TOOLS_IMAGE", "ghcr.io/user187x/coder-image-tools:1.0.0")
BASE_IMAGE = os.environ.get("BUILDER_BASE_IMAGE", "")
BASE_FALLBACK = os.environ.get("BUILDER_BASE_FALLBACK", "")
# The image the workspace template runs, as the template names it, and the template's name (for the tracked entry).
WORKSPACE_IMAGE = os.environ.get("BUILDER_WORKSPACE_IMAGE", "")
WORKSPACE_TEMPLATE = os.environ.get("BUILDER_WORKSPACE_TEMPLATE", "")
TRACKED_ID = "coder-workspace"
TRACKED_SYNC_SECONDS = 300
ADDONS_PATH = "usr/share/coder-workspace/addons.json"
SERVICE_URL = os.environ.get("BUILDER_SERVICE_URL", "http://coder-ui-updates.coder.svc").rstrip("/")
BUILD_CPU = os.environ.get("BUILDER_CPU", "4")
BUILD_MEMORY = os.environ.get("BUILDER_MEMORY", "8Gi")
BUILD_TIMEOUT = int(os.environ.get("BUILDER_TIMEOUT_MINUTES", "60") or 60)
DEFAULT_APT_SOURCES = os.environ.get("BUILDER_APT_SOURCES", "")
try:
    PULL_SECRETS = json.loads(os.environ.get("BUILDER_PULL_SECRETS", "") or "[]")
except ValueError:
    PULL_SECRETS = []
BASE = "/__coder-ui"
REPO = "coder-images"
# A scan on a node (an image no registry here holds): room for the image's files, copied out of it.
NODE_SCAN_DISK = os.environ.get("BUILDER_NODE_SCAN_DISK", "40Gi")
EDIT_EXTRA_ROLES = {"template-admin"}  # besides ADMIN_ROLES: who may create, edit, build and delete images

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")
INSTALL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
PKG_RE = re.compile(r"^[a-z0-9][a-z0-9+.-]+(?::[a-z0-9-]+)?(?:=[A-Za-z0-9.+:~-]+)?$")
FILE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,120}$")
DOTFILE_RE = re.compile(r"^(?!.*\.\.)[A-Za-z0-9._-][A-Za-z0-9._/-]{0,199}$")
MAX_UPLOAD = 2 * 1024 * 1024 * 1024
# Imports: the largest archive taken, and what an image reference may look like (registry/repo:tag or @digest).
IMPORT_MAX = int(float(os.environ.get("BUILDER_IMPORT_MAX_GIB", "20")) * 1024 ** 3)
REF_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:/[a-z0-9][a-z0-9._-]*)+(?::[A-Za-z0-9._-]{1,128}|@sha256:[0-9a-f]{64})$")
# The templates the chart pushes (BUILDER_TEMPLATES: [{name, displayName, image}]): the In use list, and where a
# workspace can be made on an image (their Workspace image parameter).
try:
    TEMPLATES = [t for t in json.loads(os.environ.get("BUILDER_TEMPLATES", "") or "[]") if isinstance(t, dict)]
except ValueError:
    TEMPLATES = []
DESKTOPS = ("keep", "xfce", "gnome", "none")
HARDENING = {
    "purgeDocs": "Remove documentation, man pages and caches (smaller image, less to scan)",
    "noSudo": "No sudo for the workspace user (coder)",
    "lockRoot": "Lock the root account's password",
    "noSetuid": "Remove the setuid / setgid bit from every program",
    "noCompilers": "Remove compilers (gcc, g++, make): nothing can be built in the workspace",
    "strictUmask": "Default file permissions 027 (new files not readable by others)",
    "noCoreDumps": "No core dumps (they can hold secrets from memory)",
    "sshHardening": "SSH: no root login, no passwords (keys only), modern ciphers",
}

LOG = None  # set by setup(): ui-service's log()
HTTP_JSON = None
KUBE = None


def setup(log, http_json, kube):
    global LOG, HTTP_JSON, KUBE
    LOG, HTTP_JSON, KUBE = log, http_json, kube


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- storage
class DB:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS images (
                  id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL,
                  created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL,
                  version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', ref TEXT, digest TEXT,
                  size INTEGER, built_at TEXT, built_by TEXT, report TEXT, s3 TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS builds (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, image_id TEXT NOT NULL, version INTEGER NOT NULL,
                  status TEXT NOT NULL, stage TEXT, progress REAL NOT NULL DEFAULT 0, message TEXT,
                  steps TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL, finished_at TEXT, by TEXT,
                  token TEXT NOT NULL, job TEXT, error TEXT, spec TEXT NOT NULL, log TEXT NOT NULL DEFAULT '');
                CREATE INDEX IF NOT EXISTS builds_image ON builds(image_id, id);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """
            )
            # a restart ends the builds it was following: they show as interrupted
            db.execute(
                "UPDATE builds SET status='failed', error='The platform service restarted during the build.', "
                "finished_at=? WHERE status IN ('queued','building','pushing','scanning')", (now(),))
            db.execute("UPDATE images SET status=CASE WHEN ref IS NULL THEN 'draft' ELSE 'ready' END "
                       "WHERE status='building'")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def setting(self, key, default=None):
        with self.connect() as db:
            r = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(r[0]) if r else default

    def put_setting(self, key, value):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET "
                       "value=excluded.value", (key, json.dumps(value)))

    @staticmethod
    def _image(r, full=False):
        out = {
            "id": r["id"], "name": r["id"], "description": r["description"], "createdBy": r["created_by"],
            "createdAt": r["created_at"], "updatedBy": r["updated_by"], "updatedAt": r["updated_at"],
            "version": r["version"], "status": r["status"], "ref": r["ref"], "digest": r["digest"],
            "size": r["size"], "builtAt": r["built_at"], "builtBy": r["built_by"],
            "pullRef": "%s/%s/%s:%d" % (PULL_PREFIX, REPO, r["id"], r["version"]) if r["ref"] else None,
            "s3": json.loads(r["s3"] or "{}"),
        }
        spec = json.loads(r["spec"])
        tracked = spec.get("tracked")
        out["tracked"] = tracked or None
        out["imported"] = spec.get("imported") or None
        out["scanned"] = spec.get("scanned") or None
        if out["scanned"]:
            # a scanned image is the image itself, wherever it is
            out["pullRef"] = out["scanned"].get("image")
        if tracked:
            # what workspace templates name: the image itself, not the builder's copy that is scanned
            out["pullRef"] = tracked.get("image") if r["ref"] else None
        report = json.loads(r["report"]) if r["report"] else None
        out["base"] = spec.get("base") or {"kind": "workspace"}
        out["counts"] = {"packages": len(spec.get("packages") or []), "debs": len(spec.get("debs") or []),
                         "installations": len(spec.get("installations") or []),
                         "remove": len(spec.get("remove") or [])}
        out["desktop"] = spec.get("desktop") or "keep"
        out["summary"] = report_summary(report)
        if full:
            out["spec"] = spec
            out["report"] = report
        return out

    def images(self):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM images ORDER BY updated_at DESC").fetchall()
        return [self._image(r) for r in rows]

    def image(self, image_id, full=True):
        with self.connect() as db:
            r = db.execute("SELECT * FROM images WHERE id=?", (image_id,)).fetchone()
        return self._image(r, full) if r else None

    def create(self, image_id, description, spec, user):
        t = now()
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO images (id, description, spec, created_by, created_at, updated_by, updated_at) "
                       "VALUES (?,?,?,?,?,?,?)", (image_id, description, json.dumps(spec), user, t, user, t))

    def save(self, image_id, user, spec=None, description=None):
        sets, args = ["updated_by=?", "updated_at=?"], [user, now()]
        if spec is not None:
            sets.append("spec=?")
            args.append(json.dumps(spec))
        if description is not None:
            sets.append("description=?")
            args.append(description)
        with self.lock, self.connect() as db:
            db.execute("UPDATE images SET %s WHERE id=?" % ", ".join(sets), (*args, image_id))

    def set(self, image_id, **fields):
        cols = {"status": "status", "ref": "ref", "digest": "digest", "size": "size", "builtAt": "built_at",
                "builtBy": "built_by", "version": "version"}
        sets, args = [], []
        for k, v in fields.items():
            if k == "report":
                sets.append("report=?")
                args.append(json.dumps(v) if v is not None else None)
            elif k == "s3":
                sets.append("s3=?")
                args.append(json.dumps(v))
            else:
                sets.append("%s=?" % cols[k])
                args.append(v)
        with self.lock, self.connect() as db:
            db.execute("UPDATE images SET %s WHERE id=?" % ", ".join(sets), (*args, image_id))

    def delete(self, image_id):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM builds WHERE image_id=?", (image_id,))
            db.execute("DELETE FROM images WHERE id=?", (image_id,))

    # builds
    def new_build(self, image_id, version, spec, user):
        token = secrets.token_urlsafe(32)
        with self.lock, self.connect() as db:
            cur = db.execute("INSERT INTO builds (image_id, version, status, stage, started_at, by, token, spec) "
                             "VALUES (?,?,?,?,?,?,?,?)",
                             (image_id, version, "queued", "prepare", now(), user, token, json.dumps(spec)))
            return cur.lastrowid, token

    def build(self, build_id=None, token=None):
        with self.connect() as db:
            r = (db.execute("SELECT * FROM builds WHERE id=?", (build_id,)) if build_id is not None
                 else db.execute("SELECT * FROM builds WHERE token=?", (token,))).fetchone()
        return dict(r) if r else None

    def update_build(self, build_id, **fields):
        if "steps" in fields:
            fields["steps"] = json.dumps(fields["steps"])
        sets = ", ".join("%s=?" % k for k in fields)
        with self.lock, self.connect() as db:
            db.execute("UPDATE builds SET %s WHERE id=?" % sets, (*fields.values(), build_id))

    def delete_build(self, build_id):
        """A build's row (its log with it) and the report its scan posted (a setting of its own)."""
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM builds WHERE id=?", (build_id,))
            db.execute("DELETE FROM settings WHERE key=?", ("report-%d" % build_id,))

    def append_log(self, build_id, text, limit=1024 * 1024):
        with self.lock, self.connect() as db:
            r = db.execute("SELECT log FROM builds WHERE id=?", (build_id,)).fetchone()
            log = ((r[0] if r else "") + text)[-limit:]
            db.execute("UPDATE builds SET log=? WHERE id=?", (log, build_id))

    def builds(self, image_id, limit=20):
        with self.connect() as db:
            rows = db.execute("SELECT id, version, status, stage, progress, message, started_at, finished_at, by, "
                              "error, steps FROM builds WHERE image_id=? ORDER BY id DESC LIMIT ?",
                              (image_id, limit)).fetchall()
        return [{"id": r["id"], "version": r["version"], "status": r["status"], "stage": r["stage"],
                 "progress": r["progress"], "message": r["message"], "startedAt": r["started_at"],
                 "finishedAt": r["finished_at"], "by": r["by"], "error": r["error"],
                 "scanOnly": scan_only(r["steps"])} for r in rows]

    def active_build(self, image_id):
        with self.connect() as db:
            r = db.execute("SELECT id FROM builds WHERE image_id=? AND status IN "
                           "('queued','building','pushing','scanning') ORDER BY id DESC LIMIT 1",
                           (image_id,)).fetchone()
        return r[0] if r else None


STORE = None


def image_dir(image_id):
    return os.path.join(FILES, "images", image_id)


def file_path(image_id, kind, name, install=None):
    if kind == "deb":
        return os.path.join(image_dir(image_id), "debs", name)
    if kind == "install":
        return os.path.join(image_dir(image_id), "installs", install, name)
    if kind == "dotfile":
        return os.path.join(image_dir(image_id), "dotfiles", name)
    raise ValueError("unknown kind")


# --------------------------------------------------------------------------- the spec
def empty_spec(base=None):
    return {"base": base or {"kind": "workspace"}, "packages": [], "debs": [], "installations": [], "remove": [],
            "hardening": {"script": ""}, "desktop": "keep", "fips": False,
            "config": {"aliases": "", "functions": "", "profile": "", "dotfiles": []}}


def text(value, limit, what):
    value = "" if value is None else value
    if not isinstance(value, str):
        raise ValueError("%s must be text." % what)
    if len(value.encode()) > limit:
        raise ValueError("%s is too long (at most %d KB)." % (what, limit // 1024))
    return value


def clean_spec(spec, image_id):
    """The builder's spec, checked: anything malformed is refused with a reason a person can act on."""
    if not isinstance(spec, dict):
        raise ValueError("Expected an image definition.")
    out = empty_spec()
    base = spec.get("base") or {"kind": "workspace"}
    if base.get("kind") == "image" and base.get("id") != TRACKED_ID:  # the tracked entry is the workspace base
        other = str(base.get("id") or "")
        if other == image_id or not NAME_RE.match(other):
            raise ValueError("Pick another built image as the base.")
        out["base"] = {"kind": "image", "id": other}
    packages = spec.get("packages") or []
    if not isinstance(packages, list) or len(packages) > 500:
        raise ValueError("At most 500 packages.")
    seen = set()
    for p in packages:
        p = str(p).strip()
        if not PKG_RE.match(p):
            raise ValueError("'%s' is not an apt package name." % p[:60])
        if p not in seen:
            seen.add(p)
            out["packages"].append(p)
    for d in spec.get("debs") or []:
        n = str((d or {}).get("name") or "")
        if FILE_NAME_RE.match(n) and n.endswith(".deb") and os.path.isfile(file_path(image_id, "deb", n)):
            out["debs"].append({"name": n, "size": os.path.getsize(file_path(image_id, "deb", n))})
    installs = spec.get("installations") or []
    if not isinstance(installs, list) or len(installs) > 50:
        raise ValueError("At most 50 installations.")
    ids = set()
    for i in installs:
        iid = str((i or {}).get("id") or "")
        if not INSTALL_ID_RE.match(iid) or iid in ids:
            raise ValueError("An installation has no valid id.")
        ids.add(iid)
        name = text(i.get("name"), 120, "An installation's name").strip() or iid
        files = []
        for f in i.get("files") or []:
            n = str((f or {}).get("name") or "")
            p = file_path(image_id, "install", n, iid) if FILE_NAME_RE.match(n) else None
            if p and os.path.isfile(p):
                files.append({"name": n, "size": os.path.getsize(p)})
        out["installations"].append({"id": iid, "name": name, "script": text(i.get("script"), 256 * 1024,
                                                                                "%s's script" % name),
                                     "files": files})
    for p in spec.get("remove") or []:
        p = str(p).strip()
        if not PKG_RE.match(p):
            raise ValueError("'%s' is not an apt package name." % p[:60])
        if p not in out["remove"]:
            out["remove"].append(p)
    hardening = spec.get("hardening") or {}
    for key in HARDENING:
        if hardening.get(key):
            out["hardening"][key] = True
    out["hardening"]["script"] = text(hardening.get("script"), 128 * 1024, "The hardening script")
    if spec.get("desktop") in DESKTOPS:
        out["desktop"] = spec["desktop"]
    out["fips"] = bool(spec.get("fips"))
    config = spec.get("config") or {}
    for key, what in (("aliases", "Aliases"), ("functions", "Functions"), ("profile", "Environment")):
        out["config"][key] = text(config.get(key), 64 * 1024, what)
    for d in config.get("dotfiles") or []:
        path = str((d or {}).get("path") or "").lstrip("/")
        if not DOTFILE_RE.match(path):
            raise ValueError("'%s' is not a path inside the home directory." % path[:80])
        out["config"]["dotfiles"].append({"path": path, "content": text(d.get("content"), 256 * 1024, path)})
    if len(out["config"]["dotfiles"]) > 50:
        raise ValueError("At most 50 dotfiles.")
    return out


def spec_problems(spec, apt_results=None):
    """What stops a build: packages apt doesn't have (the GNOME desktop's too), empty installation scripts. Offline
    with no apt mirror, nothing is in the sources: such builds stop here, before they start, rather than failing
    halfway."""
    out = []
    gnome_missing = []
    for name, r in (apt_results or {}).items():
        if r.get("available"):
            continue
        if spec.get("desktop") == "gnome" and name in GNOME and name not in (spec.get("packages") or []):
            gnome_missing.append(name)
        else:
            out.append("'%s' is not in the apt sources: upload its .deb or install it manually." % name)
    if gnome_missing:
        out.append("The GNOME desktop needs packages that are not in the apt sources (%s): set your apt mirror in "
                   "Images > Settings, or keep the XFCE desktop (it needs no download)." % ", ".join(gnome_missing))
    for i in spec.get("installations") or []:
        if not i["script"].strip():
            out.append("The installation '%s' has no script." % i["name"])
    return out


# --------------------------------------------------------------------------- apt package check
def parse_sources(text_):
    """deb822 stanzas (or one-line "deb URI suite comp..." entries) -> [(uri, suite, [components])]."""
    out = []
    for line in text_.splitlines():
        line = line.strip()
        if line.startswith("deb ") and not line.startswith("deb-src"):
            parts = re.sub(r"\[[^]]*\]", "", line).split()
            if len(parts) >= 3:
                out.append((parts[1].rstrip("/"), parts[2], parts[3:] or ["main"]))
    for stanza in re.split(r"\n\s*\n", text_):
        fields = {}
        for line in stanza.splitlines():
            if ":" in line and not line.startswith((" ", "\t", "#")):
                k, v = line.split(":", 1)
                fields[k.strip().lower()] = v.strip()
        if "uris" in fields and "deb" in fields.get("types", "deb").split():
            for uri in fields["uris"].split():
                for suite in fields.get("suites", "").split():
                    out.append((uri.rstrip("/"), suite, fields.get("components", "main").split()))
    return out


class AptIndex:
    """Package names in the configured apt sources (amd64), from their Packages indices: fetched on first use and
    kept a day (on the builder volume too, so a restart doesn't fetch them again)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.packages, self.loaded_at, self.errors, self.sources_key = {}, 0, [], None

    def sources(self):
        return (STORE.setting("aptSources") if STORE else None) or DEFAULT_APT_SOURCES

    def load(self, force=False):
        text_ = self.sources()
        key = hashlib.sha256(text_.encode()).hexdigest()[:16]
        with self.lock:
            if not force and self.sources_key == key and time.time() - self.loaded_at < 86400 and self.packages:
                return
            cache = os.path.join(FILES, "apt-cache", key + ".json")
            if not force and os.path.isfile(cache) and time.time() - os.path.getmtime(cache) < 86400:
                with open(cache) as f:
                    saved = json.load(f)
                self.packages, self.errors = saved["packages"], saved["errors"]
                self.loaded_at, self.sources_key = os.path.getmtime(cache), key
                return
            packages, errors = {}, []
            for uri, suite, comps in parse_sources(text_):
                for comp in comps:
                    for ext, opener in (("xz", lzma.open), ("gz", gzip.open)):
                        url = "%s/dists/%s/%s/binary-amd64/Packages.%s" % (uri, suite, comp, ext)
                        try:
                            # 20 s per socket operation: an unreachable source (an air gap with no mirror)
                            # answers in seconds, not minutes; a big list still streams.
                            with urllib.request.urlopen(url, timeout=20) as r:
                                # streamed: the uncompressed lists are hundreds of MB
                                with opener(r, "rt", encoding="utf-8", errors="replace") as lines:
                                    self._parse(lines, packages)
                            break
                        except urllib.error.HTTPError as e:
                            if e.code != 404:
                                errors.append("%s: HTTP %s" % (url, e.code))
                                break
                        except Exception as e:  # noqa: BLE001 - unreachable source: reported
                            errors.append("%s: %s" % (url, str(getattr(e, "reason", e))[:120]))
                            break
            self.packages, self.errors, self.loaded_at, self.sources_key = packages, errors, time.time(), key
            if packages:
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                with open(cache + ".tmp", "w") as f:
                    json.dump({"packages": packages, "errors": errors}, f)
                os.replace(cache + ".tmp", cache)

    @staticmethod
    def _parse(lines, packages):
        """Packages-file stanzas from an iterable of lines: name -> version, short description, section."""
        fields = {}

        def flush():
            name = fields.get("Package")
            if name:
                prev = packages.get(name)
                if not prev or prev.get("virtual"):
                    packages[name] = {"v": fields.get("Version", ""), "d": fields.get("Description", "")[:100],
                                      "s": fields.get("Section", "")}
                for p in fields.get("Provides", "").split(","):
                    p = p.strip().split(" ")[0]
                    if p and p not in packages:
                        packages[p] = {"virtual": True, "by": name}
            fields.clear()

        for line in lines:
            if line in ("\n", ""):
                flush()
            elif line[0] not in " \t":
                k, _, v = line.partition(":")
                if k in ("Package", "Version", "Description", "Section", "Provides"):
                    fields[k] = v.strip()
        flush()

    def status(self):
        return {"sources": len(parse_sources(self.sources())), "packages": len(self.packages),
                "loadedAt": datetime.datetime.fromtimestamp(self.loaded_at, datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ") if self.loaded_at else None, "errors": self.errors[:10]}

    def check(self, names):
        self.load()
        out = {}
        for raw in names:
            name = re.split(r"[:=]", raw, 1)[0]
            hit = self.packages.get(name)
            if hit and hit.get("virtual"):
                out[raw] = {"available": True, "virtual": True, "providedBy": hit["by"],
                            "description": "provided by %s" % hit["by"]}
            elif hit:
                out[raw] = {"available": True, "version": hit["v"], "description": hit["d"], "section": hit["s"]}
            else:
                out[raw] = {"available": False}
        return out

    def search(self, q, limit=25):
        self.load()
        q = q.lower().strip()
        if not q:
            return []
        starts = [n for n in self.packages if n.startswith(q) and not self.packages[n].get("virtual")]
        starts.sort(key=lambda n: (len(n), n))
        out = starts[:limit]
        if len(out) < limit:
            out += sorted(n for n in self.packages if q in n and not n.startswith(q)
                          and not self.packages[n].get("virtual"))[: limit - len(out)]
        return [{"name": n, "version": self.packages[n]["v"], "description": self.packages[n]["d"]} for n in out]


APT = AptIndex()


# --------------------------------------------------------------------------- scripts: lint and format
def lint(script):
    try:
        p = subprocess.run(["shellcheck", "-s", "bash", "-f", "json", "-"], input=script.encode(),
                           capture_output=True, timeout=15)
    except FileNotFoundError:
        return {"available": False, "issues": []}
    except subprocess.TimeoutExpired:
        return {"available": True, "issues": [], "error": "shellcheck took too long"}
    try:
        issues = json.loads(p.stdout or b"[]")
    except ValueError:
        return {"available": True, "issues": [], "error": p.stderr.decode()[:300]}
    return {"available": True, "issues": [
        {"line": i["line"], "column": i["column"], "endLine": i["endLine"], "endColumn": i["endColumn"],
         "level": i["level"], "code": "SC%d" % i["code"], "message": i["message"]} for i in issues]}


def fmt(script):
    try:
        p = subprocess.run(["shfmt", "-i", "1", "-ln", "bash", "-"], input=script.encode(), capture_output=True,
                           timeout=15)
    except FileNotFoundError:
        return {"available": False}
    if p.returncode != 0:
        return {"available": True, "error": p.stderr.decode().strip()[:400].replace("<standard input>", "line")}
    return {"available": True, "script": p.stdout.decode()}


# --------------------------------------------------------------------------- the Dockerfile
SH = "bash -euo pipefail -c"


def q(s):
    """A shell word, single-quoted."""
    return "'" + s.replace("'", "'\\''") + "'"


def custom_sources():
    """The admins' apt sources when they differ from the workspace image's own (an air-gapped mirror)."""
    s = STORE.setting("aptSources") if STORE else None
    return s if s and s.strip() != DEFAULT_APT_SOURCES.strip() else None


def hardening_script(spec):
    h, lines = spec["hardening"], []
    if h.get("purgeDocs"):
        lines += ["find /usr/share/doc -mindepth 2 ! -name copyright ! -type d -delete 2>/dev/null || true",
                  "rm -rf /usr/share/man/* /usr/share/info/* /var/cache/apt/* /var/lib/apt/lists/* /tmp/* "
                  "/root/.cache 2>/dev/null || true"]
    if h.get("noSudo"):
        lines += ["gpasswd -d coder sudo 2>/dev/null || true",
                  "grep -rl 'coder' /etc/sudoers.d 2>/dev/null | xargs -r rm -f",
                  "sed -i '/^coder\\b/d' /etc/sudoers 2>/dev/null || true"]
    if h.get("lockRoot"):
        lines += ["passwd -l root >/dev/null"]
    if h.get("noSetuid"):
        lines += ["find / -xdev \\( -perm -4000 -o -perm -2000 \\) -type f -exec chmod u-s,g-s {} + 2>/dev/null || true"]
    if h.get("noCompilers"):
        lines += ["apt-get purge -y --auto-remove 'gcc' 'gcc-[0-9]*' 'g++' 'g++-[0-9]*' make cpp 2>/dev/null || true"]
    if h.get("strictUmask"):
        lines += ["sed -i 's/^UMASK.*/UMASK\\t\\t027/' /etc/login.defs",
                  "echo 'umask 027' > /etc/profile.d/coder-umask.sh"]
    if h.get("noCoreDumps"):
        lines += ["mkdir -p /etc/security/limits.d", "echo '* hard core 0' > /etc/security/limits.d/coder-no-core.conf"]
    if h.get("sshHardening"):
        lines += ["if [ -d /etc/ssh ]; then mkdir -p /etc/ssh/sshd_config.d && printf '%s\\n' 'PermitRootLogin no' "
                  "'PasswordAuthentication no' 'KbdInteractiveAuthentication no' "
                  "'Ciphers aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr' "
                  "> /etc/ssh/sshd_config.d/coder-hardening.conf; fi",
                  "rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub"]
    return lines


def fips_script():
    """FIPS-aligned settings, from the FIPS rules in force (securitydata): SSH limited to their approved algorithms;
    OpenSSL's FIPS provider made the default when a validated module is installed (e.g. Ubuntu Pro's
    openssl-fips-module from your mirror); TLS at their minimum version."""
    rules = securitydata.rules()
    ssh = rules["ssh"]
    ciphers, macs, kex = (",".join(ssh[k]) for k in ("ciphers", "macs", "kex"))
    tls_min = rules["tls"]["minProtocol"]
    return [
        "mkdir -p /etc/ssh/ssh_config.d /etc/ssh/sshd_config.d",
        "printf '%s\\n' 'Ciphers " + ciphers + "' 'MACs " + macs + "' 'KexAlgorithms " + kex
        + "' > /etc/ssh/ssh_config.d/coder-fips.conf",
        "cp /etc/ssh/ssh_config.d/coder-fips.conf /etc/ssh/sshd_config.d/coder-fips.conf",
        "mod=$(ls /usr/lib/*/ossl-modules/fips.so 2>/dev/null | head -n1 || true)",
        "if [ -n \"$mod\" ]; then openssl fipsinstall -out /etc/ssl/fipsmodule.cnf -module \"$mod\" >/dev/null 2>&1 "
        "|| true; printf '%s\\n' '' '# Image builder: FIPS provider by default' '.include /etc/ssl/fipsmodule.cnf' "
        "'[coder_fips_sect]' 'default_properties = fips=yes' >> /etc/ssl/openssl.cnf; fi",
        "printf '%s\\n' '' '# Image builder: FIPS-aligned TLS' '[system_default_sect]' 'MinProtocol = " + tls_min + "' "
        "'CipherString = DEFAULT:@SECLEVEL=2' >> /etc/ssl/openssl.cnf",
        "mkdir -p /etc/coder-image && echo fips > /etc/coder-image/fips",
    ]


GNOME = ["gnome-session-flashback", "gnome-panel", "metacity", "gnome-terminal", "nautilus", "gnome-settings-daemon",
         "dbus-x11", "adwaita-icon-theme"]
GNOME_SESSION = """#!/bin/sh
# Image builder: the desktop the workspace template starts: GNOME Flashback (GNOME without 3D, fit for VNC). Started
# piece by piece: gnome-session needs systemd, which a container doesn't have.
export XDG_CURRENT_DESKTOP=GNOME-Flashback:GNOME XDG_SESSION_DESKTOP=gnome-flashback-metacity XDG_SESSION_TYPE=x11
export NO_AT_BRIDGE=1
[ -n "$DBUS_SESSION_BUS_ADDRESS" ] || exec dbus-run-session -- "$0" "$@"
for d in xsettings keyboard media-keys color a11y-settings housekeeping; do
  [ -x /usr/libexec/gsd-$d ] && /usr/libexec/gsd-$d &
done
gnome-flashback &
gnome-panel &
exec metacity
"""


def build_plan(spec):
    """The build's steps, in order: (key, label). They label the progress view and name the Dockerfile's RUN lines."""
    steps = [("prepare", "Preparing the build"), ("base", "Fetching the base image")]
    if custom_sources():
        steps.append(("sources", "Using your apt mirror"))
    if spec["packages"]:
        steps.append(("packages", "Installing %d apt package%s" % (len(spec["packages"]),
                                                                    "" if len(spec["packages"]) == 1 else "s")))
    if spec["debs"]:
        steps.append(("debs", "Installing %d uploaded .deb file%s" % (len(spec["debs"]),
                                                                       "" if len(spec["debs"]) == 1 else "s")))
    if spec["desktop"] in ("gnome", "none", "xfce") and spec["desktop"] != "keep":
        steps.append(("desktop", {"gnome": "Installing the GNOME desktop", "none": "Removing the desktop",
                                  "xfce": "Installing the XFCE desktop"}[spec["desktop"]]))
    for i in spec["installations"]:
        steps.append(("install-" + i["id"], "Installing %s" % i["name"]))
    if spec["remove"]:
        steps.append(("remove", "Removing %d package%s" % (len(spec["remove"]), "" if len(spec["remove"]) == 1 else "s")))
    c = spec["config"]
    if c["aliases"].strip() or c["functions"].strip() or c["profile"].strip() or c["dotfiles"]:
        steps.append(("config", "Adding your configuration and dotfiles"))
    if spec["fips"]:
        steps.append(("fips", "Applying FIPS-aligned crypto settings"))
    if hardening_script(spec) or spec["hardening"]["script"].strip():
        steps.append(("harden", "Hardening the image"))
    steps += [("finish", "Finishing the image"), ("push", "Pushing it to the registry"),
              ("scan", "Scanning it for vulnerabilities and secrets"), ("checks", "Checking its security and FIPS readiness")]
    return steps


def dockerfile(spec, image_id, version, base_ref):
    run = lambda key, cmds: 'RUN : coder-step=%s && %s' % (key, " && ".join(cmds))  # noqa: E731
    lines = ["# Image builder: %s, version %d (generated; edit the image in Templates > Images)" % (image_id, version),
             "FROM " + base_ref, "USER root", 'SHELL ["/bin/bash", "-o", "pipefail", "-c"]',
             "ENV DEBIAN_FRONTEND=noninteractive"]
    if custom_sources():
        lines += ["COPY apt/coder-mirror.sources /tmp/coder-mirror.sources",
                  run("sources", ["mkdir -p /etc/apt/sources.list.d.disabled",
                                  "(mv /etc/apt/sources.list.d/* /etc/apt/sources.list.d.disabled/ 2>/dev/null || true)",
                                  "(mv /etc/apt/sources.list /etc/apt/sources.list.d.disabled/ 2>/dev/null || true)",
                                  "mv /tmp/coder-mirror.sources /etc/apt/sources.list.d/coder-mirror.sources"])]
    if spec["packages"]:
        lines.append(run("packages", ["apt-get update", "apt-get install -y --no-install-recommends "
                                      + " ".join(q(p) for p in spec["packages"]), "apt-get clean",
                                      "rm -rf /var/lib/apt/lists/*"]))
    if spec["debs"]:
        lines += ["COPY debs/ /tmp/coder-debs/",
                  run("debs", ["apt-get update", "apt-get install -y --no-install-recommends /tmp/coder-debs/*.deb",
                               "apt-get clean", "rm -rf /tmp/coder-debs /var/lib/apt/lists/*"])]
    if spec["desktop"] == "gnome":
        lines += ["COPY desktop/coder-desktop-session /usr/local/bin/coder-desktop-session",
                  run("desktop", ["apt-get update", "apt-get install -y --no-install-recommends " + " ".join(GNOME),
                                  "chmod 0755 /usr/local/bin/coder-desktop-session", "mkdir -p /etc/coder-image",
                                  "echo gnome > /etc/coder-image/desktop", "apt-get clean",
                                  "rm -rf /var/lib/apt/lists/*"])]
    elif spec["desktop"] == "xfce":
        lines.append(run("desktop", ["apt-get update", "apt-get install -y --no-install-recommends xfce4 "
                                     "xfce4-terminal dbus-x11 tigervnc-standalone-server novnc websockify",
                                     "rm -f /usr/local/bin/coder-desktop-session", "mkdir -p /etc/coder-image",
                                     "echo xfce > /etc/coder-image/desktop", "apt-get clean",
                                     "rm -rf /var/lib/apt/lists/*"]))
    elif spec["desktop"] == "none":
        # The X server, noVNC and websockify stay (small; with no desktop, the template starts nothing on them).
        lines.append(run("desktop", ["(apt-get purge -y --auto-remove 'xfce4*' 'libxfce4*' firefox 2>/dev/null || true)",
                                     "rm -f /usr/local/bin/coder-desktop-session", "mkdir -p /etc/coder-image",
                                     "echo none > /etc/coder-image/desktop", "rm -rf /var/lib/apt/lists/*"]))
    for i in spec["installations"]:
        d = "/tmp/coder-install/" + i["id"]
        lines += ["COPY installs/%s/ %s/" % (i["id"], d),
                  run("install-" + i["id"], ["cd " + d, "INSTALL_DIR=%s bash -euo pipefail ./install.sh" % d,
                                             "cd /", "rm -rf " + d])]
    if spec["remove"]:
        # Only what the image has: a package it doesn't have is skipped (and said so in the log), not an error.
        names = " ".join(q(p) for p in spec["remove"])
        lines.append(run("remove", [
            "installed=$( (dpkg-query -W -f='${db:Status-Abbrev} ${Package}\\n' %s 2>/dev/null || true) "
            "| awk '$1 ~ /^ii/ {print $2}')"
            % names,
            "for p in %s; do echo \"$installed\" | grep -qx \"$p\" || echo \"Not in the image, skipped: $p\"; done" % names,
            "if [ -n \"$installed\" ]; then apt-get purge -y --auto-remove $installed; fi",
            "rm -rf /var/lib/apt/lists/*"]))
    c = spec["config"]
    if c["aliases"].strip() or c["functions"].strip() or c["profile"].strip() or c["dotfiles"]:
        lines += ["COPY config/ /tmp/coder-config/",
                  run("config", ["install -D -m 0644 /tmp/coder-config/bashrc /etc/coder-image/bashrc",
                                 "(grep -q /etc/coder-image/bashrc /etc/bash.bashrc || printf '%s\\n' '' "
                                 "'# Image builder: environment, aliases and functions' "
                                 "'[ -r /etc/coder-image/bashrc ] && . /etc/coder-image/bashrc' >> /etc/bash.bashrc)",
                                 "if [ -d /tmp/coder-config/home ]; then mkdir -p /usr/share/coder-image/home /etc/skel "
                                 "&& cp -a /tmp/coder-config/home/. /usr/share/coder-image/home/ "
                                 "&& cp -a /tmp/coder-config/home/. /etc/skel/; fi", "rm -rf /tmp/coder-config"])]
    if spec["fips"]:
        lines.append(run("fips", fips_script()))
    harden = hardening_script(spec)
    if harden or spec["hardening"]["script"].strip():
        if spec["hardening"]["script"].strip():
            lines.append("COPY harden.sh /tmp/coder-harden.sh")
            harden = harden + ["bash -euo pipefail /tmp/coder-harden.sh", "rm -f /tmp/coder-harden.sh"]
        lines.append(run("harden", harden))
    manifest = json.dumps({"name": image_id, "version": version, "builtAt": now()})
    lines += [run("finish", ["mkdir -p /etc/coder-image", "printf '%s\\n' " + q(manifest) + " > /etc/coder-image/image.json"]),
              'LABEL org.opencontainers.image.title="%s" org.opencontainers.image.version="%d" '
              'com.coder.image.builder="coder-airgapped"' % (image_id, version),
              "USER coder", "WORKDIR /home/coder"]
    return "\n".join(lines) + "\n"


def bashrc(config):
    parts = ["# Image builder: added to every shell (/etc/bash.bashrc reads it)."]
    for key, title in (("profile", "environment"), ("aliases", "aliases"), ("functions", "functions")):
        if config[key].strip():
            parts += ["", "# --- " + title, config[key].rstrip()]
    return "\n".join(parts) + "\n"


def context_tar(spec, image_id, version, base_ref, out):
    """The build context (Dockerfile and files) as a tar, written to `out` (a binary file)."""
    def add(tf, name, data, mode=0o644):
        info = tarfile.TarInfo(name)
        info.size, info.mode, info.mtime = len(data), mode, int(time.time())
        tf.addfile(info, io.BytesIO(data))

    with tarfile.open(fileobj=out, mode="w|") as tf:
        add(tf, "Dockerfile", dockerfile(spec, image_id, version, base_ref).encode())
        src = custom_sources()
        if src:
            add(tf, "apt/coder-mirror.sources", src.encode())
        for d in spec["debs"]:
            tf.add(file_path(image_id, "deb", d["name"]), "debs/" + d["name"])
        for i in spec["installations"]:
            add(tf, "installs/%s/install.sh" % i["id"], i["script"].encode(), 0o755)
            for f in i["files"]:
                tf.add(file_path(image_id, "install", f["name"], i["id"]), "installs/%s/%s" % (i["id"], f["name"]))
        if spec["desktop"] == "gnome":
            add(tf, "desktop/coder-desktop-session", GNOME_SESSION.encode(), 0o755)
        c = spec["config"]
        if c["aliases"].strip() or c["functions"].strip() or c["profile"].strip() or c["dotfiles"]:
            add(tf, "config/bashrc", bashrc(c).encode())
            for d in c["dotfiles"]:
                add(tf, "config/home/" + d["path"], d["content"].encode(), 0o644)
        if spec["hardening"]["script"].strip():
            add(tf, "harden.sh", spec["hardening"]["script"].encode(), 0o755)


def base_ref_for(spec):
    if spec["base"]["kind"] == "image":
        other = STORE.image(spec["base"]["id"], full=False)
        if not other or not other["ref"]:
            raise ValueError("The base image '%s' has not been built." % spec["base"]["id"])
        return other["ref"]
    if not BASE_IMAGE:
        raise ValueError("No workspace base image is configured.")
    # The workspace image in the builder's own registry (seeded at install); else, until it is seeded, the one in
    # your registry (global.registry), which BuildKit pulls with the pull secret.
    repo_tag = BASE_IMAGE.split("/", 1)[1] if BASE_IMAGE.startswith(REGISTRY + "/") else None
    if repo_tag:
        repo, _, tag = repo_tag.rpartition(":")
        try:
            registry("HEAD", "%s/manifests/%s" % (repo, tag), timeout=15).close()
        except Exception:  # noqa: BLE001 - not seeded (404) or the registry is not up: the fallback, if any
            if BASE_FALLBACK:
                return BASE_FALLBACK
            raise ValueError("The base image (%s) is not in the image builder's registry yet: seed it with "
                             "`./mirror-images.sh seed-builder` from the bundle (`./make --deploy` does it)." % repo_tag)
    return BASE_IMAGE


# --------------------------------------------------------------------------- the registry (plain HTTP, in-cluster)
MANIFEST_TYPES = ", ".join([
    "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"])


def registry(method, path, accept=MANIFEST_TYPES, timeout=60):
    req = urllib.request.Request("http://%s/v2/%s" % (REGISTRY, path), method=method, headers={"Accept": accept})
    return urllib.request.urlopen(req, timeout=timeout)


def manifest(repo, ref):
    """(manifest, digest) of the linux/amd64 image."""
    with registry("GET", "%s/manifests/%s" % (repo, ref)) as r:
        m, digest = json.loads(r.read()), r.headers.get("Docker-Content-Digest")
    if m.get("manifests"):  # an index (BuildKit adds an attestation manifest)
        pick = next(x for x in m["manifests"] if (x.get("platform") or {}).get("architecture") == "amd64"
                    and (x.get("platform") or {}).get("os") == "linux")
        with registry("GET", "%s/manifests/%s" % (repo, pick["digest"])) as r:
            m = json.loads(r.read())
    return m, digest


def image_size(repo, ref):
    m, _ = manifest(repo, ref)
    return sum(int(x.get("size") or 0) for x in m.get("layers") or [])


def delete_tags(repo):
    try:
        with registry("GET", "%s/tags/list" % repo) as r:
            tags = json.loads(r.read()).get("tags") or []
    except urllib.error.HTTPError:
        return 0
    n = 0
    for t in tags:
        try:
            with registry("HEAD", "%s/manifests/%s" % (repo, t)) as r:
                digest = r.headers.get("Docker-Content-Digest")
            with registry("DELETE", "%s/manifests/%s" % (repo, digest)):
                n += 1
        except urllib.error.HTTPError:
            pass
    return n


def docker_archive(repo, tag, ref_name, out):
    """Writes the image as a `docker save` tarball to `out` (layers stay gzip-compressed; docker load reads them)."""
    m, _ = manifest(repo, tag)
    cfg_digest = m["config"]["digest"]

    def blob(digest):
        return registry("GET", "%s/blobs/%s" % (repo, digest), accept="*/*", timeout=600)

    with tarfile.open(fileobj=out, mode="w|") as tf:
        with blob(cfg_digest) as r:
            cfg = r.read()
        cfg_name = cfg_digest.split(":")[1] + ".json"
        info = tarfile.TarInfo(cfg_name)
        info.size = len(cfg)
        tf.addfile(info, io.BytesIO(cfg))
        names = []
        for layer in m["layers"]:
            name = layer["digest"].split(":")[1] + ".tar.gz"
            info = tarfile.TarInfo(name)
            info.size = int(layer["size"])
            with blob(layer["digest"]) as r:
                tf.addfile(info, r)
            names.append(name)
        man = json.dumps([{"Config": cfg_name, "RepoTags": [ref_name], "Layers": names}]).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(man)
        tf.addfile(info, io.BytesIO(man))


# --------------------------------------------------------------------------- S3 (SigV4, multipart; AWS or compatible)
def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def s3_request(cfg, method, key, query="", body=b"", headers=None):
    with s3_open(cfg, method, key, query, body, headers) as r:
        return r.status, dict(r.headers), r.read()


def s3_open(cfg, method, key, query="", body=b"", headers=None):
    """The open response (read it as it comes: a large object is never held whole); query canonical (sorted, encoded)."""
    endpoint = (cfg.get("endpoint") or "https://s3.%s.amazonaws.com" % cfg["region"]).rstrip("/")
    u = urllib.parse.urlsplit(endpoint)
    path_style = cfg.get("pathStyle", True)
    host = u.netloc if path_style else "%s.%s" % (cfg["bucket"], u.netloc)
    path = "/" + urllib.parse.quote(("%s/%s" % (cfg["bucket"], key)) if path_style else key, safe="/~")
    t = datetime.datetime.now(datetime.timezone.utc)
    amz, date = t.strftime("%Y%m%dT%H%M%SZ"), t.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    h = {"host": host, "x-amz-date": amz, "x-amz-content-sha256": payload, **{k.lower(): v for k, v in (headers or {}).items()}}
    names = sorted(h)
    canonical = "\n".join([method, path, query, "".join("%s:%s\n" % (k, h[k]) for k in names), ";".join(names), payload])
    scope = "%s/%s/s3/aws4_request" % (date, cfg["region"])
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = _sign(_sign(_sign(_sign(("AWS4" + cfg["secretKey"]).encode(), date), cfg["region"]), "s3"), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    h["authorization"] = "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s" % (
        cfg["accessKey"], scope, ";".join(names), sig)
    req = urllib.request.Request("%s://%s%s%s" % (u.scheme, host, path, "?" + query if query else ""), data=body or None,
                                 method=method, headers={k: v for k, v in h.items() if k != "host"})
    import ssl
    ctx = ssl.create_default_context(cafile=os.environ.get("CA_FILE") or None) if u.scheme == "https" else None
    return urllib.request.urlopen(req, timeout=300, context=ctx)


class S3Upload:
    """A file-like object: what is written goes to S3 as a multipart upload (64 MB parts)."""

    PART = 64 * 1024 * 1024

    def __init__(self, cfg, key):
        self.cfg, self.key, self.buf, self.parts, self.size = cfg, key, bytearray(), [], 0
        _, _, body = s3_request(cfg, "POST", key, "uploads=")
        self.upload_id = re.search(rb"<UploadId>([^<]+)</UploadId>", body).group(1).decode()

    def write(self, data):
        self.buf += data
        self.size += len(data)
        while len(self.buf) >= self.PART:
            self._part(bytes(self.buf[: self.PART]))
            del self.buf[: self.PART]
        return len(data)

    def _part(self, data):
        n = len(self.parts) + 1
        query = "partNumber=%d&uploadId=%s" % (n, urllib.parse.quote(self.upload_id, safe=""))
        _, headers, _ = s3_request(self.cfg, "PUT", self.key, query, data)
        self.parts.append(headers.get("ETag") or headers.get("etag"))

    def close(self):
        if self.buf or not self.parts:
            self._part(bytes(self.buf))
            self.buf = bytearray()
        xml = "<CompleteMultipartUpload>%s</CompleteMultipartUpload>" % "".join(
            "<Part><PartNumber>%d</PartNumber><ETag>%s</ETag></Part>" % (i + 1, e) for i, e in enumerate(self.parts))
        s3_request(self.cfg, "POST", self.key, "uploadId=%s" % urllib.parse.quote(self.upload_id, safe=""),
                   xml.encode(), {"content-type": "application/xml"})

    def abort(self):
        try:
            s3_request(self.cfg, "DELETE", self.key, "uploadId=%s" % urllib.parse.quote(self.upload_id, safe=""))
        except Exception:  # noqa: BLE001
            pass

    # tarfile asks for these
    def tell(self):
        return self.size

    def flush(self):
        pass


def s3_settings(include_secret=False):
    cfg = STORE.setting("s3", {}) or {}
    if not include_secret:
        cfg = dict(cfg, secretKey="", secretSet=bool(cfg.get("secretKey")))
    return cfg


def s3_backup(image_id):
    """The image's current version to S3 as <prefix><name>-<version>.tar (a `docker load` tarball)."""
    img = STORE.image(image_id, full=False)
    cfg = s3_settings(True)
    if not img or not img["ref"]:
        raise ValueError("The image has not been built.")
    if not (cfg.get("bucket") and cfg.get("accessKey") and cfg.get("secretKey") and cfg.get("region")):
        raise ValueError("S3 is not set up: bucket, region and keys are needed (Images > Settings).")
    key = "%s%s-%d.tar" % (cfg.get("prefix") or "", image_id, img["version"])
    s3 = dict(img["s3"], status="uploading", startedAt=now(), error=None)
    STORE.set(image_id, s3=s3)
    up = S3Upload(cfg, key)
    try:
        docker_archive("%s/%s" % (REPO, image_id), str(img["version"]), img["pullRef"], up)
        up.close()
    except Exception as e:
        up.abort()
        STORE.set(image_id, s3=dict(s3, status="failed", error=str(e)[:300], finishedAt=now()))
        raise
    STORE.set(image_id, s3=dict(s3, status="done", key=key, bytes=up.size, version=img["version"], finishedAt=now(),
                                bucket=cfg["bucket"]))
    if LOG:
        LOG(event="image-s3-backup", image=image_id, version=img["version"], key=key, bytes=up.size)


# --------------------------------------------------------------------------- builds
def kube_call(method, path, body=None, tries=6):
    """KUBE.call, again after a timeout or a dropped connection (a busy API server must not fail a 10-minute build).
    Creating a Job again is safe: "already exists" (409) counts as created."""
    for n in range(tries):
        try:
            status, out = KUBE.call(method, path, body)
        except (OSError, http.client.HTTPException) as e:  # socket.timeout, URLError, a reset connection
            if n == tries - 1:
                raise RuntimeError("the Kubernetes API did not answer (%s %s): %s" % (method, path.split("?")[0], e))
            time.sleep(min(30, 2 ** (n + 1)))
            continue
        if method == "POST" and status == 409 and n:
            return 201, out
        if status in (0, 429, 500, 502, 503, 504) and n < tries - 1:
            time.sleep(min(30, 2 ** (n + 1)))
            continue
        return status, out


def kube_stream(path, timeout, tries=6):
    for n in range(tries):
        try:
            return KUBE.stream(path, timeout=timeout)
        except (OSError, http.client.HTTPException):
            if n == tries - 1:
                raise
            time.sleep(min(30, 2 ** (n + 1)))


def job_name(kind, image_id, build_id):
    return ("coder-image-%s-%s-%d" % (kind, image_id, build_id))[:63].rstrip("-")


# What Jobs that run this file need of the service's code (imagebuilder imports securitydata, which reads the rules).
# The Jobs run TOOLS_IMAGE, the service's own image: its code is in /app there (development/tools/build-ui-image.sh).


def pod_spec(containers, init=None, unconfined=False):
    spec = {
        "restartPolicy": "Never",
        "securityContext": {"runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000, "fsGroup": 1000,
                            "seccompProfile": {"type": "Unconfined" if unconfined else "RuntimeDefault"}},
        "containers": containers,
        "volumes": [],
    }
    if unconfined:
        spec["securityContext"]["appArmorProfile"] = {"type": "Unconfined"}
    if init:
        spec["initContainers"] = init
    if PULL_SECRETS:
        spec["imagePullSecrets"] = PULL_SECRETS
    return spec


def build_job(image_id, build_id, version, token):
    name = job_name("build", image_id, build_id)
    target = "%s/%s/%s" % (REGISTRY, REPO, image_id)
    url = "%s%s/internal/builds/%s/context.tar" % (SERVICE_URL, BASE, token)
    tools = {"name": "context", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
             "command": ["python3", "/app/imagebuilder.py", "fetch-context", url, "/ctx"],
             "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
             "volumeMounts": [{"name": "ctx", "mountPath": "/ctx"}]}
    build = {"name": "build", "image": BUILDKIT_IMAGE, "imagePullPolicy": "IfNotPresent",
             "command": ["buildctl-daemonless.sh"],
             "args": ["build", "--frontend", "dockerfile.v0", "--local", "context=/ctx", "--local", "dockerfile=/ctx",
                      "--output", 'type=image,"name=%s:%d,%s:latest",push=true,registry.insecure=true' % (
                          target, version, target), "--progress", "rawjson"],
             "env": [{"name": "BUILDKITD_FLAGS",
                      "value": "--oci-worker-no-process-sandbox --config /etc/buildkit/buildkitd.toml"}],
             "resources": {"requests": {"cpu": "500m", "memory": "1Gi"},
                           "limits": {"cpu": BUILD_CPU, "memory": BUILD_MEMORY}},
             "volumeMounts": [{"name": "ctx", "mountPath": "/ctx"}, {"name": "cfg", "mountPath": "/etc/buildkit"},
                              {"name": "state", "mountPath": "/home/user/.local/share/buildkit"}]}
    spec = pod_spec([build], [tools], unconfined=True)
    spec["volumes"] += [{"name": "ctx", "emptyDir": {}}, {"name": "cfg", "configMap": {"name": "coder-image-builder"}},
                        {"name": "state", "emptyDir": {}}]
    if PULL_SECRETS:  # the base image from your registry (EKS)
        spec["volumes"].append({"name": "docker", "secret": {"secretName": PULL_SECRETS[0]["name"], "items": [
            {"key": ".dockerconfigjson", "path": "config.json"}]}})
        build["volumeMounts"].append({"name": "docker", "mountPath": "/home/user/.docker"})
    return name, job_body(name, image_id, build_id, "build", spec)


def scan_job(image_id, build_id, version, token, ref=None, node=None, kind="scan"):
    """The scan Job: trivy on the image in the cluster's registry; or, given the node that holds it (an image no
    registry here holds), on its files copied out of the node's copy (node_scan_spec). kind: the Job's own (a pit
    stop scans after each lap: scan1, scan2...)."""
    name = job_name(kind, image_id, build_id)
    ref = ref or "%s/%s/%s:%d" % (REGISTRY, REPO, image_id, version)
    url = "%s%s/internal/builds/%s/report" % (SERVICE_URL, BASE, token)
    command = (["python3", "/app/imagebuilder.py", "scan-rootfs", ref, url, "/rootfs"] if node
               else ["python3", "/app/imagebuilder.py", "scan", ref, url])
    c = {"name": "scan", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
         "command": command,
         "env": [{"name": "TRIVY_INSECURE", "value": "true"}, {"name": "HOME", "value": "/tmp"},
                 {"name": "BUILDER_REGISTRY", "value": REGISTRY}],
         "resources": {"requests": {"cpu": "250m", "memory": "512Mi"}, "limits": {"cpu": "2", "memory": "4Gi"}},
         "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
         "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}]}
    init = None
    if securitydata.active_bundle():
        # the uploaded security data (vulnerability and Java databases, FIPS rules), fetched from the service
        url = "%s%s/internal/builds/%s/security-data.tar.gz" % (SERVICE_URL, BASE, token)
        init = [{"name": "security-data", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
                 "command": ["python3", "/app/securitydata.py", "fetch", url, "/sec"],
                 "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
                 "resources": {"requests": {"cpu": "100m", "memory": "256Mi"}, "limits": {"memory": "1Gi"}},
                 "volumeMounts": [{"name": "sec", "mountPath": "/sec"}]}]
        c["env"].append({"name": "SECURITY_DIR", "value": "/sec"})
        c["volumeMounts"].append({"name": "sec", "mountPath": "/sec", "readOnly": True})
    if node:
        spec = node_scan_spec(c, init or [], ref, node)
    else:
        spec = pod_spec([c], init=init)
    spec["volumes"].append({"name": "tmp", "emptyDir": {"sizeLimit": "8Gi"}})
    if init:
        spec["volumes"].append({"name": "sec", "emptyDir": {"sizeLimit": "8Gi"}})
    return name, job_body(name, image_id, build_id, kind, spec)


# The tools a node scan runs inside the image being scanned, whatever it has (no shell, another libc): the tools
# image's busybox with the musl loader it needs, started through the loader.
NODE_TOOLS = "/scan-tools"
NODE_BUSYBOX = [NODE_TOOLS + "/ld-musl-x86_64.so.1", NODE_TOOLS + "/busybox"]
# What is not the image's own files: the container's runtime mounts and the scan's own volumes (tar -X patterns).
NODE_SCAN_EXCLUDE = ("./proc", "./sys", "./dev", "./run", "./scan-out", "." + NODE_TOOLS)


def node_scan_spec(scan, init, ref, node):
    """A scan on the node that holds the image: the image runs (from the node's copy, never pulled) only the tools
    image's busybox, once as its default user (who it runs as) and once as root to copy its files into the scan's
    volume, which the scan reads (as root, able to read every file, nothing else). No privileges, no registry."""
    bb = " ".join(NODE_BUSYBOX)
    tools = {"name": "scan-tools", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
             "command": ["sh", "-c", "cp /bin/busybox /lib/ld-musl-x86_64.so.1 %s/ && printf '%%s\\n' %s > %s/exclude"
                         % (NODE_TOOLS, " ".join(NODE_SCAN_EXCLUDE), NODE_TOOLS)],
             "securityContext": {"runAsUser": 1000, "runAsGroup": 1000, "allowPrivilegeEscalation": False,
                                 "capabilities": {"drop": ["ALL"]}},
             "volumeMounts": [{"name": "scan-tools", "mountPath": NODE_TOOLS}]}
    user = {"name": "image-user", "image": ref, "imagePullPolicy": "Never",
            "command": NODE_BUSYBOX + ["sh", "-c", "%s id -u > /scan-out/uid; %s id -g > /scan-out/gid" % (bb, bb)],
            "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
            "volumeMounts": [{"name": "scan-tools", "mountPath": NODE_TOOLS, "readOnly": True},
                             {"name": "rootfs", "mountPath": "/scan-out"}]}
    copy = {"name": "image-files", "image": ref, "imagePullPolicy": "Never",
            "command": NODE_BUSYBOX + ["sh", "-c",
                                       "%s mkdir -p /scan-out/rootfs && cd / && %s tar -cf - -X %s/exclude . 2>/scan-out/tar.err"
                                       " | %s tar -xof - -C /scan-out/rootfs" % (bb, bb, NODE_TOOLS, bb)],
            "securityContext": {"runAsUser": 0, "runAsGroup": 0, "runAsNonRoot": False,
                                "allowPrivilegeEscalation": False,
                                "capabilities": {"drop": ["ALL"], "add": ["DAC_READ_SEARCH"]}},
            "resources": {"requests": {"cpu": "250m", "memory": "256Mi"}, "limits": {"cpu": "2", "memory": "1Gi"}},
            "volumeMounts": [{"name": "scan-tools", "mountPath": NODE_TOOLS, "readOnly": True},
                             {"name": "rootfs", "mountPath": "/scan-out"}]}
    scan = dict(scan, securityContext={"runAsUser": 0, "runAsGroup": 0, "runAsNonRoot": False,
                                       "allowPrivilegeEscalation": False,
                                       "capabilities": {"drop": ["ALL"], "add": ["DAC_READ_SEARCH"]}})
    scan["volumeMounts"] = scan["volumeMounts"] + [{"name": "rootfs", "mountPath": "/rootfs", "readOnly": True}]
    spec = {
        "restartPolicy": "Never",
        "nodeName": node,
        "securityContext": {"fsGroup": 1000, "seccompProfile": {"type": "RuntimeDefault"}},
        "initContainers": [tools, user, copy] + init,
        "containers": [scan],
        "volumes": [{"name": "scan-tools", "emptyDir": {"sizeLimit": "64Mi"}},
                    {"name": "rootfs", "emptyDir": {"sizeLimit": NODE_SCAN_DISK}}],
    }
    if PULL_SECRETS:
        spec["imagePullSecrets"] = PULL_SECRETS
    return spec


def job_body(name, image_id, build_id, kind, spec):
    labels = {"app.kubernetes.io/name": "coder-image-" + kind, "app.kubernetes.io/part-of": "coder",
              "coder-image/id": image_id, "coder-image/build": str(build_id)}
    return {"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": name, "namespace": NAMESPACE, "labels": labels},
            "spec": {"backoffLimit": 0, "activeDeadlineSeconds": BUILD_TIMEOUT * 60, "ttlSecondsAfterFinished": 3600,
                     "template": {"metadata": {"labels": labels}, "spec": spec}}}


class Build(threading.Thread):
    """Follows one build from start to report: the build Job (its BuildKit progress drives the steps), the scan Job,
    then the image's new version (and its S3 backup, when that is on)."""

    def __init__(self, image_id, build_id, version, token, spec, user):
        super().__init__(daemon=True)
        self.image_id, self.build_id, self.version, self.token, self.spec, self.user = (
            image_id, build_id, version, token, spec, user)
        self.plan = build_plan(spec)
        self.done = set()
        self.current = "prepare"
        self.cancelled = False
        self.started = time.time()

    def steps(self):
        out = []
        for key, label in self.plan:
            out.append({"key": key, "label": label,
                        "state": "done" if key in self.done else "active" if key == self.current else "pending"})
        return out

    def progress(self):
        n = len(self.plan)
        return round(min(0.99, (len(self.done) + 0.5 * (self.current not in self.done)) / n), 3)

    def advance(self, key, message=None):
        keys = [k for k, _ in self.plan]
        if key not in keys:
            return
        for k in keys[: keys.index(key)]:
            self.done.add(k)
        self.current = key
        label = dict(self.plan)[key]
        STORE.update_build(self.build_id, stage=key, message=message or label, progress=self.progress(),
                           steps=self.steps())

    def finish_step(self, key):
        self.done.add(key)
        STORE.update_build(self.build_id, progress=self.progress(), steps=self.steps())

    def fail(self, error):
        STORE.update_build(self.build_id, status="cancelled" if self.cancelled else "failed", error=error[:2000],
                           finished_at=now(), steps=self.steps())
        img = STORE.image(self.image_id, full=False)
        STORE.set(self.image_id, status="ready" if img and img["ref"] else "draft")
        if LOG:
            LOG(event="image-build-failed", image=self.image_id, build=self.build_id, error=error[:300])

    def run(self):
        try:
            self._run()
        except Exception as e:  # noqa: BLE001 - any failure ends the build, with its reason
            self.fail(str(e))
        finally:
            # Its log and report are kept here: the Jobs go now, and BuildKit's scratch space (GBs) with their pods.
            for kind in ["build", "scan"] + ["%s%d" % (k, n) for k in ("copa", "scan") for n in range(1, PIT_MAX_LAPS + 1)]:
                try:
                    kube_call("DELETE", "/apis/batch/v1/namespaces/%s/jobs/%s?propagationPolicy=Background" % (
                        NAMESPACE, job_name(kind, self.image_id, self.build_id)))
                except Exception:  # noqa: BLE001 - ttlSecondsAfterFinished removes it later
                    pass

    def _job(self, body):
        status, out = kube_call("POST", "/apis/batch/v1/namespaces/%s/jobs" % NAMESPACE, body)
        if status not in (200, 201):
            raise RuntimeError("could not start the Job (HTTP %s): %s" % (status, str(out)[:300]))

    def _pod(self, job):
        status, pods = kube_call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
            NAMESPACE, urllib.parse.quote("job-name=" + job)))
        items = (pods or {}).get("items") or [] if status == 200 else []
        return items[0] if items else None

    def _wait_container(self, job, container, init=False, timeout=1800):
        """The pod once `container` runs (or finished)."""
        deadline = time.time() + timeout
        while time.time() < deadline and not self.cancelled:
            pod = self._pod(job)
            if pod:
                st = (pod.get("status") or {})
                for cs in st.get("initContainerStatuses" if init else "containerStatuses") or []:
                    if cs["name"] == container and (cs["state"].get("running") or cs["state"].get("terminated")):
                        return pod
                for cs in st.get("initContainerStatuses") or []:
                    t = cs["state"].get("terminated")
                    if t and t.get("exitCode"):
                        raise RuntimeError("The build context could not be fetched (exit %s)." % t.get("exitCode"))
                    w = cs["state"].get("waiting") or {}
                    if w.get("reason") in ("ErrImagePull", "ImagePullBackOff", "CreateContainerConfigError"):
                        raise RuntimeError("%s: %s" % (w["reason"], w.get("message", "")[:300]))
                for cs in st.get("containerStatuses") or []:
                    w = cs["state"].get("waiting") or {}
                    if w.get("reason") in ("ErrImagePull", "ImagePullBackOff", "CreateContainerConfigError"):
                        raise RuntimeError("%s: %s" % (w["reason"], w.get("message", "")[:300]))
            time.sleep(2)
        raise RuntimeError("cancelled" if self.cancelled else "The build pod did not start.")

    def _exit_code(self, job, container):
        for _ in range(60):
            pod = self._pod(job)
            for cs in ((pod or {}).get("status") or {}).get("containerStatuses") or []:
                t = cs["state"].get("terminated")
                if cs["name"] == container and t:
                    return t.get("exitCode", 1), t.get("reason")
            time.sleep(2)
        return None, None

    def _follow(self, job):
        """BuildKit's rawjson progress -> the steps, and its logs -> the build log."""
        names = {}
        errors = []
        self.problems = []
        stream = kube_stream("/api/v1/namespaces/%s/pods/%s/log?container=build&follow=true" % (
            NAMESPACE, self._pod(job)["metadata"]["name"]), timeout=BUILD_TIMEOUT * 60)
        pending = ""
        try:
            for raw in stream:
                if self.cancelled:
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("{"):
                    if line:
                        STORE.append_log(self.build_id, line + "\n")
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                for v in d.get("vertexes") or []:
                    name = v.get("name") or ""
                    names[v["digest"]] = name
                    m = re.search(r"coder-step=([a-z0-9-]+)", name)
                    if v.get("started") and not v.get("completed"):
                        if m:
                            self.advance(m.group(1))
                        elif "FROM " in name or "load metadata" in name:
                            self.advance("base")
                        elif name.startswith("exporting"):
                            self.advance("finish", "Exporting the image's layers")
                    if v.get("completed") and m and not v.get("error"):
                        self.finish_step(m.group(1))
                    if v.get("error"):
                        errors.append("%s: %s" % (name[:200], v["error"][:500]))
                for s in d.get("statuses") or []:
                    if (s.get("id") or "").startswith("pushing") or "push" in (s.get("name") or ""):
                        self.advance("push", "Pushing it to the registry")
                for l in d.get("logs") or []:
                    try:
                        pending += base64.b64decode(l.get("data") or "").decode("utf-8", "replace")
                    except ValueError:
                        pass
                    if len(pending) > 4096 or "\n" in pending:
                        cut = pending.rfind("\n") + 1 or len(pending)
                        self._note_problems(pending[:cut])
                        STORE.append_log(self.build_id, pending[:cut])
                        pending = pending[cut:]
        finally:
            if pending:
                STORE.append_log(self.build_id, pending)
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        return errors

    PROBLEM = re.compile(r"^(E: |error|fatal|.*(command not found|No such file or directory|Permission denied|"
                         r"Unable to locate|has no installation candidate))", re.I)

    def _note_problems(self, text_):
        """Lines of the build's output that say what went wrong (apt's "E: ...", a missing command...): the last ones
        explain a failure better than BuildKit's "exit code: 100"."""
        for line in text_.splitlines():
            line = line.strip()
            if self.PROBLEM.match(line) and "failed to solve" not in line:
                self.problems = (self.problems + [line[:300]])[-5:]

    def _run(self):
        STORE.update_build(self.build_id, status="building", steps=self.steps(), message="Preparing the build")
        STORE.set(self.image_id, status="building")
        name, body = build_job(self.image_id, self.build_id, self.version, self.token)
        STORE.update_build(self.build_id, job=name)
        self._job(body)
        if LOG:
            LOG(event="image-build", image=self.image_id, build=self.build_id, version=self.version, by=self.user)
        self._wait_container(name, "build")
        self.advance("base")
        errors = self._follow(name)
        if self.cancelled:
            raise RuntimeError("cancelled")
        code, reason = self._exit_code(name, "build")
        if code != 0:
            step = dict(self.plan).get(self.current, "The build")
            first = ("%s failed: %s" % (step, self.problems[-1]) if self.problems
                     else "%s failed%s. See the log." % (step, " (%s)" % reason if reason and reason != "Error" else ""))
            more = self.problems[:-1] + errors[-3:]
            raise RuntimeError(first + ("\n" + "\n".join(more) if more else ""))
        self.finish_step("push")
        repo = "%s/%s" % (REPO, self.image_id)
        _, digest = manifest(repo, str(self.version))
        size = image_size(repo, str(self.version))
        # the scan
        report = self._scan()
        STORE.set(self.image_id, status="ready", version=self.version, ref="%s/%s:%d" % (REGISTRY, repo, self.version),
                  digest=digest, size=size, builtAt=now(), builtBy=self.user, report=report)
        self.done = {k for k, _ in self.plan}
        STORE.update_build(self.build_id, status="ready", progress=1.0, stage="done", finished_at=now(),
                           message="Ready: %s/%s:%d" % (PULL_PREFIX, repo, self.version), steps=self.steps())
        if LOG:
            LOG(event="image-built", image=self.image_id, build=self.build_id, version=self.version, size=size,
                grade=(report_summary(report) or {}).get("grade"))
        img = STORE.image(self.image_id, full=False)
        if (img["s3"] or {}).get("enabled"):
            try:
                s3_backup(self.image_id)
            except Exception as e:  # noqa: BLE001 - the build stands; the backup says why it failed
                if LOG:
                    LOG(event="image-s3-backup-failed", image=self.image_id, error=str(e)[:300])

    def _scan(self):
        """The scan Job (trivy and the image checks, with the security data in force): the report, or None."""
        self.advance("scan")
        STORE.update_build(self.build_id, status="scanning")
        name, body = scan_job(self.image_id, self.build_id, self.version, self.token, getattr(self, "scan_ref", None),
                              getattr(self, "scan_node", None), getattr(self, "scan_kind", "scan"))
        self._job(body)
        deadline = time.time() + 1800
        while time.time() < deadline and not self.cancelled:
            b = STORE.build(self.build_id)
            if b.get("stage") == "checks-done":
                break
            code, reason = self._exit_code_quick(name)
            if code not in (None, 0):
                STORE.append_log(self.build_id, "\n[scan] the scan Job failed (exit %s%s); the image is kept, without a "
                                 "report.\n" % (code, ", " + reason if reason else ""))
                break
            if code == 0 and STORE.build(self.build_id).get("stage") != "checks-done":
                time.sleep(3)
                break
            time.sleep(3)
        return STORE.setting("report-%d" % self.build_id) or None

    def _exit_code_quick(self, job):
        pod = self._pod(job)
        st = (pod or {}).get("status") or {}
        # a failed init container (the security data fetch) fails the pod before the scan runs
        for cs in st.get("initContainerStatuses") or []:
            t = (cs.get("state") or {}).get("terminated")
            if t and t.get("exitCode", 0) != 0:
                return t.get("exitCode", 1), "%s: %s" % (cs.get("name"), t.get("reason") or "failed")
        if st.get("phase") == "Failed" and not st.get("containerStatuses"):
            return 1, "the pod failed"
        for cs in st.get("containerStatuses") or []:
            t = cs["state"].get("terminated")
            if t:
                return t.get("exitCode", 1), t.get("reason")
        return None, None


BUILDS = {}  # build id -> Build (running here)


def start_build(image_id, user):
    img = STORE.image(image_id)
    if not img:
        raise ValueError("No such image.")
    if STORE.active_build(image_id):
        raise ValueError("This image is being built already.")
    spec = clean_spec(img["spec"], image_id)
    wanted = list(spec["packages"]) + (GNOME if spec["desktop"] == "gnome" else [])
    problems = spec_problems(spec, APT.check(wanted) if wanted else {})
    if problems:
        raise ValueError(" ".join(problems))
    base_ref_for(spec)
    version = img["version"] + 1
    build_id, token = STORE.new_build(image_id, version, spec, user)
    b = Build(image_id, build_id, version, token, spec, user)
    STORE.update_build(build_id, steps=b.steps())
    BUILDS[build_id] = b
    b.start()
    return build_id


class Rescan(Build):
    """A built image scanned again, with the security data in force (after new data is loaded): a new report for its
    current version, nothing rebuilt. It shows as a build of that version with only the scan steps."""

    def __init__(self, image_id, build_id, version, token, spec, user):
        super().__init__(image_id, build_id, version, token, spec, user)
        self.plan = [("scan", "Scanning it for vulnerabilities and secrets"),
                     ("checks", "Checking its security and FIPS readiness")]
        self.current = "scan"
        self.scan_ref = (STORE.image(image_id, full=False) or {}).get("ref")

    def _run(self):
        data = securitydata.stamp()
        STORE.update_build(self.build_id, status="scanning", steps=self.steps(),
                           message="Rescanning with the vulnerability database of %s" % (
                               (data.get("vulnerabilityDbUpdatedAt") or "?")[:10]))
        report = self._scan()
        if self.cancelled:
            raise RuntimeError("cancelled")
        if not report:
            raise RuntimeError("The scan gave no report. See the log.")
        STORE.set(self.image_id, report=report)
        self.done = {k for k, _ in self.plan}
        STORE.update_build(self.build_id, status="ready", progress=1.0, stage="done", finished_at=now(),
                           message="Rescanned: grade %s" % ((report_summary(report) or {}).get("grade") or "?"),
                           steps=self.steps())
        if LOG:
            LOG(event="image-rescanned", image=self.image_id, build=self.build_id, version=self.version,
                grade=(report_summary(report) or {}).get("grade"), data=data)


def scan_only(steps):
    """A build that only scanned (Rescan's steps: a rescan, or a scan of an image as it is), from its steps (JSON):
    nothing built, imported or patched, so its record can go on its own (delete_scan)."""
    try:
        return [s.get("key") for s in json.loads(steps or "[]")] == ["scan", "checks"]
    except (ValueError, TypeError, AttributeError):
        return False


def node_image_groups():
    """Every image the cluster's nodes hold (preloaded, loaded or pulled), each once with all its names there (a tag,
    its digest) and the nodes that hold it: [{"names", "sizeBytes", "nodes"}]. A node reports only its largest images
    (the kubelet's nodeStatusMaxImages, 50 by default), so the images its running pods run are added too (their size
    unknown: 0): a small image a pod runs is on that pod's node all the same."""
    status, nodes = kube_call("GET", "/api/v1/nodes")
    groups = {}
    for node in (nodes.get("items") or []) if status == 200 and isinstance(nodes, dict) else []:
        name = node["metadata"]["name"]
        for img in (node.get("status") or {}).get("images") or []:
            names = tuple(sorted(img.get("names") or []))
            if not names:
                continue
            g = groups.setdefault(names, {"names": list(names), "sizeBytes": img.get("sizeBytes") or 0, "nodes": []})
            if name not in g["nodes"]:
                g["nodes"].append(name)
    by_name = {n: g for g in groups.values() for n in g["names"]}
    status, pods = kube_call("GET", "/api/v1/pods?fieldSelector=" + urllib.parse.quote("status.phase=Running"))
    for pod in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        node = (pod.get("spec") or {}).get("nodeName")
        st = pod.get("status") or {}
        for c in (st.get("containerStatuses") or []) + (st.get("initContainerStatuses") or []):
            ref = c.get("image") or ""
            # its digest too, when the runtime knows it by one (a locally loaded image has only its ID)
            names = [n for n in (ref, c.get("imageID") or "") if n and not n.startswith("sha256:")]
            if not node or not names:
                continue
            g = next((by_name[n] for n in names if n in by_name), None)
            if g is None:
                g = groups.setdefault(tuple(sorted(names)), {"names": sorted(names), "sizeBytes": 0, "nodes": []})
            for n in names:
                if n not in g["names"]:
                    g["names"].append(n)
                by_name[n] = g
            if node not in g["nodes"]:
                g["nodes"].append(node)
    return list(groups.values())


def node_images():
    """{name: {"sizeBytes", "nodes"}} for every name an image has on the nodes."""
    out = {}
    for g in node_image_groups():
        for ref in g["names"]:
            out[ref] = {"sizeBytes": g["sizeBytes"], "nodes": g["nodes"]}
    return out


def in_builder_registry(ref):
    """The builder's registry's name for ref when it is one of its images (as workspaces pull them), else None."""
    if ref.startswith(REGISTRY + "/"):
        return ref
    if ref.startswith(PULL_PREFIX + "/"):
        return REGISTRY + ref[len(PULL_PREFIX):]
    return None


def scan_target(ref):
    """(what to scan, node or None): an image of the builder's registry is read from it; any other from a node that
    holds it (air-gapped clusters and preloaded images need no registry); one no node holds, from its registry."""
    own = registry_copy(ref)
    if own:
        return own, None
    holders = (node_images().get(ref) or {}).get("nodes") or []
    if holders:
        return ref, sorted(holders)[0]
    return ref, None


def scanned_id(ref):
    """The entry of a scanned image: scan-<its name>-<a hash of the reference>."""
    name = re.sub(r"[^a-z0-9]+", "-", ref.rsplit("/", 1)[-1].split("@")[0].lower()).strip("-")[:40] or "image"
    return "scan-%s-%s" % (name, hashlib.sha256(ref.encode()).hexdigest()[:6])


def start_ref_scan(ref, user):
    """Any image, by reference: its entry (made the first time, read-only) scanned now. (entry id, build id)."""
    ref = (ref or "").strip()
    if not ref or len(ref) > 500 or re.search(r"\s", ref):
        raise ValueError("An image reference, such as ghcr.io/org/image:1.0.")
    known = {e["image"] for e in images_in_use()} | set(node_images())
    if ref not in known and not in_builder_registry(ref):
        raise ValueError("No workspace runs %s and no node holds it: import it first (Import), or run it once." % ref)
    image_id = scanned_id(ref)
    img = STORE.image(image_id)
    if img and not img.get("scanned"):
        raise ValueError("An image called %s exists already." % image_id)
    if not img:
        STORE.create(image_id, "Scanned as it is: %s. Read-only here; scan it again to update its report." % ref,
                     dict(empty_spec(), scanned={"image": ref}), user)
        STORE.set(image_id, status="ready", ref=ref, builtAt=now(), builtBy=user)
    return image_id, start_rescan(image_id, user)


def start_rescan(image_id, user):
    img = STORE.image(image_id)
    if not img:
        raise ValueError("No such image.")
    target, node = None, None
    if img.get("scanned"):
        target, node = scan_target(img["scanned"]["image"])
    elif img.get("ref"):
        target = img["ref"]
    elif (img.get("tracked") or {}).get("image"):
        # the workspace image before the builder's registry has its copy (an install that did not seed it): read
        # from a node that holds it
        target, node = scan_target(img["tracked"]["image"])
        if not node and not in_builder_registry(target):
            raise ValueError("The builder's registry has no copy of %s yet and no node holds it." % target)
    else:
        raise ValueError("Only a built image can be rescanned.")
    if STORE.active_build(image_id):
        raise ValueError("This image is being built or scanned already.")
    build_id, token = STORE.new_build(image_id, img["version"], img["spec"], user)
    b = Rescan(image_id, build_id, img["version"], token, img["spec"], user)
    b.scan_ref, b.scan_node = target, node
    if node:
        STORE.append_log(build_id, "[scan] %s is read from node %s (its copy there; no registry needed).\n" % (
            target, node))
    STORE.update_build(build_id, steps=b.steps(), status="scanning")
    BUILDS[build_id] = b
    b.start()
    return build_id


def registry_host(ref):
    """The registry of an image reference (Docker Hub's for a name without one)."""
    first = ref.split("/", 1)[0]
    return first if "/" in ref and ("." in first or ":" in first or first == "localhost") else "docker.io"


class Import(Build):
    """A container image brought in rather than built: copied from a registry (regctl image copy) or read from an
    uploaded archive (`docker save` or an OCI layout; regctl image import), stored as coder-images/<name>:<version> in
    the cluster's registry, then scanned like a built image. It shows as a build with these steps; a registry's
    credentials go to regctl in a config file of its own (never on a command line), removed afterwards."""

    def __init__(self, image_id, build_id, version, token, spec, user, source):
        super().__init__(image_id, build_id, version, token, spec, user)
        self.source = source
        first = (("copy", "Copying it from %s" % source["ref"]) if source["kind"] == "registry"
                 else ("load", "Reading %s" % source["name"]))
        self.plan = [first, ("push", "Storing it in the cluster's registry"),
                     ("scan", "Scanning it for vulnerabilities and secrets"),
                     ("checks", "Checking its security and FIPS readiness")]
        self.current = first[0]

    def _regctl(self, args, home):
        STORE.append_log(self.build_id, "$ regctl %s\n" % " ".join(args))
        proc = subprocess.Popen(["regctl", "-v", "info"] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, env=dict(os.environ, HOME=home))
        self.proc = proc
        for line in proc.stdout:
            STORE.append_log(self.build_id, line)
            if self.cancelled:
                proc.kill()
        if proc.wait() != 0:
            raise RuntimeError("cancelled" if self.cancelled else "regctl failed (exit %d). See the log." % proc.returncode)

    def _run(self):
        STORE.update_build(self.build_id, status="building", steps=self.steps(), message=dict(self.plan)[self.current])
        STORE.set(self.image_id, status="building")
        if LOG:
            LOG(event="image-import", image=self.image_id, build=self.build_id, version=self.version, by=self.user,
                source=self.source.get("ref") or self.source.get("name"))
        dest = "%s/%s/%s:%d" % (REGISTRY, REPO, self.image_id, self.version)
        home = os.path.join(FILES, "imports", "home-%d" % self.build_id)
        os.makedirs(os.path.join(home, ".regctl"), exist_ok=True)
        try:
            hosts = {REGISTRY: {"tls": "disabled"}}
            if self.source["kind"] == "registry" and self.source.get("user"):
                hosts[registry_host(self.source["ref"])] = {"user": self.source["user"], "pass": self.source["password"]}
            with open(os.path.join(home, ".regctl", "config.json"), "w") as f:
                os.fchmod(f.fileno(), 0o600)
                json.dump({"hosts": hosts}, f)
            if self.source["kind"] == "registry":
                self._regctl(["image", "copy", self.source["ref"], dest], home)
            else:
                self._regctl(["image", "import", dest, self.source["file"]], home)
        finally:
            shutil.rmtree(home, ignore_errors=True)
            if self.source.get("file"):
                try:
                    os.remove(self.source["file"])
                except OSError:
                    pass
        if self.cancelled:
            raise RuntimeError("cancelled")
        self.finish_step(self.plan[0][0])
        self.advance("push")
        repo = "%s/%s" % (REPO, self.image_id)
        _, digest = manifest(repo, str(self.version))
        size = image_size(repo, str(self.version))
        self.finish_step("push")
        report = self._scan()
        STORE.set(self.image_id, status="ready", version=self.version, ref=dest, digest=digest, size=size,
                  builtAt=now(), builtBy=self.user, report=report)
        self.done = {k for k, _ in self.plan}
        STORE.update_build(self.build_id, status="ready", progress=1.0, stage="done", finished_at=now(),
                           message="Ready: %s/%s:%d" % (PULL_PREFIX, repo, self.version), steps=self.steps())
        if LOG:
            LOG(event="image-imported", image=self.image_id, build=self.build_id, version=self.version, size=size,
                grade=(report_summary(report) or {}).get("grade"))


def start_import(name, description, source, user):
    """A new imported image, or a new version of one: (image id, build id)."""
    image_id = str(name or "").strip().lower()
    if not NAME_RE.match(image_id):
        raise ValueError("A name of 3-40 lowercase letters, digits and dashes (it becomes the image's name).")
    if image_id in RESERVED_NAMES:
        raise ValueError("'%s' is a name the Images view uses itself: pick another." % image_id)
    origin = source.get("ref") or source.get("name")
    imported = {"source": source["kind"], "from": origin, "at": now(), "by": user}
    img = STORE.image(image_id)
    if img and not img.get("imported"):
        raise ValueError("There is an image called '%s' already, built here: pick another name." % image_id)
    if img and STORE.active_build(image_id):
        raise ValueError("This image is being imported or scanned already.")
    if not img:
        STORE.create(image_id, text(description, 2000, "The description"),
                     dict(empty_spec(), imported=imported), user)
    else:
        STORE.save(image_id, user, spec=dict(img["spec"], imported=imported),
                   description=text(description, 2000, "The description") if description else None)
    img = STORE.image(image_id)
    version = img["version"] + 1
    build_id, token = STORE.new_build(image_id, version, img["spec"], user)
    b = Import(image_id, build_id, version, token, img["spec"], user, source)
    STORE.update_build(build_id, steps=b.steps())
    BUILDS[build_id] = b
    b.start()
    return image_id, build_id


# ---------------------------------------------------------------------------------------------------------- pit stops
# Images > Fix image > Pit stop: Copa (Copacetic) patches an image's packages in place, no rebuild - the image comes
# into the pit, is patched, rescanned (patched again while there is more it can fix, up to the laps given) and goes
# back out on the track: the patched image is the image's next version (for an image only scanned here, or the
# platform's workspace image, the next version of its patched copy, <name>-patched), and its :latest. Templates offer
# it with every version the registry has (IMAGES_CONFIGMAP).
#
# Copa runs in a Job beside a rootless BuildKit (a native sidecar, its socket in a shared volume): from a trivy report
# of the image - OS packages, and (experimental in Copa) Python and Node.js packages - it updates them with the
# image's own package managers, which reach the distribution's repositories (or the mirrors the image names) and, for
# libraries, PyPI and npm, and pushes a patch layer. Every lap patches the image as it came in (Copa replaces its own
# earlier patch layer, so a lap's image is complete on its own); a later lap lets library updates go further (patch,
# then minor, then major versions, as far as allowed). An image the builder's registry does not hold is taken from its
# own registry (BuildKit pulls it with the cluster's pull secret).
COPA_LEVELS = ("patch", "minor", "major")
PIT_MAX_LAPS = 3
# The builder's registry as the pit stop's Job reaches it: through a forwarder of its own on localhost, which Copa's
# registry client (as BuildKit, by its configuration) reaches over plain HTTP.
PIT_LOCAL = "localhost:5000"
PIT_TIMEOUT_MINUTES = int(os.environ.get("BUILDER_PIT_TIMEOUT_MINUTES", "90") or 90)
PIT_SUMMARY = re.compile(r"Patch Summary: (\d+) total, (\d+) patched, (\d+) skipped")


def registry_copy(ref):
    """The builder's registry's name for an image: one of its own, or its copy of an outside image
    (coder-images/base/<name:tag>, seeded by `make --deploy` or mirror-images.sh seed-builder), else None."""
    own = in_builder_registry(ref)
    if own:
        return own
    name = (ref or "").rsplit("/", 1)[-1]
    if "@" in name or ":" not in name:
        return None
    repo, tag = name.split(":", 1)
    try:
        with registry("HEAD", "%s/base/%s/manifests/%s" % (REPO, repo, tag), timeout=10):
            return "%s/%s/base/%s:%s" % (REGISTRY, REPO, repo, tag)
    except (urllib.error.URLError, OSError, ValueError):
        return None


def pit_source(img):
    """Where a pit stop takes the image from: the builder's registry's copy, else its own reference."""
    if img.get("scanned"):
        ref = img["scanned"]["image"]
        return registry_copy(ref) or ref
    if img.get("tracked"):
        return img.get("ref") or registry_copy(img["tracked"]["image"]) or img["tracked"]["image"]
    if not img.get("ref"):
        raise ValueError("Build the image first: a pit stop patches a built image.")
    return img["ref"]


def pit_target(img, source, user):
    """The entry the patched image goes to: the image itself (its next version), or, for one only scanned here or the
    platform's workspace image, its patched copy (<name>-patched, made the first time)."""
    if not img.get("scanned") and not img.get("tracked"):
        return img["id"]
    outside = (img.get("scanned") or img.get("tracked"))["image"]
    base = re.sub(r"[^a-z0-9]+", "-", outside.rsplit("/", 1)[-1].split("@")[0].split(":")[0].lower()).strip("-")
    target = "%s-patched" % (base[:31].strip("-") or "image")
    copy = {"source": "copa", "from": outside, "entry": img["id"], "at": now(), "by": user}
    existing = STORE.image(target)
    if existing and (existing.get("imported") or {}).get("source") != "copa":
        raise ValueError("There is an image called '%s' already, not a patched copy: rename it first." % target)
    if existing:
        STORE.save(target, user, spec=dict(existing["spec"], imported=copy))
    else:
        STORE.create(target, "%s, patched in place by Copa (Images > Fix image > Pit stop)." % outside,
                     dict(empty_spec(), imported=copy), user)
    return target


# trivy's types of the Python packages Copa's library patching updates (in their own environments). Node.js ones it
# patches through a tooling image from Docker Hub, and on the AI image that failed the whole patch: left out, they go
# the other ways (an add-on's newer release). Go, Java and the rest Copa does not patch.
PIT_PYTHON_TYPES = {"python-pkg", "pip", "pipenv", "poetry", "uv", "conda-pkg"}
# pip's --break-system-packages, as an environment variable: Copa runs pip with the image's environment
PIT_PIP_ENV = "PIP_BREAK_SYSTEM_PACKAGES"
_PY_PATH = re.compile(r"(^|/)lib/python[0-9.]+/(site|dist)-packages/")


def pit_kind(v):
    """A report finding's kind for a pit stop: "os" (a package of the distribution), "python", or None (not Copa's)."""
    if v.get("class") == "os-pkgs" or (not v.get("class") and re.search(r" \([^)]+\)$", v.get("target") or "")):
        return "os"
    if v.get("type") in PIT_PYTHON_TYPES or v.get("target") == "Python" or (
            not v.get("type") and _PY_PATH.search((v.get("path") or v.get("target") or "").lstrip("/"))):
        return "python"
    return None


def pit_keys(report, keys, libraries=True):
    """The findings a pit stop works on, as (vulnerability id, package) pairs: of those Copa patches (OS packages, and
    Python ones with library patching) with a fixed version, the ones chosen, or (none chosen) every one."""
    kinds = {"os", "python"} if libraries else {"os"}
    fixable = {(v["id"], v["pkg"]) for v in ((report or {}).get("vulnerabilities") or {}).get("top") or []
               if v.get("fixed") and pit_kind(v) in kinds}
    if keys:
        return fixable & {(str(k.get("id")), str(k.get("pkg"))) for k in keys if isinstance(k, dict)}
    return fixable


def pit_remaining(report, pairs):
    """Of those findings, the ones a report still has with a fixed version."""
    left = {(v["id"], v["pkg"]) for v in ((report or {}).get("vulnerabilities") or {}).get("top") or [] if v.get("fixed")}
    return sorted(pairs & left)


def with_pit(images):
    """The images, each with its pit stop in progress (the Images list's "In the pit" badge): {lap, laps, stage,
    target} or None."""
    for img in images:
        img["pit"] = None
        latest = STORE.setting("pit-latest-%s" % img["id"])
        b = STORE.build(latest) if latest else None
        if b and b["status"] in ("queued", "building", "pushing", "scanning"):
            st = pit_state(latest) or {}
            img["pit"] = {"build": latest, "lap": st.get("lap") or 1, "laps": st.get("laps"), "stage": b["stage"],
                          "target": st.get("target"), "source": st.get("sourceEntry")}
    return images


def pit_state(build_id):
    return STORE.setting("pit-%d" % build_id)


def pit_view(build_id):
    """A pit stop as the Fix image page shows it: its options, laps, before and after, and its build's progress."""
    st = pit_state(build_id)
    b = STORE.build(build_id)
    if not st or not b:
        return None
    return dict(st, build=build_id, status=b["status"], stage=b["stage"], progress=b["progress"], message=b["message"],
                error=b["error"], startedAt=b["started_at"], finishedAt=b["finished_at"],
                steps=json.loads(b["steps"] or "[]"), log=(b["log"] or "")[-6000:])


class PitStop(Build):
    """A pit stop: into the pit (the image's source), a trivy report of what to fix, Copa's patch (a lap), the patched
    image rescanned - another lap while there is more to fix and laps are left - and back out on the track."""

    def __init__(self, image_id, build_id, version, token, spec, user, pit):
        super().__init__(image_id, build_id, version, token, spec, user)
        self.pit = pit
        self.plan = [("pit-in", "Into the pit"), ("report", "Reading what to fix (trivy)"),
                     ("patch", "Copa patching it"), ("rescan", "Rescanning the patched image"),
                     ("pit-out", "Back on the track")]
        self.current = "pit-in"
        self.target_ref = "%s/%s/%s:%d" % (REGISTRY, REPO, image_id, version)
        self.scan_ref = self.target_ref

    def _save(self):
        STORE.put_setting("pit-%d" % self.build_id, self.pit)

    def level(self, lap):
        """The library updates a lap allows: the chosen level on lap 1, a level further each lap after, never past
        the most allowed."""
        first = COPA_LEVELS.index(self.pit["level"])
        top = COPA_LEVELS.index(self.pit["maxLevel"])
        return COPA_LEVELS[min(first + lap - 1, max(first, top))]

    def _follow_copa(self, job):
        """The Copa Job's output -> the build log (and its steps: the report, then the patch)."""
        stream = kube_stream("/api/v1/namespaces/%s/pods/%s/log?container=copa&follow=true" % (
            NAMESPACE, self._pod(job)["metadata"]["name"]), timeout=PIT_TIMEOUT_MINUTES * 60)
        self.problems = []
        try:
            for raw in stream:
                if self.cancelled:
                    break
                line = raw.decode("utf-8", "replace").rstrip("\n")
                if line.startswith("[pit] patch"):
                    self.advance("patch", "Copa patching it (lap %d)" % self.pit["lap"])
                if re.search(r"level=(error|fatal)|^Error:", line):
                    self.problems = (self.problems + [line[-300:]])[-5:]
                STORE.append_log(self.build_id, line + "\n")
        finally:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass

    def _drop_job(self, name):
        """A lap's Job, gone as soon as the lap has what it needs: its pod's scratch space (BuildKit's, GBs) with it."""
        try:
            kube_call("DELETE", "/apis/batch/v1/namespaces/%s/jobs/%s?propagationPolicy=Background" % (NAMESPACE, name))
        except Exception:  # noqa: BLE001 - run() deletes it at the end anyway
            pass

    def _pip_source(self):
        """Copa's source when it updates Python packages: the source with PIP_BREAK_SYSTEM_PACKAGES=1 in its
        configuration (a tag of its own, the same layers), for pip installs into environments the distribution or uv
        manage (PEP 668) - as the Dockerfile's fix does (--break-system-packages). The patched image has it taken out
        again. None where it cannot be made: Copa patches the source as it is."""
        src = self.pit["source"]
        if not src.startswith(REGISTRY + "/"):
            return None
        repo, tag = src[len(REGISTRY) + 1:].rsplit(":", 1)
        out = ("%s-pit%d" % (tag, self.build_id))[-128:]
        try:
            image_env(repo, tag, out, add={PIT_PIP_ENV: "1"})
        except Exception as e:  # noqa: BLE001
            STORE.append_log(self.build_id, "[pit] the source for pip could not be made (%s): Copa patches the image "
                                            "as it is - pip refuses environments the distribution manages\n" % e)
            return None
        self.pip_tag = (repo, out)
        STORE.append_log(self.build_id, "[pit] Python: pip may update environments the distribution or uv manage "
                                        "(%s, for the patch only)\n" % PIT_PIP_ENV)
        return "%s/%s:%s" % (REGISTRY, repo, out)

    def _run(self):
        self.pip_tag = None
        try:
            self._race()
        finally:
            if self.pip_tag:
                try:
                    delete_manifest(*self.pip_tag)
                except Exception:  # noqa: BLE001 - a tag left over: its configuration blob, nothing more
                    pass

    def _race(self):
        p = self.pit
        STORE.update_build(self.build_id, status="building", steps=self.steps(),
                           message="Into the pit: %s" % p["source"])
        STORE.set(self.image_id, status="building")
        if LOG:
            LOG(event="image-pit-stop", image=self.image_id, build=self.build_id, version=self.version, by=self.user,
                source=p["source"], laps=p["laps"], libraries=p["libraries"])
        STORE.append_log(self.build_id, "[pit] into the pit: %s -> %s (up to %d lap%s; %s)\n" % (
            p["source"], self.target_ref, p["laps"], "" if p["laps"] == 1 else "s",
            "OS and Python packages" if p["libraries"] else "OS packages"))
        p["copaSource"] = self._pip_source() if p["libraries"] else None
        self._save()
        self.finish_step("pit-in")
        good = None
        repo = "%s/%s" % (REPO, self.image_id)
        for lap in range(1, p["laps"] + 1):
            p["lap"] = lap
            rec = {"lap": lap, "level": self.level(lap) if p["libraries"] else None, "status": "patching",
                   "startedAt": now()}
            p["history"] = p.get("history", []) + [rec]
            self._save()
            STORE.update_build(self.build_id, status="building")
            self.advance("report" if lap == 1 else "patch",
                         "Reading what to fix (trivy)" if lap == 1 else "Copa patching it (lap %d)" % lap)
            name, body = copa_job(self.image_id, self.build_id, lap, self.token)
            STORE.update_build(self.build_id, job=name)
            self._job(body)
            self._wait_container(name, "copa", timeout=1800)
            self._follow_copa(name)
            if self.cancelled:
                raise RuntimeError("cancelled")
            code, reason = self._exit_code(name, "copa")
            self._drop_job(name)
            result = STORE.setting("pit-result-%d-%d" % (self.build_id, lap)) or {}
            rec.update(summary=result.get("summary"), vex=result.get("vex"), finishedAt=now())
            if code != 0 or not result.get("pushed"):
                why = (self.problems[-1] if self.problems else "exit %s%s" % (code, ", " + reason if reason else ""))
                rec.update(status="failed", error=why)
                self._save()
                if good:
                    STORE.append_log(self.build_id, "[pit] lap %d failed (%s): lap %d's image goes out\n" % (
                        lap, why, good["lap"]))
                    break
                raise RuntimeError("Copa could not patch the image: %s" % why)
            if p.get("copaSource"):
                # pip's permission was for the patch only: out of the patched image's configuration
                image_env(repo, str(self.version), str(self.version), drop=[PIT_PIP_ENV])
            # the patched image, rescanned
            self.advance("rescan", "Rescanning the patched image (lap %d)" % lap)
            self.scan_kind = "scan%d" % lap
            STORE.put_setting("report-%d" % self.build_id, None)
            report = self._scan()
            self._drop_job(job_name(self.scan_kind, self.image_id, self.build_id))
            if not report:
                rec.update(status="failed", error="The rescan gave no report.")
                self._save()
                if good:
                    break
                raise RuntimeError("The patched image's rescan gave no report. See the log.")
            left = pit_remaining(report, {tuple(k) for k in p["pairs"]})
            summary = report_summary(report) or {}
            rec.update(status="done", grade=summary.get("grade"), counts=(report.get("vulnerabilities") or {}).get(
                "counts"), remaining=len(left))
            good = {"lap": lap, "report": report, "left": left}
            self._save()
            STORE.append_log(self.build_id, "[pit] lap %d: grade %s, %d of the %d findings worked on left\n" % (
                lap, summary.get("grade") or "?", len(left), len(p["pairs"])))
            if not left:
                break
            # another lap only where it could do better: library updates may go a level further. (The same lap
            # again - from the same image, with the same report - would patch the same packages, skip the same.)
            further = p["libraries"] and self.level(lap + 1) != self.level(lap)
            if lap < p["laps"] and not further:
                STORE.append_log(self.build_id, "[pit] no further lap: %s\n" % (
                    "library updates may go no further than %s" % self.level(lap) if p["libraries"]
                    else "Copa found no newer packages for the rest"))
                break
        # back on the track: the patched image is this version, and :latest
        self.advance("pit-out", "Back on the track")
        retag(repo, str(self.version), "latest")
        _, digest = manifest(repo, str(self.version))
        size = image_size(repo, str(self.version))
        report = good["report"]
        before, after = p.get("before") or {}, report_summary(report) or {}
        p.update(after={"grade": after.get("grade"), "counts": (report.get("vulnerabilities") or {}).get("counts")},
                 ref="%s/%s:%d" % (PULL_PREFIX, repo, self.version),
                 fixed=len(p["pairs"]) - len(good["left"]), outcome="on-track")
        self._save()
        STORE.set(self.image_id, status="ready", version=self.version, ref=self.target_ref, digest=digest, size=size,
                  builtAt=now(), builtBy=self.user, report=report)
        self.done = {k for k, _ in self.plan}
        STORE.update_build(self.build_id, status="ready", progress=1.0, stage="done", finished_at=now(),
                           message="Back on the track: %s/%s:%d - grade %s (was %s)" % (
                               PULL_PREFIX, repo, self.version, after.get("grade") or "?",
                               before.get("grade") or "?"), steps=self.steps())
        if LOG:
            LOG(event="image-pit-stop-done", image=self.image_id, build=self.build_id, version=self.version,
                laps=len(p.get("history", [])), fixed=p["fixed"], grade=after.get("grade"), was=before.get("grade"))

    def fail(self, error):
        super().fail(error)
        # the pit lane's headline: what stopped it, not the station it was at
        STORE.update_build(self.build_id, message="Cancelled" if self.cancelled else error.strip().split("\n")[0][:200])
        st = pit_state(self.build_id)
        if st:
            st["outcome"] = "cancelled" if self.cancelled else "failed"
            STORE.put_setting("pit-%d" % self.build_id, st)


def push_blob(repo, data):
    """A blob into the builder's registry (in one upload), unless it is there: its digest."""
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    try:
        with registry("HEAD", "%s/blobs/%s" % (repo, digest), accept="*/*", timeout=30):
            return digest
    except urllib.error.HTTPError as e:
        e.close()
    req = urllib.request.Request("http://%s/v2/%s/blobs/uploads/" % (REGISTRY, repo), data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        loc = r.headers.get("Location") or ""
    if loc.startswith("/"):
        loc = "http://%s%s" % (REGISTRY, loc)
    loc += ("&" if "?" in loc else "?") + "digest=" + urllib.parse.quote(digest)
    urllib.request.urlopen(urllib.request.Request(loc, data=data, method="PUT", headers={
        "Content-Type": "application/octet-stream"}), timeout=300).read()
    return digest


def put_manifest(repo, ref, body, ctype):
    """A manifest into the builder's registry, under a tag (or, ref None, its digest): its digest."""
    digest = "sha256:" + hashlib.sha256(body).hexdigest()
    urllib.request.urlopen(urllib.request.Request("http://%s/v2/%s/manifests/%s" % (REGISTRY, repo, ref or digest),
                                                  data=body, method="PUT", headers={"Content-Type": ctype}),
                           timeout=60).read()
    return digest


def image_env(repo, ref, out_tag, add=None, drop=()):
    """repo:ref again as repo:out_tag with its configuration's environment changed - `add` ({name: value}) set,
    `drop` (names) taken out: a new configuration and manifest over the same layers, no build. Of an index, each
    image's (its attestations left out: they name the manifests as they were). The new manifest's digest."""
    names = set(drop) | set(add or {})
    pack = lambda obj: json.dumps(obj, separators=(",", ":")).encode()  # noqa: E731

    def edit(m):
        with registry("GET", "%s/blobs/%s" % (repo, m["config"]["digest"]), accept="*/*") as r:
            cfg = json.loads(r.read())
        conf = cfg.setdefault("config", {})
        conf["Env"] = [e for e in conf.get("Env") or [] if e.split("=", 1)[0] not in names] + [
            "%s=%s" % kv for kv in (add or {}).items()]
        blob = pack(cfg)
        return dict(m, config=dict(m["config"], digest=push_blob(repo, blob), size=len(blob)))

    with registry("GET", "%s/manifests/%s" % (repo, ref)) as r:
        top = json.loads(r.read())
        ctype = r.headers.get("Content-Type") or top.get("mediaType")
    if not top.get("manifests"):
        return put_manifest(repo, out_tag, pack(edit(top)), ctype)
    kept = []
    for x in top["manifests"]:
        if (x.get("platform") or {}).get("architecture") in (None, "unknown"):
            continue
        with registry("GET", "%s/manifests/%s" % (repo, x["digest"])) as r:
            m, mtype = json.loads(r.read()), r.headers.get("Content-Type") or x.get("mediaType")
        body = pack(edit(m))
        kept.append(dict(x, digest=put_manifest(repo, None, body, mtype), size=len(body)))
    return put_manifest(repo, out_tag, pack(dict(top, manifests=kept)), ctype)


def delete_manifest(repo, ref):
    """A tag's manifest out of the builder's registry (every tag on it goes; its blobs stay until garbage
    collection)."""
    with registry("HEAD", "%s/manifests/%s" % (repo, ref), timeout=30) as r:
        digest = r.headers.get("Docker-Content-Digest")
    urllib.request.urlopen(urllib.request.Request("http://%s/v2/%s/manifests/%s" % (REGISTRY, repo, digest),
                                                  method="DELETE"), timeout=60).read()


def retag(repo, tag, new):
    """Another tag of the same manifest in the builder's registry (its :latest)."""
    with registry("GET", "%s/manifests/%s" % (repo, tag)) as r:
        body, ctype = r.read(), r.headers.get("Content-Type")
    req = urllib.request.Request("http://%s/v2/%s/manifests/%s" % (REGISTRY, repo, new), data=body, method="PUT",
                                 headers={"Content-Type": ctype})
    urllib.request.urlopen(req, timeout=60).read()


def start_pit_stop(image_id, options, user):
    """A pit stop for an image (options: keys - the findings chosen, [{id, pkg}], none: every fixable one -,
    libraries, level and maxLevel, laps): (target entry, build id)."""
    img = STORE.image(image_id)
    if not img:
        raise ValueError("No such image.")
    if not img.get("report"):
        raise ValueError("Scan the image first: a pit stop starts from its report.")
    if STORE.active_build(image_id):
        raise ValueError("This image is in the pit already, or being built or scanned.")
    libraries = bool(options.get("libraries"))
    level = str(options.get("level") or "patch")
    max_level = str(options.get("maxLevel") or level)
    if level not in COPA_LEVELS or max_level not in COPA_LEVELS:
        raise ValueError("Library updates: patch, minor or major.")
    if COPA_LEVELS.index(max_level) < COPA_LEVELS.index(level):
        max_level = level
    try:
        laps = int(options.get("laps") or 2)
    except (TypeError, ValueError):
        raise ValueError("Laps: 1 to %d." % PIT_MAX_LAPS) from None
    if not 1 <= laps <= PIT_MAX_LAPS:
        raise ValueError("Laps: 1 to %d." % PIT_MAX_LAPS)
    keys = options.get("keys") or []
    if not isinstance(keys, list) or len(keys) > 2000:
        raise ValueError("The findings: a list of {id, pkg}.")
    pairs = pit_keys(img["report"], keys, libraries)
    if not pairs:
        raise ValueError("Nothing to fix: Copa patches OS packages, and Python ones with library patching, that "
                         "have a fixed version; none of the findings chosen is one.")
    source = pit_source(img)
    target = pit_target(img, source, user)
    if target != image_id and STORE.active_build(target):
        raise ValueError("Its patched copy, %s, is in the pit already." % target)
    timg = STORE.image(target)
    version = timg["version"] + 1
    build_id, token = STORE.new_build(target, version, timg["spec"], user)
    summary = report_summary(img["report"]) or {}
    pit = {"source": source, "sourceEntry": image_id, "target": target, "version": version, "libraries": libraries,
           "level": level, "maxLevel": max_level, "laps": laps, "lap": 0, "pairs": sorted(list(k) for k in pairs),
           "chosen": len(keys), "before": {"grade": summary.get("grade"),
                                           "counts": (img["report"].get("vulnerabilities") or {}).get("counts")},
           "by": user, "outcome": "running"}
    STORE.put_setting("pit-%d" % build_id, pit)
    for entry in {image_id, target}:
        STORE.put_setting("pit-latest-%s" % entry, build_id)
    b = PitStop(target, build_id, version, token, timg["spec"], user, pit)
    STORE.update_build(build_id, steps=b.steps())
    BUILDS[build_id] = b
    b.start()
    return target, build_id


def copa_job(image_id, build_id, lap, token):
    """A pit stop's lap: rootless BuildKit as a native sidecar (its socket in the shared /run/copa), and the tools
    image running `imagebuilder.py copa` (the report on lap 1, Copa's patch pushed, the result posted back)."""
    name = job_name("copa%d" % lap, image_id, build_id)
    url = "%s%s/internal/builds/%s/copa/%d" % (SERVICE_URL, BASE, token, lap)
    sock = "/run/copa/buildkitd.sock"
    buildkitd = {"name": "buildkitd", "image": BUILDKIT_IMAGE, "imagePullPolicy": "IfNotPresent",
                 "restartPolicy": "Always",
                 "command": ["rootlesskit", "buildkitd", "--addr", "unix://" + sock, "--oci-worker-no-process-sandbox",
                             "--config", "/etc/buildkit/buildkitd.toml"],
                 "resources": {"requests": {"cpu": "500m", "memory": "1Gi"},
                               "limits": {"cpu": BUILD_CPU, "memory": BUILD_MEMORY}},
                 "volumeMounts": [{"name": "cfg", "mountPath": "/etc/buildkit"}, {"name": "run", "mountPath": "/run/copa"},
                                  {"name": "state", "mountPath": "/home/user/.local/share/buildkit"}]}
    copa = {"name": "copa", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
            "command": ["python3", "/app/imagebuilder.py", "copa", url],
            "env": [{"name": "TRIVY_INSECURE", "value": "true"}, {"name": "HOME", "value": "/tmp"},
                    {"name": "BUILDER_REGISTRY", "value": REGISTRY}, {"name": "COPA_ADDR", "value": "unix://" + sock},
                    {"name": "PIT_TIMEOUT_MINUTES", "value": str(PIT_TIMEOUT_MINUTES)}],
            "resources": {"requests": {"cpu": "250m", "memory": "512Mi"}, "limits": {"cpu": "2", "memory": "4Gi"}},
            "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
            "volumeMounts": [{"name": "run", "mountPath": "/run/copa"}, {"name": "tmp", "mountPath": "/tmp"}]}
    init = [buildkitd]
    if securitydata.active_bundle():
        sec_url = "%s%s/internal/builds/%s/security-data.tar.gz" % (SERVICE_URL, BASE, token)
        init.insert(0, {"name": "security-data", "image": TOOLS_IMAGE, "imagePullPolicy": "IfNotPresent",
                        "command": ["python3", "/app/securitydata.py", "fetch", sec_url, "/sec"],
                        "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
                        "resources": {"requests": {"cpu": "100m", "memory": "256Mi"}, "limits": {"memory": "1Gi"}},
                        "volumeMounts": [{"name": "sec", "mountPath": "/sec"}]})
        copa["env"].append({"name": "SECURITY_DIR", "value": "/sec"})
        copa["volumeMounts"].append({"name": "sec", "mountPath": "/sec", "readOnly": True})
    spec = pod_spec([copa], init, unconfined=True)
    spec["volumes"] += [{"name": "cfg", "configMap": {"name": "coder-image-builder"}}, {"name": "run", "emptyDir": {}},
                        {"name": "state", "emptyDir": {}}, {"name": "tmp", "emptyDir": {}}]
    if securitydata.active_bundle():
        spec["volumes"].append({"name": "sec", "emptyDir": {"sizeLimit": "8Gi"}})
    if PULL_SECRETS:  # an image from your registry (EKS): BuildKit, Copa and trivy sign in with the pull secret
        spec["volumes"].append({"name": "docker", "secret": {"secretName": PULL_SECRETS[0]["name"], "items": [
            {"key": ".dockerconfigjson", "path": "config.json"}]}})
        buildkitd["volumeMounts"].append({"name": "docker", "mountPath": "/home/user/.docker"})
        copa["volumeMounts"].append({"name": "docker", "mountPath": "/docker"})
        copa["env"].append({"name": "DOCKER_CONFIG", "value": "/docker"})
    return name, job_body(name, image_id, build_id, "copa", spec)


def _forward(port, target):
    """127.0.0.1:port -> target (host:port), every connection in threads of its own: the builder's registry as
    localhost for the pit stop's Job (Copa's registry client talks plain HTTP to localhost only)."""
    import socket
    host, tport = target.rsplit(":", 1)
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(64)

    def pipe(a, b):
        try:
            while True:
                data = a.recv(1 << 16)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s_ in (a, b):
                try:
                    s_.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def serve():
        while True:
            c, _ = srv.accept()
            try:
                u = socket.create_connection((host, int(tport)), timeout=30)
                u.settimeout(None)
            except OSError:
                c.close()
                continue
            threading.Thread(target=pipe, args=(c, u), daemon=True).start()
            threading.Thread(target=pipe, args=(u, c), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()


def pit_filter(report, pairs):
    """trivy's JSON report with only the findings worked on ((vulnerability id, package) pairs), in OS packages and
    Python environments only, and only the results that keep one: what Copa patches."""
    wanted = {tuple(k) for k in pairs}
    for res in report.get("Results") or []:
        ours = res.get("Class") == "os-pkgs" or res.get("Type") in PIT_PYTHON_TYPES
        res["Vulnerabilities"] = [v for v in res.get("Vulnerabilities") or []
                                  if ours and (v.get("VulnerabilityID"), v.get("PkgName")) in wanted]
    report["Results"] = [r for r in report.get("Results") or [] if r.get("Vulnerabilities")]
    return report


def copa(url):
    """The pit stop's Job (one lap): the plan from the service; on lap 1 a trivy report of the image (the findings
    worked on only), else lap 1's; then Copa, through the BuildKit beside it, pushing the patched image; its summary
    and VEX document posted back. Exits with Copa's status."""
    def call(method, path="", body=None):
        req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")

    plan = call("GET")
    registry_ = os.environ.get("BUILDER_REGISTRY", REGISTRY)
    local = lambda ref: PIT_LOCAL + ref[len(registry_):] if ref.startswith(registry_ + "/") else ref  # noqa: E731
    _forward(5000, registry_)
    source, target = local(plan["source"]), local(plan["target"])
    print("[pit] lap %d: %s -> %s" % (plan["lap"], plan["source"], plan["target"]), flush=True)
    report = plan.get("report")
    if not report:
        print("[pit] report: trivy on %s (%s packages)" % (plan["source"], "OS and Python" if plan["libraries"]
                                                             else "OS"), flush=True)
        data = securitydata.job_stamp(os.environ.get("SECURITY_DIR"))
        # Java archives aside: Copa does not patch them, and they would need trivy's Java database
        cmd = ["trivy", "image", "--insecure", "--cache-backend", "memory", "--cache-dir", data["cacheDir"],
               "--skip-db-update", "--skip-java-db-update", "--scanners", "vuln", "--ignore-unfixed",
               "--pkg-types", "os,library" if plan["libraries"] else "os", "--format", "json", "--quiet",
               "--skip-files", "**/*.jar", "--skip-files", "**/*.war", "--skip-files", "**/*.ear",
               "--timeout", "45m", source]
        p = subprocess.run(cmd, capture_output=True, timeout=3600)
        if p.returncode != 0:
            print(p.stderr.decode()[-2000:], flush=True)
            sys.exit("[pit] trivy could not read %s" % plan["source"])
        report = pit_filter(json.loads(p.stdout or b"{}"), plan["pairs"])
        kept = sum(len(r["Vulnerabilities"]) for r in report["Results"])
        print("[pit] report: %d findings to fix in %d places" % (kept, len(report["Results"])), flush=True)
        call("POST", "/report", report)
    with open("/tmp/report.json", "w") as f:
        json.dump(report, f)
    for _ in range(120):
        if os.path.exists(os.environ.get("COPA_ADDR", "")[len("unix://"):]):
            break
        time.sleep(1)
    args = ["copa", "patch", "-i", source, "-r", "/tmp/report.json", "-t", target, "--push",
            "--addr", os.environ.get("COPA_ADDR", ""), "--ignore-errors", "--progress", "plain",
            "--timeout", "%sm" % os.environ.get("PIT_TIMEOUT_MINUTES", "90"), "-f", "openvex", "-o", "/tmp/vex.json"]
    env = dict(os.environ)
    if plan["libraries"]:
        args += ["--pkg-types", "os,library", "--library-patch-level", plan["level"]]
        env["COPA_EXPERIMENTAL"] = "1"
    print("[pit] patch: copa %s" % " ".join(args[1:]), flush=True)
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    summary = None
    pushed = False
    for line in proc.stdout:
        print(line.rstrip("\n"), flush=True)
        m = PIT_SUMMARY.search(line)
        if m:
            summary = {"total": int(m.group(1)), "patched": int(m.group(2)), "skipped": int(m.group(3))}
        if "Patched image" in line:
            pushed = True
    code = proc.wait()
    vex = None
    try:
        with open("/tmp/vex.json") as f:
            vex = json.load(f)
    except (OSError, ValueError):
        pass
    fixed = sorted({(s_.get("vulnerability") or {}).get("name") for s_ in (vex or {}).get("statements") or []} - {None})
    call("POST", "/result", {"exit": code, "summary": summary, "pushed": pushed and code == 0,
                             "vex": {"fixed": fixed[:500], "statements": len((vex or {}).get("statements") or [])}})
    sys.exit(code)


INDEX_TYPES = ("application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json")


def complete_layout(path):
    """A `docker save` from Docker's containerd image store names every platform of a multi-platform image in its OCI
    index (index.json), but holds only the platforms that were pulled; regctl then finds blobs missing. Point the index
    at the platform manifests the archive holds (linux/amd64 first). The archive is rewritten only when it must be."""
    def blob(digest):
        return "blobs/" + digest.replace(":", "/")
    with tarfile.open(path) as tf:
        names = set(tf.getnames())
        if "index.json" not in names:
            return False
        index = json.load(tf.extractfile("index.json"))
        manifests, changed = [], False
        for desc in index.get("manifests") or []:
            if desc.get("mediaType") not in INDEX_TYPES or blob(desc.get("digest", "")) not in names:
                manifests.append(desc)
                continue
            children = json.load(tf.extractfile(blob(desc["digest"]))).get("manifests") or []
            present = [m for m in children if blob(m.get("digest", "")) in names]
            if len(present) == len(children):
                manifests.append(desc)
                continue
            if not present:
                raise ValueError("The archive holds none of the platforms its index names.")
            pick = next((m for m in present if (m.get("platform") or {}).get("architecture") == "amd64"
                         and (m.get("platform") or {}).get("os", "linux") == "linux"), present[0])
            manifests.append(dict(pick, annotations=desc.get("annotations") or {}))
            changed = True
    if not changed:
        return False
    index["manifests"] = manifests
    data = json.dumps(index).encode()
    with tarfile.open(path) as src, tarfile.open(path + ".fix", "w") as dst:
        for m in src:
            if m.name == "index.json":
                info = tarfile.TarInfo("index.json")
                info.size, info.mtime, info.mode = len(data), m.mtime, m.mode
                dst.addfile(info, io.BytesIO(data))
            else:
                dst.addfile(m, src.extractfile(m) if m.isfile() else None)
    os.replace(path + ".fix", path)
    return True


def import_upload(h, q_, user):
    """An image archive streamed to the builder volume (gzip is taken off as it comes), then imported."""
    first = lambda k: (q_.get(k) or [""])[0]  # noqa: E731
    name, description, filename = first("name"), first("description"), first("file") or "image.tar"
    if not NAME_RE.match(name.strip().lower()):
        raise ValueError("A name of 3-40 lowercase letters, digits and dashes (it becomes the image's name).")
    n = int(h.headers.get("Content-Length") or -1)
    if n < 0:
        raise ValueError("The upload needs a Content-Length.")
    if n > IMPORT_MAX:
        raise ValueError("An image archive can be at most %d GB." % (IMPORT_MAX // 1024 ** 3))
    os.makedirs(os.path.join(FILES, "imports"), exist_ok=True)
    if shutil.disk_usage(FILES).free < n * 2.5:
        raise ValueError("Not enough room on the image builder's volume for this archive (imageBuilder.files.size).")
    dest = os.path.join(FILES, "imports", "%s.tar" % secrets.token_hex(8))
    try:
        with open(dest + ".part", "wb") as out:
            left = n
            while left > 0:
                chunk = h.rfile.read(min(1024 * 1024, left))
                if not chunk:
                    raise ValueError("The upload was cut short.")
                out.write(chunk)
                left -= len(chunk)
        with open(dest + ".part", "rb") as f:
            gzipped = f.read(2) == b"\x1f\x8b"
        if gzipped:  # a .tar.gz: regctl takes the tar
            with gzip.open(dest + ".part", "rb") as gz, open(dest, "wb") as out:
                shutil.copyfileobj(gz, out, 1024 * 1024)
            os.remove(dest + ".part")
        else:
            os.replace(dest + ".part", dest)
        if not tarfile.is_tarfile(dest):
            raise ValueError("%s is not an image archive: a `docker save` tar (or .tar.gz) or an OCI layout." % filename)
        if complete_layout(dest):
            LOG(event="image-import-platform", file=filename, note="index pointed at the platform the archive holds")
    except Exception:
        for f in (dest, dest + ".part"):
            try:
                os.remove(f)
            except OSError:
                pass
        raise
    source = {"kind": "upload", "file": dest, "name": re.sub(r"[^A-Za-z0-9._ -]", "_", filename)[:120]}
    image_id, build_id = start_import(name, description, source, user["username"])
    LOG(event="image-import-upload", image=image_id, bytes=n, by=user["username"])
    h.send_json(200, {"image": image_id, "build": build_id})
    return True


def images_in_use():
    """The images workspaces run now (their pods' first container), with which workspaces, and the ones the templates
    run; each with its entry here when it has one."""
    found = {}
    status, pods = kube_call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("com.coder.workspace.id")))
    for pod in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        containers = (pod.get("spec") or {}).get("containers") or []
        if not containers or (pod.get("status") or {}).get("phase") not in ("Running", "Pending"):
            continue
        labels = (pod.get("metadata") or {}).get("labels") or {}
        ws = "%s/%s" % (labels.get("com.coder.user.username", "?"), labels.get("com.coder.workspace.name", "?"))
        found.setdefault(containers[0]["image"], {"workspaces": [], "templates": []})["workspaces"].append(ws)
    for t in TEMPLATES:
        if t.get("image"):
            found.setdefault(t["image"], {"workspaces": [], "templates": []})["templates"].append(
                t.get("displayName") or t.get("name"))
    entries = {}
    for img in STORE.images():
        if img.get("pullRef"):
            entries[img["pullRef"]] = img["id"]
        if (img.get("tracked") or {}).get("image"):
            entries[img["tracked"]["image"]] = img["id"]
        if (img.get("scanned") or {}).get("image"):
            entries[img["scanned"]["image"]] = img["id"]
    return sorted(({"image": k, "workspaces": sorted(v["workspaces"]), "templates": sorted(v["templates"]),
                    "entry": entries.get(k)} for k, v in found.items()),
                  key=lambda x: (-len(x["workspaces"]), x["image"]))


def images_on_nodes():
    """Every image the nodes hold, each once (its names there together), with the nodes, its size, whether a
    workspace runs it, and its entry here when it has one (a scan, an import, a build, the workspace image)."""
    entries = {}
    for img in STORE.images():
        for key in ("pullRef", "ref"):
            if img.get(key):
                entries.setdefault(img[key], img["id"])
        for kind in ("tracked", "scanned"):
            if (img.get(kind) or {}).get("image"):
                entries[img[kind]["image"]] = img["id"]
    running = {e["image"] for e in images_in_use() if e["workspaces"]}
    out = []
    for g in node_image_groups():
        # its readable name (a tag) first; digests as the other names
        refs = sorted(g["names"], key=lambda r: ("@" in r, r))
        main = refs[0]
        entry = next((entries[r] for r in refs if r in entries), None) or entries.get(
            in_builder_registry(main) or "", None)
        out.append({"image": main, "names": refs[1:], "sizeBytes": g["sizeBytes"], "nodes": sorted(g["nodes"]),
                    "running": any(r in running for r in refs), "entry": entry})
    out.sort(key=lambda x: (not x["running"], x["entry"] is None, x["image"]))
    return out


RESCAN_ALL = {"running": False, "queued": [], "done": [], "failed": [], "startedAt": None}


def rescan_all(user):
    """Every built image scanned again, one after another (each scan can take a few GB of memory)."""
    if RESCAN_ALL["running"]:
        raise ValueError("A rescan of every image is running already.")
    ids = [i["id"] for i in STORE.images() if i.get("pullRef") and not STORE.active_build(i["id"])]
    RESCAN_ALL.update(running=True, queued=list(ids), done=[], failed=[], startedAt=now())

    def run():
        try:
            for image_id in ids:
                try:
                    build_id = start_rescan(image_id, user)
                    BUILDS[build_id].join()
                    ok = (STORE.build(build_id) or {}).get("status") == "ready"
                    RESCAN_ALL["done" if ok else "failed"].append(image_id)
                except Exception:  # noqa: BLE001 - the next image is still scanned
                    RESCAN_ALL["failed"].append(image_id)
                RESCAN_ALL["queued"].remove(image_id)
        finally:
            RESCAN_ALL["running"] = False

    threading.Thread(target=run, daemon=True).start()
    return ids


def cancel_build(image_id, build_id):
    b = BUILDS.get(build_id)
    row = STORE.build(build_id)
    if not row or row["image_id"] != image_id:
        raise ValueError("No such build.")
    if b:
        b.cancelled = True
        proc = getattr(b, "proc", None)  # an import's regctl: stopped now, not at its next line
        if proc and proc.poll() is None:
            proc.kill()
    for kind in ("build", "scan"):
        kube_call("DELETE", "/apis/batch/v1/namespaces/%s/jobs/%s?propagationPolicy=Background" % (
            NAMESPACE, job_name(kind, image_id, build_id)))
    if row["status"] in ("queued", "building", "pushing", "scanning"):
        STORE.update_build(build_id, status="cancelled", error="Cancelled.", finished_at=now())
        img = STORE.image(image_id, full=False)
        STORE.set(image_id, status="ready" if img["ref"] else "draft")


def delete_scan(image_id, row):
    """A finished scan's record (the image page's Scans table): its row, its log and the report it made. Where the
    image shows that report, the newest scan of the same image left takes its place; with none left it has no report
    (the workspace template's image is then scanned again: sync_tracked). A build, an import or a pit stop stays: it
    is a version's record, and what offers that version to the templates (workspace_image_choices). What became of
    the image's report: "kept", "earlier" or "none"."""
    if not scan_only(row["steps"]):
        raise ValueError("Only a scan's record can be deleted: a build's goes with its image.")
    report = STORE.setting("report-%d" % row["id"])
    STORE.delete_build(row["id"])
    BUILDS.pop(row["id"], None)
    cur = (STORE.image(image_id) or {}).get("report")
    if not (report and cur and (cur.get("ref"), cur.get("scannedAt")) == (report.get("ref"), report.get("scannedAt"))):
        return "kept"
    kept = (STORE.setting("report-%d" % b["id"]) for b in STORE.builds(image_id, limit=200) if b["status"] == "ready")
    earlier = next((r for r in kept if r and r.get("ref") == cur.get("ref")), None)
    STORE.set(image_id, report=earlier)
    return "earlier" if earlier else "none"


# --------------------------------------------------------------------------- the report
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")

# Findings that cannot apply to a container image, set apart in the report (each listed, with the reason) and left
# out of its counts and grade. Narrow on purpose: anything they do not match counts.
#   kernel-headers   linux-libc-dev carries the Linux kernel's header files (for compiling C programs), so Ubuntu
#                    files every kernel vulnerability under it; a container runs its node's kernel, never one from the
#                    image. Those are fixed by patching the nodes (their kernel), not the image.
#   mozilla-firefox  Ubuntu's firefox package became a snap installer in 2022 and Ubuntu marks every Firefox
#                    vulnerability "fixed" in it (1:1snap1...); an image with Mozilla's own Firefox (packages.mozilla.org:
#                    no epoch, a ~build version) matches them all. Only those at least two years old count as not
#                    applicable: Mozilla ships its fixes within weeks, so a current build has them.
NA_FIREFOX_AGE_DAYS = 730


def not_applicable(v, res):
    """The rule a trivy finding is set apart by (kernel-headers, mozilla-firefox), or None."""
    os_pkg = res.get("Class") == "os-pkgs"
    if os_pkg and v.get("PkgName") == "linux-libc-dev":
        return "kernel-headers"
    if os_pkg and v.get("PkgName") == "firefox" and (v.get("FixedVersion") or "").startswith("1:1snap") \
            and ":" not in (v.get("InstalledVersion") or ":") and "~build" in (v.get("InstalledVersion") or ""):
        try:
            published = datetime.datetime.fromisoformat((v.get("PublishedDate") or "").replace("Z", "+00:00"))
        except ValueError:
            return None
        if (datetime.datetime.now(datetime.timezone.utc) - published).days >= NA_FIREFOX_AGE_DAYS:
            return "mozilla-firefox"
    return None


NA_REASONS = {
    "kernel-headers": "Linux kernel vulnerabilities, filed under the kernel's header files (linux-libc-dev, for "
                      "compiling C programs): a container runs its node's kernel, never one from the image. Patch the "
                      "nodes' kernel.",
    "mozilla-firefox": "Ubuntu's advisories for its own firefox package (a snap installer since 2022), matching this "
                       "image's Mozilla Firefox (packages.mozilla.org); at least two years old, so fixed in Mozilla's "
                       "releases long before this one.",
}


def grade(report):
    v = report.get("vulnerabilities", {}).get("counts", {})
    checks = report.get("checks") or []
    fails = sum(1 for c in checks if c["status"] == "fail")
    warns = sum(1 for c in checks if c["status"] == "warn")
    secrets_n = len(report.get("secrets") or [])
    if report.get("error"):
        return "?"  # not scanned: no grade
    if v.get("CRITICAL", 0) > 0 or secrets_n or fails:
        return "F" if (v.get("CRITICAL", 0) > 5 or secrets_n or fails > 1) else "D"
    if v.get("HIGH", 0) > 20:
        return "D"
    if v.get("HIGH", 0) > 0:
        return "C"
    if v.get("MEDIUM", 0) > 20 or warns > 2:
        return "B"
    return "A"


PY_SITE = re.compile(r"lib/python[0-9.]+/(site|dist)-packages/")


def fix_here(item):
    """A finding the Fix image page can fix with an upgrade in the image (its fixPlan.ts, the same rules): an OS
    package, or a Python one, with a fixed version. Not the packages inside a program the image ships (Go, npm, Java):
    a newer release of the program fixes those."""
    if not item.get("fixed"):
        return False
    cls = item.get("class") or ""
    if cls == "os-pkgs" or (not cls and re.search(r" \([^)]+\)$", item.get("target") or "")):
        return True
    return (item.get("type") in ("python-pkg", "pip") or item.get("target") == "Python"
            or bool(PY_SITE.search(item.get("path") or item.get("target") or "")))


def fixable_counts(report):
    """How many findings of each severity Fix image can fix (fix_here): recorded by the scan (all of them); a report
    from before it, counted from its top findings (all of them when it has 200 or fewer)."""
    v = report.get("vulnerabilities") or {}
    if isinstance(v.get("fixableHereCounts"), dict):
        return v["fixableHereCounts"]
    out = {s_: 0 for s_ in SEVERITIES}
    for item in v.get("top") or []:
        if fix_here(item) and item.get("severity") in out:
            out[item["severity"]] += 1
    return out


GRADE_ORDER = "ABCDF"


def projected_grade(report):
    """The grade the image would have with every finding Fix image can fix fixed (its checks and secrets as they
    are)."""
    if not report or report.get("error"):
        return None
    counts = (report.get("vulnerabilities") or {}).get("counts") or {}
    fixable = fixable_counts(report)
    left = {s_: max(0, counts.get(s_, 0) - fixable.get(s_, 0)) for s_ in SEVERITIES}
    return grade(dict(report, vulnerabilities=dict(report.get("vulnerabilities") or {}, counts=left)))


def needs_fixing(report):
    """Graded D or F, and fixing what has a fix would raise the grade: the Images list's "Needs fixing"."""
    g, p = (report or {}).get("grade"), projected_grade(report)
    return bool(g in ("D", "F") and p and p in GRADE_ORDER and GRADE_ORDER.index(p) < GRADE_ORDER.index(g))


def report_summary(report):
    if not report:
        return None
    v = report.get("vulnerabilities", {})
    return {"grade": report.get("grade"), "counts": v.get("counts", {}), "fixable": v.get("fixable", 0),
            # what Fix image can fix, by severity and in all (fixable: every finding with a fixed version)
            "fixableCounts": fixable_counts(report), "fixableHere": sum(fixable_counts(report).values()),
            "projectedGrade": projected_grade(report),
            "needsFixing": needs_fixing(report),
            "secrets": len(report.get("secrets") or []), "fips": (report.get("fips") or {}).get("status"),
            "scannedAt": report.get("scannedAt"), "dbUpdatedAt": report.get("dbUpdatedAt"),
            "checks": {s: sum(1 for c in report.get("checks") or [] if c["status"] == s) for s in ("pass", "warn", "fail")},
            # what the image adds over its base (addons.json): programs, and the apt packages asked for
            "addons": len((report.get("addons") or {}).get("software") or []),
            "addonPackages": len(((report.get("addons") or {}).get("packages") or {}).get("added") or [])}


# --------------------------------------------------------------------------- the scan (runs in the scan Job)
# The few files the checks read.
WALK_WANTED = re.compile(r"^(etc/(sudoers(\.d/.*)?|ssh/(ssh|sshd)_config(\.d/.*)?|ssh/ssh_host_.*_key|passwd|shadow|group|"
                         r"ssl/openssl\.cnf|ssl/fipsmodule\.cnf|coder-image/.*|os-release)|usr/lib/os-release|var/lib/dpkg/status|"
                         r"usr/share/coder-workspace/addons\.json|"
                         r"(root|home/[^/]+)/\.(bash_history|ssh/id_[a-z0-9]+))$")


def walk_image(ref):
    """The image's files (layers applied in order, whiteouts honoured): {path: (mode, size, type)} and the contents of
    the few files the checks read."""
    host, rest = ref.split("/", 1)
    repo, tag = rest.rsplit(":", 1)
    global REGISTRY
    REGISTRY = host
    m, _ = manifest(repo, tag)
    with registry("GET", "%s/blobs/%s" % (repo, m["config"]["digest"]), accept="*/*") as r:
        config = json.loads(r.read())
    files, contents = {}, {}
    for layer in m["layers"]:
        with registry("GET", "%s/blobs/%s" % (repo, layer["digest"]), accept="*/*", timeout=1800) as r:
            with tarfile.open(fileobj=r, mode="r|*") as tf:
                for ti in tf:
                    path = ti.name.lstrip("./")
                    d, base = os.path.split(path)
                    if base == ".wh..wh..opq":
                        pre = d + "/"
                        for p in [p for p in files if p.startswith(pre)]:
                            files.pop(p, None)
                            contents.pop(p, None)
                        continue
                    if base.startswith(".wh."):
                        gone = os.path.join(d, base[4:])
                        for p in [p for p in files if p == gone or p.startswith(gone + "/")]:
                            files.pop(p, None)
                            contents.pop(p, None)
                        continue
                    t = "d" if ti.isdir() else "l" if ti.issym() or ti.islnk() else "f"
                    files[path] = (ti.mode, ti.size, t)
                    if t == "f" and WALK_WANTED.match(path) and ti.size < 8 * 1024 * 1024:
                        f = tf.extractfile(ti)
                        contents[path] = f.read().decode("utf-8", "replace") if f else ""
                    else:
                        contents.pop(path, None)
    return config, files, contents


def image_checks(config, files, contents):
    checks = []

    def add(cid, title, status, detail, items=None):
        checks.append({"id": cid, "title": title, "status": status, "detail": detail, "items": (items or [])[:30]})

    user = (config.get("config") or {}).get("User") or "root"
    add("user", "Runs as a regular user", "fail" if user in ("", "root", "0", "0:0") else "pass",
        "The image's default user is %s." % (user or "root"))
    shadow = contents.get("etc/shadow", "")
    empty = [line.split(":")[0] for line in shadow.splitlines() if line.count(":") >= 2 and line.split(":")[1] == ""]
    add("passwords", "No account without a password", "fail" if empty else "pass",
        "Accounts anyone can log in to without a password: %s." % ", ".join(empty) if empty
        else "Every account has a password or is locked.", empty)
    root_locked = any(line.startswith("root:") and line.split(":")[1].startswith(("!", "*")) for line in shadow.splitlines())
    add("root", "The root account is locked", "pass" if root_locked else "warn",
        "root has no usable password." if root_locked else "root has a password: lock it (Hardening).")
    sudo = "\n".join(v for k, v in contents.items() if k.startswith("etc/sudoers"))
    nopasswd = [line.strip() for line in sudo.splitlines() if "NOPASSWD" in line and not line.strip().startswith("#")]
    add("sudo", "No passwordless sudo", "warn" if nopasswd else "pass",
        "Anyone with a terminal in the workspace can become root: %d rule(s)." % len(nopasswd) if nopasswd
        else "No NOPASSWD rules.", nopasswd)
    suid = sorted(p for p, (mode, _, t) in files.items() if t == "f" and mode & 0o6000)
    add("setuid", "Few setuid / setgid programs", "warn" if len(suid) > 15 else "pass",
        "%d program(s) run with their owner's or group's rights." % len(suid), ["/" + p for p in suid])
    ww = sorted(p for p, (mode, _, t) in files.items() if t in ("f", "d") and mode & 0o002 and not (mode & 0o1000)
                and not p.startswith(("tmp/", "var/tmp/", "dev/", "proc/", "run/")))
    add("world-writable", "No world-writable files or folders", "warn" if ww else "pass",
        "%d path(s) anyone can change." % len(ww), ["/" + p for p in ww])
    hostkeys = sorted(p for p in contents if p.startswith("etc/ssh/ssh_host_") and p.endswith("_key"))
    add("ssh-host-keys", "No SSH host keys baked in", "warn" if hostkeys else "pass",
        "Every workspace from this image would share these keys." if hostkeys else "None.", ["/" + p for p in hostkeys])
    keys = sorted(p for p in contents if re.search(r"/\.ssh/id_", p))
    hist = sorted(p for p in contents if p.endswith(".bash_history"))
    add("leftovers", "No private keys or shell history in home folders", "fail" if keys else "warn" if hist else "pass",
        "Files that should not ship in an image." if keys or hist else "None.", ["/" + p for p in keys + hist])
    status = contents.get("var/lib/dpkg/status", "")
    pkgs = re.findall(r"^Package: (.+)$", status, re.M)
    add("packages", "Package count", "pass", "%d Debian packages installed." % len(pkgs))
    compilers = [p for p in ("gcc", "g++", "make", "clang") if any(x == p or x.startswith(p + "-") for x in pkgs)]
    add("compilers", "Compilers", "warn" if compilers else "pass",
        "Installed: %s (remove them if workspaces need not build code)." % ", ".join(compilers) if compilers
        else "None installed.", compilers)
    return checks, pkgs


def fips_checks(files, contents, pkgs, rules=None):
    """The image's part of FIPS 140 readiness, graded against the FIPS rules in force (securitydata)."""
    rules = rules or securitydata.rules()
    out = []

    def add(cid, title, status, detail):
        out.append({"id": cid, "title": title, "status": status, "detail": detail})

    module = sorted(p for p in files if re.match(rules["providerPath"], p))
    validated = [p for p in pkgs if p in rules["validatedPackages"]]
    add("module", "A FIPS 140 validated OpenSSL module is installed",
        "pass" if module and validated else "warn" if module else "fail",
        ("Ubuntu Pro FIPS packages: %s." % ", ".join(validated)) if validated
        else ("An OpenSSL FIPS provider (%s) is there, but not from a validated package." % ("/" + module[0]))
        if module else "No FIPS provider. Validated modules come with Ubuntu Pro (openssl-fips-module-3 from its FIPS "
                       "repository, through your mirror); add the package and build again.")
    cnf = contents.get("etc/ssl/openssl.cnf", "")
    add("openssl-default", "OpenSSL uses the FIPS provider by default",
        "pass" if re.search(r"default_properties\s*=\s*fips\s*=\s*yes", cnf) and "fipsmodule.cnf" in cnf else "fail",
        "openssl.cnf makes fips=yes the default." if "fips=yes" in cnf.replace(" ", "") else
        "openssl.cnf does not select the FIPS provider (FIPS-aligned crypto, in the builder, does once a module is there).")
    floor = rules["tls"]["minProtocol"]
    allowed = r"TLSv1\.[23]" if floor == "TLSv1.2" else r"TLSv1\.3"
    tls = re.search(r"MinProtocol\s*=\s*" + allowed, cnf)
    add("tls", "TLS %s or later only" % floor.replace("TLSv", ""), "pass" if tls else "warn",
        "openssl.cnf sets MinProtocol." if tls else "Older TLS versions are allowed by OpenSSL's defaults.")
    ssh = "\n".join(v for k, v in contents.items() if k.startswith("etc/ssh/ssh_config"))
    ciphers = re.findall(r"^\s*Ciphers\s+(\S+)", ssh, re.M | re.I)
    approved = set(rules["ssh"]["ciphers"])
    ok = ciphers and all(set(c.split(",")) <= approved for c in ciphers)
    add("ssh", "SSH uses FIPS-approved ciphers", "pass" if ok else "warn",
        "Ciphers: %s." % ciphers[-1] if ciphers else "SSH's defaults include ciphers FIPS does not approve (chacha20).")
    gnutls = [p for p in pkgs if any(p.startswith(x) for x in rules["nonFipsLibraries"])]
    add("other-libs", "Other crypto libraries", "warn" if gnutls else "pass",
        "GnuTLS / libgcrypt run in FIPS mode only when the host kernel does: %s." % ", ".join(gnutls[:4]) if gnutls
        else "Only OpenSSL.")
    add("kernel", "The host runs in FIPS mode", "info",
        "A container shares its node's kernel: FIPS mode (fips=1) is set on the nodes, not in the image.")
    by_id = {c["id"]: c["status"] for c in out}
    problems = [c for c in out if c["status"] in ("fail", "warn")]
    if by_id["module"] == "pass" and by_id["openssl-default"] == "pass" and not problems:
        status = "ready"
    elif by_id["module"] == "fail" and by_id["openssl-default"] == "fail":
        status = "not-ready"
    else:
        status = "partial"
    return {"status": status, "checks": out,
            "rules": {"version": rules.get("version"), "published": rules.get("published"),
                      "standard": rules.get("standard")},
            "note": "An image cannot be FIPS certified on its own: it needs a validated module, FIPS mode on its "
                    "nodes, and applications that use them. This checks the image's part."}


def _post_to(report_url):
    def post(body):
        req = urllib.request.Request(report_url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=60).read()
    return post


def _trivy(target, data, rootfs=False):
    """trivy's findings on an image (in a registry) or on a directory of its files: (parsed JSON, error or None)."""
    cmd = ["trivy", "rootfs" if rootfs else "image", "--cache-backend", "memory", "--cache-dir", data["cacheDir"],
           "--skip-db-update", "--skip-java-db-update", "--scanners", "vuln,secret",
           "--format", "json", "--quiet", "--timeout", "25m"]
    if not rootfs:
        cmd.insert(2, "--insecure")
    if not data["java"]:
        # Java archives need trivy's Java database: without one (the bundled data), they are not analysed
        cmd += ["--skip-files", "**/*.jar", "--skip-files", "**/*.war", "--skip-files", "**/*.ear"]
    p = subprocess.run(cmd + [target], capture_output=True, timeout=1800)
    try:
        t = json.loads(p.stdout or b"{}")
    except ValueError:
        t = {}
    if p.returncode != 0 and not t:
        return t, "trivy: " + p.stderr.decode()[-600:]
    return t, None


def _report(ref, t, error, data, config, files, contents, source):
    """The report from trivy's findings and the image's files (the same whichever way they were read)."""
    report = {"ref": ref, "scannedAt": now(), "data": data["stamp"], "source": source}
    if error:
        report["error"] = error
    vulns, secrets_, na = [], [], {}
    for res in t.get("Results") or []:
        for v in res.get("Vulnerabilities") or []:
            item = {"id": v.get("VulnerabilityID"), "pkg": v.get("PkgName"), "installed": v.get("InstalledVersion"),
                    "fixed": v.get("FixedVersion") or "", "severity": v.get("Severity", "UNKNOWN"),
                    "title": (v.get("Title") or v.get("Description") or "")[:160], "target": res.get("Target"),
                    # how it was found: an OS package (os-pkgs, its type the distribution) or a language's
                    # (lang-pkgs: python-pkg, node-pkg, gobinary, jar...): the fix page groups by it
                    "class": res.get("Class") or "", "type": res.get("Type") or "",
                    # where a language's package is (trivy groups them as "Python", "Node.js"): its environment
                    "path": v.get("PkgPath") or ""}
            rule = not_applicable(v, res)
            if rule:
                na.setdefault(rule, []).append(item)
            else:
                vulns.append(item)
        for s_ in res.get("Secrets") or []:
            secrets_.append({"rule": s_.get("RuleID"), "title": s_.get("Title"), "severity": s_.get("Severity"),
                             "target": res.get("Target"), "line": s_.get("StartLine")})
    counts = {s_: sum(1 for v in vulns if v["severity"] == s_) for s_ in SEVERITIES}
    order = {s_: i for i, s_ in enumerate(SEVERITIES)}
    vulns.sort(key=lambda v: (order.get(v["severity"], 9), v["fixed"] == "", v["pkg"] or ""))
    report["vulnerabilities"] = {"counts": counts, "total": len(vulns), "fixable": sum(1 for v in vulns if v["fixed"]),
                                 # all of them, not only the top 200: what Fix image can fix (the projected grade)
                                 "fixableHereCounts": {s_: sum(1 for v in vulns if v["severity"] == s_ and fix_here(v))
                                                       for s_ in SEVERITIES},
                                 "top": vulns[:200], "scanned": not report.get("error"),
                                 "os": (t.get("Metadata") or {}).get("OS"),
                                 "javaScanned": data["java"],
                                 "note": "" if data["java"] else "Java archives (.jar) are not checked: load security "
                                         "data with the Java database (Images > Settings) to check them.",
                                 # set apart, each rule with its reason, how many, and the findings (the first 100)
                                 "notApplicable": [
                                     {"rule": rule, "reason": NA_REASONS[rule], "total": len(items),
                                      "counts": {s_: sum(1 for x in items if x["severity"] == s_) for s_ in SEVERITIES},
                                      "packages": sorted({x["pkg"] for x in items}),
                                      "items": sorted(items, key=lambda x: order.get(x["severity"], 9))[:100]}
                                     for rule, items in sorted(na.items())]}
    report["secrets"] = secrets_[:50]
    report["dbUpdatedAt"] = data["stamp"]["vulnerabilityDbUpdatedAt"]
    checks, pkgs = image_checks(config, files, contents)
    report["checks"] = checks
    report["fips"] = fips_checks(files, contents, pkgs, data["rules"] or None)
    release = contents.get("etc/os-release") or contents.get("usr/lib/os-release") or ""
    report["os"] = (re.search(r'^PRETTY_NAME="?([^"\n]+)', release, re.M) or [None, None])[1]
    report["addons"] = addons_of(contents.get(ADDONS_PATH))
    report["grade"] = grade(report)
    return report


def scan(ref, report_url):
    """The scan Job: trivy (vulnerabilities, secrets) on the image in the registry, then the image's files."""
    post = _post_to(report_url)
    post({"progress": "scan"})
    # the security data in force: fetched by the init container (an uploaded set), else the bundled
    data = securitydata.job_stamp(os.environ.get("SECURITY_DIR"))
    t, error = _trivy(ref, data)
    post({"progress": "checks"})
    config, files, contents = walk_image(ref)
    post({"report": _report(ref, t, error, data, config, files, contents, "registry")})


def walk_rootfs(root):
    """walk_image's answer for a directory of the image's files: {path: (mode, size, type)} and the checks' files."""
    files, contents = {}, {}
    for d, dirs, names in os.walk(root):
        for name in dirs + names:
            full = os.path.join(d, name)
            path = os.path.relpath(full, root)
            try:
                st = os.lstat(full)
            except OSError:
                continue
            t = "d" if os.path.isdir(full) and not os.path.islink(full) else "l" if os.path.islink(full) else "f"
            files[path] = (st.st_mode, st.st_size, t)
            if t == "f" and WALK_WANTED.match(path) and st.st_size < 8 * 1024 * 1024:
                try:
                    with open(full, "rb") as f:
                        contents[path] = f.read().decode("utf-8", "replace")
                except OSError:
                    pass
    return files, contents


def scan_rootfs(ref, report_url, out):
    """The node scan Job: trivy on the image's files copied out of a node's copy (out/rootfs), then the same checks
    (its default user as the image ran it: out/uid)."""
    post = _post_to(report_url)
    post({"progress": "scan"})
    data = securitydata.job_stamp(os.environ.get("SECURITY_DIR"))
    root = os.path.join(out, "rootfs")
    t, error = _trivy(root, data, rootfs=True)
    if error is None and not os.listdir(root):
        error = "The image's files could not be copied out of the node's copy of it."
    post({"progress": "checks"})
    try:
        with open(os.path.join(out, "uid")) as f:
            uid = f.read().strip()
    except OSError:
        uid = ""
    config = {"config": {"User": "" if uid in ("", "0") else uid}}
    files, contents = walk_rootfs(root)
    post({"report": _report(ref, t, error, data, config, files, contents, "node")})


def addons_of(text_):
    """The image's add-ons (addons.json, written by the workspace image's build), checked and kept small; or None."""
    try:
        d = json.loads(text_ or "")
    except ValueError:
        return None
    if not isinstance(d, dict) or not isinstance(d.get("software"), list):
        return None
    clip = lambda v, n=200: str(v)[:n] if v is not None else None  # noqa: E731
    pk = d.get("packages") if isinstance(d.get("packages"), dict) else {}
    py = d.get("python") if isinstance(d.get("python"), dict) else {}
    return {
        "base": clip(d.get("base")), "builtAt": clip(d.get("builtAt"), 40),
        "software": [{"name": clip(x.get("name"), 80), "what": clip(x.get("what")), "group": clip(x.get("group"), 40),
                      "version": clip(x.get("version"), 80)} for x in d["software"][:200] if isinstance(x, dict)],
        "packages": {"added": [{"name": clip(x.get("name"), 120), "version": clip(x.get("version"), 120)}
                               for x in (pk.get("added") or [])[:2000] if isinstance(x, dict)],
                     "dependencies": int(pk.get("dependencies") or 0), "upgraded": int(pk.get("upgraded") or 0),
                     "installed": int(pk.get("installed") or 0)},
        "python": {"environment": clip(py.get("environment")),
                   "packages": [{"name": clip(x.get("name"), 120), "version": clip(x.get("version"), 80)}
                                for x in (py.get("packages") or [])[:2000] if isinstance(x, dict)]},
    }


def fetch_context(url, dest):
    with urllib.request.urlopen(url, timeout=600) as r:
        with tarfile.open(fileobj=r, mode="r|") as tf:
            tf.extractall(dest, filter="data")


# --------------------------------------------------------------------------- the API (called by ui-service's handler)
def can_edit(user, admin_roles):
    return bool(set(user.get("roles") or []) & (set(admin_roles) | EDIT_EXTRA_ROLES))


def handle_internal(h, method, path):
    """Build and scan Jobs: token-protected, no user."""
    m = re.match(r"^%s/internal/builds/([A-Za-z0-9_-]{20,})/(context\.tar|report|security-data\.tar\.gz|"
                 r"copa/[1-9](?:/report|/result)?)$" % BASE, path)
    if not m or not STORE:
        return False
    b = STORE.build(token=m.group(1))
    if not b or b["status"] in ("ready", "failed", "cancelled"):
        h.send(404, "not found\n")
        return True
    if m.group(2).startswith("copa/"):
        return pit_internal(h, method, b, m.group(2))
    if m.group(2) == "context.tar" and method == "GET":
        spec = json.loads(b["spec"])
        h.send_response(200)
        h.send_header("Content-Type", "application/x-tar")
        h.send_header("Connection", "close")
        h.end_headers()
        h.close_connection = True
        context_tar(spec, b["image_id"], b["version"], base_ref_for(spec), h.wfile)
        return True
    if m.group(2) == "security-data.tar.gz" and method == "GET":
        bundle = securitydata.active_bundle()
        if not bundle:
            h.send(404, "no uploaded security data\n")
            return True
        h.send_response(200)
        h.send_header("Content-Type", "application/gzip")
        h.send_header("Content-Length", str(os.path.getsize(bundle)))
        h.send_header("Connection", "close")
        h.end_headers()
        h.close_connection = True
        with open(bundle, "rb") as f:
            shutil.copyfileobj(f, h.wfile, 1024 * 1024)
        return True
    if m.group(2) == "report" and method == "POST":
        n = int(h.headers.get("Content-Length") or 0)
        if n > 64 * 1024 * 1024:
            h.send(413, "too large\n")
            return True
        body = json.loads(h.rfile.read(n) or b"{}")
        run = BUILDS.get(b["id"])
        if body.get("progress") and run:
            run.advance(body["progress"])
        if body.get("report"):
            STORE.put_setting("report-%d" % b["id"], body["report"])
            STORE.update_build(b["id"], stage="checks-done")
        h.send_json(200, {"ok": True})
        return True
    return False


def pit_internal(h, method, b, what):
    """The pit stop's Job: its lap's plan (GET copa/<lap>), lap 1's report of what to fix (POST copa/1/report: later
    laps get it with their plan), and the lap's result (POST copa/<lap>/result)."""
    parts = what.split("/")
    lap = int(parts[1])
    st = pit_state(b["id"])
    run = BUILDS.get(b["id"])
    if not st or not isinstance(run, PitStop):
        h.send(404, "not a pit stop\n")
        return True
    if len(parts) == 2 and method == "GET":
        # Copa's source: the image, or (Python) its copy that lets pip into environments the distribution manages
        h.send_json(200, {"lap": lap, "source": st.get("copaSource") or st["source"], "target": run.target_ref,
                          "libraries": st["libraries"],
                          "level": run.level(lap), "pairs": st["pairs"],
                          "report": STORE.setting("pit-report-%d" % b["id"])})
        return True
    if method != "POST":
        h.send(405, "method not allowed\n")
        return True
    n = int(h.headers.get("Content-Length") or 0)
    if n > 64 * 1024 * 1024:
        h.send(413, "too large\n")
        return True
    body = json.loads(h.rfile.read(n) or b"null")
    if parts[2] == "report":
        STORE.put_setting("pit-report-%d" % b["id"], body)
    else:
        STORE.put_setting("pit-result-%d-%d" % (b["id"], lap), body if isinstance(body, dict) else {})
    h.send_json(200, {"ok": True})
    return True


def upload_csrf_ok(h):
    """ui-service's cross-site check for a file upload: the same, except that the body is the file, not JSON."""
    if h.headers.get("X-Requested-With") != "coder-ui":
        return False
    origin = h.headers.get("Origin")
    if origin and urllib.parse.urlsplit(origin).netloc != h.headers.get("Host"):
        return False
    return h.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")


def read_json(h, limit=8 * 1024 * 1024):
    n = int(h.headers.get("Content-Length") or 0)
    if n > limit:
        raise ValueError("The request is too large.")
    data = json.loads(h.rfile.read(n) or b"{}") if n else {}
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def handle(h, method, path, query, admin_roles):
    """The Images API. True when it answered."""
    if not path.startswith(BASE + "/api/images"):
        return False
    if not ENABLED or not STORE:
        h.send_json(404, {"error": "The image builder is not enabled."})
        return True
    if method == "PUT" and not upload_csrf_ok(h) or method == "POST" and not h.csrf_ok():
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user()
    if err:
        return True
    editor = can_edit(user, admin_roles)
    admin = bool(set(user.get("roles") or []) & set(admin_roles))
    # Images is the admins' alone (the dashboard shows it to no one else)
    if not admin:
        h.send_json(403, {"error": "Images is for admins only."})
        return True
    rest = path[len(BASE + "/api/images"):]
    try:
        return route(h, method, rest, query, user, editor, admin)
    except ValueError as e:
        h.send_json(400, {"error": str(e)})
        return True


def need(editor):
    if not editor:
        raise PermissionError


def route(h, method, rest, query, user, editor, admin):
    q_ = urllib.parse.parse_qs(query)
    try:
        if rest in ("", "/") and method == "GET":
            return h.send_json(200, {"images": with_pit(STORE.images()), "canEdit": editor, "pullPrefix": PULL_PREFIX,
                                     "baseImage": BASE_IMAGE.rsplit("/", 1)[-1],
                                     "templates": [{"name": t.get("name"), "displayName": t.get("displayName")}
                                                   for t in TEMPLATES if t.get("name")]}) or True
        if rest in ("", "/") and method == "POST":
            need(editor)
            body = read_json(h)
            image_id = str(body.get("name") or "").strip().lower()
            if not NAME_RE.match(image_id):
                raise ValueError("A name of 3-40 lowercase letters, digits and dashes (it becomes the image's name).")
            if image_id in RESERVED_NAMES:
                raise ValueError("'%s' is a name the Images view uses itself: pick another." % image_id)
            if STORE.image(image_id, full=False):
                raise ValueError("There is an image called '%s' already." % image_id)
            spec = clean_spec(dict(empty_spec(), base=body.get("base") or {"kind": "workspace"}), image_id)
            STORE.create(image_id, text(body.get("description"), 2000, "The description"), spec, user["username"])
            LOG(event="image-created", image=image_id, by=user["username"])
            return h.send_json(200, {"image": STORE.image(image_id)}) or True
        if rest == "/apt-check" and method == "POST":
            body = read_json(h)
            names = [str(n).strip() for n in body.get("packages") or [] if str(n).strip()][:500]
            bad = [n for n in names if not PKG_RE.match(n)]
            results = APT.check([n for n in names if PKG_RE.match(n)])
            for n in bad:
                results[n] = {"available": False, "invalid": True}
            return h.send_json(200, {"results": results, "index": APT.status()}) or True
        if rest == "/apt-search" and method == "GET":
            return h.send_json(200, {"packages": APT.search((q_.get("q") or [""])[0][:60]), "index": APT.status()}) or True
        if rest == "/lint" and method == "POST":
            return h.send_json(200, lint(text(read_json(h).get("script"), 256 * 1024, "The script"))) or True
        if rest == "/format" and method == "POST":
            return h.send_json(200, fmt(text(read_json(h).get("script"), 256 * 1024, "The script"))) or True
        if rest == "/dockerfile" and method == "POST":
            body = read_json(h)
            image_id = str(body.get("id") or "preview")
            spec = clean_spec(body.get("spec") or {}, image_id)
            try:
                base = base_ref_for(spec)
            except ValueError as e:
                base = "(%s)" % e
            return h.send_json(200, {"dockerfile": dockerfile(spec, image_id, (STORE.image(image_id, full=False) or
                                                                                {"version": 0})["version"] + 1, base),
                                     "steps": [{"key": k, "label": l} for k, l in build_plan(spec)]}) or True
        if rest == "/security-data" and method == "GET":
            return h.send_json(200, dict(securitydata.status(), canChange=admin, rescan=RESCAN_ALL)) or True
        if rest == "/security-data" and method == "PUT":
            if not admin:
                return h.send_json(403, {"error": "Only admins load security data."}) or True
            return upload_security_data(h, (q_.get("name") or ["security-data.tar.gz"])[0], user) or True
        if rest == "/security-data/activate" and method == "POST":
            if not admin:
                return h.send_json(403, {"error": "Only admins load security data."}) or True
            sid = read_json(h).get("id") or None
            securitydata.activate(str(sid) if sid else None)
            LOG(event="security-data-activated", id=sid or "bundled", by=user["username"])
            return h.send_json(200, securitydata.status()) or True
        if rest == "/rescan-all" and method == "POST":
            need(editor)
            ids = rescan_all(user["username"])
            return h.send_json(200, {"images": ids}) or True
        if rest == "/settings":
            if method == "GET":
                return h.send_json(200, {"aptSources": APT.sources(), "defaultAptSources": DEFAULT_APT_SOURCES,
                                         "index": APT.status(), "s3": s3_settings(), "canChange": admin,
                                         "hardening": HARDENING}) or True
            if not admin:
                raise PermissionError
            body = read_json(h)
            if "aptSources" in body:
                src = text(body["aptSources"], 32 * 1024, "The apt sources")
                if src.strip() and not parse_sources(src):
                    raise ValueError("No apt source found: deb822 stanzas (Types/URIs/Suites/Components) or "
                                     "'deb URI suite components' lines.")
                STORE.put_setting("aptSources", src if src.strip() else None)
                threading.Thread(target=APT.load, kwargs={"force": True}, daemon=True).start()
            if "s3" in body:
                cur = s3_settings(True)
                new = body["s3"] or {}
                cfg = {k: text(str(new.get(k, cur.get(k, "")) or ""), 1024, k) for k in
                       ("endpoint", "region", "bucket", "prefix", "accessKey")}
                cfg["pathStyle"] = bool(new.get("pathStyle", cur.get("pathStyle", True)))
                # kept unless replaced; with no access key there is no secret either (S3 switched off)
                cfg["secretKey"] = (new.get("secretKey") or cur.get("secretKey", "")) if cfg["accessKey"] else ""
                STORE.put_setting("s3", cfg)
            LOG(event="image-settings", by=user["username"])
            return h.send_json(200, {"ok": True, "s3": s3_settings()}) or True
        if rest == "/apt-refresh" and method == "POST":
            need(editor)
            APT.load(force=True)
            return h.send_json(200, {"index": APT.status()}) or True
        if rest == "/import" and method == "POST":
            need(editor)
            body = read_json(h)
            ref = str(body.get("ref") or "").strip()
            if not REF_RE.match(ref):
                raise ValueError("An image reference with its registry, such as registry.example.org/team/tool:1.2 "
                                 "(or @sha256:...).")
            source = {"kind": "registry", "ref": ref, "user": str(body.get("username") or "")[:256],
                      "password": str(body.get("password") or "")[:4096]}
            image_id, build_id = start_import(str(body.get("name") or ""), body.get("description"), source,
                                              user["username"])
            return h.send_json(200, {"image": image_id, "build": build_id}) or True
        if rest == "/import-upload" and method == "PUT":
            need(editor)
            return import_upload(h, q_, user) or True
        if rest == "/in-use" and method == "GET":
            return h.send_json(200, {"images": images_in_use()}) or True
        if rest == "/contents" and method == "GET":
            return h.send_json(200, image_contents()) or True
        if rest == "/on-nodes" and method == "GET":
            return h.send_json(200, {"images": images_on_nodes()}) or True
        if rest == "/scan" and method == "POST":
            need(editor)
            image_id, build_id = start_ref_scan(str(read_json(h).get("image") or ""), user["username"])
            return h.send_json(200, {"id": image_id, "build": build_id}) or True
        m = re.match(r"^/([a-z0-9-]+)(/.*)?$", rest)
        if not m:
            return h.send_json(404, {"error": "not found"}) or True
        image_id, sub = m.group(1), m.group(2) or ""
        img = STORE.image(image_id)
        if not img:
            return h.send_json(404, {"error": "No image called '%s'." % image_id}) or True
        if img.get("tracked") and (
                (sub == "" and method == "POST") or sub in ("/build", "/s3", "/s3/backup", "/files/delete")
                or sub.startswith("/files/")):
            raise ValueError(TRACKED_NOTE % img["tracked"].get("image"))
        if img.get("imported") and (sub in ("/build", "/files/delete") or sub.startswith("/files/")):
            raise ValueError(IMPORTED_NOTE % img["imported"].get("from"))
        if img.get("scanned") and ((sub == "" and method == "POST") or sub in ("/build", "/s3", "/s3/backup",
                                                                             "/files/delete", "/download")
                                   or sub.startswith("/files/")):
            raise ValueError(SCANNED_NOTE % img["scanned"].get("image"))

        def detail(img):
            """The image page's view (GET, and what a save answers with, so the dashboard can keep it)."""
            img["builds"] = STORE.builds(image_id)
            img["activeBuild"] = STORE.active_build(image_id)
            img["canEdit"] = editor
            latest = STORE.setting("pit-latest-%s" % image_id)
            img["pit"] = pit_view(latest) if latest else None
            return {"image": img}

        if sub == "" and method == "GET":
            return h.send_json(200, detail(img)) or True
        if sub == "" and method == "POST":
            need(editor)
            body = read_json(h)
            spec = clean_spec(body["spec"], image_id) if "spec" in body else None
            desc = text(body.get("description"), 2000, "The description") if "description" in body else None
            STORE.save(image_id, user["username"], spec, desc)
            return h.send_json(200, detail(STORE.image(image_id))) or True
        if sub == "/delete" and method == "POST" and img.get("tracked"):
            # The workspace template's image: its entry and report go (the registry's copy stays, the base new images
            # build on); it is not listed again until the platform deploys another workspace image.
            need(editor)
            if STORE.active_build(image_id):
                raise ValueError("Wait for its scan to finish first.")
            dismiss_tracked(img["tracked"].get("image"))
            shutil.rmtree(image_dir(image_id), ignore_errors=True)
            STORE.delete(image_id)
            LOG(event="image-deleted", image=image_id, by=user["username"], tracked=img["tracked"].get("image"))
            return h.send_json(200, {"ok": True}) or True
        if sub == "/delete" and method == "POST":
            need(editor)
            if STORE.active_build(image_id):
                raise ValueError("Wait for the build to finish (or cancel it) first.")
            users = [i["id"] for i in STORE.images() if i["base"].get("kind") == "image" and i["base"].get("id") == image_id]
            if users:
                raise ValueError("These images are built on it: %s." % ", ".join(users))
            removed = delete_tags("%s/%s" % (REPO, image_id))
            shutil.rmtree(image_dir(image_id), ignore_errors=True)
            STORE.delete(image_id)
            LOG(event="image-deleted", image=image_id, by=user["username"], tags=removed)
            return h.send_json(200, {"ok": True}) or True
        if sub == "/rescan" and method == "POST":
            need(editor)
            return h.send_json(200, {"build": start_rescan(image_id, user["username"])}) or True
        if sub == "/pit" and method == "GET":
            latest = STORE.setting("pit-latest-%s" % image_id)
            return h.send_json(200, {"pit": pit_view(latest) if latest else None}) or True
        if sub == "/pit" and method == "POST":
            need(editor)
            target, build_id = start_pit_stop(image_id, read_json(h), user["username"])
            return h.send_json(200, {"target": target, "build": build_id, "pit": pit_view(build_id)}) or True
        if sub == "/build" and method == "POST":
            need(editor)
            build_id = start_build(image_id, user["username"])
            return h.send_json(200, {"build": build_id}) or True
        mb = re.match(r"^/builds/(\d+)(/cancel|/delete)?$", sub)
        if mb:
            build_id = int(mb.group(1))
            if mb.group(2) == "/cancel" and method == "POST":
                need(editor)
                cancel_build(image_id, build_id)
                return h.send_json(200, {"ok": True}) or True
            if mb.group(2) == "/delete" and method == "POST":
                # a scan's record (the Scans table's trash can): whoever may scan images may delete their scans
                need(editor)
                b = STORE.build(build_id)
                if not b or b["image_id"] != image_id:
                    return h.send_json(404, {"error": "No such scan."}) or True
                run = BUILDS.get(build_id)
                if b["status"] in ("queued", "building", "pushing", "scanning") or run and run.is_alive():
                    return h.send_json(409, {"error": "This scan is still running: cancel it, or wait for it to "
                                                      "finish."}) or True
                report = delete_scan(image_id, b)
                LOG(event="image-scan-deleted", image=image_id, build=build_id, by=user["username"], report=report)
                return h.send_json(200, {"ok": True}) or True
            b = STORE.build(build_id)
            if not b or b["image_id"] != image_id:
                return h.send_json(404, {"error": "No such build."}) or True
            tail = int((q_.get("log") or ["400"])[0] or 400)
            log = b["log"].splitlines()[-min(tail, 4000):]
            return h.send_json(200, {"build": {
                "id": b["id"], "version": b["version"], "status": b["status"], "stage": b["stage"],
                "progress": b["progress"], "message": b["message"], "steps": json.loads(b["steps"] or "[]"),
                "startedAt": b["started_at"], "finishedAt": b["finished_at"], "by": b["by"], "error": b["error"],
                "log": log}, "image": {"id": image_id, "pullRef": STORE.image(image_id, full=False)["pullRef"],
                                       "summary": STORE.image(image_id, full=False)["summary"]}}) or True
        mf = re.match(r"^/files/(deb|install|dotfile)/([^/]+)$", sub)
        if mf and method == "PUT":
            need(editor)
            return upload(h, image_id, mf.group(1), urllib.parse.unquote(mf.group(2)), (q_.get("install") or [None])[0])
        if sub == "/files/delete" and method == "POST":
            need(editor)
            body = read_json(h)
            kind, name = body.get("kind"), str(body.get("name") or "")
            install = body.get("install")
            if kind not in ("deb", "install", "dotfile") or not FILE_NAME_RE.match(name) or (
                    kind == "install" and not INSTALL_ID_RE.match(str(install or ""))):
                raise ValueError("Which file?")
            try:
                os.remove(file_path(image_id, kind, name, install))
            except FileNotFoundError:
                pass
            return h.send_json(200, {"ok": True}) or True
        if sub == "/download" and method == "GET":
            if not img["ref"]:
                raise ValueError("The image has not been built yet.")
            h.send_response(200)
            h.send_header("Content-Type", "application/x-tar")
            repo, _, tag = img["ref"].split("/", 1)[1].rpartition(":")
            h.send_header("Content-Disposition", 'attachment; filename="%s-%s.tar"' % (image_id, tag))
            h.send_header("Cache-Control", "no-store")
            h.send_header("Connection", "close")
            h.end_headers()
            h.close_connection = True
            LOG(event="image-download", image=image_id, version=img["version"], by=user["username"])
            docker_archive(repo, tag, img["pullRef"], h.wfile)
            return True
        if sub == "/s3" and method == "POST":
            need(editor)
            on = bool(read_json(h).get("enabled"))
            STORE.set(image_id, s3=dict(img["s3"], enabled=on))
            return h.send_json(200, {"s3": STORE.image(image_id, full=False)["s3"]}) or True
        if sub == "/s3/backup" and method == "POST":
            need(editor)
            if (img["s3"] or {}).get("status") == "uploading":
                raise ValueError("A backup is running.")
            threading.Thread(target=lambda: _quiet(s3_backup, image_id), daemon=True).start()
            return h.send_json(200, {"ok": True}) or True
        return h.send_json(404, {"error": "not found"}) or True
    except PermissionError:
        return h.send_json(403, {"error": "Only admins and template admins can change images."}) or True


def _quiet(fn, *args):
    try:
        fn(*args)
    except Exception as e:  # noqa: BLE001 - recorded on the image
        if LOG:
            LOG(event="image-s3-backup-failed", error=str(e)[:300])


SCANNED_NOTE = ("This entry is a scan of %s as it is, not an image built or kept here: it only holds its report. "
                "Import the image to build on it.")
RESERVED_NAMES = {"security-data", "rescan-all", "settings", "apt-check", "apt-search", "apt-refresh", "lint", "format",
                  "dockerfile", "import", "import-upload", "in-use", "on-nodes", "scan", "contents", TRACKED_ID}

IMPORTED_NOTE = ("This image was imported (%s), not built here: import a new version of it instead of building, or "
                 "build on it with New Image.")

TRACKED_NOTE = ("This is the image the workspace template runs (%s), listed so everyone can see its security and its "
                "add-ons. It comes with the platform (development/workspace-image) and is not changed here: build on "
                "it with New Image (the workspace image is the default base).")


def _dismissed_file():
    return os.path.join(FILES, "images", ".tracked-dismissed")


def dismiss_tracked(image):
    """An admin deleted the tracked entry of this workspace image: kept away until another one is deployed."""
    os.makedirs(os.path.dirname(_dismissed_file()), exist_ok=True)
    with open(_dismissed_file(), "w") as f:
        f.write(image or "")


def tracked_dismissed(image):
    try:
        with open(_dismissed_file()) as f:
            return f.read().strip() == (image or "")
    except OSError:
        return False


_contents = {}


def image_contents():
    """What each image of ours holds (image-contents.json beside this file, from development/tools/image-contents.py),
    read once; {"images": {}} where it is missing. An image's add-ons (its addons.json as built) in the shape the
    reports give them (addons_of: every part there, a Python environment or none)."""
    if "data" not in _contents:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "image-contents.json")) as f:
                data = json.load(f)
            for image in (data.get("images") or {}).values():
                if image.get("addons") is not None:
                    image["addons"] = addons_of(json.dumps(image["addons"]))
            _contents["data"] = data
        except (OSError, ValueError, AttributeError):
            _contents["data"] = {"images": {}}
    return _contents["data"]


def sync_tracked():
    """The workspace template's image as the entry TRACKED_ID: made, kept to the image the platform deploys (a chart
    upgrade changes it), and scanned when it is new or has changed. Until the builder's registry has its copy (seeded
    at install), the entry waits as a draft."""
    if not (ENABLED and STORE and WORKSPACE_IMAGE and BASE_IMAGE.startswith(REGISTRY + "/")):
        return
    img = STORE.image(TRACKED_ID)
    if img and not img.get("tracked"):
        if LOG:
            LOG(event="image-tracked-conflict", image=TRACKED_ID)
        return
    tracked = {"image": WORKSPACE_IMAGE, "ref": BASE_IMAGE, "template": WORKSPACE_TEMPLATE}
    description = ("The image the workspace template%s runs, as the platform deploys it: its security report and "
                   "its add-ons. Read-only here; new images build on it." % (
                       " " + WORKSPACE_TEMPLATE if WORKSPACE_TEMPLATE else ""))
    if not img and tracked_dismissed(WORKSPACE_IMAGE):
        return  # an admin deleted its entry: back with the next workspace image
    if not img:
        STORE.create(TRACKED_ID, description, dict(empty_spec(), tracked=tracked), "platform")
    elif img["spec"].get("tracked") != tracked or img["description"] != description:
        STORE.save(TRACKED_ID, "platform", spec=dict(img["spec"], tracked=tracked), description=description)
    repo, _, tag = BASE_IMAGE.split("/", 1)[1].rpartition(":")
    try:
        _, digest = manifest(repo, tag)
        size = image_size(repo, tag)
    except Exception:  # noqa: BLE001 - not seeded yet, or the registry is not up: next time
        digest = None
    img = STORE.image(TRACKED_ID)
    if not digest:
        if img["ref"]:
            STORE.set(TRACKED_ID, status="draft", ref=None)
        return
    if img["digest"] != digest or img["ref"] != BASE_IMAGE:
        STORE.set(TRACKED_ID, status="ready", ref=BASE_IMAGE, digest=digest, size=size, builtAt=now(),
                  builtBy="platform", report=None)
        if LOG:
            LOG(event="image-tracked", image=WORKSPACE_IMAGE, digest=digest)
        img = STORE.image(TRACKED_ID)
    if not img["report"] and not STORE.active_build(TRACKED_ID):
        start_rescan(TRACKED_ID, "platform")


IMAGES_CONFIGMAP = "coder-workspace-images"
IMAGES_PUBLISH_SECONDS = int(os.environ.get("BUILDER_IMAGES_PUBLISH_SECONDS", "30"))
# The platform's workspace images on the nodes (their earlier versions too): ghcr.io/user187x/coder-workspace[-*]:<tag>.
WORKSPACE_IMAGE_RE = re.compile(r"^[^@\s]*/coder-workspace(-[a-z0-9]+)*:[A-Za-z0-9._-]+$")
_images_published = {"state": None}


def workspace_image_choices():
    """What the templates offer as a workspace's image besides their own (see the module's docstring)."""
    registry = []
    for img in STORE.images():
        if img.get("tracked") or img.get("scanned") or not img.get("pullRef"):
            continue
        versions = sorted({b["version"] for b in STORE.builds(img["id"], limit=200) if b["status"] == "ready"}
                          | {img["version"]}, reverse=True)
        for v in versions:
            registry.append({"ref": "%s/%s/%s:%d" % (PULL_PREFIX, REPO, img["id"], v), "name": img["id"],
                             "version": v, "description": (img.get("description") or "")[:200]})
    nodes = sorted({ref for ref in node_images() if WORKSPACE_IMAGE_RE.match(ref)})
    return {"registry": registry, "nodes": nodes}


def publish_workspace_images():
    state = json.dumps(workspace_image_choices(), sort_keys=True)
    if state == _images_published["state"]:
        return
    path = "/api/v1/namespaces/%s/configmaps/%s" % (NAMESPACE, IMAGES_CONFIGMAP)
    body = {"apiVersion": "v1", "kind": "ConfigMap",
            "metadata": {"name": IMAGES_CONFIGMAP, "namespace": NAMESPACE,
                         "labels": {"app.kubernetes.io/name": "coder-image-builder",
                                    "app.kubernetes.io/part-of": "coder"}},
            "data": {"images": state}}
    status, cur = kube_call("GET", path)
    if status == 404:
        status, _ = kube_call("POST", "/api/v1/namespaces/%s/configmaps" % NAMESPACE, body)
    elif status == 200:
        if (cur.get("data") or {}).get("images") == state:
            _images_published["state"] = state
            return
        version = (cur.get("metadata") or {}).get("resourceVersion")
        if version:
            body["metadata"]["resourceVersion"] = version
        status, _ = kube_call("PUT", path, body)
    if status not in (200, 201):
        raise RuntimeError("ConfigMap %s: HTTP %s" % (IMAGES_CONFIGMAP, status))
    _images_published["state"] = state


def _publish_images_loop():
    last = None
    while True:
        try:
            publish_workspace_images()
            last = None
        except Exception as e:  # noqa: BLE001 - reported once, tried again on the next round
            if LOG and str(e) != last:
                LOG(event="workspace-images-publish-failed", error=str(e)[:300])
            last = str(e)
        time.sleep(IMAGES_PUBLISH_SECONDS)


def _sync_tracked_loop():
    while True:
        try:
            sync_tracked()
        except Exception as e:  # noqa: BLE001 - tried again on the next round
            if LOG:
                LOG(event="image-tracked-failed", error=str(e)[:300])
        time.sleep(TRACKED_SYNC_SECONDS)


def upload_security_data(h, name, user):
    """A security data file (build-security-data.sh), streamed to the builder volume, verified, made active."""
    n = int(h.headers.get("Content-Length") or -1)
    if n < 0:
        raise ValueError("The upload needs a Content-Length.")
    if n > securitydata.MAX_BUNDLE:
        raise ValueError("A security data file is at most %d GB." % (securitydata.MAX_BUNDLE // 1024 ** 3))
    if shutil.disk_usage(FILES).free < n * 1.2:
        raise ValueError("Not enough room on the image builder's volume for this file.")
    tmp = os.path.join(securitydata.ROOT, secrets.token_hex(8) + ".upload")
    try:
        with open(tmp, "wb") as f:
            left = n
            while left > 0:
                chunk = h.rfile.read(min(1024 * 1024, left))
                if not chunk:
                    raise ValueError("The upload stopped before the end.")
                f.write(chunk)
                left -= len(chunk)
        info = securitydata.install(tmp, user["username"], re.sub(r"[^A-Za-z0-9._-]", "-", name)[:120])
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    LOG(event="security-data-installed", id=info["id"], by=user["username"], size=info["size"],
        db=(info.get("db") or {}).get("UpdatedAt"), java=bool(info.get("javaDb")))
    h.send_json(200, securitydata.status())


def upload(h, image_id, kind, name, install):
    """A file streamed to the builder volume (up to 2 GB): a .deb, an installation's file or a dotfile."""
    if not FILE_NAME_RE.match(name):
        raise ValueError("A file name of letters, digits, dots, dashes and underscores.")
    if kind == "deb" and not name.endswith(".deb"):
        raise ValueError("A Debian package (.deb).")
    if kind == "install" and not INSTALL_ID_RE.match(str(install or "")):
        raise ValueError("Which installation?")
    n = int(h.headers.get("Content-Length") or -1)
    if n < 0:
        raise ValueError("The upload needs a Content-Length.")
    if n > MAX_UPLOAD:
        raise ValueError("Files can be at most 2 GB.")
    dest = file_path(image_id, kind, name, install)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    digest = hashlib.sha256()
    with open(dest + ".part", "wb") as f:
        left = n
        while left:
            chunk = h.rfile.read(min(1024 * 1024, left))
            if not chunk:
                break
            f.write(chunk)
            digest.update(chunk)
            left -= len(chunk)
    if left:
        os.remove(dest + ".part")
        raise ValueError("The upload was cut short.")
    if kind == "deb":
        with open(dest + ".part", "rb") as f:
            if f.read(8) != b"!<arch>\n":
                os.remove(dest + ".part")
                raise ValueError("%s is not a Debian package." % name)
    os.replace(dest + ".part", dest)
    LOG(event="image-file", image=image_id, kind=kind, file=name, bytes=n)
    h.send_json(200, {"file": {"name": name, "size": n, "sha256": digest.hexdigest()}})
    return True


def start():
    global STORE
    if ENABLED:
        STORE = DB(os.path.join(FILES, "images.sqlite"))
        securitydata.setup(FILES)
        threading.Thread(target=_sync_tracked_loop, daemon=True, name="tracked-image").start()
        threading.Thread(target=_publish_images_loop, daemon=True, name="workspace-images").start()


if __name__ == "__main__":
    if sys.argv[1:2] == ["fetch-context"]:
        fetch_context(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["scan"]:
        scan(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["scan-rootfs"]:
        scan_rootfs(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1:2] == ["copa"]:
        copa(sys.argv[2])
    else:
        sys.exit(__doc__)
