"""coder-ui-updates service, served on Coder's hostname under /__coder-ui/ (Python standard library only).

  GET  /__coder-ui/<file>                 the dashboard add-ons (dashboard.js, views, ..., the Workspaces icon), revalidated on every use
  GET  /__coder-ui/refresh                clears the browser's cached Coder JavaScript (Clear-Site-Data) and returns to /
  GET  /__coder-ui/healthz

  Announcement receipts
  GET  /__coder-ui/api/me?id=X            signed in? and did they confirm announcement X
  POST /__coder-ui/api/view   {"id": X}   the signed-in user has seen announcement X
  POST /__coder-ui/api/ack    {"id": X}   ... and confirmed it
  GET  /__coder-ui/api/acks               admins: every announcement ("event") with who saw / confirmed it, who has not
  POST /__coder-ui/api/events/delete {"id": X}   admins: forget one announcement and its receipts

  Network map (admins; nodes, pods and metrics read cluster-wide through the ClusterRole coder-ui-updates-<namespace>)
  GET  /__coder-ui/api/network            nodes (addresses, capacity, usage), Coder's pods, running workspaces per node
  GET  /__coder-ui/api/cluster/usage      CPU / memory totals (allocatable, in use, requested, free): the Admin menu's bars

  Classification banner
  GET  /__coder-ui/api/classification     public (the marking shows on the sign-in page too)
  POST /__coder-ui/api/classification     admins: {enabled, text, height, background, color}

  Logo (stored in Coder's own CloudNativePG database, schema coder_ui_updates)
  GET  /__coder-ui/boot.js                loaded first by every Coder page: the logo (and classification) to use
  GET  /__coder-ui/logo?v=<sha>           the uploaded logo          GET /__coder-ui/favicon/<name>  logo or Coder's
  GET  /__coder-ui/api/logo               what is set                POST /__coder-ui/api/logo {"dataUrl"}, /api/logo/reset

  User avatars (every user, their own; rows in coder_ui_updates.avatar of Coder's database)
  GET  /__coder-ui/avatar/<user id>?v=<sha>   the picture            GET  /__coder-ui/api/avatar   mine
  POST /__coder-ui/api/avatar {"dataUrl"}     set mine               POST /__coder-ui/api/avatar/reset   remove mine
  GET  /__coder-ui/avatar/default?v=<sha>     the default avatar     GET  /__coder-ui/api/avatar/defaults   who gets it

  Chat (every signed-in user; admins in ADMIN_ROLES write to anyone, others to admins or whoever wrote to them;
        kept 30 days in SQLite)
  GET  /__coder-ui/api/chat/state          me, my conversations (last message, unread), newest message id
  GET  /__coder-ui/api/chat/messages?peer=<user id>[&before=<id>]   one conversation (100 at a time)
  GET  /__coder-ui/api/chat/poll?after=<id>&typing=<ids>   long poll (25 s): new messages, who is typing to me
  POST /__coder-ui/api/chat/send {"to", "text"}   POST /api/chat/typing {"to"}   POST /api/chat/read {"to", "last"}
  GET  /__coder-ui/api/chat/admins          the admins a user may write to (their line to support): those with chat on
  POST /__coder-ui/api/chat/availability {"enabled"}   admins: their chat on / off (off: developers can't write to them)
  GET  /__coder-ui/api/chat/file/<id>       a message's screenshot (the two people in the conversation only)
  POST /__coder-ui/api/chat/send also takes {"image": data URL, "page": path}: a screenshot (PNG / JPEG / WebP, 4 MB)
  POST /__coder-ui/api/chat/delete {"to"}   the whole conversation, for both (either participant); the other side's
       poll answers with "cleared": [user id]

  Default images (resources/defaults/, mounted from ConfigMaps coder-ui-updates-default-logo / -avatar into
  DEFAULTS_DIR): the logo a fresh installation starts with (written to the logo table when this service creates it),
  and the avatar of every user without a picture of their own (neither uploaded here nor from Coder / OIDC).

  Monitoring (admins; workspace pod logs streamed into the temporary Postgres coder-ui-logs-db, 5 MB per instance)
  GET  /__coder-ui/api/monitoring          users and their running workspaces
  GET  /__coder-ui/api/monitoring/logs?workspace=<id>&after=<seq>   new log lines (starts / keeps the follower)

  Keycloak <-> Coder sign-in (admins)
  GET  /__coder-ui/api/keycloak           discovery: every check with its current / expected value and a suggested fix
  POST /__coder-ui/api/keycloak/apply     {"fixes": [...], "settings": {...}}  apply approved fixes
  POST /__coder-ui/api/keycloak/undo      put Coder's previous Argo CD values back

An announcement "event" is one announcement as coder-banner identifies it: its id changes when the text changes or an
admin uses "Show again to everyone". Only the live announcement (or one already recorded) is accepted.

Users are identified by their Coder session (the coder_session_token cookie the browser already sends), checked against
Coder's own API. Admin endpoints require one of ADMIN_ROLES; state-changing requests also need the X-Requested-With
header and a same-origin Origin (cross-site protection). Keycloak's admin credentials and the OIDC client secret are
read in-cluster (Kubernetes API, RBAC limited to the named Secrets) and never sent to the browser.
"""
import base64
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgwire  # noqa: E402  (next to this file)
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")
DB_PATH = os.environ.get("DB_PATH", "/data/receipts.sqlite")
CODER_URL = os.environ.get("CODER_URL", "http://coder").rstrip("/")            # in-cluster Service
CODER_ACCESS_URL = os.environ.get("CODER_ACCESS_URL", "").rstrip("/")           # what browsers use
CODER_NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
CODER_DEPLOYMENT = os.environ.get("CODER_DEPLOYMENT", "coder")
BANNER_URL = os.environ.get("BANNER_URL", "http://coder-banner").rstrip("/")
ADMIN_ROLES = {r.strip() for r in os.environ.get("ADMIN_ROLES", "owner").split(",") if r.strip()}
CA_FILE = os.environ.get("CA_FILE", "")                                          # extra trusted CA (local PKI)
KEYCLOAK_NAMESPACE = os.environ.get("KEYCLOAK_NAMESPACE", "keycloak")
KEYCLOAK_ADMIN_SECRET = os.environ.get("KEYCLOAK_ADMIN_SECRET", "keycloak-initial-admin")
ARGOCD_NAMESPACE = os.environ.get("ARGOCD_NAMESPACE", "argocd")
ARGOCD_APP = os.environ.get("ARGOCD_APP", "")                                    # empty: Coder is not managed by Argo CD
CA_SOURCE_SECRET = os.environ.get("CA_SOURCE_SECRET", "tls-ca")                  # Coder-namespace Secret holding the local CA
OIDC_SECRET = "keycloaking-coder-oidc"   # same names as ../keycloak/keycloaking-coder, so the two tools agree
ATTACHED = os.environ.get("ATTACHED", "") == "true"   # coder-platform chart attached to an existing Coder (./upgrade)
# What Coder uses when a setting isn't given (coder server --help): a missing variable means this value.
CODER_OIDC_DEFAULTS = {"CODER_OIDC_EMAIL_FIELD": "email", "CODER_OIDC_USERNAME_FIELD": "preferred_username",
                       "CODER_OIDC_SCOPES": "openid,profile,email", "CODER_OIDC_IGNORE_EMAIL_VERIFIED": "false",
                       "CODER_OIDC_ALLOW_SIGNUPS": "true", "CODER_OIDC_SIGN_IN_TEXT": "OpenID Connect", "CODER_OIDC_ICON_URL": ""}
# Differences here are the deployment's choices, not faults: shown as notes.
OIDC_CHOICES = {"CODER_OIDC_SIGN_IN_TEXT", "CODER_OIDC_ICON_URL", "CODER_OIDC_ALLOW_SIGNUPS", "CODER_OIDC_IGNORE_EMAIL_VERIFIED"}
GROUP_SETTINGS = ("CODER_OIDC_GROUP_FIELD", "CODER_OIDC_ALLOWED_GROUPS", "CODER_OIDC_GROUP_MAPPING",
                  "CODER_OIDC_GROUP_REGEX_FILTER", "CODER_OIDC_GROUP_AUTO_CREATE", "CODER_OIDC_USER_ROLE_FIELD",
                  "CODER_OIDC_USER_ROLE_MAPPING", "CODER_OIDC_USER_ROLE_DEFAULT")
CA_SECRET = "keycloaking-coder-ca"
CA_MOUNT = "/etc/keycloaking/ca"
CODER_DB_URI = os.environ.get("CODER_DB_URI", "")             # Coder's CNPG database (logo)
CODER_DB_CA = os.environ.get("CODER_DB_CA", "")
CODER_DB_SECRET = os.environ.get("CODER_DB_SECRET", "")       # read through the API when CODER_DB_URI was empty at start
CODER_DB_SECRET_KEY = os.environ.get("CODER_DB_SECRET_KEY", "") or "uri"
CODER_DB_CA_SECRET = os.environ.get("CODER_DB_CA_SECRET", "")
LOGS_DB_URL = os.environ.get("LOGS_DB_URL", "")               # the temporary log database
LOGS_DB_SECRET = os.environ.get("LOGS_DB_SECRET", "")         # chart installs: its password Secret, created here
WORKSPACE_NAMESPACE = os.environ.get("WORKSPACE_NAMESPACE", CODER_NAMESPACE)
LOG_CAP_BYTES = int(os.environ.get("LOG_CAP_BYTES", str(5 * 1024 * 1024)))
LOGO_MAX_BYTES = 4 * 1024 * 1024   # the dashboard resizes uploads first; animated logos keep their frames
DEFAULTS_DIR = os.environ.get("DEFAULTS_DIR", "/app/defaults")   # <dir>/logo/logo.<ext>, <dir>/avatar/avatar.<ext>
BASE = "/__coder-ui"
SESSION_COOKIE = "coder_session_token"
CSRF_HEADER = ("X-Requested-With", "coder-ui")
AUTH_TTL, BANNER_TTL, USERS_TTL = 60, 5, 60
MAX_EVENTS = 50
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
HTML_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")


def log(**fields):
    sys.stdout.write(json.dumps({"time": now(), **fields}) + "\n")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


TLS = ssl.create_default_context()
# Python 3.13 turned on strict RFC 5280 checks by default; many local root CAs (this cluster's included) lack the
# keyUsage extension they insist on, while OpenSSL, curl and Go (Coder itself) accept them. Chain and hostname
# verification stay on.
TLS.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
if CA_FILE and os.path.exists(CA_FILE):
    TLS.load_verify_locations(CA_FILE)


def http_json(url, method="GET", body=None, headers=None, form=None, timeout=8, context=None):
    """(status, parsed JSON or text). Never raises for HTTP errors."""
    data = None
    hdrs = {"Accept": "application/json", **(headers or {})}
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context if url.startswith("https") else None) as res:
            raw, status = res.read(), res.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors="replace")


class TTLCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}

    def get(self, key):
        with self.lock:
            hit = self.items.get(key)
            return hit[1] if hit and hit[0] > time.time() else None

    def put(self, key, value, ttl):
        with self.lock:
            if len(self.items) > 2000:
                self.items.clear()
            self.items[key] = (time.time() + ttl, value)


CACHE = TTLCache()


# --------------------------------------------------------------------------- Coder


def coder_user(token):
    """(status, user): status is ok | unauthenticated | unavailable."""
    key = "me:" + hashlib.sha256(token.encode()).hexdigest()
    hit = CACHE.get(key)
    if hit:
        return hit
    try:
        status, me = http_json(CODER_URL + "/api/v2/users/me", headers={"Coder-Session-Token": token}, timeout=5)
    except Exception as e:  # noqa: BLE001 - any network problem
        log(event="coder-unreachable", error=str(e))
        return "unavailable", None
    if status in (401, 403):
        CACHE.put(key, ("unauthenticated", None), 5)
        return "unauthenticated", None
    if status != 200 or not isinstance(me, dict):
        log(event="coder-error", status=status)
        return "unavailable", None
    if me.get("status") not in (None, "active"):
        return "unauthenticated", None
    user = {
        "id": me.get("id") or me.get("username"),
        "username": me.get("username") or "",
        "name": me.get("name") or "",
        "email": me.get("email") or "",
        "roles": sorted({r.get("name") for r in me.get("roles") or [] if r.get("name")}),
    }
    CACHE.put(key, ("ok", user), AUTH_TTL)
    return "ok", user


def current_banner(fresh=False):
    hit = None if fresh else CACHE.get("banner")
    if hit is not None:
        return hit or None
    try:
        status, b = http_json(BANNER_URL + "/__banner/banner.json", timeout=5)
    except Exception as e:  # noqa: BLE001
        log(event="banner-unreachable", error=str(e))
        return None
    live = b if status == 200 and isinstance(b, dict) and b.get("enabled") and b.get("message") and b.get("id") else {}
    CACHE.put("banner", live, BANNER_TTL)
    return live or None


def active_users(token):
    key = "users:" + hashlib.sha256(token.encode()).hexdigest()
    hit = CACHE.get(key)
    if hit is not None:
        return hit
    users, offset = [], 0
    while offset < 5000:
        q = urllib.parse.urlencode({"q": "status:active", "limit": 500, "offset": offset})
        status, page = http_json(CODER_URL + "/api/v2/users?" + q, headers={"Coder-Session-Token": token})
        if status != 200:
            raise RuntimeError("Coder users API: HTTP %s" % status)
        rows = page.get("users") or []
        users += [{"id": u.get("id"), "username": u.get("username") or "", "name": u.get("name") or "",
                   "email": u.get("email") or "", "loginType": u.get("login_type") or ""} for u in rows]
        if len(rows) < 500:
            break
        offset += 500
    CACHE.put(key, users, USERS_TTL)
    return users


# --------------------------------------------------------------------------- Kubernetes (in-cluster)


class Kube:
    SA = "/var/run/secrets/kubernetes.io/serviceaccount"

    def __init__(self):
        self.ok = os.path.exists(self.SA + "/token")
        self.base = "https://%s:%s" % (os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc"),
                                       os.environ.get("KUBERNETES_SERVICE_PORT", "443"))
        self.ctx = ssl.create_default_context(cafile=self.SA + "/ca.crt") if self.ok else None

    def call(self, method, path, body=None, patch_type=None):
        if not self.ok:
            return 0, "no service account"
        with open(self.SA + "/token") as f:
            token = f.read().strip()
        headers = {"Authorization": "Bearer " + token}
        if patch_type:
            headers["Content-Type"] = patch_type
        return http_json(self.base + path, method=method, body=body, headers=headers, context=self.ctx)

    def stream(self, path, timeout=65):
        """An open streaming response (pod logs with follow=true); the caller reads lines and closes it."""
        with open(self.SA + "/token") as f:
            token = f.read().strip()
        req = urllib.request.Request(self.base + path, headers={"Authorization": "Bearer " + token})
        return urllib.request.urlopen(req, timeout=timeout, context=self.ctx)

    def secret(self, ns, name):
        """{key: str} or None."""
        status, s = self.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (ns, name))
        if status != 200:
            return None
        return {k: base64.b64decode(v).decode(errors="replace") for k, v in (s.get("data") or {}).items()}

    def put_secret(self, ns, name, data):
        body = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                "metadata": {"name": name, "namespace": ns, "labels": {"app.kubernetes.io/part-of": "coder",
                                                                     "coder-ui-updates/managed": "keycloak"}},
                "data": {k: base64.b64encode(v.encode()).decode() for k, v in data.items()}}
        status, _ = self.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (ns, name))
        if status == 200:
            status, out = self.call("PATCH", "/api/v1/namespaces/%s/secrets/%s" % (ns, name), {"data": body["data"]},
                                    "application/merge-patch+json")
        else:
            status, out = self.call("POST", "/api/v1/namespaces/%s/secrets" % ns, body)
        if status not in (200, 201):
            raise RuntimeError("could not write Secret %s/%s (HTTP %s): %s" % (ns, name, status, str(out)[:200]))


KUBE = Kube()


def logs_db_url():
    """LOGS_DB_URL with its {password} taken from Secret LOGS_DB_SECRET, which is created with a random password the
    first time. A Helm chart can't render such a Secret without re-randomizing it on every Argo CD sync; created here
    it is made once and kept (the log database pod waits for it). Without the marker the URL is used as it is."""
    if not LOGS_DB_SECRET or "{password}" not in LOGS_DB_URL:
        return LOGS_DB_URL
    path = "/api/v1/namespaces/%s/secrets" % CODER_NAMESPACE
    for _ in range(60):
        found = KUBE.secret(CODER_NAMESPACE, LOGS_DB_SECRET)
        if found and found.get("password"):
            return LOGS_DB_URL.replace("{password}", urllib.parse.quote(found["password"], safe=""))
        password = base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("=")
        status, out = KUBE.call("POST", path, {
            "apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": LOGS_DB_SECRET, "labels": {"app.kubernetes.io/part-of": "coder",
                                                            "app.kubernetes.io/created-by": "coder-ui-updates"}},
            "data": {"password": base64.b64encode(password.encode()).decode()}})
        if status in (201, 409):
            continue    # read it back (409: another replica or an earlier start made it)
        log(event="logs-db-secret", status=status, detail=str(out)[:200])
        time.sleep(2)
    log(event="logs-db-secret", status="gave up", detail="Monitoring is unavailable until Secret %s exists" % LOGS_DB_SECRET)
    return ""


# --------------------------------------------------------------------------- Keycloak


class Keycloak:
    def __init__(self, url):
        self.url = url.rstrip("/")
        self.token, self.expires = None, 0
        self.error = None
        self.via = None

    def _token(self, form):
        try:
            status, tok = http_json(self.url + "/realms/master/protocol/openid-connect/token", method="POST", context=TLS, form=form)
        except Exception as e:  # noqa: BLE001 - network / TLS: reported as a failed check, not a crash
            return None, "Keycloak could not be reached (%s)." % str(getattr(e, "reason", e))[:160]
        if status == 200 and isinstance(tok, dict) and tok.get("access_token"):
            return tok, None
        detail = (tok.get("error_description") or tok.get("error")) if isinstance(tok, dict) else "HTTP %s" % status
        return None, detail

    def login(self):
        """Admin API token. Tries, in order: the service-account client created by "Connect to Keycloak" (stored by
        this service), then the Kubernetes Secret KEYCLOAK_ADMIN_SECRET (keys username/password, or client-id /
        client-secret)."""
        if self.token and time.time() < self.expires - 20:
            return True
        attempts = []
        stored = STORE.get_setting("keycloak_admin_client") if STORE else None
        if stored and stored.get("url") == self.url:
            tok, err = self._token({"grant_type": "client_credentials", "client_id": stored["clientId"], "client_secret": stored["secret"]})
            if tok:
                return self._use(tok, "service account '%s'" % stored["clientId"])
            attempts.append("service account '%s': %s" % (stored["clientId"], err))
        creds = KUBE.secret(KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET) if KEYCLOAK_ADMIN_SECRET else None
        if creds and creds.get("client-id") and creds.get("client-secret"):
            tok, err = self._token({"grant_type": "client_credentials", "client_id": creds["client-id"], "client_secret": creds["client-secret"]})
        elif creds and creds.get("username"):
            tok, err = self._token({"grant_type": "password", "client_id": "admin-cli", "username": creds["username"], "password": creds.get("password", "")})
        else:
            tok, err = None, "not readable by this service"
        if tok:
            return self._use(tok, "Secret %s/%s" % (KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET))
        attempts.append("Secret %s/%s: %s" % (KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET, err))
        self.error = "No working Keycloak admin access (" + "; ".join(attempts) + ")."
        return False

    def _use(self, tok, via):
        self.token, self.expires, self.error, self.via = tok["access_token"], time.time() + int(tok.get("expires_in", 60)), None, via
        return True

    def api(self, method, path, body=None):
        if not self.login():
            raise RuntimeError(self.error)
        status, out = http_json(self.url + "/admin/realms" + path, method=method, body=body, context=TLS,
                                headers={"Authorization": "Bearer " + self.token})
        if status >= 400:
            raise RuntimeError("Keycloak %s %s: HTTP %s %s" % (method, path, status, str(out)[:200]))
        return out


def keycloak_url_from_cluster():
    for version in ("v2beta1", "v2alpha1"):
        status, lst = KUBE.call("GET", "/apis/k8s.keycloak.org/%s/namespaces/%s/keycloaks" % (version, KEYCLOAK_NAMESPACE))
        if status == 200:
            break
    if status == 200:
        for kc in lst.get("items") or []:
            host = ((kc.get("spec") or {}).get("hostname") or {}).get("hostname")
            if host:
                return host if host.startswith("http") else "https://" + host
    return None


# --------------------------------------------------------------------------- Argo CD values (Coder's configuration)
# The Coder Application keeps its Helm values as a YAML string. Only the blocks `coder.env`, `coder.volumes` and
# `coder.volumeMounts` are ever rewritten; every other byte of the document is kept as it is. They are parsed with a
# small, strict block-YAML reader: anything it does not understand (anchors, flow style, multi-line scalars) makes the
# edit refuse rather than guess.


class YamlSubsetError(ValueError):
    pass


class Plain(str):
    """An unquoted scalar (true, 8080, a path ...): written back unquoted so YAML keeps its type."""


def _scalar(text):
    text = text.strip()
    if text == "":
        return None
    if text[0] == "'":
        if not text.endswith("'") or len(text) < 2:
            raise YamlSubsetError("unterminated quote: " + text)
        return text[1:-1].replace("''", "'")
    if text[0] == '"':
        return json.loads(text)
    if text[0] in "|>&*{[!%@`":
        raise YamlSubsetError("unsupported YAML: " + text)
    if " #" in text:
        text = text.split(" #", 1)[0].rstrip()
    return Plain(text)


def _parse_block(lines, i, indent):
    """Parses a block (mapping or sequence) whose lines start at column `indent`. Returns (value, next index)."""
    if i >= len(lines):
        return None, i
    first = lines[i]
    if first[indent:indent + 2] == "- " or first[indent:].rstrip() == "-":
        seq = []
        while i < len(lines) and len(lines[i]) - len(lines[i].lstrip()) == indent and lines[i][indent:indent + 1] == "-":
            rest = lines[i][indent + 1:]
            if rest.strip() == "":
                item, i = _parse_block(lines, i + 1, indent + 2)
            else:
                # "- key: value" starts a mapping whose keys sit at indent + 2
                lines[i] = " " * (indent + 2) + rest.lstrip()
                item, i = _parse_block(lines, i, indent + 2)
            seq.append(item)
        return seq, i
    mapping = {}
    while i < len(lines):
        line = lines[i]
        cur = len(line) - len(line.lstrip())
        if cur < indent:
            break
        if cur > indent:
            raise YamlSubsetError("unexpected indentation: " + line.strip())
        m = re.match(r"^([A-Za-z0-9_.\-/]+):(?:\s+(.*))?$", line.strip())
        if not m:
            raise YamlSubsetError("unsupported line: " + line.strip())
        key, rest = m.group(1), m.group(2)
        if rest is None or rest.strip() == "" or rest.strip().startswith("#"):
            nxt = i + 1
            if nxt < len(lines):
                ind = len(lines[nxt]) - len(lines[nxt].lstrip())
                if ind > indent or (ind == indent and lines[nxt][ind:ind + 1] == "-"):
                    mapping[key], i = _parse_block(lines, nxt, ind)
                    continue
            mapping[key], i = None, nxt
        else:
            mapping[key], i = _scalar(rest), i + 1
    return mapping, i


def _emit_scalar(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, Plain):
        return str(v)
    s = str(v)
    if re.match(r"^[A-Za-z_][A-Za-z0-9_./-]*$", s) and s.lower() not in ("true", "false", "yes", "no", "on", "off", "null", "y", "n"):
        return s
    return "'" + s.replace("'", "''") + "'"


def _emit(value, indent):
    pad = " " * indent
    out = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and item:
                sub = _emit(item, indent + 2)
                out.append(pad + "- " + sub[0].lstrip())
                out += sub[1:]
            else:
                out.append(pad + "- " + _emit_scalar(item))
    elif isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)) and v:
                out.append(pad + k + ":")
                out += _emit(v, indent if isinstance(v, list) else indent + 2)
            else:
                out.append(pad + k + ": " + ("[]" if v == [] else "{}" if v == {} else _emit_scalar(v)))
    return out


def values_block(text, key):
    """(start, end, indent, parsed) of `coder.<key>` in the values YAML; start/end are line indexes."""
    lines = text.split("\n")
    try:
        top = lines.index("coder:")
    except ValueError:
        return None
    i = top + 1
    while i < len(lines) and (lines[i].startswith(" ") or lines[i].strip() == ""):
        if re.match(r"^  %s:\s*$" % re.escape(key), lines[i]):
            start = i
            j = i + 1
            while j < len(lines) and (lines[j].startswith("   ") or lines[j].startswith("  -") or lines[j].strip() == ""):
                j += 1
            body = [l for l in lines[start + 1:j] if l.strip() and not l.strip().startswith("#")]
            if not body:
                return start, j, 2, []
            ind = len(body[0]) - len(body[0].lstrip())
            parsed, _ = _parse_block(list(body), 0, ind)
            return start, j, ind, parsed
        i += 1
    return None


def _norm(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return None if v is None else str(v)


def replace_values_block(text, key, value):
    lines = text.split("\n")
    found = values_block(text, key)
    new_block = ["  %s:" % key] + _emit(value, 2)
    if found:
        start, end, _, _ = found
        lines[start:end] = new_block
    else:
        top = lines.index("coder:")
        lines[top + 1:top + 1] = new_block
    out = "\n".join(lines)
    check = values_block(out, key)
    if not check or _norm(check[3]) != _norm(value):
        raise YamlSubsetError("re-reading coder.%s after the edit gave a different result" % key)
    return out


def argo_app():
    if not ARGOCD_APP:
        return None
    status, app = KUBE.call("GET", "/apis/argoproj.io/v1alpha1/namespaces/%s/applications/%s" % (ARGOCD_NAMESPACE, ARGOCD_APP))
    return app if status == 200 else None


def env_map(env):
    return {e.get("name"): e for e in env or [] if isinstance(e, dict)}


def container_env(dep):
    """The first container's environment as Kubernetes resolves it: ConfigMaps named in envFrom (the coder-platform
    chart puts Coder's settings in one), overridden by the explicit env list."""
    c = (((((dep or {}).get("spec") or {}).get("template") or {}).get("spec") or {}).get("containers") or [{}])[0]
    merged = {}
    for src in c.get("envFrom") or []:
        ref = (src or {}).get("configMapRef") or {}
        if not ref.get("name"):
            continue
        status, cm = KUBE.call("GET", "/api/v1/namespaces/%s/configmaps/%s" % (CODER_NAMESPACE, ref["name"]))
        if status == 200:
            prefix = src.get("prefix") or ""
            for k, v in ((cm or {}).get("data") or {}).items():
                merged[prefix + k] = {"name": prefix + k, "value": v}
    merged.update(env_map(c.get("env")))
    return merged


# --------------------------------------------------------------------------- storage


class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY, level TEXT, title TEXT, message TEXT, link_text TEXT, link_url TEXT,
                  first_seen TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS receipts (
                  event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL,
                  username TEXT, name TEXT, email TEXT, viewed_at TEXT NOT NULL, acked_at TEXT,
                  PRIMARY KEY (event_id, user_id));
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS value_backups (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, saved_at TEXT NOT NULL, saved_by TEXT, app TEXT, values_text TEXT NOT NULL);
                """
            )

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    # ---- settings
    def get_setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return json.loads(row["value"]) if row else default

    def put_setting(self, key, value):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (key, json.dumps(value)))

    # ---- value backups (Coder's Argo CD values before each change from the Keycloak view)
    def backup_values(self, user, app, text):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO value_backups (saved_at, saved_by, app, values_text) VALUES (?,?,?,?)", (now(), user, app, text))

    def last_backup(self):
        with self.connect() as db:
            return db.execute("SELECT * FROM value_backups ORDER BY id DESC LIMIT 1").fetchone()

    def drop_backup(self, backup_id):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM value_backups WHERE id=?", (backup_id,))

    # ---- receipts
    def ensure_event(self, db, banner):
        db.execute(
            "INSERT OR IGNORE INTO events (id, level, title, message, link_text, link_url, first_seen) VALUES (?,?,?,?,?,?,?)",
            (banner["id"], banner.get("level"), banner.get("title"), banner.get("message"), banner.get("linkText"), banner.get("linkUrl"), now()),
        )

    def known(self, event_id):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM events WHERE id=?", (event_id,)).fetchone() is not None

    def record(self, event_id, user, ack, banner):
        stamp = now()
        with self.lock, self.connect() as db:
            if banner and banner["id"] == event_id:
                self.ensure_event(db, banner)
            db.execute(
                "INSERT INTO receipts (event_id, user_id, username, name, email, viewed_at, acked_at) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(event_id, user_id) DO UPDATE SET username=excluded.username, name=excluded.name, email=excluded.email, "
                "acked_at=COALESCE(receipts.acked_at, excluded.acked_at)",
                (event_id, user["id"], user["username"], user["name"], user["email"], stamp, stamp if ack else None),
            )

    def delete_event(self, event_id):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM receipts WHERE event_id=?", (event_id,))
            return db.execute("DELETE FROM events WHERE id=?", (event_id,)).rowcount

    def acked(self, event_id, user_id):
        with self.connect() as db:
            row = db.execute("SELECT acked_at FROM receipts WHERE event_id=? AND user_id=?", (event_id, user_id)).fetchone()
            return bool(row and row["acked_at"])

    def report(self, banner, users):
        with self.lock, self.connect() as db:
            if banner:
                self.ensure_event(db, banner)
            events = db.execute("SELECT * FROM events ORDER BY first_seen DESC LIMIT ?", (MAX_EVENTS,)).fetchall()
            out = []
            for ev in events:
                rows = db.execute(
                    "SELECT * FROM receipts WHERE event_id=? ORDER BY acked_at IS NULL, acked_at DESC, viewed_at DESC", (ev["id"],)
                ).fetchall()
                seen = {r["user_id"] for r in rows}
                out.append({
                    "id": ev["id"], "level": ev["level"], "title": ev["title"], "message": ev["message"],
                    "firstSeen": ev["first_seen"], "current": bool(banner and banner["id"] == ev["id"]),
                    "viewed": len(rows), "acked": sum(1 for r in rows if r["acked_at"]),
                    "receipts": [{"username": r["username"], "name": r["name"], "email": r["email"],
                                  "viewedAt": r["viewed_at"], "ackedAt": r["acked_at"]} for r in rows],
                    "pending": [u for u in users if u["id"] not in seen] if users is not None else None,
                })
            return out


STORE = None

CLASSIFICATION_DEFAULT = {"enabled": False, "text": "UNCLASSIFIED", "height": 24, "background": "#007a33", "color": "#ffffff"}


# --------------------------------------------------------------------------- Keycloak <-> Coder: discovery and fixes

DEFAULT_KC_SETTINGS = {
    "realm": "master", "clientId": "coder", "scopes": "openid,profile,email", "usernameField": "preferred_username",
    "emailField": "email", "ignoreEmailVerified": True, "signInText": "Sign in with Keycloak",
    "iconUrl": "/icon/keycloak.svg", "allowSignups": True, "flowAlias": "x509-browser", "tokenLifespan": 36000,
}


def kc_settings(declared_env):
    """Suggested settings: what Coder is configured with where it is sensible, else the defaults."""
    s = dict(DEFAULT_KC_SETTINGS)
    s.update(STORE.get_setting("keycloak", {}) or {})
    issuer = (declared_env.get("CODER_OIDC_ISSUER_URL") or {}).get("value") or ""
    m = re.match(r"^(https?://[^/]+(?:/auth)?)/realms/([^/]+)/?$", issuer)
    discovered_url = keycloak_url_from_cluster()
    s["keycloakUrl"] = s.get("keycloakUrl") or discovered_url or (m.group(1) if m else "")
    if m:
        s["realm"] = m.group(2)
    for env, key in (("CODER_OIDC_CLIENT_ID", "clientId"), ("CODER_OIDC_SIGN_IN_TEXT", "signInText"),
                     ("CODER_OIDC_ICON_URL", "iconUrl")):
        v = (declared_env.get(env) or {}).get("value")
        if v:
            s[key] = v
    v = (declared_env.get("CODER_OIDC_ALLOW_SIGNUPS") or {}).get("value")
    if v is not None:
        s["allowSignups"] = str(v).lower() == "true"
    return s, discovered_url


def desired_client(s, access_url, flow_id):
    cb = access_url + "/api/v2/users/oidc/callback"
    client = {
        "clientId": s["clientId"], "name": "Coder", "enabled": True, "protocol": "openid-connect",
        "publicClient": False, "clientAuthenticatorType": "client-secret", "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False, "implicitFlowEnabled": False, "serviceAccountsEnabled": False,
        "rootUrl": access_url, "baseUrl": "/", "redirectUris": [cb], "webOrigins": [access_url],
        "attributes": {"post.logout.redirect.uris": access_url + "/*", "access.token.lifespan": str(int(s["tokenLifespan"]))},
    }
    if flow_id:
        client["authenticationFlowBindingOverrides"] = {"browser": flow_id}
    return client


def desired_env(s, kc_url):
    issuer = "%s/realms/%s" % (kc_url.rstrip("/"), s["realm"])
    return [
        {"name": "CODER_OIDC_ISSUER_URL", "value": issuer},
        {"name": "CODER_OIDC_CLIENT_ID", "value": s["clientId"]},
        {"name": "CODER_OIDC_CLIENT_SECRET", "valueFrom": {"secretKeyRef": {"name": OIDC_SECRET, "key": "client-secret"}}},
        {"name": "CODER_OIDC_SCOPES", "value": s["scopes"]},
        {"name": "CODER_OIDC_USERNAME_FIELD", "value": s["usernameField"]},
        {"name": "CODER_OIDC_EMAIL_FIELD", "value": s["emailField"]},
        {"name": "CODER_OIDC_IGNORE_EMAIL_VERIFIED", "value": "true" if s["ignoreEmailVerified"] else "false"},
        {"name": "CODER_OIDC_SIGN_IN_TEXT", "value": s["signInText"]},
        {"name": "CODER_OIDC_ICON_URL", "value": s["iconUrl"]},
        {"name": "CODER_OIDC_ALLOW_SIGNUPS", "value": "true" if s["allowSignups"] else "false"},
    ]


def oidc_secret_ref(env):
    """(name, key) of the Secret Coder really reads its OIDC client secret from, or None (inline / unset)."""
    ref = (((env.get("CODER_OIDC_CLIENT_SECRET") or {}).get("valueFrom") or {}).get("secretKeyRef")) or {}
    return (ref["name"], ref.get("key") or "client-secret") if ref.get("name") else None


def env_value(env, name):
    """The value Coder runs with: the variable, else Coder's default for it."""
    have = env.get(name)
    if have is not None and "value" in have:
        return have.get("value")
    return CODER_OIDC_DEFAULTS.get(name)


def group_names(env):
    """Group names Coder's settings refer to: allowed groups, and the keys of the group and role mappings."""
    names = []
    for part in (env_value(env, "CODER_OIDC_ALLOWED_GROUPS") or "").split(","):
        if part.strip():
            names.append(part.strip())
    for var in ("CODER_OIDC_GROUP_MAPPING", "CODER_OIDC_USER_ROLE_MAPPING"):
        raw = env_value(env, var) or ""
        try:
            names += list((json.loads(raw) if raw.strip() else {}).keys())
        except ValueError:
            pass
    return list(dict.fromkeys(names))


def ssl_dirs_ok(env):
    v = (env.get("SSL_CERT_DIR") or {}).get("value") or ""
    return CA_MOUNT in v.split(":")


def check(checks, cid, group, title, status, current=None, expected=None, detail="", fix=None):
    checks.append({"id": cid, "group": group, "title": title, "status": status,
                   "current": current, "expected": expected, "detail": detail, "fix": fix})


def walk_groups(groups):
    """Every group of a Keycloak group search result, sub-groups included (a search returns the matching trees)."""
    out = []
    for g in groups or []:
        out.append(g)
        out += walk_groups(g.get("subGroups") or [])
    return out


def group_report(checks, facts, env, kc, settings, client):
    """Coder's group-based settings, and (with Keycloak admin access) whether the groups they name exist and reach
    Coder in that form. Keycloak sends a child group as "/Parent/Child" when the group mapper's "Full group path" is on,
    and as just "Child" when it is off; Coder compares names exactly."""
    used = {k: env_value(env, k) for k in GROUP_SETTINGS if env_value(env, k)}
    facts["groupSettings"] = used
    if not used:
        return
    field = used.get("CODER_OIDC_GROUP_FIELD") or ""
    names = group_names(env)
    check(checks, "coder.groups", "Coder", "Group-based sign-in settings", "info",
          current=", ".join("%s=%s" % (k.replace("CODER_OIDC_", ""), v) for k, v in used.items())[:300],
          detail="Groups named: %s" % (", ".join(names) or "none"))
    flat = [n for n in names if "/" not in n]
    if not kc:
        if flat:
            check(checks, "coder.groups.flat", "Coder", "Group names without a path", "warn", current=", ".join(flat),
                  detail="These match only if Keycloak's group mapper has 'Full group path' OFF, and then ANY group with "
                         "that name matches (e.g. every child group called Admin). Prefer full paths like /Parent/Admin.")
        return
    realm = settings["realm"]
    # the claim: a group-membership mapper on the client or on one of its default client scopes
    mappers = []
    try:
        if client:
            mappers += kc.api("GET", "/%s/clients/%s/protocol-mappers/models" % (realm, client["id"])) or []
            for sc in kc.api("GET", "/%s/clients/%s/default-client-scopes" % (realm, client["id"])) or []:
                mappers += kc.api("GET", "/%s/client-scopes/%s/protocol-mappers/models" % (realm, sc["id"])) or []
    except Exception:  # noqa: BLE001
        pass
    gm = [m for m in mappers if m.get("protocolMapper") == "oidc-group-membership-mapper"
          and ((m.get("config") or {}).get("claim.name") or "") == field]
    if field and not gm:
        check(checks, "kc.groups.claim", "Keycloak", "Group claim '%s' in the token" % field, "error",
              current="no group-membership mapper with that claim name on client '%s'" % settings["clientId"],
              detail="Coder reads groups from the '%s' claim; without a mapper Keycloak doesn't send it, so allowed-group "
                     "sign-in fails for everyone." % field)
        return
    full_path = any(((m.get("config") or {}).get("full.path") or "false") == "true" for m in gm)
    if gm:
        check(checks, "kc.groups.claim", "Keycloak", "Group claim '%s' in the token" % field, "ok",
              current="group-membership mapper, full group path %s" % ("on (/Parent/Child)" if full_path else "off (Child)"))
    for n in names:
        try:
            if full_path or "/" in n:
                path = n if n.startswith("/") else "/" + n
                try:
                    g = kc.api("GET", "/%s/group-by-path/%s" % (realm, urllib.parse.quote(path.lstrip("/"), safe="/")))
                except Exception as e:  # noqa: BLE001
                    if "404" not in str(e):
                        raise
                    g = None
                ok_form = full_path and n.startswith("/")
                hint = ""
                if not g:
                    # the same last name elsewhere in the realm: the likely new path after a rename or a move
                    last = path.rstrip("/").rsplit("/", 1)[-1]
                    cands = [x.get("path") for x in walk_groups(kc.api("GET", "/%s/groups?search=%s&briefRepresentation=true" % (realm, urllib.parse.quote(last))) or [])
                             if x.get("name") == last]
                    hint = "; in the realm: %s" % ", ".join(cands) if cands else ""
                current = ("exists" if g else "not in realm %s%s" % (realm, hint))
                if g and not ok_form:
                    current += "; the token carries " + ("the full path: write it as %s" % path if full_path else "only the last name (full group path is off)")
                check(checks, "kc.group:" + n, "Keycloak", "Group %s" % n, "ok" if (g and ok_form) else "error", current=current,
                      detail="" if (g and ok_form) else "Members of a group Coder's settings name wrongly can't sign in (or lose what the "
                             "group gives them). A group renamed or moved in Keycloak (e.g. KeycloakAdminGroup -> /KeycloakGroup/Admin) "
                             "must be renamed where Coder is deployed from too.")
            else:
                found = kc.api("GET", "/%s/groups?search=%s&briefRepresentation=true" % (realm, urllib.parse.quote(n))) or []
                hits = [g.get("path") for g in walk_groups(found) if g.get("name") == n]
                check(checks, "kc.group:" + n, "Keycloak", "Group %s" % n, "warn" if len(hits) != 1 else "ok",
                      current="%d group(s) named %s: %s" % (len(hits), n, ", ".join(hits) or "none"),
                      detail="" if len(hits) == 1 else "With 'Full group path' off, every group called %s matches. Turn full "
                             "paths on and name the group by its path in Coder's settings." % n)
        except Exception as e:  # noqa: BLE001
            check(checks, "kc.group:" + n, "Keycloak", "Group %s" % n, "unknown", current=str(e)[:160])


def keycloak_report(token):
    checks, facts = [], {}
    access_url = CODER_ACCESS_URL
    facts["coderUrl"] = access_url
    facts["argoApp"] = ARGOCD_APP or None
    app = argo_app()
    values_text = (((app or {}).get("spec") or {}).get("source") or {}).get("helm", {}).get("values") if app else None
    declared = {}
    dep_status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
    running = container_env(dep) if dep_status == 200 else {}
    from_chart = any(((src or {}).get("configMapRef") or {}).get("name") == "coder-platform-config"
                     for src in ((((((dep or {}).get("spec") or {}).get("template") or {}).get("spec") or {})
                                  .get("containers") or [{}])[0].get("envFrom") or []))
    if app is None and ATTACHED:
        declared = running
        check(checks, "coder.source", "Coder", "Where Coder's settings live", "info",
              current="Coder's own Helm release or Argo CD Application",
              detail="The platform is attached to an existing Coder: change Coder's settings where Coder is deployed "
                     "from. Keycloak's side and the Secrets Coder reads can be fixed here.")
    elif app is None and from_chart:
        declared = running
        check(checks, "coder.source", "Coder", "Where Coder's settings live", "info",
              current="the coder-platform chart's values",
              detail="Coder's own settings come from the installation's values: change them in install.conf (or "
                     "values-local.yaml) and run ./install deploy. Keycloak's side and the Secrets can be fixed here.")
    elif app is None:
        declared = running
        check(checks, "coder.source", "Coder", "Where Coder's settings live", "warn",
              current="not an Argo CD Application this service can read",
              detail="Coder's settings can only be changed from here when Argo CD manages Coder. The checks below still "
                     "show what is wrong; change them where Coder is deployed from.")
    elif not isinstance(values_text, str):
        check(checks, "coder.source", "Coder", "Where Coder's settings live", "warn", current="Argo CD (valuesObject)",
              detail="The Application uses helm.valuesObject; this view only edits helm.values. Use keycloaking-coder.")
        app = None
    else:
        blk = values_block(values_text, "env")
        declared = env_map(blk[3] if blk else [])
        sync = ((app.get("status") or {}).get("sync") or {}).get("status")
        health = ((app.get("status") or {}).get("health") or {}).get("status")
        check(checks, "coder.source", "Coder", "Where Coder's settings live", "ok",
              current="Argo CD Application %s/%s (%s, %s)" % (ARGOCD_NAMESPACE, ARGOCD_APP, sync, health),
              detail="Changes are written to the Application's Helm values; Argo CD rolls Coder out with them.")
    facts["canEditCoder"] = app is not None

    settings, discovered_url = kc_settings(declared)
    facts["settings"] = settings
    facts["discoveredKeycloakUrl"] = discovered_url
    kc_url = settings["keycloakUrl"]
    if not kc_url:
        check(checks, "kc.url", "Connection", "Keycloak address", "error", detail="No Keycloak resource was found and Coder has no issuer URL. Enter Keycloak's address.")
        return {"checks": checks, "facts": facts}
    check(checks, "kc.url", "Connection", "Keycloak address", "ok", current=kc_url,
          detail="Found from the Keycloak resource in namespace %s." % KEYCLOAK_NAMESPACE if discovered_url else "Taken from Coder's issuer URL.")

    issuer = "%s/realms/%s" % (kc_url, settings["realm"])
    try:
        status, disc = http_json(issuer + "/.well-known/openid-configuration", context=TLS, timeout=6)
        if status == 200 and isinstance(disc, dict) and disc.get("issuer") == issuer:
            check(checks, "kc.discovery", "Connection", "Keycloak answers for realm '%s'" % settings["realm"], "ok", current=issuer)
        else:
            check(checks, "kc.discovery", "Connection", "Keycloak answers for realm '%s'" % settings["realm"], "error", current="HTTP %s" % status,
                  detail="Coder reads this discovery document at start-up; without it Coder does not start with OIDC enabled.")
    except ssl.SSLError as e:
        check(checks, "kc.discovery", "Connection", "Keycloak's TLS certificate is trusted", "error", current=str(e)[:120],
              detail="Keycloak's certificate is not signed by a CA this service (and Coder) trusts.")
    except Exception as e:  # noqa: BLE001
        check(checks, "kc.discovery", "Connection", "Keycloak is reachable", "error", current=str(e)[:160])

    kc = Keycloak(kc_url)
    client, flow_id, kc_ok = None, None, kc.login()
    check(checks, "kc.admin", "Connection", "Keycloak admin access", "ok" if kc_ok else "warn",
          current="via " + kc.via if kc_ok else "not connected",
          fix=None if kc_ok else "kc.connect",
          detail="" if kc_ok else (kc.error or "") + " Keycloak-side checks are skipped until this service is connected: "
                 "sign in once below with a Keycloak admin account and it creates its own, limited service account.")
    facts["keycloakConnected"] = kc_ok
    kc_secret = None
    if kc_ok:
        try:
            kc.api("GET", "/%s" % settings["realm"])
            check(checks, "kc.realm", "Keycloak", "Realm '%s' exists" % settings["realm"], "ok")
            flows = kc.api("GET", "/%s/authentication/flows" % settings["realm"]) or []
            flow = next((f for f in flows if f.get("alias") == settings["flowAlias"]), None)
            flow_id = flow and flow.get("id")
            clients = kc.api("GET", "/%s/clients?clientId=%s" % (settings["realm"], urllib.parse.quote(settings["clientId"])))
            client = clients[0] if clients else None
            want = desired_client(settings, access_url, flow_id)
            if not client:
                check(checks, "kc.client", "Keycloak", "OIDC client '%s'" % settings["clientId"], "error", current="missing",
                      expected="confidential client, callback %s" % want["redirectUris"][0], fix="kc.client",
                      detail="Coder signs people in through this client. It will be created with Coder's callback URL.")
            else:
                problems = []
                if not client.get("enabled"):
                    problems.append("disabled")
                if client.get("publicClient"):
                    problems.append("public (Coder needs a confidential client with a secret)")
                if not client.get("standardFlowEnabled"):
                    problems.append("standard (authorization code) flow off")
                cb = want["redirectUris"][0]
                uris = client.get("redirectUris") or []
                if not any(u == cb or (u.endswith("*") and cb.startswith(u[:-1])) for u in uris):
                    problems.append("callback %s not allowed (has: %s)" % (cb, ", ".join(uris) or "none"))
                if access_url not in (client.get("webOrigins") or []) and "+" not in (client.get("webOrigins") or []):
                    problems.append("web origin %s missing" % access_url)
                if flow_id and (client.get("authenticationFlowBindingOverrides") or {}).get("browser") != flow_id:
                    problems.append("browser flow is not '%s'" % settings["flowAlias"])
                check(checks, "kc.client", "Keycloak", "OIDC client '%s'" % settings["clientId"], "warn" if problems else "ok",
                      current="; ".join(problems) or "confidential, callback and origin allowed" + (", certificate flow" if flow_id else ""),
                      expected=None if not problems else "callback %s, origin %s" % (cb, access_url),
                      fix="kc.client" if problems else None,
                      detail="Existing redirect URIs and origins are kept; the missing ones are added." if problems else "")
                sec = kc.api("GET", "/%s/clients/%s/client-secret" % (settings["realm"], client["id"])) or {}
                kc_secret = sec.get("value")
                scopes = {s.get("name") for s in kc.api("GET", "/%s/clients/%s/default-client-scopes" % (settings["realm"], client["id"])) or []}
                missing = [n for n in ("profile", "email") if n not in scopes]
                check(checks, "kc.scopes", "Keycloak", "Client scopes give Coder a username and e-mail", "warn" if missing else "ok",
                      current="default scopes: " + (", ".join(sorted(scopes)) or "none"),
                      expected="profile, email" if missing else None, fix="kc.scopes" if missing else None,
                      detail="Coder reads preferred_username (profile) and email (email) from the ID token.")
            check(checks, "kc.flow", "Keycloak", "Certificate sign-in flow '%s'" % settings["flowAlias"], "ok" if flow_id else "info",
                  current="present" if flow_id else "not in this realm",
                  detail="" if flow_id else "Coder will use the realm's normal browser login. ../keycloak/keycloak-x509-sso sets up certificate sign-in.")
        except Exception as e:  # noqa: BLE001
            check(checks, "kc.realm", "Keycloak", "Realm '%s'" % settings["realm"], "error", current=str(e)[:200])

    # ---- Coder side (declared = Argo CD values; running = the Deployment)
    want_env = env_map(desired_env(settings, kc_url))
    source = declared if app else running
    diffs = []
    secret_ref = oidc_secret_ref(source) or (OIDC_SECRET, "client-secret")
    for name, want in want_env.items():
        if name == "CODER_OIDC_CLIENT_SECRET":
            # any Secret will do (its content is compared with Keycloak's below); an inline value is worth fixing
            if not oidc_secret_ref(source) and (source.get(name) or {}).get("value"):
                diffs.append({"name": name, "current": "inline value", "expected": "from a Secret"})
            elif not source.get(name):
                diffs.append({"name": name, "current": None, "expected": "from Secret %s (client-secret)" % OIDC_SECRET})
            continue
        have, wanted = env_value(source, name), want["value"]
        if name == "CODER_OIDC_SCOPES":
            if {"openid", "profile", "email"} <= set((have or "").replace(" ", ",").split(",")):
                continue
        if name == "CODER_OIDC_ISSUER_URL" and (have or "").rstrip("/") == (wanted or "").rstrip("/"):
            continue
        if (have or "") != (wanted or ""):
            diffs.append({"name": name, "current": have, "expected": wanted, "choice": name in OIDC_CHOICES})
    serious = [d for d in diffs if not d.get("choice")]
    check(checks, "coder.env", "Coder", "Coder's OIDC settings", "error" if serious else "info" if diffs else "ok",
          current=None if diffs else "match Keycloak", expected=None, fix="coder.values" if serious and app else None,
          detail="" if not diffs else ("Coder restarts to apply these (about 30 seconds; signed-in sessions survive)." if serious
                                       else "Only differences in this deployment's own choices (sign-in text, icon, sign-ups, email verification)."))
    facts["envDiffs"] = diffs
    running_ok = dep_status == 200 and ((dep or {}).get("status") or {}).get("availableReplicas", 0) >= 1
    started_with_issuer = (env_value(running, "CODER_OIDC_ISSUER_URL") or "").rstrip("/") == ("%s/realms/%s" % (kc_url.rstrip("/"), settings["realm"]))
    if running_ok and started_with_issuer:
        check(checks, "coder.ca", "Coder", "Coder trusts Keycloak's certificate", "ok", current="Coder is running with this issuer",
              detail="Coder reads the issuer's discovery document at start and doesn't start without it, so it reached and trusted Keycloak.")
    elif not ssl_dirs_ok(source):
        check(checks, "coder.ca", "Coder", "Coder trusts Keycloak's certificate", "error",
              current="SSL_CERT_DIR does not include %s" % CA_MOUNT, expected="/etc/ssl/certs:%s" % CA_MOUNT,
              fix="coder.values" if app else None,
              detail="Coder verifies Keycloak's TLS certificate against these directories; the local CA is mounted there.")

    # Secrets Coder reads
    facts["oidcSecret"] = "%s/%s" % secret_ref
    oidc = KUBE.secret(CODER_NAMESPACE, secret_ref[0])
    have_secret = (oidc or {}).get(secret_ref[1])
    if kc_secret is None:
        check(checks, "coder.secret", "Coder", "Client secret shared with Keycloak", "unknown" if have_secret else "error",
              current="Secret %s/%s (%s) %s" % (CODER_NAMESPACE, secret_ref[0], secret_ref[1], "present" if have_secret else "missing or not readable here"),
              detail="It can only be compared with Keycloak's copy once Keycloak admin access works.")
    else:
        same = have_secret is not None and have_secret == kc_secret
        check(checks, "coder.secret", "Coder", "Client secret shared with Keycloak", "ok" if same else "error",
              current="Secret %s/%s (%s) %s" % (CODER_NAMESPACE, secret_ref[0], secret_ref[1], "matches Keycloak" if same else ("differs from Keycloak" if have_secret else "missing")),
              fix=None if same else "coder.secret",
              detail="" if same else "Coder presents this secret when it exchanges the sign-in code; a mismatch fails every sign-in with 'unauthorized_client'.")
    group_report(checks, facts, source, kc if kc_ok else None, settings, client)

    ca_src = KUBE.secret(CODER_NAMESPACE, CA_SOURCE_SECRET)
    ca_now = KUBE.secret(CODER_NAMESPACE, CA_SECRET)
    if ca_src and ca_src.get("ca.crt"):
        same = bool(ca_now) and ca_now.get("ca.crt") == ca_src.get("ca.crt")
        check(checks, "coder.ca_secret", "Coder", "Keycloak's CA available to Coder", "ok" if same else "warn",
              current="Secret %s/%s %s" % (CODER_NAMESPACE, CA_SECRET, "present" if same else ("differs from %s" % CA_SOURCE_SECRET if ca_now else "missing")),
              fix=None if same else "coder.ca",
              detail="" if same else "Copied from Secret %s/%s, the CA that signed Keycloak's certificate." % (CODER_NAMESPACE, CA_SOURCE_SECRET))

    # Live: what the running Coder offers
    try:
        status, am = http_json(CODER_URL + "/api/v2/users/authmethods", timeout=5)
        oidc_on = status == 200 and bool(((am or {}).get("oidc") or {}).get("enabled"))
        pw_on = status == 200 and bool(((am or {}).get("password") or {}).get("enabled"))
        check(checks, "coder.live", "Coder", "Sign-in methods Coder offers now", "ok" if oidc_on else "error",
              current=", ".join([m for m, on in (("Keycloak (OIDC)", oidc_on), ("password", pw_on)) if on]) or "none",
              detail="" if oidc_on else "Coder is not offering OIDC sign-in; fix the items above and let it restart.")
    except Exception as e:  # noqa: BLE001
        check(checks, "coder.live", "Coder", "Sign-in methods Coder offers now", "unknown", current=str(e)[:120])
    if app and running and declared:
        pending = any((declared.get(n) or {}) != (running.get(n) or {}) for n in want_env)
        if pending:
            check(checks, "coder.rollout", "Coder", "Coder is running the saved settings", "info",
                  current="Argo CD is rolling Coder out with the new settings", detail="This page refreshes on its own.")

    # Users: Coder links accounts by e-mail, so each Coder user needs a Keycloak twin with the same e-mail
    if kc_ok and client is not None:
        try:
            users = active_users(token)
            missing, mismatch = [], []
            for u in users[:200]:
                found = kc.api("GET", "/%s/users?username=%s&exact=true" % (settings["realm"], urllib.parse.quote(u["username"])))
                if not found:
                    missing.append(u["username"])
                elif (found[0].get("email") or "").lower() != (u["email"] or "").lower():
                    mismatch.append(u["username"])
            status_u = "ok" if not missing and not mismatch else "info"
            detail = []
            if missing:
                detail.append("No Keycloak user yet: " + ", ".join(missing[:12]) + (" ..." if len(missing) > 12 else ""))
            if mismatch:
                detail.append("Different e-mail in Keycloak: " + ", ".join(mismatch[:12]))
            check(checks, "kc.users", "Keycloak", "Coder users can sign in through Keycloak", status_u,
                  current="%d of %d Coder users have a matching Keycloak user" % (len(users) - len(missing) - len(mismatch), len(users)),
                  detail=" ".join(detail) + (" Coder matches accounts by e-mail; ../keycloak/keycloaking-coder creates the missing twins." if detail else ""))
        except Exception as e:  # noqa: BLE001
            check(checks, "kc.users", "Keycloak", "Coder users can sign in through Keycloak", "unknown", current=str(e)[:160])

    backup = STORE.last_backup()
    facts["undo"] = {"savedAt": backup["saved_at"], "savedBy": backup["saved_by"]} if backup else None
    return {"checks": checks, "facts": facts}


def clean_kc_settings(raw):
    s = dict(DEFAULT_KC_SETTINGS)
    s.update(STORE.get_setting("keycloak", {}) or {})
    for key in ("keycloakUrl", "realm", "clientId", "scopes", "usernameField", "emailField", "signInText", "iconUrl", "flowAlias"):
        if key in raw:
            v = str(raw[key]).strip()
            if len(v) > 300 or any(c in v for c in "\n\r"):
                raise ValueError("%s is not valid." % key)
            s[key] = v
    for key in ("ignoreEmailVerified", "allowSignups"):
        if key in raw:
            s[key] = bool(raw[key])
    if "tokenLifespan" in raw:
        s["tokenLifespan"] = max(300, min(int(raw["tokenLifespan"]), 7 * 86400))
    if s.get("keycloakUrl") and not re.match(r"^https?://[A-Za-z0-9.\-:]+(/auth)?$", s["keycloakUrl"].rstrip("/")):
        raise ValueError("Keycloak address must look like https://keycloak.example.com")
    if not re.match(r"^[A-Za-z0-9_.\-]+$", s["realm"]) or not re.match(r"^[A-Za-z0-9_.\-]+$", s["clientId"]):
        raise ValueError("Realm and client ID may only contain letters, digits, '.', '_' and '-'.")
    if "openid" not in [x.strip() for x in s["scopes"].split(",")]:
        raise ValueError("Scopes must include openid.")
    s["keycloakUrl"] = (s.get("keycloakUrl") or "").rstrip("/")
    return s


ADMIN_CLIENT_ID = "coder-ui-updates"
# Least privilege for the realm Coder uses: read the realm and its flows, manage its clients, look up its users.
ADMIN_ROLES_NEEDED = ("view-realm", "view-clients", "manage-clients", "view-users", "query-users")


def connect_keycloak(username, password, raw_settings, user):
    """One-time: sign in as a Keycloak admin (credentials used for this call only, never stored), create the
    confidential service-account client ADMIN_CLIENT_ID in the master realm with the realm-management roles above for
    Coder's realm, and store that client's secret. From then on the service uses the client, not the admin account."""
    s = clean_kc_settings(raw_settings or {})
    kc_url = s["keycloakUrl"] or keycloak_url_from_cluster()
    if not kc_url:
        raise ValueError("Keycloak's address is unknown; enter it in the settings first.")
    kc = Keycloak(kc_url)
    tok, err = kc._token({"grant_type": "password", "client_id": "admin-cli", "username": username, "password": password})
    if not tok:
        raise RuntimeError("Keycloak refused that admin sign-in (%s)." % err)
    kc._use(tok, "admin %s" % username)
    found = kc.api("GET", "/master/clients?clientId=%s" % ADMIN_CLIENT_ID)
    if not found:
        kc.api("POST", "/master/clients", {
            "clientId": ADMIN_CLIENT_ID, "name": "coder-ui-updates (Coder dashboard: Keycloak view)", "enabled": True,
            "protocol": "openid-connect", "publicClient": False, "clientAuthenticatorType": "client-secret",
            "serviceAccountsEnabled": True, "standardFlowEnabled": False, "directAccessGrantsEnabled": False,
            "implicitFlowEnabled": False, "description": "Created from Coder > Deployment > Keycloak. Delete it to revoke access."})
        found = kc.api("GET", "/master/clients?clientId=%s" % ADMIN_CLIENT_ID)
    client = found[0]
    sa = kc.api("GET", "/master/clients/%s/service-account-user" % client["id"])
    # "<realm>-realm" in the master realm holds the management roles for <realm> (master-realm for master itself).
    mgmt = kc.api("GET", "/master/clients?clientId=%s" % urllib.parse.quote(s["realm"] + "-realm"))
    if not mgmt:
        raise RuntimeError("Keycloak has no management client '%s-realm' in the master realm." % s["realm"])
    roles = [r for r in kc.api("GET", "/master/clients/%s/roles" % mgmt[0]["id"]) or [] if r.get("name") in ADMIN_ROLES_NEEDED]
    kc.api("POST", "/master/users/%s/role-mappings/clients/%s" % (sa["id"], mgmt[0]["id"]), roles)
    secret = (kc.api("GET", "/master/clients/%s/client-secret" % client["id"]) or {}).get("value")
    if not secret:
        raise RuntimeError("Keycloak returned no secret for client '%s'." % ADMIN_CLIENT_ID)
    STORE.put_setting("keycloak_admin_client", {"url": kc_url, "clientId": ADMIN_CLIENT_ID, "secret": secret,
                                               "realm": s["realm"], "by": user, "at": now()})
    return ["Connected to Keycloak with service account '%s' (roles for realm '%s': %s). The admin password was not stored."
            % (ADMIN_CLIENT_ID, s["realm"], ", ".join(sorted(r["name"] for r in roles)))]


def apply_keycloak(fixes, raw_settings, user):
    s = clean_kc_settings(raw_settings or {})
    STORE.put_setting("keycloak", {k: v for k, v in s.items() if k != "keycloakUrl" or v != keycloak_url_from_cluster()})
    kc_url = s["keycloakUrl"] or keycloak_url_from_cluster()
    if not kc_url:
        raise ValueError("Keycloak's address is unknown; enter it first.")
    done = []
    kc = Keycloak(kc_url)
    realm = s["realm"]
    if "kc.client" in fixes or "kc.scopes" in fixes or "coder.secret" in fixes:
        if not kc.login():
            raise RuntimeError(kc.error)
    client = None
    if "kc.client" in fixes:
        flows = kc.api("GET", "/%s/authentication/flows" % realm) or []
        flow = next((f for f in flows if f.get("alias") == s["flowAlias"]), None)
        want = desired_client(s, CODER_ACCESS_URL, flow and flow.get("id"))
        found = kc.api("GET", "/%s/clients?clientId=%s" % (realm, urllib.parse.quote(s["clientId"])))
        if not found:
            kc.api("POST", "/%s/clients" % realm, want)
            done.append("Created Keycloak client '%s'" % s["clientId"])
            fixes = list(fixes) + ["coder.secret"]  # a new client has a new secret: Coder's copy is necessarily stale
        else:
            cur = kc.api("GET", "/%s/clients/%s" % (realm, found[0]["id"]))
            merged = dict(cur)
            for k, v in want.items():
                if k == "attributes":
                    merged["attributes"] = {**(cur.get("attributes") or {}), **v}
                elif k in ("redirectUris", "webOrigins"):
                    merged[k] = sorted(set((cur.get(k) or []) + v))
                elif k in ("rootUrl", "baseUrl", "name") and cur.get(k):
                    continue
                else:
                    merged[k] = v
            kc.api("PUT", "/%s/clients/%s" % (realm, found[0]["id"]), merged)
            done.append("Updated Keycloak client '%s'" % s["clientId"])
    if "kc.scopes" in fixes or "coder.secret" in fixes:
        found = kc.api("GET", "/%s/clients?clientId=%s" % (realm, urllib.parse.quote(s["clientId"])))
        if not found:
            raise RuntimeError("Keycloak client '%s' does not exist yet; create it first." % s["clientId"])
        client = found[0]
    if "kc.scopes" in fixes:
        have = {x.get("name") for x in kc.api("GET", "/%s/clients/%s/default-client-scopes" % (realm, client["id"])) or []}
        scopes = {x.get("name"): x.get("id") for x in kc.api("GET", "/%s/client-scopes" % realm) or []}
        for name in ("profile", "email"):
            if name not in have and scopes.get(name):
                kc.api("PUT", "/%s/clients/%s/default-client-scopes/%s" % (realm, client["id"], scopes[name]))
                done.append("Added scope '%s' to the client" % name)
    if "coder.secret" in fixes:
        sec = (kc.api("GET", "/%s/clients/%s/client-secret" % (realm, client["id"])) or {}).get("value")
        if not sec:
            raise RuntimeError("Keycloak returned no client secret for '%s'." % s["clientId"])
        status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
        name, key = oidc_secret_ref(container_env(dep) if status == 200 else {}) or (OIDC_SECRET, "client-secret")
        KUBE.put_secret(CODER_NAMESPACE, name, {key: sec})
        done.append("Stored the client secret in Secret %s/%s (key %s)" % (CODER_NAMESPACE, name, key))
    if "coder.ca" in fixes:
        src = KUBE.secret(CODER_NAMESPACE, CA_SOURCE_SECRET)
        if not src or not src.get("ca.crt"):
            raise RuntimeError("Secret %s/%s has no ca.crt." % (CODER_NAMESPACE, CA_SOURCE_SECRET))
        KUBE.put_secret(CODER_NAMESPACE, CA_SECRET, {"ca.crt": src["ca.crt"]})
        done.append("Stored Keycloak's CA in Secret %s/%s" % (CODER_NAMESPACE, CA_SECRET))
    if "coder.values" in fixes:
        done += apply_coder_values(s, kc_url, user)
    return done


def apply_coder_values(s, kc_url, user):
    app = argo_app()
    text = (((app or {}).get("spec") or {}).get("source") or {}).get("helm", {}).get("values") if app else None
    if not isinstance(text, str):
        raise RuntimeError("Coder's Argo CD Application (helm.values) is not readable; nothing was changed.")
    blk = values_block(text, "env")
    env = list(blk[3] if blk else [])
    want = desired_env(s, kc_url)
    names = {e["name"] for e in want}
    env = [e for e in env if not (isinstance(e, dict) and e.get("name") in names)] + want
    ssl_entry = next((e for e in env if isinstance(e, dict) and e.get("name") == "SSL_CERT_DIR"), None)
    if not ssl_entry:
        env.append({"name": "SSL_CERT_DIR", "value": "/etc/ssl/certs:" + CA_MOUNT})
    elif CA_MOUNT not in str(ssl_entry.get("value", "")).split(":"):
        ssl_entry["value"] = (ssl_entry.get("value") or "/etc/ssl/certs") + ":" + CA_MOUNT
    new = replace_values_block(text, "env", env)
    vols = values_block(new, "volumes")
    vol_list = list(vols[3] if vols else [])
    if not any(isinstance(v, dict) and v.get("name") == "keycloaking-ca" for v in vol_list):
        vol_list.append({"name": "keycloaking-ca", "secret": {"secretName": CA_SECRET}})
        new = replace_values_block(new, "volumes", vol_list)
    mounts = values_block(new, "volumeMounts")
    mount_list = list(mounts[3] if mounts else [])
    if not any(isinstance(v, dict) and v.get("name") == "keycloaking-ca" for v in mount_list):
        mount_list.append({"name": "keycloaking-ca", "mountPath": CA_MOUNT, "readOnly": True})
        new = replace_values_block(new, "volumeMounts", mount_list)
    if new == text:
        return ["Coder's settings already matched"]
    STORE.backup_values(user, ARGOCD_APP, text)
    patch_argo_values(new)
    return ["Saved Coder's OIDC settings in Argo CD Application %s; Coder is restarting with them" % ARGOCD_APP]


def patch_argo_values(text):
    status, out = KUBE.call("PATCH", "/apis/argoproj.io/v1alpha1/namespaces/%s/applications/%s" % (ARGOCD_NAMESPACE, ARGOCD_APP),
                            {"metadata": {"annotations": {"argocd.argoproj.io/refresh": "normal"}},
                             "spec": {"source": {"helm": {"values": text}}}}, "application/merge-patch+json")
    if status != 200:
        raise RuntimeError("Argo CD Application update failed (HTTP %s): %s" % (status, str(out)[:200]))



# --------------------------------------------------------------------------- Logo (Coder's CNPG database)
PNG, JPEG, GIF, WEBP = b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", (b"GIF87a", b"GIF89a"), b"RIFF"
LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif", "image/avif"}
SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"   # an SVG opened directly runs nothing


def is_avif(data):
    """An AVIF image (still or animated): an ISO-BMFF file whose ftyp box names the avif or avis brand."""
    return data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis")


def image_type(data, svg=False):
    """The content type of a PNG / JPEG / GIF / WebP (and, if allowed, script-free SVG) image, else None."""
    if data.startswith(PNG):
        return "image/png"
    if data.startswith(JPEG):
        return "image/jpeg"
    if data.startswith(GIF):
        return "image/gif"
    if data.startswith(WEBP) and data[8:12] == b"WEBP":
        return "image/webp"
    if is_avif(data):
        return "image/avif"
    if svg:
        text = data[:LOGO_MAX_BYTES].decode("utf-8", errors="replace").lower()
        if "<svg" in text and not re.search(r"<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed", text):
            return "image/svg+xml"
    return None


class Defaults:
    """The default images installed with this tool (resources/defaults/: logo.<ext>, avatar.<ext>), each from its own
    optional ConfigMap mounted at DEFAULTS_DIR/<kind>/. Re-read at most every 30 seconds, so a changed or removed
    ConfigMap takes effect without a restart. Checked like uploads: the logo may be SVG, the avatar may not."""

    def __init__(self, root):
        self.root = root
        self.cache = {}   # kind -> (read at, {"type", "data", "sha", "file"} or None)
        self.lock = threading.Lock()

    def get(self, kind):
        with self.lock:
            hit = self.cache.get(kind)
            if hit and time.time() - hit[0] < 30:
                return hit[1]
            value = self._read(kind)
            self.cache[kind] = (time.time(), value)
            return value

    def _read(self, kind):
        folder = os.path.join(self.root, kind)
        try:
            names = sorted(n for n in os.listdir(folder) if re.match(r"^%s\.(png|jpe?g|gif|webp|avif|svg)$" % kind, n))
        except OSError:
            return None
        for name in names:
            try:
                with open(os.path.join(folder, name), "rb") as f:
                    data = f.read(LOGO_MAX_BYTES + 1)
            except OSError:
                continue
            ctype = image_type(data, svg=kind == "logo") if 0 < len(data) <= LOGO_MAX_BYTES else None
            if ctype:
                return {"type": ctype, "data": data, "sha": hashlib.sha256(data).hexdigest()[:16], "file": name}
            log(event="default-image-ignored", kind=kind, file=name, reason="not a supported image or larger than %d MB" % (LOGO_MAX_BYTES // 1048576))
        return None


DEFAULTS = None


class LogoStore:
    """The uploaded logo, one row in coder_ui_updates.logo of Coder's own database (so it survives everything this
    tool's pods and volumes go through), cached in memory and re-read at most every 30 seconds."""

    def __init__(self):
        self._pool, self.tried_at = None, 0
        self.ready = False
        self.cache, self.loaded_at = None, 0
        self.lock = threading.Lock()
        self.refreshing = False
        self.peek()   # start loading it now, in the background

    def connect(self):
        """The database pool, made on first use. When this pod started before Coder's database existed (Argo CD
        creates the database in a later sync wave), the connection Secret was missing then: it is read through the
        API instead, re-tried at most every 30 seconds."""
        if self._pool or time.time() - self.tried_at < 30:
            return self._pool
        self.tried_at = time.time()
        uri, ca = CODER_DB_URI, CODER_DB_CA if CODER_DB_CA and os.path.exists(CODER_DB_CA) else None
        if not uri and CODER_DB_SECRET:
            uri = (KUBE.secret(CODER_NAMESPACE, CODER_DB_SECRET) or {}).get(CODER_DB_SECRET_KEY, "")
            if uri and not ca and CODER_DB_CA_SECRET:
                pem = (KUBE.secret(CODER_NAMESPACE, CODER_DB_CA_SECRET) or {}).get("ca.crt", "")
                if pem:
                    ca = os.path.join(os.path.dirname(DB_PATH), "coder-db-ca.crt")
                    with open(ca, "w") as f:
                        f.write(pem)
        if uri:
            self._pool = pgwire.Pool(uri, ca, size=2)
            log(event="logo-store", status="connected", via="environment" if CODER_DB_URI else "Secret " + CODER_DB_SECRET)
        return self._pool

    @property
    def pool(self):
        return self.connect()

    def _schema(self):
        if self.ready:
            return
        # No logo table yet = a fresh installation (or one whose logo was purged): it starts with the default logo, if
        # one is installed. Only then: an existing installation keeps what it has, Coder's own logo included.
        fresh = self.pool.query("SELECT to_regclass('coder_ui_updates.logo')")[0][0] is None
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.logo (
            id int PRIMARY KEY CHECK (id = 1), content_type text NOT NULL, data bytea NOT NULL,
            sha256 text NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now())""")
        default = DEFAULTS.get("logo") if fresh and DEFAULTS else None
        if default:
            self.pool.query("""INSERT INTO coder_ui_updates.logo (id, content_type, data, sha256, updated_by, updated_at)
                VALUES (1, $1, $2, $3, 'default', now()) ON CONFLICT (id) DO NOTHING""",
                            [default["type"], default["data"], default["sha"]])
            log(event="logo-default", status="installed", file=default["file"], bytes=len(default["data"]))
        self.ready = True

    def peek(self):
        """The logo for boot.js, which every Coder page waits for: the cached copy, refreshed in the background (at
        most every 30 seconds), so a slow or unreachable database never delays a page. Until the first load finishes
        pages show Coder's own logo."""
        if time.time() - self.loaded_at >= 30 and not self.refreshing:
            self.refreshing = True
            threading.Thread(target=self._refresh, daemon=True).start()
        return self.cache

    def _refresh(self):
        try:
            self.get(fresh=True)
        except Exception as e:  # noqa: BLE001
            log(event="logo-read-failed", error=str(e)[:200])
            self.loaded_at = time.time()   # try again in 30 seconds, keep the last good copy
        finally:
            self.refreshing = False

    def get(self, fresh=False):
        """{"type", "data", "sha", "by", "at"} or None. Raises when the database cannot be reached."""
        if not self.pool:
            return None
        with self.lock:
            if not fresh and time.time() - self.loaded_at < 30:
                return self.cache
            self._schema()
            rows = self.pool.query("SELECT content_type, data, sha256, updated_by, updated_at FROM coder_ui_updates.logo WHERE id = 1")
            self.cache = {"type": rows[0][0], "data": rows[0][1], "sha": rows[0][2], "by": rows[0][3], "at": rows[0][4]} if rows else None
            self.loaded_at = time.time()
            return self.cache

    def put(self, ctype, data, user):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            self.pool.query("""INSERT INTO coder_ui_updates.logo (id, content_type, data, sha256, updated_by, updated_at)
                VALUES (1, $1, $2, $3, $4, now()) ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type,
                data = excluded.data, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()""",
                            [ctype, data, sha, user])
            self.loaded_at = 0
        self.get(fresh=True)   # the cache boot.js reads is current at once
        return sha

    def reset(self):
        with self.lock:
            self._schema()
            self.pool.query("DELETE FROM coder_ui_updates.logo WHERE id = 1")
            self.loaded_at = 0
            self.cache = None   # boot.js stops pointing at it at once


def parse_logo(data_url):
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in LOGO_TYPES:
        raise ValueError("Upload a PNG, JPEG, SVG, WebP, GIF or AVIF image.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > LOGO_MAX_BYTES:
        raise ValueError("The image must be smaller than %d MB." % (LOGO_MAX_BYTES // 1048576))
    ctype = m.group(1)
    ok = {"image/png": data.startswith(PNG), "image/jpeg": data.startswith(JPEG), "image/gif": data.startswith(GIF),
          "image/webp": data.startswith(WEBP) and data[8:12] == b"WEBP", "image/avif": is_avif(data)}.get(ctype)
    if ctype == "image/svg+xml":
        text = data.decode("utf-8", errors="replace").lower()
        ok = "<svg" in text and not re.search(r"<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed", text)
        if not ok:
            raise ValueError("That SVG contains scripts or embedded content, which is not allowed.")
    if not ok:
        raise ValueError("The file is not a valid %s image." % ctype.split("/")[1].upper())
    return ctype, data


LOGOS = None


# --------------------------------------------------------------------------- Template icons (Coder's database)
ICON_MAX_BYTES = 1024 * 1024        # the dashboard sends a 256 px picture; an animated one keeps its frames
ICON_MAX_COUNT = 500
ICON_TYPES = LOGO_TYPES             # the same formats as the logo, SVG included (served under SVG_CSP)
ICON_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
ICON_MANAGER_ROLES = {"template-admin"}   # besides ADMIN_ROLES: who may add and remove icons


def parse_icon(data_url):
    """An uploaded icon: the same checks as the logo, at most ICON_MAX_BYTES."""
    ctype, data = parse_logo(data_url)
    if len(data) > ICON_MAX_BYTES:
        raise ValueError("The icon must be smaller than %d MB." % (ICON_MAX_BYTES // 1048576))
    return ctype, data


class IconStore:
    """Icons uploaded for templates and workspaces (Templates > Icons): one row per name in coder_ui_updates.icon of
    Coder's own database, served at /__coder-ui/icons/<name> so a template can use them like Coder's /icon/ files."""

    def __init__(self, logos):
        self.logos = logos   # shares the logo store's connection to Coder's database
        self.ready = False
        self.lock = threading.Lock()

    @property
    def pool(self):
        return self.logos.pool if self.logos else None

    def _schema(self):
        if self.ready:
            return
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.icon (
            name text PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, sha256 text NOT NULL,
            bytes int NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now())""")
        self.ready = True

    def list(self):
        with self.lock:
            self._schema()
            rows = self.pool.query("SELECT name, content_type, sha256, bytes, updated_by, updated_at::text "
                                   "FROM coder_ui_updates.icon ORDER BY name")
        return [{"name": r[0], "type": r[1], "url": "%s/icons/%s?v=%s" % (BASE, r[0], r[2]), "bytes": int(r[3]),
                 "uploadedBy": r[4], "uploadedAt": r[5]} for r in rows]

    def get(self, name):
        """(content type, data, sha) or None."""
        with self.lock:
            self._schema()
            rows = self.pool.query("SELECT content_type, data, sha256 FROM coder_ui_updates.icon WHERE name = $1", [name])
        return (rows[0][0], rows[0][1], rows[0][2]) if rows else None

    def put(self, name, ctype, data, user):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            count = int(self.pool.query("SELECT count(*) FROM coder_ui_updates.icon WHERE name <> $1", [name])[0][0])
            if count >= ICON_MAX_COUNT:
                raise ValueError("There are already %d icons; delete some first." % ICON_MAX_COUNT)
            self.pool.query("""INSERT INTO coder_ui_updates.icon (name, content_type, data, sha256, bytes, updated_by, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (name) DO UPDATE SET content_type = excluded.content_type,
                data = excluded.data, sha256 = excluded.sha256, bytes = excluded.bytes, updated_by = excluded.updated_by,
                updated_at = now()""", [name, ctype, data, sha, len(data), user])
        return sha

    def delete(self, name):
        with self.lock:
            self._schema()
            return bool(self.pool.query("DELETE FROM coder_ui_updates.icon WHERE name = $1 RETURNING name", [name]))


ICONS = None
FAVICONS = TTLCache()

# --------------------------------------------------------------------------- User avatars (Coder's database)

AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}
AVATAR_MAX_BYTES = 4 * 1024 * 1024   # the dashboard sends a 256 px square; an animated one keeps its frames


def parse_avatar(data_url):
    """The dashboard turns any picture into a 256 px square (an animated one stays animated); only PNG / JPEG / WebP /
    GIF / AVIF are stored, never SVG."""
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in AVATAR_TYPES:
        raise ValueError("Expected a PNG, JPEG, WebP, GIF or AVIF image.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > AVATAR_MAX_BYTES:
        raise ValueError("The picture must be smaller than %d MB." % (AVATAR_MAX_BYTES // 1048576))
    ctype = m.group(1)
    ok = {"image/png": data.startswith(PNG), "image/jpeg": data.startswith(JPEG), "image/gif": data.startswith(GIF),
          "image/webp": data.startswith(WEBP) and data[8:12] == b"WEBP", "image/avif": is_avif(data)}[ctype]
    if not ok:
        raise ValueError("The file is not a valid %s image." % ctype.split("/")[1].upper())
    return ctype, data


class AvatarStore:
    """Each user's own avatar picture: one row per Coder user in coder_ui_updates.avatar, in Coder's CloudNativePG
    database (so it is in that database's backups and survives this tool's pods). boot.js hands every page the
    username -> picture URL map, cached here and re-read at most every 30 seconds (never waits for the database)."""

    def __init__(self, logos):
        self.logos = logos          # shares the logo store's connection pool
        self.ready = False
        self.cache, self.loaded_at = {}, 0
        self.lock = threading.Lock()
        self.refreshing = False
        self.default_for, self.default_at = [], 0

    @property
    def pool(self):
        return self.logos.pool if self.logos else None

    def _schema(self):
        if self.ready:
            return
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.avatar (
            user_id text PRIMARY KEY, username text NOT NULL, content_type text NOT NULL, data bytea NOT NULL,
            sha256 text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())""")
        self.ready = True

    def urls(self):
        """{username: url} for boot.js, from the cache (refreshed in the background)."""
        if time.time() - self.loaded_at >= 30 and not self.refreshing and self.pool:
            self.refreshing = True
            threading.Thread(target=self._refresh, daemon=True).start()
        return self.cache

    def _refresh(self):
        try:
            with self.lock:
                self._schema()
                rows = self.pool.query("SELECT username, user_id, sha256 FROM coder_ui_updates.avatar")
                self.cache = {r[0]: "%s/avatar/%s?v=%s" % (BASE, r[1], r[2]) for r in rows}
                self.loaded_at = time.time()
        except Exception as e:  # noqa: BLE001
            log(event="avatar-read-failed", error=str(e)[:200])
            self.loaded_at = time.time()
        finally:
            self.refreshing = False

    def get(self, user_id):
        """(content_type, data) or None."""
        with self.lock:
            self._schema()
            rows = self.pool.query("SELECT content_type, data FROM coder_ui_updates.avatar WHERE user_id = $1", [user_id])
        return (rows[0][0], rows[0][1]) if rows else None

    def put(self, user, ctype, data):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            # a username is unique in Coder: a stale row left by a renamed user must not shadow the new owner's name
            self.pool.query("DELETE FROM coder_ui_updates.avatar WHERE username = $1 AND user_id <> $2", [user["username"], user["id"]])
            self.pool.query("""INSERT INTO coder_ui_updates.avatar (user_id, username, content_type, data, sha256, updated_at)
                VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (user_id) DO UPDATE SET username = excluded.username,
                content_type = excluded.content_type, data = excluded.data, sha256 = excluded.sha256, updated_at = now()""",
                            [user["id"], user["username"], ctype, data, sha])
        self._refresh()
        self.default_at = 0   # no longer one of the default avatar's users
        return "%s/avatar/%s?v=%s" % (BASE, user["id"], sha)

    def reset(self, user):
        with self.lock:
            self._schema()
            self.pool.query("DELETE FROM coder_ui_updates.avatar WHERE user_id = $1", [user["id"]])
        self._refresh()
        self.default_at = 0   # they may get the default avatar now

    @staticmethod
    def default_url():
        default = DEFAULTS.get("avatar") if DEFAULTS else None
        return "%s/avatar/default?v=%s" % (BASE, default["sha"]) if default else ""

    def default_users(self):
        """Usernames that get the default avatar: users (not deleted) with no picture at all, neither uploaded here nor
        Coder's own (avatar_url, e.g. from OIDC). Read from Coder's users table (username, avatar_url, deleted: the
        same since Coder's first releases), at most every 30 seconds; only signed-in pages are told."""
        if not self.default_url() or not self.pool:
            return []
        if time.time() - self.default_at < 30:
            return self.default_for
        try:
            with self.lock:
                self._schema()
                rows = self.pool.query("""SELECT u.username FROM public.users u WHERE NOT u.deleted
                    AND coalesce(u.avatar_url, '') = '' AND NOT EXISTS (
                        SELECT 1 FROM coder_ui_updates.avatar a WHERE a.user_id = u.id::text) ORDER BY u.username""")
            self.default_for = [r[0] for r in rows]
        except Exception as e:  # noqa: BLE001 - no default avatars rather than an error on every page
            log(event="avatar-default-users-failed", error=str(e)[:200])
        self.default_at = time.time()
        return self.default_for


AVATARS = None


# --------------------------------------------------------------------------- Monitoring (temporary log database)


class LogStore:
    """Pod log lines of the workspaces being watched, in the temporary Postgres (coder-ui-logs-db). Each stream keeps
    at most LOG_CAP_BYTES: older lines are deleted as new ones arrive, so the browser never holds more than it shows."""

    def __init__(self, url):
        self.pool = pgwire.Pool(url, size=6) if url else None
        self.ready = False
        self.lock = threading.Lock()

    def schema(self):
        if self.ready:
            return
        with self.lock:
            if self.ready:
                return
            self.pool.query("""CREATE TABLE IF NOT EXISTS log_lines (seq bigserial PRIMARY KEY, stream text NOT NULL,
                ts text, line text NOT NULL, bytes int NOT NULL)""")
            self.pool.query("CREATE INDEX IF NOT EXISTS log_lines_stream_seq ON log_lines (stream, seq)")
            self.ready = True

    def insert(self, stream, batch):
        self.schema()
        self.pool.query("""INSERT INTO log_lines (stream, ts, line, bytes)
            SELECT $1, x->>0, x->>1, (x->>2)::int FROM json_array_elements($2::json) x""",
                        [stream, json.dumps([[ts, line, len(line.encode())] for ts, line in batch])])

    def trim(self, stream, keep=LOG_CAP_BYTES):
        """Keeps the newest `keep` bytes of the stream; returns the bytes kept."""
        rows = self.pool.query("""SELECT seq FROM (SELECT seq, SUM(bytes) OVER (ORDER BY seq DESC) AS kept
            FROM log_lines WHERE stream = $1) x WHERE kept > $2 ORDER BY seq DESC LIMIT 1""", [stream, max(0, keep)])
        if rows:
            self.pool.query("DELETE FROM log_lines WHERE stream = $1 AND seq <= $2", [stream, rows[0][0]])
        return int(self.pool.query("SELECT COALESCE(SUM(bytes), 0) FROM log_lines WHERE stream = $1", [stream])[0][0])

    def read(self, stream, after, limit=2000):
        self.schema()
        if after <= 0:  # first look: only the newest lines, the browser does not need the whole 5 MB
            rows = self.pool.query("""SELECT seq, ts, line FROM (SELECT seq, ts, line FROM log_lines WHERE stream = $1
                ORDER BY seq DESC LIMIT 500) x ORDER BY seq""", [stream])
        else:
            rows = self.pool.query("SELECT seq, ts, line FROM log_lines WHERE stream = $1 AND seq > $2 ORDER BY seq LIMIT $3",
                                   [stream, after, limit])
        return [[int(r[0]), r[1], r[2]] for r in rows]

    def stats(self, stream):
        self.schema()
        r = self.pool.query("SELECT COUNT(*), COALESCE(SUM(bytes), 0), COALESCE(MAX(ts), '') FROM log_lines WHERE stream = $1", [stream])[0]
        return int(r[0]), int(r[1]), r[2]


def norm_ts(ts):
    """Kubernetes log timestamps drop trailing zeros (…49.9Z, …49.91Z): pad to nanoseconds so they sort as text."""
    if not ts.endswith("Z"):
        return ts
    base, _, frac = ts[:-1].partition(".")
    return "%s.%sZ" % (base, (frac or "0").ljust(9, "0")[:9])


class Follower(threading.Thread):
    """Streams one pod container's log (Kubernetes API, follow=true) into the LogStore until nobody has looked for
    IDLE_STOP seconds or the pod is gone. Reconnects (from the last timestamp) when the stream breaks."""
    IDLE_STOP = 120

    def __init__(self, logs, ns, pod, container, stream):
        super().__init__(daemon=True)
        self.logs, self.ns, self.pod, self.container, self.stream_id = logs, ns, pod, container, stream
        self.last_poll = time.time()
        self.state = "starting"
        self.error = None

    def _write(self, batch, stored):
        """Makes room first (the oldest lines go), then inserts: the stream never holds more than the cap, not even
        between the two steps."""
        sizes = [len(t.encode()) for _, t in batch]
        size = sum(sizes)
        while size > LOG_CAP_BYTES and batch:  # one batch bigger than the whole cap: keep its newest lines
            size -= sizes.pop(0)
            batch = batch[1:]
        if stored + size > LOG_CAP_BYTES:
            stored = self.logs.trim(self.stream_id, LOG_CAP_BYTES - size)
        self.logs.insert(self.stream_id, batch)
        return stored + size

    def run(self):
        try:
            _, stored, last_ts = self.logs.stats(self.stream_id)
            last_ts = last_ts or None  # resume after what is already stored
        except Exception as e:  # noqa: BLE001
            self.state, self.error = "error", "Log database: %s" % str(e)[:200]
            return
        while time.time() - self.last_poll < self.IDLE_STOP:
            q = {"container": self.container, "follow": "true", "timestamps": "true"}
            if last_ts:
                q["sinceTime"] = last_ts[:19] + "Z"  # whole seconds, inclusive: already-stored lines are skipped below
            else:
                q["tailLines"] = "5000"
            try:
                res = KUBE.stream("/api/v1/namespaces/%s/pods/%s/log?%s" % (self.ns, self.pod, urllib.parse.urlencode(q)))
            except urllib.error.HTTPError as e:
                self.state, self.error = ("gone", "The pod no longer exists.") if e.code == 404 else ("error", "Kubernetes: HTTP %s" % e.code)
                if e.code == 404:
                    return
                time.sleep(5)
                continue
            except Exception as e:  # noqa: BLE001
                self.state, self.error = "error", str(e)[:200]
                time.sleep(5)
                continue
            self.state, self.error = "streaming", None
            batch, flushed = [], time.time()
            try:
                for raw in res:
                    line = raw.decode("utf-8", errors="replace").rstrip("\n")
                    ts, _, text = line.partition(" ")
                    ts = norm_ts(ts)
                    if last_ts and ts <= last_ts:
                        continue  # sinceTime is inclusive (second precision): skip what we already have
                    batch.append((ts, text[:16384]))
                    last_ts = ts
                    if len(batch) >= 200 or time.time() - flushed > 0.5:
                        stored = self._write(batch, stored)
                        batch, flushed = [], time.time()
                    if time.time() - self.last_poll >= self.IDLE_STOP:
                        break
            except Exception as e:  # noqa: BLE001 - timeouts and broken streams: reconnect
                self.error = str(e)[:200]
            finally:
                if batch:
                    stored = self._write(batch, stored)
                res.close()
            time.sleep(1)
        self.state = "stopped"


class Monitor:
    def __init__(self):
        self.logs = LogStore(logs_db_url())
        self.followers = {}
        self.lock = threading.Lock()

    def pods(self, workspace_id=None):
        sel = "com.coder.workspace.id" + ("=" + workspace_id if workspace_id else "")
        status, lst = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (WORKSPACE_NAMESPACE, urllib.parse.quote(sel)))
        if status != 200:
            raise RuntimeError("Kubernetes pods in %s: HTTP %s" % (WORKSPACE_NAMESPACE, status))
        return lst.get("items") or []

    def overview(self, token):
        users = active_users(token)
        status, ws = http_json(CODER_URL + "/api/v2/workspaces?" + urllib.parse.urlencode({"q": "status:running", "limit": 1000}),
                               headers={"Coder-Session-Token": token})
        if status != 200:
            raise RuntimeError("Coder workspaces API: HTTP %s" % status)
        pods = {}
        try:
            for pod in self.pods():
                wid = ((pod.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")
                if wid and (pod.get("status") or {}).get("phase") == "Running":
                    pods[wid] = pod["metadata"]["name"]
        except RuntimeError as e:
            log(event="monitoring-pods-failed", error=str(e))
        by_user = {}
        for w in ws.get("workspaces") or []:
            build = w.get("latest_build") or {}
            agents = [{"name": a.get("name"), "status": a.get("status"), "lifecycle": a.get("lifecycle_state"),
                       "health": (a.get("health") or {}).get("healthy")}
                      for r in build.get("resources") or [] for a in r.get("agents") or []]
            by_user.setdefault(w.get("owner_id"), []).append({
                "workspaceId": w.get("id"), "name": w.get("name"), "owner": w.get("owner_name"),
                "template": w.get("template_display_name") or w.get("template_name"), "startedAt": build.get("updated_at"),
                "agents": agents, "healthy": (w.get("health") or {}).get("healthy", True), "pod": pods.get(w.get("id")),
                "watching": any(f.is_alive() for k, f in self.followers.items() if k.startswith((pods.get(w.get("id")) or "-") + "/")),
            })
        return {"namespace": WORKSPACE_NAMESPACE, "capBytes": LOG_CAP_BYTES,
                "users": [{"user": u, "instances": by_user.get(u["id"], [])} for u in users]}

    def lines(self, workspace_id, after):
        pods = [p for p in self.pods(workspace_id) if (p.get("status") or {}).get("phase") == "Running"]
        if not pods:
            raise LookupError("This workspace has no running pod in namespace %s." % WORKSPACE_NAMESPACE)
        pod = pods[0]
        name = pod["metadata"]["name"]
        container = (pod["spec"].get("containers") or [{}])[0].get("name")
        stream = "%s/%s" % (name, container)
        with self.lock:
            f = self.followers.get(stream)
            if not f or not f.is_alive():
                f = Follower(self.logs, WORKSPACE_NAMESPACE, name, container, stream)
                self.followers[stream] = f
                f.start()
            f.last_poll = time.time()
        rows = self.logs.read(stream, after)
        count, size, _ = self.logs.stats(stream)
        return {"pod": name, "container": container, "state": f.state, "error": f.error, "lines": rows,
                "stored": {"lines": count, "bytes": size, "capBytes": LOG_CAP_BYTES}}


MONITOR = None

# --------------------------------------------------------------------------- Network (General > Network map)

QUANTITY_SUFFIX = {"n": 1e-9, "u": 1e-6, "m": 1e-3, "": 1, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12, "P": 1e15,
                   "Ki": 2 ** 10, "Mi": 2 ** 20, "Gi": 2 ** 30, "Ti": 2 ** 40, "Pi": 2 ** 50, "E": 1e18, "Ei": 2 ** 60}


def quantity(text):
    """A Kubernetes resource quantity ("3500m", "16Gi", "1.5") as a float in base units (cores, bytes); None if unreadable."""
    m = re.match(r"^([0-9.]+)([a-zA-Z]{0,2})$", str(text or "").strip())
    if not m or m.group(2) not in QUANTITY_SUFFIX:
        return None
    try:
        return float(m.group(1)) * QUANTITY_SUFFIX[m.group(2)]
    except ValueError:
        return None


def pod_brief(pod):
    meta, spec, st = pod.get("metadata") or {}, pod.get("spec") or {}, pod.get("status") or {}
    containers = st.get("containerStatuses") or []
    return {"name": meta.get("name"), "namespace": meta.get("namespace"), "node": spec.get("nodeName"),
            "podIP": st.get("podIP"), "hostIP": st.get("hostIP"), "phase": st.get("phase"),
            "ready": bool(containers) and all(c.get("ready") for c in containers),
            "restarts": sum(c.get("restartCount") or 0 for c in containers), "started": st.get("startTime")}


def coder_role(pod):
    """What a pod in Coder's namespace is, for the map's legend."""
    labels = (pod.get("metadata") or {}).get("labels") or {}
    if labels.get("com.coder.workspace.id"):
        return "workspace"
    if labels.get("cnpg.io/cluster"):
        return "database"
    if labels.get("app.kubernetes.io/instance") == CODER_DEPLOYMENT and labels.get("app.kubernetes.io/name") in ("coder", None):
        return "coder"
    return "add-on"


def cluster_snapshot():
    """Nodes, running pods, node metrics (None without metrics-server) and the version, read cluster-wide through the
    ClusterRole; shared by the Network map and the Admin menu's resource bars, cached for 3 seconds."""
    hit = CACHE.get("network")
    if hit is None:
        status, nodes = KUBE.call("GET", "/api/v1/nodes")
        if status != 200:
            raise RuntimeError("Kubernetes nodes: HTTP %s (the service needs its ClusterRole coder-ui-updates-%s)" % (status, CODER_NAMESPACE))
        status, pods = KUBE.call("GET", "/api/v1/pods?fieldSelector=" + urllib.parse.quote("status.phase!=Succeeded,status.phase!=Failed"))
        pods = (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []
        status, usage = KUBE.call("GET", "/apis/metrics.k8s.io/v1beta1/nodes")
        usage = {(u.get("metadata") or {}).get("name"): u.get("usage") or {}
                 for u in (usage.get("items") or [])} if status == 200 and isinstance(usage, dict) else None
        status, version = KUBE.call("GET", "/version")
        hit = {"nodes": nodes.get("items") or [], "pods": pods, "usage": usage,
               "version": version.get("gitVersion") if status == 200 and isinstance(version, dict) else None}
        CACHE.put("network", hit, 3)
    return hit


def cluster_usage():
    """The cluster's CPU (cores) and memory (bytes) at a glance, over the Ready nodes: allocatable (what pods may use),
    in use (live, from metrics-server; else what is requested), requested (reserved by running pods' requests) and free
    (allocatable - requested: what new workspaces can still be given)."""
    hit = cluster_snapshot()
    ready = {(n.get("metadata") or {}).get("name"): n for n in hit["nodes"]
             if any(c.get("type") == "Ready" and c.get("status") == "True" for c in (n.get("status") or {}).get("conditions") or [])}
    out = {}
    for res in ("cpu", "memory"):
        total = sum(quantity(((n.get("status") or {}).get("allocatable") or {}).get(res)) or 0 for n in ready.values())
        requested = 0.0
        for pod in hit["pods"]:
            if (pod.get("spec") or {}).get("nodeName") in ready:
                for c in (pod.get("spec") or {}).get("containers") or []:
                    requested += quantity(((c.get("resources") or {}).get("requests") or {}).get(res)) or 0
        used = sum(quantity((hit["usage"].get(name) or {}).get(res)) or 0 for name in ready) if hit["usage"] is not None else requested
        out[res] = {"total": total, "used": used, "requested": requested, "free": max(total - requested, 0.0)}
    return {**out, "nodes": len(ready), "live": hit["usage"] is not None, "generatedAt": now()}


def network_report(token):
    """Nodes, their addresses, capacity and live usage, and which Coder pods and workspaces run on each."""
    hit = cluster_snapshot()

    status, ws = http_json(CODER_URL + "/api/v2/workspaces?" + urllib.parse.urlencode({"q": "status:running", "limit": 1000}),
                           headers={"Coder-Session-Token": token})
    workspaces = (ws.get("workspaces") or []) if status == 200 and isinstance(ws, dict) else []

    per_node = {}
    for pod in hit["pods"]:
        node = (pod.get("spec") or {}).get("nodeName")
        if not node:
            continue
        acc = per_node.setdefault(node, {"pods": 0, "cpu": 0.0, "memory": 0.0, "namespaces": {}})
        acc["pods"] += 1
        ns = (pod.get("metadata") or {}).get("namespace") or ""
        acc["namespaces"][ns] = acc["namespaces"].get(ns, 0) + 1
        for c in (pod.get("spec") or {}).get("containers") or []:
            req = (c.get("resources") or {}).get("requests") or {}
            acc["cpu"] += quantity(req.get("cpu")) or 0
            acc["memory"] += quantity(req.get("memory")) or 0

    out_nodes = []
    for n in hit["nodes"]:
        meta, spec, st = n.get("metadata") or {}, n.get("spec") or {}, n.get("status") or {}
        labels, info = meta.get("labels") or {}, st.get("nodeInfo") or {}
        addresses = {}
        for a in st.get("addresses") or []:
            addresses.setdefault(a.get("type"), []).append(a.get("address"))
        conditions = st.get("conditions") or []
        ready = next((c for c in conditions if c.get("type") == "Ready"), {})
        u = (hit["usage"] or {}).get(meta.get("name"))
        acc = per_node.get(meta.get("name"), {"pods": 0, "cpu": 0.0, "memory": 0.0, "namespaces": {}})
        res = lambda d: {"cpu": quantity((d or {}).get("cpu")), "memory": quantity((d or {}).get("memory")),  # noqa: E731
                         "pods": quantity((d or {}).get("pods")), "storage": quantity((d or {}).get("ephemeral-storage"))}
        out_nodes.append({
            "name": meta.get("name"), "created": meta.get("creationTimestamp"),
            "roles": sorted(k.split("/", 1)[1] for k in labels if k.startswith("node-role.kubernetes.io/") and "/" in k) or ["worker"],
            "zone": labels.get("topology.kubernetes.io/zone"), "region": labels.get("topology.kubernetes.io/region"),
            "instanceType": labels.get("node.kubernetes.io/instance-type"),
            "ready": ready.get("status") == "True", "readySince": ready.get("lastTransitionTime"),
            "unschedulable": bool(spec.get("unschedulable")),
            "pressure": [c.get("type") for c in conditions if c.get("type") != "Ready" and c.get("status") == "True"],
            "taints": ["%s%s:%s" % (t.get("key"), "=" + t["value"] if t.get("value") else "", t.get("effect")) for t in spec.get("taints") or []],
            "addresses": addresses, "podCIDRs": spec.get("podCIDRs") or ([spec["podCIDR"]] if spec.get("podCIDR") else []),
            "kubelet": info.get("kubeletVersion"), "os": info.get("osImage"), "kernel": info.get("kernelVersion"),
            "runtime": info.get("containerRuntimeVersion"), "arch": info.get("architecture"),
            "capacity": res(st.get("capacity")), "allocatable": res(st.get("allocatable")),
            "usage": {"cpu": quantity(u.get("cpu")), "memory": quantity(u.get("memory"))} if u else None,
            "requests": {"cpu": acc["cpu"], "memory": acc["memory"]}, "podCount": acc["pods"],
            "namespaces": dict(sorted(acc["namespaces"].items(), key=lambda kv: -kv[1])),
        })

    # Coder's own pods (server, database, add-ons) and the workspace pods, matched to Coder's workspaces.
    by_ws = {}
    coder = []
    for pod in hit["pods"]:
        meta = pod.get("metadata") or {}
        wid = (meta.get("labels") or {}).get("com.coder.workspace.id")
        if wid:
            by_ws.setdefault(wid, pod)
        elif meta.get("namespace") == CODER_NAMESPACE:
            coder.append({**pod_brief(pod), "role": coder_role(pod)})
    out_ws, unplaced = [], []
    for w in workspaces:
        build = w.get("latest_build") or {}
        agents = []
        for r in build.get("resources") or []:
            for a in r.get("agents") or []:
                lat = [v.get("latency_ms") for v in (a.get("latency") or {}).values() if isinstance(v, dict) and v.get("preferred")]
                agents.append({"name": a.get("name"), "status": a.get("status"), "lifecycle": a.get("lifecycle_state"),
                               "version": a.get("version"), "os": a.get("operating_system"), "arch": a.get("architecture"),
                               "latencyMs": lat[0] if lat else None})
        entry = {"id": w.get("id"), "name": w.get("name"), "owner": w.get("owner_name"),
                 "template": w.get("template_display_name") or w.get("template_name"),
                 "healthy": (w.get("health") or {}).get("healthy", True), "agents": agents}
        pod = by_ws.pop(w.get("id"), None)
        if pod:
            out_ws.append({**entry, **{"pod": pod_brief(pod)}})
        else:
            unplaced.append(entry)
    # Workspace pods Coder does not list as running (stopping, orphaned, or the API could not be read): still on the map,
    # named from the labels Coder's templates put on them.
    for wid, pod in by_ws.items():
        labels = (pod.get("metadata") or {}).get("labels") or {}
        out_ws.append({"id": wid, "name": labels.get("com.coder.workspace.name") or wid[:8], "owner": labels.get("com.coder.user.username") or "?",
                       "template": None, "healthy": None, "agents": [], "orphan": True, "pod": pod_brief(pod)})
    return {"generatedAt": now(), "kubernetesVersion": hit["version"], "accessUrl": CODER_ACCESS_URL,
            "metrics": hit["usage"] is not None, "coderNamespace": CODER_NAMESPACE,
            "nodes": sorted(out_nodes, key=lambda n: n["name"] or ""), "coder": sorted(coder, key=lambda p: (p["role"], p["name"] or "")),
            "workspaces": sorted(out_ws, key=lambda w: ((w["owner"] or "").lower(), (w["name"] or "").lower())),
            "unplaced": unplaced, "workspacesApi": status == 200}


# --------------------------------------------------------------------------- Persistence (Coder's database)


CNPG_API = "/apis/postgresql.cnpg.io/v1"
PG_IMAGE = os.environ.get("PG_IMAGE", "")     # the image a Cluster created here runs (air-gapped registries); "" = the operator's
PERSISTENCE_FIXES = ("cnpg.cluster", "cnpg.instances", "cnpg.storage", "cnpg.backup")
DEFAULT_PG_SETTINGS = {"clusterName": "coder-db", "instances": 3, "storageSize": "10Gi", "storageClass": "",
                       "snapshotClass": "", "backupSchedule": "0 0 2 * * *"}
NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9]{0,48}[a-z0-9])?$")
CRON6_RE = re.compile(r"^\S+( \S+){5}$")   # CloudNativePG schedules have a seconds field
STORAGE_HIGH = 0.8                          # warn when the database fills this share of its volume

# Hosted PostgreSQL recognised from the host name: (suffix or fragment, provider).
CLOUD_DB_HOSTS = ((".rds.amazonaws.com", "Amazon RDS"), (".postgres.database.azure.com", "Azure Database for PostgreSQL"),
                  (".postgres.cosmos.azure.com", "Azure Cosmos DB for PostgreSQL"), (".cloudsql", "Google Cloud SQL"),
                  (".alloydb", "Google AlloyDB"), (".neon.tech", "Neon"), (".supabase.co", "Supabase"),
                  (".crunchybridge.com", "Crunchy Bridge"), (".aivencloud.com", "Aiven"),
                  (".db.ondigitalocean.com", "DigitalOcean Managed PostgreSQL"))

# What a StorageClass's provisioner means for the data: (fragment, label, kind). First match wins.
STORAGE_PROVISIONERS = (
    ("ebs.csi.aws.com", "AWS EBS", "cloud"), ("kubernetes.io/aws-ebs", "AWS EBS", "cloud"),
    ("efs.csi.aws.com", "AWS EFS", "cloud"), ("disk.csi.azure.com", "Azure Disk", "cloud"),
    ("kubernetes.io/azure-disk", "Azure Disk", "cloud"), ("file.csi.azure.com", "Azure Files", "cloud"),
    ("pd.csi.storage.gke.io", "Google Persistent Disk", "cloud"), ("kubernetes.io/gce-pd", "Google Persistent Disk", "cloud"),
    ("csi.vsphere.vmware.com", "vSphere CNS", "network"), ("driver.longhorn.io", "Longhorn", "network"),
    ("rbd.csi.ceph.com", "Ceph RBD", "network"), ("cephfs.csi.ceph.com", "CephFS", "network"),
    ("portworx", "Portworx", "network"), ("openebs.io/local", "OpenEBS LocalPV", "local"),
    ("rancher.io/local-path", "local-path", "local"), ("topolvm", "TopoLVM", "local"),
    ("kubernetes.io/no-provisioner", "local volumes", "local"), ("hostpath", "host path", "local"),
    ("openebs.io", "OpenEBS", "network"), ("nfs", "NFS", "network"),
)


def storage_kind(provisioner):
    p = (provisioner or "").lower()
    for fragment, label, kind in STORAGE_PROVISIONERS:
        if fragment in p:
            return label, kind
    return provisioner or "unknown", "unknown"


def storage_classes():
    status, out = KUBE.call("GET", "/apis/storage.k8s.io/v1/storageclasses")
    items = (out.get("items") or []) if status == 200 and isinstance(out, dict) else []
    found = []
    for sc in items:
        meta = sc.get("metadata") or {}
        ann = meta.get("annotations") or {}
        label, kind = storage_kind(sc.get("provisioner"))
        found.append({"name": meta.get("name"), "provisioner": sc.get("provisioner"), "label": label, "kind": kind,
                      "isDefault": "true" in (ann.get("storageclass.kubernetes.io/is-default-class"),
                                              ann.get("storageclass.beta.kubernetes.io/is-default-class")),
                      "allowExpansion": bool(sc.get("allowVolumeExpansion")), "reclaimPolicy": sc.get("reclaimPolicy"),
                      "bindingMode": sc.get("volumeBindingMode")})
    return sorted(found, key=lambda s: (not s["isDefault"], s["name"] or ""))


def snapshot_classes():
    status, out = KUBE.call("GET", "/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses")
    items = (out.get("items") or []) if status == 200 and isinstance(out, dict) else []
    return sorted(n for n in ((c.get("metadata") or {}).get("name") for c in items) if n)


def cnpg_operator():
    """Whether CloudNativePG is installed: its CRD, and its Deployment (any namespace) for the version and readiness."""
    status, _ = KUBE.call("GET", "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/clusters.postgresql.cnpg.io")
    found = {"installed": status == 200, "crd": status == 200, "namespace": None, "version": None, "ready": None}
    status, deps = KUBE.call("GET", "/apis/apps/v1/deployments?labelSelector=" + urllib.parse.quote("app.kubernetes.io/name=cloudnative-pg"))
    items = (deps.get("items") or []) if status == 200 and isinstance(deps, dict) else []
    if items:
        d = items[0]
        image = ((((d.get("spec") or {}).get("template") or {}).get("spec") or {}).get("containers") or [{}])[0].get("image") or ""
        tag = image.rsplit("/", 1)[-1].split("@")[0]
        found.update({"installed": True, "namespace": (d.get("metadata") or {}).get("namespace"),
                      "version": tag.split(":", 1)[1] if ":" in tag else None,
                      "ready": ((d.get("status") or {}).get("readyReplicas") or 0) >= 1})
    return found


def parse_pg_uri(uri):
    """host, port, database, user and sslmode of a PostgreSQL URL or key=value DSN; never the password."""
    out = {"host": None, "port": None, "database": None, "user": None, "sslMode": None}
    if not uri:
        return out
    if "://" in uri:
        u = urllib.parse.urlsplit(uri)
        q = urllib.parse.parse_qs(u.query)
        try:
            port = u.port
        except ValueError:
            port = None
        out.update({"host": u.hostname, "port": port or 5432, "database": (u.path or "/")[1:] or None,
                    "user": urllib.parse.unquote(u.username) if u.username else None, "sslMode": (q.get("sslmode") or [None])[0]})
        return out
    kv = dict(m.groups() for m in re.finditer(r"(\w+)\s*=\s*('[^']*'|\S+)", uri))
    kv = {k: v.strip("'") for k, v in kv.items()}
    port = kv.get("port")
    out.update({"host": kv.get("host"), "port": int(port) if port and port.isdigit() else 5432, "database": kv.get("dbname"),
                "user": kv.get("user"), "sslMode": kv.get("sslmode")})
    return out


def coder_db_connection(env):
    """Where Coder's database is, from CODER_PG_CONNECTION_URL as Coder runs with it (its Secret is read for the host;
    the password is never returned)."""
    entry = env.get("CODER_PG_CONNECTION_URL") or {}
    ref = ((entry.get("valueFrom") or {}).get("secretKeyRef")) or {}
    uri, source, secret = entry.get("value"), "environment", None
    if ref.get("name"):
        secret = ref["name"]
        source = "Secret %s (key %s)" % (secret, ref.get("key") or "")
        uri = (KUBE.secret(CODER_NAMESPACE, secret) or {}).get(ref.get("key") or "")
    elif not entry:
        source = "Coder's built-in PostgreSQL" if env else None
    if not uri and secret and secret == CODER_DB_SECRET:
        uri = CODER_DB_URI
    return {**parse_pg_uri(uri), "source": source, "secret": secret}


def coder_cnpg_cluster(conn):
    """The CloudNativePG Cluster Coder's connection points at: its -rw/-ro/-r Service, or the <name>-app Secret."""
    host = conn.get("host") or ""
    parts = host.split(".")
    if len(parts) > 2 and parts[2] != "svc":
        return None   # an outside host (a cloud database) is not a CloudNativePG cluster, whatever its Secret is called
    ns = parts[1] if len(parts) >= 2 else CODER_NAMESPACE
    names = []
    m = re.match(r"^(.*)-(rw|ro|r)$", parts[0])
    if m:
        names.append(m.group(1))
    if (conn.get("secret") or "").endswith(("-app", "-superuser")):
        names.append(conn["secret"].rsplit("-", 1)[0])
    for name in dict.fromkeys(names):
        status, c = KUBE.call("GET", "%s/namespaces/%s/clusters/%s" % (CNPG_API, ns, name))
        if status == 200 and isinstance(c, dict):
            return c
    return None


def cnpg_list(ns, kind, cluster=None):
    status, out = KUBE.call("GET", "%s/namespaces/%s/%s" % (CNPG_API, ns, kind))
    items = (out.get("items") or []) if status == 200 and isinstance(out, dict) else []
    if cluster is None:
        return items
    return [i for i in items if (((i.get("spec") or {}).get("cluster") or {}).get("name")) == cluster]


def database_stats():
    """Size, connections and replication of Coder's database, read through the service's own connection to it."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    try:
        row = pool.query("select pg_database_size(current_database()), (select count(*) from pg_stat_activity), "
                         "current_setting('max_connections'), current_setting('server_version'), "
                         "pg_postmaster_start_time()::text")[0]
    except Exception as e:  # noqa: BLE001
        log(event="persistence-db-stats-failed", error=str(e)[:200])
        return None
    num = lambda v: float(v) if v not in (None, "") else None  # noqa: E731
    replication = []
    try:   # rows are visible to the monitoring role; an ordinary user sees them with the positions left out
        for r in pool.query("select application_name, state, sync_state, "
                            "pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) from pg_stat_replication"):
            replication.append({"name": r[0], "state": r[1], "syncState": r[2], "lagBytes": num(r[3])})
    except Exception as e:  # noqa: BLE001
        log(event="persistence-replication-failed", error=str(e)[:200])
    return {"sizeBytes": num(row[0]), "connections": int(row[1]) if row[1] is not None else None,
            "maxConnections": int(row[2]) if row[2] else None, "version": row[3], "startedAt": row[4],
            "replication": replication}


def managed_by(obj):
    meta = obj.get("metadata") or {}
    labels, ann = meta.get("labels") or {}, meta.get("annotations") or {}
    if ann.get("argocd.argoproj.io/tracking-id") or labels.get("argocd.argoproj.io/instance"):
        return "Argo CD (%s)" % (ann.get("argocd.argoproj.io/tracking-id", "").split(":", 1)[0] or labels.get("argocd.argoproj.io/instance"))
    if labels.get("app.kubernetes.io/managed-by") == "Helm":
        return "Helm release %s" % (ann.get("meta.helm.sh/release-name") or labels.get("app.kubernetes.io/instance") or "?")
    if labels.get("app.kubernetes.io/created-by") == "coder-ui-updates":
        return "General > Persistence"
    return None


def cluster_instances(cluster, replication):
    """Each instance of a Cluster: role, node and zone, readiness, its volume and how far it is behind the primary."""
    meta, st = cluster.get("metadata") or {}, cluster.get("status") or {}
    ns, name = meta.get("namespace"), meta.get("name")
    selector = "?labelSelector=" + urllib.parse.quote("cnpg.io/cluster=" + name)
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods%s" % (ns, selector))
    pods = (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []
    status, pvcs = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims%s" % (ns, selector))
    pvcs = {(p.get("metadata") or {}).get("name"): p for p in ((pvcs.get("items") or []) if status == 200 and isinstance(pvcs, dict) else [])}
    zones = {}
    try:
        zones = {(n.get("metadata") or {}).get("name"): ((n.get("metadata") or {}).get("labels") or {}).get("topology.kubernetes.io/zone")
                 for n in cluster_snapshot()["nodes"]}
    except RuntimeError:
        pass
    lag = {r["name"]: r for r in replication or []}

    def volume(pvc):
        if not pvc:
            return None
        spec, pst = pvc.get("spec") or {}, pvc.get("status") or {}
        return {"name": (pvc.get("metadata") or {}).get("name"), "storageClass": spec.get("storageClassName"),
                "capacityBytes": quantity((pst.get("capacity") or {}).get("storage")),
                "requestedBytes": quantity(((spec.get("resources") or {}).get("requests") or {}).get("storage")),
                "phase": pst.get("phase")}

    out = []
    for pod in pods:
        labels = (pod.get("metadata") or {}).get("labels") or {}
        if labels.get("cnpg.io/podRole") not in (None, "instance"):
            continue   # jobs (initdb, join) share the label
        brief = pod_brief(pod)
        role = labels.get("cnpg.io/instanceRole") or labels.get("role") or ""
        primary = role == "primary" or brief["name"] == st.get("currentPrimary")
        rep = lag.get(brief["name"]) or {}
        out.append({**brief, "role": "primary" if primary else "replica", "zone": zones.get(brief["node"]),
                    "pvc": volume(pvcs.get(brief["name"])), "walPvc": volume(pvcs.get(brief["name"] + "-wal")),
                    "lagBytes": None if primary else rep.get("lagBytes"), "replicationState": None if primary else rep.get("state"),
                    "syncState": None if primary else rep.get("syncState")})
    return sorted(out, key=lambda i: (i["role"] != "primary", i["name"] or ""))


def suggested_settings(cluster, classes, snaps):
    s = dict(DEFAULT_PG_SETTINGS)
    default_class = next((c["name"] for c in classes if c["isDefault"]), "")
    s.update({"storageClass": default_class, "snapshotClass": snaps[0] if snaps else ""})
    if cluster:
        spec = cluster.get("spec") or {}
        storage = spec.get("storage") or {}
        instances = int(spec.get("instances") or 1)   # a single instance is the one to change; replicas are kept as they are
        s.update({"clusterName": (cluster.get("metadata") or {}).get("name"), "instances": instances if instances >= 2 else 3,
                  "storageSize": storage.get("size") or s["storageSize"], "storageClass": storage.get("storageClass") or default_class,
                  "snapshotClass": (((spec.get("backup") or {}).get("volumeSnapshot") or {}).get("className")) or s["snapshotClass"]})
    return s


def persistence_report(token):
    checks, facts = [], {}
    status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
    env = container_env(dep) if status == 200 else {}
    conn = coder_db_connection(env)
    operator = cnpg_operator()
    classes, snaps = storage_classes(), snapshot_classes()
    cluster = coder_cnpg_cluster(conn) if operator["crd"] else None
    stats = database_stats()
    host = conn.get("host") or ""
    provider = next((p for frag, p in CLOUD_DB_HOSTS if frag in host), None)
    mode = "cloudnative-pg" if cluster else ("external" if host else "unknown")
    facts.update({"coderDatabase": conn, "operator": operator, "storageClasses": classes, "snapshotClasses": snaps,
                  "database": stats, "cluster": None, "instances": [], "backups": None,
                  "otherClusters": [], "provider": "CloudNativePG" if cluster else (provider or ("PostgreSQL" if host else None))})

    # Database
    if host:
        check(checks, "db.connection", "Database", "Coder's database", "ok",
              current="%s:%s/%s" % (host, conn.get("port") or 5432, conn.get("database") or "?"),
              detail="Coder connects as %s, TLS %s. Read from %s." % (conn.get("user") or "?", conn.get("sslMode") or "default (prefer)", conn.get("source")))
    elif conn.get("source") == "Coder's built-in PostgreSQL":
        check(checks, "db.connection", "Database", "Coder's database", "error", current="Coder's built-in PostgreSQL",
              expected="a PostgreSQL cluster", detail="The built-in database lives inside the Coder pod and has no replicas or backups. "
              "Create a CloudNativePG cluster below, move Coder's data to it, and point CODER_PG_CONNECTION_URL at its <name>-app Secret.")
    else:
        check(checks, "db.connection", "Database", "Coder's database", "unknown",
              detail="CODER_PG_CONNECTION_URL could not be read (Coder's Deployment, or the Secret it names, is not readable here).")
    if stats:
        check(checks, "db.reachable", "Database", "Database answers", "ok", current="PostgreSQL %s, %s of %s connections in use"
              % (stats["version"], stats["connections"], stats["maxConnections"]))
    elif LOGOS and LOGOS.pool:
        check(checks, "db.reachable", "Database", "Database answers", "error", detail="This service could not query Coder's database.")
    if provider and not cluster:
        check(checks, "db.provider", "Database", "Managed by a cloud provider", "info", current=provider,
              detail="High availability, storage and backups are configured with %s, not in this cluster. "
                     "Check there that Multi-AZ (or zone-redundant HA) and automated backups are on." % provider)

    # Operator
    if cluster or not provider:
        if operator["installed"]:
            check(checks, "cnpg.operator", "Operator", "CloudNativePG operator", "ok" if operator["ready"] is not False else "error",
                  current="CloudNativePG %s in %s%s" % (operator["version"] or "", operator["namespace"] or "the cluster",
                                                       "" if operator["ready"] is not False else " (not ready)"),
                  detail="" if operator["ready"] is not False else "The operator's Deployment has no ready pod; database changes and fail-over wait for it.")
        else:
            check(checks, "cnpg.operator", "Operator", "CloudNativePG operator", "error", current="not installed",
                  expected="CloudNativePG in cnpg-system", fix="cnpg.operator",
                  detail="The operator runs PostgreSQL clusters in Kubernetes: replicas, automatic fail-over, volume management and "
                         "backups. Install it once (see Set up the operator), then create Coder's cluster here.")

    if not cluster:
        if operator["crd"]:
            facts["otherClusters"] = [(c.get("metadata") or {}).get("name") for c in cnpg_list(CODER_NAMESPACE, "clusters")]
        if operator["installed"] and not provider:
            check(checks, "cnpg.cluster", "High availability", "A PostgreSQL cluster for Coder", "warn",
                  current="Coder does not use a CloudNativePG cluster", expected="a %d-instance cluster" % DEFAULT_PG_SETTINGS["instances"],
                  fix="cnpg.cluster",
                  detail="Creating the cluster does not move Coder: copy the data over (pg_dump / pg_restore) and point "
                         "CODER_PG_CONNECTION_URL at the new <name>-app Secret, then restart Coder.")
        facts["settings"] = suggested_settings(None, classes, snaps)
        return {"generatedAt": now(), "mode": mode, "checks": checks, "facts": facts}

    # The cluster Coder uses
    meta, spec, st = cluster.get("metadata") or {}, cluster.get("spec") or {}, cluster.get("status") or {}
    storage = spec.get("storage") or {}
    backup_spec = spec.get("backup") or {}
    instances = cluster_instances(cluster, (stats or {}).get("replication"))
    owner = managed_by(cluster)
    facts["cluster"] = {"name": meta.get("name"), "namespace": meta.get("namespace"), "phase": st.get("phase"),
                        "instances": int(spec.get("instances") or 1), "readyInstances": int(st.get("readyInstances") or 0),
                        "primary": st.get("currentPrimary"), "image": st.get("image") or spec.get("imageName"),
                        "storageSize": storage.get("size"), "storageClass": storage.get("storageClass"),
                        "walStorageSize": (spec.get("walStorage") or {}).get("size"), "managedBy": owner,
                        "created": meta.get("creationTimestamp")}
    facts["instances"] = instances
    n, ready = facts["cluster"]["instances"], facts["cluster"]["readyInstances"]

    # High availability
    if owner and owner != "General > Persistence":
        check(checks, "cnpg.owner", "High availability", "Where the cluster's settings live", "info", current=owner,
              detail="Changes made here are applied to the Cluster directly. Make the same change where it is deployed from "
                     "(postgres.instances / postgres.storage.size in the coder-platform values) or the next deploy undoes it.")
    if n >= 2:
        check(checks, "cnpg.instances", "High availability", "Replicas for automatic fail-over", "ok",
              current="%d instances (1 primary, %d %s)" % (n, n - 1, "replica" if n == 2 else "replicas"))
    else:
        check(checks, "cnpg.instances", "High availability", "Replicas for automatic fail-over", "warn",
              current="1 instance (no replica)", expected="3 instances (1 primary, 2 replicas)", fix="cnpg.instances",
              detail="With a single instance, Coder is down whenever that pod or its node is. Replicas stream every change and "
                     "one is promoted automatically if the primary fails.")
    check(checks, "cnpg.ready", "High availability", "Instances ready", "ok" if ready >= n else "error",
          current="%d of %d ready (%s)" % (ready, n, st.get("phase") or "phase unknown"),
          detail="" if ready >= n else "See the instances below; `kubectl -n %s get pods -l cnpg.io/cluster=%s` shows why." % (meta.get("namespace"), meta.get("name")))
    nodes = {i["node"] for i in instances if i["node"]}
    zones = {i["zone"] for i in instances if i["zone"]}
    if len(instances) >= 2:
        spread_ok = len(nodes) == len(instances)
        check(checks, "cnpg.spread", "High availability", "Instances on separate nodes", "ok" if spread_ok else "warn",
              current="%d %s%s" % (len(nodes), "node" if len(nodes) == 1 else "nodes",
                                   ", %d %s" % (len(zones), "zone" if len(zones) == 1 else "zones") if zones else ""),
              detail="" if spread_ok else "Two instances share a node, so losing that node loses both. Add nodes or enable required pod anti-affinity on the Cluster.")

    # Storage
    sc_name = storage.get("storageClass") or next((c["name"] for c in classes if c["isDefault"]), None)
    sc = next((c for c in classes if c["name"] == sc_name), None)
    if sc:
        local = sc["kind"] == "local"
        check(checks, "cnpg.storageclass", "Storage", "Storage class", "warn" if local and n < 2 else "ok",
              current="%s (%s%s)" % (sc["name"], sc["label"], ", default" if sc["isDefault"] else ""),
              detail=("A local volume stays on its node; with a single instance, losing the node loses the data until it is restored "
                      "from a backup. Add replicas." if local and n < 2 else
                      "Node-local disks: each replica has its own copy, so the cluster survives losing a node." if local else
                      "Volumes are network-attached: an instance can move to another node with its data."))
    capacity = next((i["pvc"]["capacityBytes"] for i in instances if i["role"] == "primary" and i["pvc"]), None) or quantity(storage.get("size"))
    size = (stats or {}).get("sizeBytes")
    if capacity and size is not None:
        used = size / capacity
        high = used >= STORAGE_HIGH
        grow = bool(sc and sc["allowExpansion"])
        check(checks, "cnpg.storage", "Storage", "Room on the database volume", "warn" if high else "ok",
              current="%.0f%% used (%s)" % (used * 100, storage.get("size") or "?"),
              expected="%s" % suggested_size(capacity) if high else None, fix="cnpg.storage" if high and grow else None,
              detail=("The volume can be grown in place." if grow else
                      "The storage class does not allow growing volumes: create a cluster with more storage and move the data.") if high else
                     "Measured as the database's size against the volume; WAL and indexes need room too.")

    # Backups
    scheduled = cnpg_list(meta.get("namespace"), "scheduledbackups", meta.get("name"))
    done_backups = sorted((b for b in cnpg_list(meta.get("namespace"), "backups", meta.get("name"))
                           if ((b.get("status") or {}).get("phase")) == "completed"),
                          key=lambda b: (b.get("status") or {}).get("stoppedAt") or "")
    method = "object store (Barman)" if backup_spec.get("barmanObjectStore") else ("volume snapshots" if backup_spec.get("volumeSnapshot") else None)
    last = st.get("lastSuccessfulBackup") or ((done_backups[-1].get("status") or {}).get("stoppedAt") if done_backups else None)
    facts["backups"] = {"configured": bool(method and scheduled), "method": method,
                        "schedule": ((scheduled[0].get("spec") or {}).get("schedule")) if scheduled else None,
                        "lastSuccess": last, "lastFailure": st.get("lastFailedBackup"),
                        "recoverableSince": st.get("firstRecoverabilityPoint"), "count": len(done_backups)}
    if method and scheduled:
        check(checks, "cnpg.backup", "Backups", "Scheduled backups", "ok",
              current="%s, schedule %s" % (method, facts["backups"]["schedule"]))
        age = (time.time() - datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()) / 3600 if last else None
        check(checks, "cnpg.lastbackup", "Backups", "Last successful backup", "ok" if age is not None and age < 48 else "warn",
              current=last or "none yet", detail="" if age is not None and age < 48 else "No backup completed in the last two days: check the Backup resources' status.")
    elif snaps:
        check(checks, "cnpg.backup", "Backups", "Scheduled backups", "warn", current="none", expected="daily volume snapshots (%s)" % snaps[0],
              fix="cnpg.backup", detail="Replicas protect against a lost node, not against deleted or corrupted data. "
                                         "Volume snapshots are taken by the storage system and can seed a new cluster.")
    else:
        check(checks, "cnpg.backup", "Backups", "Scheduled backups", "warn", current="none",
              detail="This cluster has no VolumeSnapshotClass, so snapshot backups can't be set up here. Configure "
                     "spec.backup.barmanObjectStore (S3, Azure Blob, Google Cloud Storage or MinIO) on the Cluster and add a ScheduledBackup.")
    facts["settings"] = suggested_settings(cluster, classes, snaps)
    return {"generatedAt": now(), "mode": mode, "checks": checks, "facts": facts}


def suggested_size(capacity):
    """Double the volume, rounded to whole GiB, as a Kubernetes quantity."""
    return "%dGi" % max(1, round(capacity * 2 / 2 ** 30))


def clean_pg_settings(raw):
    s = dict(DEFAULT_PG_SETTINGS)
    name = str(raw.get("clusterName") or s["clusterName"]).strip()
    if not NAME_RE.match(name):
        raise ValueError("Cluster name: lower-case letters, digits and '-', at most 50 characters.")
    try:
        instances = int(raw.get("instances") or s["instances"])
    except (TypeError, ValueError):
        raise ValueError("Instances must be a whole number.")
    if not 1 <= instances <= 9:
        raise ValueError("Instances: between 1 and 9.")
    size = str(raw.get("storageSize") or s["storageSize"]).strip()
    if (quantity(size) or 0) < 2 ** 30:
        raise ValueError("Storage size: a Kubernetes quantity of at least 1Gi, for example 20Gi.")
    out = {"clusterName": name, "instances": instances, "storageSize": size}
    for key in ("storageClass", "snapshotClass"):
        value = str(raw.get(key) or "").strip()
        if value and not re.match(r"^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$", value):
            raise ValueError("%s: not a valid Kubernetes name." % key)
        out[key] = value
    schedule = str(raw.get("backupSchedule") or s["backupSchedule"]).strip()
    if not CRON6_RE.match(schedule):
        raise ValueError("Backup schedule: six cron fields (seconds first), for example '0 0 2 * * *'.")
    out["backupSchedule"] = schedule
    return out


def apply_persistence(fixes, raw_settings, user):
    s = clean_pg_settings(raw_settings or {})
    ns, name = CODER_NAMESPACE, s["clusterName"]
    path = "%s/namespaces/%s/clusters/%s" % (CNPG_API, ns, name)
    labels = {"app.kubernetes.io/part-of": "coder", "app.kubernetes.io/created-by": "coder-ui-updates"}
    done = []
    if "cnpg.cluster" in fixes:
        status, _ = KUBE.call("GET", path)
        if status == 200:
            done.append("Cluster %s/%s already exists" % (ns, name))
        else:
            storage = {"size": s["storageSize"]}
            if s["storageClass"]:
                storage["storageClass"] = s["storageClass"]
            spec = {"instances": s["instances"], "primaryUpdateStrategy": "unsupervised", "storage": storage,
                    "affinity": {"enablePodAntiAffinity": True, "topologyKey": "kubernetes.io/hostname"}}
            if PG_IMAGE:
                spec["imageName"] = PG_IMAGE
            status, out = KUBE.call("POST", "%s/namespaces/%s/clusters" % (CNPG_API, ns),
                                    {"apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster",
                                     "metadata": {"name": name, "namespace": ns, "labels": labels}, "spec": spec})
            if status not in (200, 201):
                raise RuntimeError("Creating Cluster %s/%s failed (HTTP %s): %s" % (ns, name, status, str(out)[:200]))
            done.append("Created CloudNativePG cluster %s/%s: %d %s, %s each%s; its connection Secret is %s-app"
                        % (ns, name, s["instances"], "instance" if s["instances"] == 1 else "instances", s["storageSize"],
                           " on " + s["storageClass"] if s["storageClass"] else "", name))
    if not {"cnpg.instances", "cnpg.storage", "cnpg.backup"} & set(fixes):
        return done
    status, cluster = KUBE.call("GET", path)
    if status != 200 or not isinstance(cluster, dict):
        raise RuntimeError("Cluster %s/%s does not exist (HTTP %s)." % (ns, name, status))
    spec = cluster.get("spec") or {}
    patch = {}
    if "cnpg.instances" in fixes and int(spec.get("instances") or 1) != s["instances"]:
        patch["instances"] = s["instances"]
        done.append("Cluster %s now runs %d instances" % (name, s["instances"]))
    if "cnpg.storage" in fixes:
        current = quantity((spec.get("storage") or {}).get("size")) or 0
        if (quantity(s["storageSize"]) or 0) <= current:
            raise ValueError("Storage can only grow: the cluster has %s." % (spec.get("storage") or {}).get("size"))
        sc_name = (spec.get("storage") or {}).get("storageClass") or next((c["name"] for c in storage_classes() if c["isDefault"]), None)
        sc = next((c for c in storage_classes() if c["name"] == sc_name), None)
        if sc and not sc["allowExpansion"]:
            raise ValueError("Storage class %s does not allow growing volumes." % sc_name)
        patch["storage"] = {"size": s["storageSize"]}
        done.append("Growing %s's volumes to %s" % (name, s["storageSize"]))
    if "cnpg.backup" in fixes:
        snap = s["snapshotClass"] or next(iter(snapshot_classes()), "")
        if not snap:
            raise ValueError("No VolumeSnapshotClass exists in this cluster.")
        patch["backup"] = {"volumeSnapshot": {"className": snap}}
    if patch:
        status, out = KUBE.call("PATCH", path, {"spec": patch}, "application/merge-patch+json")
        if status != 200:
            raise RuntimeError("Updating Cluster %s/%s failed (HTTP %s): %s" % (ns, name, status, str(out)[:200]))
    if "cnpg.backup" in fixes:
        sb = name + "-daily"
        status, _ = KUBE.call("GET", "%s/namespaces/%s/scheduledbackups/%s" % (CNPG_API, ns, sb))
        if status != 200:
            status, out = KUBE.call("POST", "%s/namespaces/%s/scheduledbackups" % (CNPG_API, ns), {
                "apiVersion": "postgresql.cnpg.io/v1", "kind": "ScheduledBackup",
                "metadata": {"name": sb, "namespace": ns, "labels": labels},
                "spec": {"schedule": s["backupSchedule"], "backupOwnerReference": "self", "cluster": {"name": name},
                         "method": "volumeSnapshot", "immediate": True}})
            if status not in (200, 201):
                raise RuntimeError("Creating ScheduledBackup %s failed (HTTP %s): %s" % (sb, status, str(out)[:200]))
        done.append("Scheduled volume-snapshot backups of %s (%s), the first one now" % (name, s["backupSchedule"]))
    owner = managed_by(cluster)
    if owner and owner != "General > Persistence" and patch:
        done.append("Also change it where the cluster is deployed from (%s), or the next deploy undoes it" % owner)
    log(event="persistence-applied", user=user, cluster=name, fixes=list(fixes))
    return done or ["Cluster %s already matched; nothing changed" % name]


# --------------------------------------------------------------------------- Chat (admins <-> users)
CHAT_MAX_TEXT = 4000
CHAT_KEEP_DAYS = 30
CHAT_TYPING_SECONDS = 6       # a "typing" signal lasts this long unless renewed (chat.js renews it every 2.5 s)
CHAT_POLL_SECONDS = 25        # a long poll answers at the latest after this, with nothing new
CHAT_RATE = (30, 60)          # at most 30 messages per 60 seconds per sender
CHAT_MAX_IMAGE = 4 * 1024 * 1024   # a screenshot attached to a message (PNG / JPEG / WebP)


class ChatStore:
    """Direct messages between admins and users: an admin starts a conversation from Admin > Users ("Chat"), or a user
    writes to an admin from the Chats panel (their line to support); both answer in the window that opens on every Coder
    page (chat.js). Admins may write to anyone; everyone else to admins, or to whoever wrote to them first. A message
    may carry a screenshot (chat_files, read only by the two people in the conversation). Messages are kept CHAT_KEEP_DAYS days in the service's SQLite file
    (its PersistentVolumeClaim). Typing signals live in memory only. A tab keeps one long poll open
    (/api/chat/poll), answered as soon as a message or a typing change concerns its user."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.changed = threading.Condition()
        self.latest = {}      # user id -> newest message id they sent or received (filled lazily)
        self.typing = {}      # (from id, to id) -> expiry time
        self.sent = {}        # user id -> recent send times (rate limit)
        # deleted conversations, told to both sides through the poll: user id -> [(version, peer id)]. Versions start at
        # this boot's time in ms, so they only grow, across restarts too.
        self.clear_ver = int(time.time() * 1000)
        self.cleared = {}
        # admins who turned their chat off (the switch in their Chats panel): developers can't write to them. A version
        # (also boot time in ms) wakes every poll when it changes, so everyone's panel updates at once.
        self.off = set()
        self.avail_ver = int(time.time() * 1000)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, from_name TEXT NOT NULL, from_display TEXT,
                  to_id TEXT NOT NULL, to_name TEXT NOT NULL, to_display TEXT, text TEXT NOT NULL, sent_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS chat_messages_to ON chat_messages (to_id, id);
                CREATE INDEX IF NOT EXISTS chat_messages_from ON chat_messages (from_id, id);
                CREATE TABLE IF NOT EXISTS chat_read (
                  user_id TEXT NOT NULL, peer_id TEXT NOT NULL, last_id INTEGER NOT NULL, PRIMARY KEY (user_id, peer_id));
            """)
            # whether sender / recipient were admins when it was sent: admins' messages are drawn on the left
            columns = {r["name"] for r in db.execute("PRAGMA table_info(chat_messages)")}
            for column, kind in (("from_admin", "INTEGER NOT NULL DEFAULT 0"), ("to_admin", "INTEGER NOT NULL DEFAULT 0"),
                                 ("image_type", "TEXT NOT NULL DEFAULT ''"), ("page", "TEXT NOT NULL DEFAULT ''")):
                if column not in columns:
                    db.execute("ALTER TABLE chat_messages ADD COLUMN %s %s" % (column, kind))
            # attachments apart from the messages, so polls and lists never read image bytes
            db.execute("CREATE TABLE IF NOT EXISTS chat_files (message_id INTEGER PRIMARY KEY, data BLOB NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS chat_status (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL)")
            self.off = {r[0] for r in db.execute("SELECT user_id FROM chat_status WHERE enabled = 0")}
            cutoff = datetime.fromtimestamp(time.time() - CHAT_KEEP_DAYS * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            db.execute("DELETE FROM chat_messages WHERE sent_at < ?", (cutoff,))
            db.execute("DELETE FROM chat_files WHERE message_id NOT IN (SELECT id FROM chat_messages)")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _message(r):
        return {"id": r["id"], "from": r["from_id"], "fromName": r["from_name"], "fromDisplay": r["from_display"] or "",
                "to": r["to_id"], "toName": r["to_name"], "toDisplay": r["to_display"] or "", "text": r["text"], "at": r["sent_at"],
                "fromAdmin": bool(r["from_admin"]), "toAdmin": bool(r["to_admin"]),
                "image": "%s/api/chat/file/%d" % (BASE, r["id"]) if r["image_type"] else None, "page": r["page"] or None}

    def newest(self, user_id):
        if user_id not in self.latest:
            with self.connect() as db:
                row = db.execute("SELECT max(id) FROM chat_messages WHERE from_id = ? OR to_id = ?", (user_id, user_id)).fetchone()
            self.latest[user_id] = row[0] or 0
        return self.latest[user_id]

    def set_enabled(self, user_id, on):
        with self.lock, self.connect() as db:
            db.execute("""INSERT INTO chat_status (user_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id)
                          DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at""", (user_id, int(on), now()))
        with self.changed:
            (self.off.discard if on else self.off.add)(user_id)
            self.avail_ver += 1
            self.changed.notify_all()

    def may_write(self, user, admin, peer_id, admin_ids=()):
        """None if allowed, else why not. Admins write to anyone. Everyone else writes to admins who have chat on, or
        answers someone who wrote to them, unless that is an admin who has turned chat off."""
        if peer_id == user["id"]:
            return "You can't chat with yourself."
        if admin:
            return None
        if peer_id in self.off:
            return "This admin has turned chat off; try another admin."
        if peer_id in admin_ids:
            return None
        with self.connect() as db:
            hit = db.execute("SELECT 1 FROM chat_messages WHERE from_id = ? AND to_id = ? LIMIT 1", (peer_id, user["id"])).fetchone()
        return None if hit else "You can start a conversation with an admin only."

    def peer_from_history(self, user_id, peer_id):
        """{id, username, name} of someone this user has exchanged messages with, from the newest message."""
        with self.connect() as db:
            r = db.execute("""SELECT * FROM chat_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
                              ORDER BY id DESC LIMIT 1""", (user_id, peer_id, peer_id, user_id)).fetchone()
        if not r:
            return None
        if r["from_id"] == peer_id:
            return {"id": peer_id, "username": r["from_name"], "name": r["from_display"] or ""}
        return {"id": peer_id, "username": r["to_name"], "name": r["to_display"] or ""}

    def rate_ok(self, user_id):
        times = [t for t in self.sent.get(user_id, []) if time.time() - t < CHAT_RATE[1]]
        self.sent[user_id] = times
        if len(times) >= CHAT_RATE[0]:
            return False
        times.append(time.time())
        return True

    def send(self, user, admin, peer, text, image=None, page=""):
        """image: (content type, bytes) or None; page: where it was taken (path on Coder's host)."""
        with self.lock, self.connect() as db:
            cur = db.execute("""INSERT INTO chat_messages (from_id, from_name, from_display, to_id, to_name, to_display, text, sent_at,
                                from_admin, to_admin, image_type, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                             (user["id"], user["username"], user.get("name") or "", peer["id"], peer["username"],
                              peer.get("name") or "", text, now(), int(admin), int(bool(peer.get("admin"))),
                              image[0] if image else "", page if image else ""))
            if image:
                db.execute("INSERT INTO chat_files (message_id, data) VALUES (?, ?)", (cur.lastrowid, sqlite3.Binary(image[1])))
            row = db.execute("SELECT * FROM chat_messages WHERE id = ?", (cur.lastrowid,)).fetchone()
        with self.changed:
            self.latest[user["id"]] = self.latest[peer["id"]] = row["id"]
            self.typing.pop((user["id"], peer["id"]), None)   # a sent message ends "typing"
            self.changed.notify_all()
        return self._message(row)

    def set_typing(self, user_id, peer_id):
        with self.changed:
            for k in [k for k, until in self.typing.items() if until < time.time() - 60]:
                del self.typing[k]   # long expired
            fresh = self.typing.get((user_id, peer_id), 0) < time.time()
            self.typing[(user_id, peer_id)] = time.time() + CHAT_TYPING_SECONDS
            if fresh:
                self.changed.notify_all()

    def typing_to(self, user_id):
        t = time.time()
        return sorted(f for (f, to), until in list(self.typing.items()) if to == user_id and until > t)

    def since(self, user_id, after):
        with self.connect() as db:
            rows = db.execute("""SELECT * FROM chat_messages WHERE id > ? AND (from_id = ? OR to_id = ?)
                                 ORDER BY id LIMIT 200""", (after, user_id, user_id)).fetchall()
        return [self._message(r) for r in rows]

    def history(self, user_id, peer_id, before=None, limit=100):
        with self.connect() as db:
            rows = db.execute("""SELECT * FROM chat_messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
                                 AND id < ? ORDER BY id DESC LIMIT ?""",
                              (user_id, peer_id, peer_id, user_id, before or 2 ** 62, limit)).fetchall()
            read = db.execute("SELECT last_id FROM chat_read WHERE user_id = ? AND peer_id = ?", (user_id, peer_id)).fetchone()
        return [self._message(r) for r in reversed(rows)], read[0] if read else 0

    def conversations(self, user_id):
        """Everyone this user exchanged messages with (newest first): the last message and how many are unread."""
        with self.connect() as db:
            rows = db.execute("""SELECT m.* FROM chat_messages m JOIN (
                                   SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer, max(id) AS last
                                   FROM chat_messages WHERE from_id = ? OR to_id = ? GROUP BY peer) c ON m.id = c.last
                                 ORDER BY m.id DESC""", (user_id, user_id, user_id)).fetchall()
            unread = {r[0]: r[1] for r in db.execute(
                """SELECT m.from_id, count(*) FROM chat_messages m LEFT JOIN chat_read r ON r.user_id = ? AND r.peer_id = m.from_id
                   WHERE m.to_id = ? AND m.id > coalesce(r.last_id, 0) GROUP BY m.from_id""", (user_id, user_id))}
        out = []
        for r in rows:
            mine = r["from_id"] == user_id
            peer = {"id": r["to_id"] if mine else r["from_id"], "username": r["to_name"] if mine else r["from_name"],
                    "name": (r["to_display"] if mine else r["from_display"]) or ""}
            out.append({"peer": peer, "last": self._message(r), "unread": unread.get(peer["id"], 0)})
        return out

    def delete(self, user_id, peer_id):
        """Removes the whole conversation between the two, for both of them (either may do it). The number deleted."""
        with self.lock, self.connect() as db:
            db.execute("""DELETE FROM chat_files WHERE message_id IN (SELECT id FROM chat_messages
                          WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))""", (user_id, peer_id, peer_id, user_id))
            n = db.execute("""DELETE FROM chat_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)""",
                           (user_id, peer_id, peer_id, user_id)).rowcount
            db.execute("""DELETE FROM chat_read WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)""",
                       (user_id, peer_id, peer_id, user_id))
        with self.changed:
            self.clear_ver += 1
            for me, other in ((user_id, peer_id), (peer_id, user_id)):
                self.cleared[me] = (self.cleared.get(me, []) + [(self.clear_ver, other)])[-50:]
            self.typing.pop((user_id, peer_id), None)
            self.typing.pop((peer_id, user_id), None)
            self.changed.notify_all()
        return n

    def file(self, user_id, message_id):
        """(content type, bytes) of a message's screenshot, for the two people in that conversation only."""
        with self.connect() as db:
            r = db.execute("""SELECT m.image_type, f.data FROM chat_messages m JOIN chat_files f ON f.message_id = m.id
                              WHERE m.id = ? AND (m.from_id = ? OR m.to_id = ?)""", (message_id, user_id, user_id)).fetchone()
        return (r[0], bytes(r[1])) if r else None

    def cleared_since(self, user_id, version):
        return sorted({peer for v, peer in self.cleared.get(user_id, []) if v > version})

    def last_clear(self, user_id):
        return max([v for v, _ in self.cleared.get(user_id, [])] or [0])

    def mark_read(self, user_id, peer_id, last_id):
        with self.lock, self.connect() as db:
            db.execute("""INSERT INTO chat_read (user_id, peer_id, last_id) VALUES (?, ?, ?) ON CONFLICT (user_id, peer_id)
                          DO UPDATE SET last_id = max(last_id, excluded.last_id)""", (user_id, peer_id, last_id))

    def wait(self, user_id, after, typing_known, clear_known, avail_known=0):
        """Until a message newer than `after` concerns this user, or who is typing to them differs from typing_known
        (a sorted list), or a conversation of theirs was deleted after clear_known, or CHAT_POLL_SECONDS pass. Typing
        signals expire without a notification: re-checked every second."""
        deadline = time.time() + CHAT_POLL_SECONDS
        with self.changed:
            while True:
                typing = self.typing_to(user_id)
                if (self.newest(user_id) > after or typing != typing_known or self.last_clear(user_id) > clear_known
                        or self.avail_ver > avail_known or time.time() >= deadline):
                    return typing
                self.changed.wait(timeout=min(1.0, max(0.05, deadline - time.time())))


CHAT = None


def chat_admins():
    """[{id, username, name}] of the active users with a site-wide role in ADMIN_ROLES (most recently seen first), whom
    every user may write to: read from Coder's users table (rbac_roles: site roles; organization roles are not
    there), cached for a minute. Empty when Coder's database can't be read."""
    hit = CACHE.get("chat-admins")
    if hit is not None:
        return hit
    admins = []
    try:
        pool = LOGOS.pool if LOGOS else None
        if pool:
            rows = pool.query("""SELECT id::text, username, name FROM public.users WHERE NOT deleted AND status = 'active'
                                 AND rbac_roles && $1::text[] ORDER BY last_seen_at DESC NULLS LAST LIMIT 50""",
                              ["{%s}" % ",".join(sorted(ADMIN_ROLES))])
            admins = [{"id": r[0], "username": r[1], "name": r[2] or "", "admin": True} for r in rows]
    except Exception as e:  # noqa: BLE001 - no list rather than an error
        log(event="chat-admins-failed", error=str(e)[:200])
    CACHE.put("chat-admins", admins, 60)
    return admins


def chat_availability():
    """Which admins take chats: {"available": [ids with chat on], "off": [ids with chat off], "availVersion"}."""
    ids = [a["id"] for a in chat_admins()]
    return {"available": [i for i in ids if i not in CHAT.off], "off": [i for i in ids if i in CHAT.off], "availVersion": CHAT.avail_ver}


def boot_js():
    """Classic script every Coder page loads before its own code: which logo to show (read synchronously by the
    rewritten logo component) and the classification marking, so neither flickers in after the first paint."""
    logo = None
    try:
        logo = LOGOS.peek() if LOGOS else None   # never waits for the database
    except Exception as e:  # noqa: BLE001 - no logo rather than a broken page
        log(event="logo-read-failed", error=str(e)[:200])
    cls = STORE.get_setting("classification", CLASSIFICATION_DEFAULT)
    avatars = AVATARS.urls() if AVATARS else {}   # never waits for the database either
    default_avatar = AvatarStore.default_url()
    js = "window.__cuiLogo=%s;window.__cuiClassification=%s;window.__cuiAvatars=%s;window.__cuiAvatarDefault=%s;\n" % (
        json.dumps(BASE + "/logo?v=" + logo["sha"] if logo else ""), json.dumps(cls), json.dumps(avatars),
        json.dumps(default_avatar))
    if default_avatar:
        # Who gets the default avatar is not public: this browser's last answer (dashboard.js refreshes it once signed in).
        js += ("try{window.__cuiAvatarUsers=new Set(JSON.parse(localStorage.getItem('coder-ui-avatar-users')||'[]'))}"
               "catch(e){window.__cuiAvatarUsers=new Set()}\n")
    return js

# --------------------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "coder-ui-updates"
    protocol_version = "HTTP/1.1"
    SECURITY = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"}

    def log_message(self, fmt, *args):  # request lines only; never headers or cookies
        log(event="request", line=fmt % args)

    def send(self, status, body=b"", content_type="text/plain; charset=utf-8", headers=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        for k, v in {**self.SECURITY, "Content-Type": content_type, "Content-Length": str(len(body)), **(headers or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, payload):
        self.send(status, json.dumps(payload), "application/json", {"Cache-Control": "no-store"})

    def token(self):
        token = self.headers.get("Coder-Session-Token")
        if token:
            return token
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:  # noqa: BLE001 - a malformed cookie header is just "no session"
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def user(self, admin=False):
        """(user, None) or (None, True) after sending the error."""
        token = self.token()
        status, user = coder_user(token) if token else ("unauthenticated", None)
        if status == "unauthenticated":
            self.send_json(401, {"error": "Sign in to Coder first."})
            return None, True
        if status != "ok":
            self.send_json(503, {"error": "Coder could not be reached to check your session. Try again in a moment."})
            return None, True
        if admin and not set(user["roles"]) & ADMIN_ROLES:
            self.send_json(403, {"error": "Only Coder admins can do this."})
            return None, True
        return user, None

    def csrf_ok(self):
        if self.headers.get(CSRF_HEADER[0]) != CSRF_HEADER[1]:
            return False
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            return False
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
            return False
        return self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")

    def body(self, limit=16384):
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/logo":
            limit = LOGO_MAX_BYTES * 2  # base64 of the largest logo
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/avatar":
            limit = AVATAR_MAX_BYTES * 2
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/icons":
            limit = ICON_MAX_BYTES * 2 + 1024   # base64 of the largest icon, and its name
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/chat/send":
            limit = CHAT_MAX_TEXT * 8 + CHAT_MAX_IMAGE * 4 // 3 + 4096   # text of any script, a screenshot as a data URL
        try:
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length) or b"{}") if 0 < length <= limit else None
        except ValueError:
            return None

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path == BASE + "/healthz":
            return self.send(200, "ok\n")
        if path == BASE + "/refresh":
            return self.send(302, "", headers={"Location": "/", "Clear-Site-Data": '"cache"', "Cache-Control": "no-store"})
        if path == BASE + "/api/me":
            token = self.token()
            status, user = coder_user(token) if token else ("unauthenticated", None)
            if status == "unauthenticated":
                return self.send_json(200, {"signedIn": False})
            if status != "ok":
                return self.send_json(503, {"error": "Coder could not be reached to check your session."})
            event_id = urllib.parse.parse_qs(url.query).get("id", [""])[0]
            acked = bool(ID_RE.match(event_id)) and STORE.acked(event_id, user["id"])
            return self.send_json(200, {"signedIn": True, "username": user["username"], "acked": acked})
        if path == BASE + "/api/acks":
            return self.acks()
        if path == BASE + "/boot.js":
            body = boot_js().encode()
            etag = '"%s"' % hashlib.sha256(body).hexdigest()[:20]
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Content-Length", "0")
                return self.end_headers()
            return self.send(200, body, "text/javascript; charset=utf-8", {"Cache-Control": "no-cache", "ETag": etag})
        if path == BASE + "/logo":
            return self.logo(versioned="v=" in url.query)
        if path.startswith(BASE + "/icons/"):
            return self.icon(path[len(BASE) + 7:], versioned="v=" in url.query)
        if path == BASE + "/api/icons":
            user, err = self.user()
            if err:
                return
            if not ICONS or not ICONS.pool:
                return self.send_json(503, {"error": "Coder's database is not configured for this service."})
            try:
                return self.send_json(200, {"icons": ICONS.list(), "canManage": self.manages_icons(user)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
        if path.startswith(BASE + "/favicon/"):
            return self.favicon(path[len(BASE) + 9:])
        if path == BASE + "/api/logo":
            try:
                logo = LOGOS.get(fresh=True) if LOGOS else None
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database is not reachable: %s" % str(e)[:200]})
            return self.send_json(200, {"available": LOGOS is not None and LOGOS.pool is not None, "set": bool(logo),
                                        "url": BASE + "/logo?v=" + logo["sha"] if logo else None,
                                        "type": logo and logo["type"], "bytes": logo and len(logo["data"]),
                                        "updatedBy": logo and logo["by"], "updatedAt": logo and logo["at"]})
        if path == BASE + "/api/monitoring":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, MONITOR.overview(self.token()))
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/monitoring/logs":
            user, err = self.user(admin=True)
            if err:
                return
            q = urllib.parse.parse_qs(url.query)
            wid = (q.get("workspace") or [""])[0]
            if not re.match(r"^[0-9a-f-]{36}$", wid):
                return self.send_json(400, {"error": "workspace=<id> is required."})
            try:
                after = int((q.get("after") or ["0"])[0])
                return self.send_json(200, MONITOR.lines(wid, after))
            except LookupError as e:
                return self.send_json(404, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Logs are not available: %s" % str(e)[:300]})
        if path.startswith(BASE + "/avatar/"):
            return self.avatar(path[len(BASE) + 8:], versioned="v=" in url.query)
        if path == BASE + "/api/avatar":
            user, err = self.user()
            if err:
                return
            url_ = (AVATARS.urls() if AVATARS else {}).get(user["username"])
            default = AVATARS.default_url() if AVATARS and user["username"] in AVATARS.default_users() else None
            return self.send_json(200, {"available": bool(AVATARS and AVATARS.pool), "set": bool(url_), "url": url_,
                                        "defaultUrl": default or None, "username": user["username"]})
        if path == BASE + "/api/avatar/defaults":
            user, err = self.user()
            if err:
                return
            default = AvatarStore.default_url()
            return self.send_json(200, {"url": default or None, "users": AVATARS.default_users() if default and AVATARS else []})
        if path.startswith(BASE + "/api/chat/"):
            return self.chat_get(path[len(BASE + "/api/chat/"):], urllib.parse.parse_qs(url.query))
        if path == BASE + "/api/cluster/usage":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, cluster_usage())
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/network":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, network_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="network-report-failed", error=str(e)[:300])
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/persistence":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, persistence_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="persistence-report-failed", error=str(e)[:300])
                return self.send_json(500, {"error": "Discovery failed: %s" % str(e)[:300]})
        if path == BASE + "/api/classification":
            return self.send_json(200, STORE.get_setting("classification", CLASSIFICATION_DEFAULT))
        if path == BASE + "/api/keycloak":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, keycloak_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="keycloak-report-failed", error=str(e))
                return self.send_json(500, {"error": "Discovery failed: %s" % e})
        if path.startswith(BASE + "/"):
            return self.static(path[len(BASE) + 1:])
        self.send(404, "not found\n")

    def static(self, name):
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.(js|css|html|gif|png)$", name):
            return self.send(404, "not found\n")
        file = os.path.join(STATIC_DIR, name)
        if not os.path.isfile(file):
            return self.send(404, "not found\n")
        with open(file, "rb") as f:
            body = f.read()
        etag = '"%s"' % hashlib.sha256(body).hexdigest()[:20]
        headers = {"Cache-Control": "no-cache", "ETag": etag}
        if name.endswith(".html"):
            headers["Content-Security-Policy"] = HTML_CSP
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            for k, v in {**self.SECURITY, **headers, "Content-Length": "0"}.items():
                self.send_header(k, v)
            return self.end_headers()
        ctype = {"js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                 "html": "text/html; charset=utf-8", "gif": "image/gif", "png": "image/png"}.get(name.rsplit(".", 1)[1]) or mimetypes.guess_type(name)[0]
        self.send(200, body, ctype, headers)

    def logo(self, versioned):
        logo = LOGOS.peek() if LOGOS else None   # the cached copy: never waits for the database
        if not logo:
            return self.send(404, "no custom logo\n", headers={"Cache-Control": "no-cache"})
        headers = {"Cache-Control": "public, max-age=31536000, immutable" if versioned else "no-cache"}
        if logo["type"] == "image/svg+xml":
            headers["Content-Security-Policy"] = SVG_CSP
        self.send(200, logo["data"], logo["type"], headers)

    def manages_icons(self, user):
        return bool(set(user["roles"]) & (ADMIN_ROLES | ICON_MANAGER_ROLES))

    def icon(self, name, versioned):
        """An uploaded icon, public like Coder's /icon/ files (templates and workspace pages show it to everyone)."""
        if not ICON_NAME_RE.match(name) or not ICONS or not ICONS.pool:
            return self.send(404, "not found\n")
        try:
            hit = ICONS.get(name)
        except Exception as e:  # noqa: BLE001
            return self.send(503, "Coder's database is not reachable: %s\n" % str(e)[:200])
        if not hit:
            return self.send(404, "no such icon\n", headers={"Cache-Control": "no-cache"})
        headers = {"Cache-Control": "public, max-age=31536000, immutable" if versioned else "public, max-age=300"}
        if hit[0] == "image/svg+xml":
            headers["Content-Security-Policy"] = SVG_CSP
        self.send(200, hit[1], hit[0], headers)

    def save_icon(self, delete, payload):
        user, err = self.user()
        if err:
            return
        if not self.manages_icons(user):
            return self.send_json(403, {"error": "Only owners and template admins can change icons."})
        if not ICONS or not ICONS.pool:
            return self.send_json(503, {"error": "Coder's database is not configured for this service."})
        name = payload.get("name")
        if not isinstance(name, str) or not ICON_NAME_RE.match(name):
            return self.send_json(400, {"error": "Icon names use lower-case letters, digits, '.', '-' and '_' (at most 64)."})
        try:
            if delete:
                removed = ICONS.delete(name)
                log(event="icon-deleted", user=user["username"], icon=name, removed=removed)
                return self.send_json(200, {"ok": True, "removed": removed})
            ctype, data = parse_icon(payload.get("dataUrl"))
            sha = ICONS.put(name, ctype, data, user["username"])
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
        log(event="icon-saved", user=user["username"], icon=name, type=ctype, bytes=len(data))
        self.send_json(200, {"ok": True, "url": "%s/icons/%s?v=%s" % (BASE, name, sha)})

    def avatar(self, user_id, versioned):
        if user_id == "default":
            default = DEFAULTS.get("avatar") if DEFAULTS else None
            if not default:
                return self.send(404, "no default avatar\n", headers={"Cache-Control": "no-cache"})
            return self.send(200, default["data"], default["type"],
                             {"Cache-Control": "public, max-age=31536000, immutable" if versioned else "no-cache"})
        if not re.match(r"^[0-9a-f-]{36}$", user_id) or not AVATARS or not AVATARS.pool:
            return self.send(404, "not found\n")
        try:
            hit = AVATARS.get(user_id)
        except Exception as e:  # noqa: BLE001
            return self.send(503, "Coder's database is not reachable: %s\n" % str(e)[:200])
        if not hit:
            return self.send(404, "no avatar\n", headers={"Cache-Control": "no-cache"})
        self.send(200, hit[1], hit[0], {"Cache-Control": "public, max-age=31536000, immutable" if versioned else "no-cache"})

    def favicon(self, name):
        if name not in ("favicon-light.png", "favicon-dark.png", "favicon-light.svg", "favicon-dark.svg"):
            return self.send(404, "not found\n")
        logo = LOGOS.peek() if LOGOS else None   # the cached copy: never waits for the database
        if logo:
            headers = {"Cache-Control": "no-cache"}
            if logo["type"] == "image/svg+xml":
                headers["Content-Security-Policy"] = SVG_CSP
            return self.send(200, logo["data"], logo["type"], headers)
        hit = FAVICONS.get(name)
        if hit is None:
            try:
                with urllib.request.urlopen(CODER_URL + "/favicons/" + name, timeout=5) as res:
                    hit = (res.headers.get("Content-Type") or "image/png", res.read())
                FAVICONS.put(name, hit, 3600)
            except Exception:  # noqa: BLE001
                return self.send(502, "Coder's favicon is not reachable\n")
        self.send(200, hit[1], hit[0], {"Cache-Control": "no-cache"})

    # ---- chat (ChatStore): every signed-in user; admins (ADMIN_ROLES) may start conversations
    def chat_get(self, what, q):
        user, err = self.user()
        if err:
            return
        if what == "state":
            return self.send_json(200, {
                "me": {"id": user["id"], "username": user["username"], "name": user["name"],
                       "admin": bool(set(user["roles"]) & ADMIN_ROLES), "chatOn": user["id"] not in CHAT.off},
                "conversations": CHAT.conversations(user["id"]), "cursor": CHAT.newest(user["id"]),
                "typing": CHAT.typing_to(user["id"]), "clearVersion": max(CHAT.last_clear(user["id"]), CHAT.clear_ver),
                **chat_availability()})
        if what == "admins":   # the admins taking chats (the developers' list)
            return self.send_json(200, {"admins": [a for a in chat_admins() if a["id"] != user["id"] and a["id"] not in CHAT.off]})
        if what.startswith("file/"):
            try:
                hit = CHAT.file(user["id"], int(what[5:]))
            except ValueError:
                hit = None
            if not hit:
                return self.send(404, "not found\n")
            return self.send(200, hit[1], hit[0], {"Cache-Control": "private, max-age=86400", "Content-Security-Policy": SVG_CSP,
                                                   "Content-Disposition": 'inline; filename="screenshot-%s.%s"' % (what[5:], hit[0].split("/")[1])})
        if what == "messages":
            peer = (q.get("peer") or [""])[0]
            if not UUID_RE.match(peer):
                return self.send_json(400, {"error": "peer=<user id> is required."})
            try:
                before = int((q.get("before") or ["0"])[0] or 0) or None
            except ValueError:
                return self.send_json(400, {"error": "before must be a message id."})
            messages, read = CHAT.history(user["id"], peer, before)
            return self.send_json(200, {"messages": messages, "readUpTo": read})
        if what == "poll":
            try:
                after = int((q.get("after") or ["0"])[0] or 0)
                cleared = int((q.get("cleared") or ["0"])[0] or 0)
                avail = int((q.get("av") or ["0"])[0] or 0)
            except ValueError:
                return self.send_json(400, {"error": "after, cleared and av must be numbers."})
            known = sorted(p for p in (q.get("typing") or [""])[0].split(",") if UUID_RE.match(p))
            typing = CHAT.wait(user["id"], after, known, cleared, avail)
            return self.send_json(200, {"messages": CHAT.since(user["id"], after), "typing": typing,
                                        "cleared": CHAT.cleared_since(user["id"], cleared),
                                        "clearVersion": max(CHAT.last_clear(user["id"]), cleared), **chat_availability()})
        self.send(404, "not found\n")

    def chat_peer(self, peer_id):
        """{id, username, name} of a Coder user, read with the caller's own session (admins may list users)."""
        key = "chat-peer:" + peer_id
        hit = CACHE.get(key)
        if hit:
            return hit
        status, u = http_json(CODER_URL + "/api/v2/users/" + peer_id, headers={"Coder-Session-Token": self.token()}, timeout=5)
        if status != 200 or not isinstance(u, dict) or not u.get("username"):
            return None
        roles = {r.get("name") for r in u.get("roles") or [] if isinstance(r, dict)}
        peer = {"id": u.get("id") or peer_id, "username": u["username"], "name": u.get("name") or "", "admin": bool(roles & ADMIN_ROLES)}
        CACHE.put(key, peer, 300)
        return peer

    def chat_post(self, what, payload):
        user, err = self.user()
        if err:
            return
        admin = bool(set(user["roles"]) & ADMIN_ROLES)
        if what == "availability":   # an admin's own on/off switch
            if not admin:
                return self.send_json(403, {"error": "Only admins can turn chat on or off."})
            on = payload.get("enabled")
            if not isinstance(on, bool):
                return self.send_json(400, {"error": "enabled must be true or false."})
            CHAT.set_enabled(user["id"], on)
            log(event="chat-availability", user=user["username"], enabled=on)
            return self.send_json(200, {"enabled": on, **chat_availability()})
        peer_id = str(payload.get("to") or "")
        if not UUID_RE.match(peer_id):
            return self.send_json(400, {"error": "Who is it for? (to=<user id>)"})
        if what == "read":
            try:
                CHAT.mark_read(user["id"], peer_id, int(payload.get("last") or 0))
            except (TypeError, ValueError):
                return self.send_json(400, {"error": "last must be a message id."})
            return self.send_json(200, {"ok": True})
        if what == "delete":
            n = CHAT.delete(user["id"], peer_id)
            log(event="chat-deleted", by=user["username"], peer=peer_id, messages=n)
            return self.send_json(200, {"ok": True, "deleted": n})
        admins = [] if admin else [a for a in chat_admins() if a["id"] not in CHAT.off]
        why = CHAT.may_write(user, admin, peer_id, {a["id"] for a in admins})
        if what == "typing":
            if not why:
                CHAT.set_typing(user["id"], peer_id)
            return self.send_json(200, {"ok": True})
        if what != "send":
            return self.send(404, "not found\n")
        text = str(payload.get("text") or "").strip()
        image = None
        if payload.get("image"):
            m = re.match(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$", str(payload["image"]))
            data = base64.b64decode(m.group(2)) if m else b""
            if not m or image_type(data) != m.group(1):
                return self.send_json(400, {"error": "The screenshot must be a PNG, JPEG or WebP image."})
            if len(data) > CHAT_MAX_IMAGE:
                return self.send_json(400, {"error": "The screenshot is larger than %d MB." % (CHAT_MAX_IMAGE // 1048576)})
            image = (m.group(1), data)
        if not text and not image:
            return self.send_json(400, {"error": "The message is empty."})
        if len(text) > CHAT_MAX_TEXT:
            return self.send_json(400, {"error": "Messages can be at most %d characters." % CHAT_MAX_TEXT})
        if why:
            return self.send_json(403, {"error": why})
        peer = self.chat_peer(peer_id) if admin else next((a for a in admins if a["id"] == peer_id), None)
        if not peer:
            peer = CHAT.peer_from_history(user["id"], peer_id)
            if peer and not admin:
                peer["admin"] = True   # only admins start conversations: whoever a user answers is one
        if not peer:
            return self.send_json(404, {"error": "That user doesn't exist (any more)."})
        if not CHAT.rate_ok(user["id"]):
            return self.send_json(429, {"error": "Too many messages at once; wait a moment."})
        page = str(payload.get("page") or "")[:300] if image else ""
        page = page if page.startswith("/") else ""
        message = CHAT.send(user, admin, peer, text, image, page)
        log(event="chat", sender=user["username"], to=peer["username"], id=message["id"], image=bool(image))   # never the text
        self.send_json(200, {"message": message})

    def acks(self):
        user, err = self.user(admin=True)
        if err:
            return
        users = None
        try:
            users = active_users(self.token())
        except Exception as e:  # noqa: BLE001
            log(event="users-list-failed", error=str(e))
        banner = current_banner()
        self.send_json(200, {"current": banner["id"] if banner else None, "totalUsers": len(users) if users is not None else None,
                             "events": STORE.report(banner, users), "generatedAt": now()})

    def do_POST(self):
        self.close_connection = True
        path = urllib.parse.urlsplit(self.path).path
        routes = {BASE + "/api/view", BASE + "/api/ack", BASE + "/api/events/delete", BASE + "/api/classification",
                  BASE + "/api/keycloak/apply", BASE + "/api/keycloak/undo", BASE + "/api/keycloak/connect",
                  BASE + "/api/persistence/apply", BASE + "/api/icons", BASE + "/api/icons/delete",
                  BASE + "/api/logo", BASE + "/api/logo/reset", BASE + "/api/avatar", BASE + "/api/avatar/reset"}
        if path not in routes and not path.startswith(BASE + "/api/chat/"):
            return self.send(404, "not found\n")
        if not self.csrf_ok():
            return self.send_json(403, {"error": "Request rejected (cross-site protection)."})
        payload = self.body()
        if not isinstance(payload, dict):
            return self.send_json(400, {"error": "Expected a JSON object."})
        if path in (BASE + "/api/view", BASE + "/api/ack"):
            return self.receipt(path.endswith("/ack"), payload)
        if path in (BASE + "/api/avatar", BASE + "/api/avatar/reset"):
            return self.save_avatar(path.endswith("/reset"), payload)
        if path.startswith(BASE + "/api/chat/"):
            return self.chat_post(path[len(BASE + "/api/chat/"):], payload)
        if path in (BASE + "/api/icons", BASE + "/api/icons/delete"):
            return self.save_icon(path.endswith("/delete"), payload)
        user, err = self.user(admin=True)
        if err:
            return
        if path in (BASE + "/api/logo", BASE + "/api/logo/reset"):
            if not LOGOS or not LOGOS.pool:
                return self.send_json(503, {"error": "Coder's database is not configured for this service."})
            try:
                if path.endswith("/reset"):
                    LOGOS.reset()
                    log(event="logo-reset", user=user["username"])
                    return self.send_json(200, {"ok": True, "set": False})
                ctype, data = parse_logo(payload.get("dataUrl"))
                sha = LOGOS.put(ctype, data, user["username"])
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
            log(event="logo-saved", user=user["username"], type=ctype, bytes=len(data))
            return self.send_json(200, {"ok": True, "set": True, "url": BASE + "/logo?v=" + sha})
        if path == BASE + "/api/events/delete":
            event_id = payload.get("id")
            if not isinstance(event_id, str) or not ID_RE.match(event_id):
                return self.send_json(400, {"error": "Expected {\"id\": \"<announcement id>\"}."})
            removed = STORE.delete_event(event_id)
            log(event="event-deleted", user=user["username"], announcement=event_id)
            return self.send_json(200, {"ok": True, "removed": removed})
        if path == BASE + "/api/classification":
            try:
                value = self.clean_classification(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            value.update({"updatedBy": user["username"], "updatedAt": now()})
            STORE.put_setting("classification", value)
            log(event="classification-saved", user=user["username"], enabled=value["enabled"], text=value["text"])
            return self.send_json(200, value)
        if path == BASE + "/api/keycloak/apply":
            fixes = [f for f in payload.get("fixes") or [] if f in ("kc.client", "kc.scopes", "coder.secret", "coder.ca", "coder.values")]
            try:
                done = apply_keycloak(fixes, payload.get("settings") or {}, user["username"])
            except (ValueError, RuntimeError, YamlSubsetError) as e:
                log(event="keycloak-apply-failed", user=user["username"], fixes=fixes, error=str(e))
                return self.send_json(400, {"error": str(e)})
            log(event="keycloak-applied", user=user["username"], fixes=fixes, done=done)
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/persistence/apply":
            fixes = [f for f in payload.get("fixes") or [] if f in PERSISTENCE_FIXES]
            if not fixes:
                return self.send_json(400, {"error": "Nothing to apply."})
            try:
                done = apply_persistence(fixes, payload.get("settings") or {}, user["username"])
            except (ValueError, RuntimeError) as e:
                log(event="persistence-apply-failed", user=user["username"], fixes=fixes, error=str(e))
                return self.send_json(400, {"error": str(e)})
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/keycloak/connect":
            username, password = payload.get("username"), payload.get("password")
            if not isinstance(username, str) or not username.strip() or not isinstance(password, str) or not password:
                return self.send_json(400, {"error": "Enter a Keycloak admin username and password."})
            try:
                done = connect_keycloak(username.strip(), password, payload.get("settings") or {}, user["username"])
            except (ValueError, RuntimeError) as e:
                log(event="keycloak-connect-failed", user=user["username"], error=str(e))
                return self.send_json(400, {"error": str(e)})
            log(event="keycloak-connected", user=user["username"], client=ADMIN_CLIENT_ID)
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/keycloak/undo":
            backup = STORE.last_backup()
            if not backup:
                return self.send_json(400, {"error": "There is no earlier version to go back to."})
            try:
                patch_argo_values(backup["values_text"])
            except RuntimeError as e:
                return self.send_json(400, {"error": str(e)})
            STORE.drop_backup(backup["id"])
            log(event="keycloak-undo", user=user["username"], restored=backup["saved_at"])
            return self.send_json(200, {"ok": True, "done": ["Restored Coder's settings from %s" % backup["saved_at"]]})

    @staticmethod
    def clean_classification(p):
        text = str(p.get("text", "")).strip()
        if len(text) > 120 or any(c in text for c in "\n\r"):
            raise ValueError("The classification text must be one line of at most 120 characters.")
        height = p.get("height", 24)
        if isinstance(height, bool) or not isinstance(height, int) or not 12 <= height <= 64:
            raise ValueError("Height must be between 12 and 64 pixels.")
        bg, fg = p.get("background", ""), p.get("color", "")
        if not HEX_RE.match(str(bg)) or not HEX_RE.match(str(fg)):
            raise ValueError("Colours must be #rrggbb.")
        enabled = bool(p.get("enabled"))
        if enabled and not text:
            raise ValueError("Enter the classification text before enabling the banners.")
        return {"enabled": enabled, "text": text, "height": height, "background": bg.lower(), "color": fg.lower()}

    def save_avatar(self, reset, payload):
        """Every signed-in user sets (or removes) their own avatar, never someone else's."""
        user, err = self.user()
        if err:
            return
        if not AVATARS or not AVATARS.pool:
            return self.send_json(503, {"error": "Coder's database is not configured for this service."})
        try:
            if reset:
                AVATARS.reset(user)
                log(event="avatar-removed", user=user["username"])
                return self.send_json(200, {"ok": True, "set": False})
            ctype, data = parse_avatar(payload.get("dataUrl"))
            url = AVATARS.put(user, ctype, data)
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
        log(event="avatar-saved", user=user["username"], type=ctype, bytes=len(data))
        return self.send_json(200, {"ok": True, "set": True, "url": url})

    def receipt(self, ack, payload):
        event_id = payload.get("id")
        if not isinstance(event_id, str) or not ID_RE.match(event_id):
            return self.send_json(400, {"error": "Expected {\"id\": \"<announcement id>\"}."})
        user, err = self.user()
        if err:
            return
        banner = current_banner()
        if not (banner and banner["id"] == event_id) and not STORE.known(event_id):
            banner = current_banner(fresh=True)  # published seconds ago: the cached copy may be the previous one
        if not (banner and banner["id"] == event_id) and not STORE.known(event_id):
            return self.send_json(409, {"error": "That announcement is not live."})
        STORE.record(event_id, user, ack, banner)
        log(event="ack" if ack else "view", user=user["username"], announcement=event_id)
        self.send_json(200, {"ok": True})


def main():
    global STORE, LOGOS, MONITOR, AVATARS, DEFAULTS, CHAT, ICONS
    STORE = Store(DB_PATH)
    CHAT = ChatStore(DB_PATH)
    DEFAULTS = Defaults(DEFAULTS_DIR)   # before the logo store, which installs the default logo on a fresh database
    LOGOS = LogoStore()
    AVATARS = AvatarStore(LOGOS)
    ICONS = IconStore(LOGOS)
    MONITOR = Monitor()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log(event="listening", port=PORT, coder=CODER_URL, banner=BANNER_URL, admin_roles=sorted(ADMIN_ROLES), db=DB_PATH,
        argocd_app=ARGOCD_APP or None, kube=KUBE.ok)
    server.serve_forever()


if __name__ == "__main__":
    main()
