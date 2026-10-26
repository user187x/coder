"""coder-ui-updates service, served on Coder's hostname under /__coder-ui/ (Python standard library only).

  GET  /__coder-ui/refresh                clears the browser's cached Coder JavaScript (Clear-Site-Data) and returns to /
  GET  /__coder-ui/healthz
  GET  /__icons/<file>                   the workspace template's app icons (TEMPLATE_ICONS_DIR), public, cacheable

  Announcement receipts
  GET  /__coder-ui/api/me?id=X            signed in? when did they see and confirm announcement X
  POST /__coder-ui/api/view   {"id": X}   the signed-in user has seen announcement X
  POST /__coder-ui/api/ack    {"id": X}   ... and confirmed it
  GET  /__coder-ui/api/notes?workspace=W  the post-it notes on workspace W (its owner: those not dismissed; admins: all)
  POST /__coder-ui/api/notes  {workspace, text, color, x, y}           an admin sticks a note on a workspace page
  POST /__coder-ui/api/notes/update  {id, text?, color?, x?, y?}       an admin edits or moves it
  POST /__coder-ui/api/notes/delete  {id}                              an admin deletes it
  POST /__coder-ui/api/notes/dismiss {id}                              the workspace's owner dismisses it
  GET  /__coder-ui/api/notes/users        admins: every note not dismissed yet, by the workspace owner's user id
  POST /__coder-ui/api/inbox/clear        anyone: their own Inbox (the bell) emptied, every notification deleted
  GET  /__coder-ui/api/acks               admins: every announcement ("event") with who saw / confirmed it, who has not
  POST /__coder-ui/api/events/delete {"id": X}   admins: forget one announcement and its receipts
  POST /__coder-ui/api/events/clear {}           admins: forget every announcement and all their receipts

  Network map (admins; nodes, pods and metrics read cluster-wide through the ClusterRole coder-ui-updates-<namespace>)
  GET  /__coder-ui/api/network            nodes (addresses, capacity, usage), Coder's pods and the platform's elsewhere
                                         (Traefik, ...) with their kind, the Services, running workspaces per node
  GET  /__coder-ui/api/network/entity, /api/network/ha, /api/network/mesh   one pod, Service, node or connection in
                                         depth; code-server HA and the storage; the connections' measured latency:
                                         see clusternet.py
  GET  /__coder-ui/api/cluster/usage      CPU / memory totals (allocatable, in use, requested, free) and the last 15 minutes
                                         of the cluster's CPU and memory in use and of its network traffic: the Settings
                                         menu's bars and graphs

  Classification banner
  GET  /__coder-ui/api/classification     public (the marking shows on the sign-in page too)
  POST /__coder-ui/api/classification     admins: {enabled, text, height, background, color}

  Sign-in and sign-out page
  GET  /__coder-ui/api/login-page         public (the sign-in page reads it; boot.js has it too)
  POST /__coder-ui/api/login-page         admins: {title, effect, color, speed, message, signedOutMessage}
  GET  /__coder-ui/api/quick-menu         the quick access wheel's wedges (signed in; items null: the default)
  POST /__coder-ui/api/quick-menu {items}  admins: 3 to 12 choices' IDs, in order   POST .../quick-menu/reset

  Logo (stored in Coder's own CloudNativePG database, schema coder_ui_updates)
  GET  /__coder-ui/boot.js                loaded first by every Coder page: the logo (and classification) to use
  GET  /__coder-ui/logo?v=<sha>           the uploaded logo          GET /__coder-ui/favicon/<name>  logo or Coder's
  GET  /__coder-ui/api/logo               what is set                POST /__coder-ui/api/logo {"dataUrl"}, /api/logo/reset

  User avatars (every user, their own; rows in coder_ui_updates.avatar of Coder's database)
  GET  /__coder-ui/avatar/<user id>?v=<sha>   the picture            GET  /__coder-ui/api/avatar   mine
  POST /__coder-ui/api/avatar {"dataUrl"}     set mine               POST /__coder-ui/api/avatar/reset   remove mine
  GET  /__coder-ui/avatar/default?v=<sha>     the default avatar     GET  /__coder-ui/api/avatar/defaults   who gets it
  GET  /__coder-ui/api/gallery                the provided pictures to choose from as logo or avatar (signed in)
  GET  /__coder-ui/background/<login|dashboard>?v=<sha>   a background image (public: the sign-in page shows it)
  GET  /__coder-ui/api/backgrounds            admins: both background images, their opacity, fit and layer
  POST /__coder-ui/api/backgrounds {slot, dataUrl? | html? | picture?, opacity?, fit?, layer?, params?}   POST /api/backgrounds/reset
       {slot}. html: an HTML / CSS background, served sandboxed (BG_HTML_CSP); params: its dials (speed, hue,
       saturation, brightness, blur) and, for a preset, the preset's settings
  GET  /__coder-ui/gallery/<file>?v=<sha>     one of them (public, like the default avatar)
  GET  /__coder-ui/api/image-store            every picture a chooser offers: the image store's baked pictures, the
       gallery's and the announcement's uploaded ones (signed in)
  GET  /__coder-ui/image-store/<file>         a baked picture (public; streamed); .../image-store/thumbs/<file>: its
       animated preview
  POST /__coder-ui/api/banner-pictures {name, dataUrl}   admins: a picture for the announcement (PNG, JPEG, GIF - animated
       too -, WebP, AVIF; at most 8 MB, stored as it is) -> {id, url}
  GET  /__coder-ui/banner-picture/<id>        one of them (public: the sign-in page may show the banner; never changes)

  Chat (every signed-in user; admins in ADMIN_ROLES write to anyone, others to admins or whoever wrote to them;
        kept 30 days in SQLite)
  GET  /__coder-ui/api/chat/state          me, my conversations (last message, unread), newest message id
  GET  /__coder-ui/api/chat/messages?peer=<user id>[&before=<id>]   one conversation (100 at a time)
  GET  /__coder-ui/api/chat/poll?after=<id>&typing=<ids>   long poll (25 s): new messages, who is typing to me
  POST /__coder-ui/api/chat/send {"to", "text", "clientId"?}   (the same clientId again: the first message, not a copy)
  POST /__coder-ui/api/chat/typing {"to"}   POST /api/chat/read {"to", "last"}
  GET  /__coder-ui/api/chat/admins          the admins a user may write to (their line to support): those with chat on
  POST /__coder-ui/api/chat/availability {"enabled"}   admins: their chat on / off (off: developers can't write to them)
  GET  /__coder-ui/api/chat/file/<id>       a message's screenshot (the two people in the conversation only)
  POST /__coder-ui/api/chat/send also takes {"image": data URL, "page": path}: a screenshot (PNG / JPEG / WebP, 4 MB)
  PUT  /__coder-ui/api/chat/upload?to=<user id>&name=&type=   a file to attach (the body; CHAT_MAX_FILE_MB): {upload}
  POST /__coder-ui/api/chat/send also takes {"upload": id}: the file uploaded for it, attached
  GET  /__coder-ui/api/chat/poll also takes tab=<tab id>&pv=<presence version>: who is online, idle or gone, pushed
  POST /__coder-ui/api/chat/activity {"tab", "idle"}   a tab's user went idle (no input for CHAT_IDLE_SECONDS) or back
  POST /__coder-ui/api/chat/leave {"tab"}   a tab closed (its user leaves the People lists with their last tab)
  GET  /__coder-ui/api/chat/pairs[?offset=&limit=]   admins: who talks to whom between developers, newest first, 25
                                            at a time (limit at most 100): {pairs, total, offset, limit}
  GET  /__coder-ui/api/presence             admins: everyone online now (active / idle, tabs, since) with their
                                            running workspaces, and who Coder saw in the last 15 minutes
  User quota (Health > User Quota; admins, and Coder's own check before it creates a workspace)
  GET  /__coder-ui/api/quota               limits, every user's usage (built with / running / live) and the cluster
  POST /__coder-ui/api/quota               {"default": {workspaces, cpu, memory}, "users": {name: {...}}, "exemptAdmins"}
  GET  /__coder-ui/api/dashboard-address    anyone signed in: the dashboard's host name and the Gateway's addresses
                                           (the announcement terminal's `ip`)
  GET  /__coder-ui/api/quota/me            anyone signed in: their own limits and what their workspaces take (the Workspaces pill)
  POST /__coder-ui/api/quota/check         {owner, template_id | template_version_id, rich_parameter_values}: allowed?
  Global Workspace Scheduler (Health > User Quota; admins, and Coder's own check before it creates or reschedules)
  GET  /__coder-ui/api/scheduler           admins: the settings and the workspaces that break them
  POST /__coder-ui/api/scheduler           admins: {enabled, mode: user|fixed, fixed: {start, stop, days, timezone},
                                            maxActiveHours, ignoreAdmins, excludedUsers}
  GET  /__coder-ui/api/scheduler/me        anyone signed in: the rules for them and their workspaces that break them
  POST /__coder-ui/api/scheduler/check     {owner, action: create|autostart|ttl, autostart_schedule, ttl_ms}: allowed?
  GET  /__coder-ui/api/keycloak/status     admins: is Keycloak's admin API usable (General sidebar's check)
  GET  /__coder-ui/api/certificates[?refresh]  admins: TLS of Coder / Keycloak / database and every mounted certificate
  POST /__coder-ui/api/chat/delete {"to"}   the whole conversation, for both (either participant); the other side's
       poll answers with "cleared": [user id]
  POST /__coder-ui/api/chat/groups {"members": [user ids]}   admins: one thread with all of them (Admin > Accounts,
       Chat); its id ("g:<hex>") is the conversation's peer in every chat call. Nobody sees it before its first
       message; that first message, the admin's, comes up for every member in front of everything (state / poll
       "focus") until they click it: POST /__coder-ui/api/chat/focus/ack {"group"}. Never again for that thread.
  Forced Focus (admins): POST /__coder-ui/api/chat/send also takes {"focus": true}: the message comes up in front of
       everything for the user (every member of a group chat) until they acknowledge it: state / poll "focus" items
       with "forced": true, POST /__coder-ui/api/chat/focus/ack {"message": id}. POST /__coder-ui/api/chat/focus/force
       {"to"} (Force Response): the newest admin message in that conversation, forced on them again. The poll takes
       fv=<focus version> and answers when one is forced or acknowledged.

  Default images (resources/defaults/, mounted from ConfigMaps coder-ui-updates-default-logo / -avatar into
  DEFAULTS_DIR): the logo a fresh installation starts with (written to the logo table when this service creates it),
  and the avatar of every user without a picture of their own (neither uploaded here nor from Coder / OIDC).

  Monitoring (admins; workspace pod logs streamed into the temporary Postgres coder-ui-logs-db, 5 MB per instance)
  GET  /__coder-ui/api/monitoring          users and their running workspaces
  GET  /__coder-ui/api/monitoring/posture  zero-trust checks and runtime signals (identity, exposure, pods, failures)
  GET  /__coder-ui/api/lockdown[/<id>]      admins (an owner: their workspace): Lock Down; POST /<id> {mode}: see lockdown.py
  GET  /__coder-ui/api/provisioners          admins: provisioner daemons, running jobs, terraform processes; POST
                                             /rekick {jobs}, /restart {pod}: see provisioners.py
  GET  /__coder-ui/api/hud                 admins: the HUD's metrics (totals, leaders, health) and Coder's uptime, cached 5 seconds
  GET  /__coder-ui/api/hud/history?range=  admins: the HUD graphs (CPU, memory, latency), sampled every 15 s, kept 7 days
  GET  /__coder-ui/api/workspaces/<id>/network   a workspace's network traffic, the last 5 minutes per agent (who
                                           may see the workspace)
  /__coder-ui/api/workspace-icons, /__coder-ui/api/workspace-volumes/<id>   workspace icons, home backups and disk
                                           growth (owners and admins): see workspacevolumes.py
  GET  /__coder-ui/api/monitoring/logs?workspace=<id>&after=<seq>   new log lines (starts / keeps the follower)

  Keycloak <-> Coder sign-in (admins)
  GET  /__coder-ui/api/keycloak           discovery: every check with its current / expected value and a suggested fix
  POST /__coder-ui/api/keycloak/apply     {"fixes": [...], "settings": {...}}  apply approved fixes
  POST /__coder-ui/api/keycloak/undo      put Coder's previous Argo CD values back

An announcement "event" is one announcement as the banner (Coder's /__banner) identifies it: its id changes when the
text changes or an admin uses "Show again to everyone". Only the live announcement (or one already recorded) is
accepted.

Users are identified by their Coder session (the coder_session_token cookie the browser already sends), checked against
Coder's own API. Admin endpoints require one of ADMIN_ROLES; state-changing requests also need the X-Requested-With
header and a same-origin Origin (cross-site protection). Keycloak's admin credentials and the OIDC client secret are
read in-cluster (Kubernetes API, RBAC limited to the named Secrets) and never sent to the browser.
"""

import base64
import collections
import hashlib
import json
import os
import random
import re
import shutil
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgwire  # noqa: E402  (next to this file)
import imagebuilder  # noqa: E402  (next to this file: the Images view)
import workspacevolumes  # noqa: E402  (workspace icons, home backups, disk growth)
import lockdown  # noqa: E402  (Lock Down: admins jail a workspace's network and sudo)
import safe  # noqa: E402  (the safe: each account's own files on S3, on the Workspaces page and in its workspaces)
import provisioners  # noqa: E402  (Provisioner Daemons: stuck jobs, their terraform processes, a re-kick)
import dr  # noqa: E402  (Persistence > Disaster recovery: Coder's database dumped or copied outside the cluster)
import workspacetunnels
import workspacepower
import drivepeers  # noqa: E402  (Cloud Drives shared between users: asked for in chat, approved by admins)
import clusternet  # noqa: E402  (the Cluster Network view in depth: entity details, code-server HA, the mesh)
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = os.environ.get("DB_PATH", "/data/receipts.sqlite")
CODER_URL = os.environ.get("CODER_URL", "http://coder").rstrip(
    "/"
)  # in-cluster Service
CODER_ACCESS_URL = os.environ.get("CODER_ACCESS_URL", "").rstrip(
    "/"
)  # what browsers use
CODER_NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
CODER_DEPLOYMENT = os.environ.get("CODER_DEPLOYMENT", "coder")
# The Helm release Coder belongs to (its pods' app.kubernetes.io/instance): the release's own name, "coder" or not.
CODER_RELEASE = os.environ.get("CODER_RELEASE", CODER_DEPLOYMENT)
BANNER_URL = os.environ.get("BANNER_URL", "http://coder").rstrip("/")
ADMIN_ROLES = {
    r.strip() for r in os.environ.get("ADMIN_ROLES", "owner").split(",") if r.strip()
}
CA_FILE = os.environ.get("CA_FILE", "")  # extra trusted CA (local PKI)
KEYCLOAK_NAMESPACE = os.environ.get("KEYCLOAK_NAMESPACE", "keycloak")
KEYCLOAK_ADMIN_SECRET = os.environ.get(
    "KEYCLOAK_ADMIN_SECRET", "keycloak-initial-admin"
)
ARGOCD_NAMESPACE = os.environ.get("ARGOCD_NAMESPACE", "argocd")
ARGOCD_APP = os.environ.get("ARGOCD_APP", "")  # empty: Coder is not managed by Argo CD
CA_SOURCE_SECRET = os.environ.get(
    "CA_SOURCE_SECRET", "tls-ca"
)  # Coder-namespace Secret holding the local CA
OIDC_SECRET = (
    os.environ.get("OIDC_SECRET") or "keycloaking-coder-oidc"
)  # same names as ../keycloak/keycloaking-coder, so the two tools agree
ATTACHED = (
    os.environ.get("ATTACHED", "") == "true"
)  # coder-platform chart attached to an existing Coder (./upgrade)
# What Coder uses when a setting isn't given (coder server --help): a missing variable means this value.
CODER_OIDC_DEFAULTS = {
    "CODER_OIDC_EMAIL_FIELD": "email",
    "CODER_OIDC_USERNAME_FIELD": "preferred_username",
    "CODER_OIDC_SCOPES": "openid,profile,email",
    "CODER_OIDC_IGNORE_EMAIL_VERIFIED": "false",
    "CODER_OIDC_ALLOW_SIGNUPS": "true",
    "CODER_OIDC_SIGN_IN_TEXT": "OpenID Connect",
    "CODER_OIDC_ICON_URL": "",
}
# Differences here are the deployment's choices, not faults: shown as notes.
OIDC_CHOICES = {
    "CODER_OIDC_SIGN_IN_TEXT",
    "CODER_OIDC_ICON_URL",
    "CODER_OIDC_ALLOW_SIGNUPS",
    "CODER_OIDC_IGNORE_EMAIL_VERIFIED",
}
GROUP_SETTINGS = (
    "CODER_OIDC_GROUP_FIELD",
    "CODER_OIDC_ALLOWED_GROUPS",
    "CODER_OIDC_GROUP_MAPPING",
    "CODER_OIDC_GROUP_REGEX_FILTER",
    "CODER_OIDC_GROUP_AUTO_CREATE",
    "CODER_OIDC_USER_ROLE_FIELD",
    "CODER_OIDC_USER_ROLE_MAPPING",
    "CODER_OIDC_USER_ROLE_DEFAULT",
)
CA_SECRET = os.environ.get("OIDC_CA_SECRET") or "keycloaking-coder-ca"
CA_MOUNT = "/etc/keycloaking/ca"
CODER_DB_URI = os.environ.get("CODER_DB_URI", "")  # Coder's CNPG database (logo)
CODER_DB_CA = os.environ.get("CODER_DB_CA", "")
CODER_DB_SECRET = os.environ.get(
    "CODER_DB_SECRET", ""
)  # read through the API when CODER_DB_URI was empty at start
CODER_DB_SECRET_KEY = os.environ.get("CODER_DB_SECRET_KEY", "") or "uri"
CODER_DB_CA_SECRET = os.environ.get("CODER_DB_CA_SECRET", "")
LOGS_DB_URL = os.environ.get("LOGS_DB_URL", "")  # the temporary log database
LOGS_DB_SECRET = os.environ.get(
    "LOGS_DB_SECRET", ""
)  # chart installs: its password Secret, created here
WORKSPACE_NAMESPACE = os.environ.get("WORKSPACE_NAMESPACE", CODER_NAMESPACE)
LOG_CAP_BYTES = int(os.environ.get("LOG_CAP_BYTES", str(5 * 1024 * 1024)))
LOGO_MAX_BYTES = (
    4 * 1024 * 1024
)  # the dashboard resizes uploads first; animated logos keep their frames
DEFAULTS_DIR = os.environ.get(
    "DEFAULTS_DIR", "/app/defaults"
)  # <dir>/logo/logo.<ext>, <dir>/avatar/avatar.<ext>
# The install's own defaults, in this service's image (build-ui-image.sh: helm-chart/defaults/): where no ConfigMap
# gives a kind (a one-step Helm install has none), these.
BAKED_DEFAULTS_DIR = os.environ.get("BAKED_DEFAULTS_DIR", "/defaults")
# The install's backgrounds, set once on a fresh install in the slots no one set (chart: uiUpdates.appearanceDefaults):
# {slot: {"picture": <the image store's>, "opacity", "fit", "layer"}}.
BACKGROUND_DEFAULTS = os.environ.get("BACKGROUND_DEFAULTS", "")
BASE = "/__coder-ui"
# Icons bundled with the workspace template (charts/coder-workspace/files/icons/, mounted from its ConfigMap), served
# at /__icons/<file> on Coder's hostname for coder_app.icon (Traefik routes /__icons/ here).
TEMPLATE_ICONS_PATH = "/__icons/"
TEMPLATE_ICONS_DIR = os.environ.get("TEMPLATE_ICONS_DIR", "")
TEMPLATE_ICON_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                       ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon"}
TEMPLATE_ICON_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SESSION_COOKIE = "coder_session_token"
CSRF_HEADER = ("X-Requested-With", "coder-ui")
AUTH_TTL, BANNER_TTL, USERS_TTL = 60, 5, 60
MAX_EVENTS = 50
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


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


def http_json(
    url, method="GET", body=None, headers=None, form=None, timeout=8, context=None
):
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
        with urllib.request.urlopen(
            req, timeout=timeout, context=context if url.startswith("https") else None
        ) as res:
            raw, status = res.read(), res.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors="replace")


class TTLCache:
    """Expiring entries, least recently used evicted past MAX (a large team's sessions all fit: clearing the whole
    cache at once, as before, sent every request back to Coder's API under load)."""

    MAX = 20000

    def __init__(self):
        self.lock = threading.Lock()
        self.items = collections.OrderedDict()

    def get(self, key):
        with self.lock:
            hit = self.items.get(key)
            if not hit:
                return None
            if hit[0] <= time.time():
                del self.items[key]
                return None
            self.items.move_to_end(key)
            return hit[1]

    def put(self, key, value, ttl):
        with self.lock:
            self.items[key] = (time.time() + ttl, value)
            self.items.move_to_end(key)
            while len(self.items) > self.MAX:
                self.items.popitem(last=False)


CACHE = TTLCache()


# --------------------------------------------------------------------------- Coder


NOTE_COLORS = ("yellow", "pink", "green", "blue", "orange")
NOTE_TEXT_MAX = 600


def clean_note(payload, partial=False):
    """The note fields in payload (all of them unless partial), checked; raises ValueError."""
    out = {}
    if "text" in payload or not partial:
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Write something on the note.")
        if len(text) > NOTE_TEXT_MAX:
            raise ValueError("A note holds at most %d characters." % NOTE_TEXT_MAX)
        out["text"] = text.strip()
    if "color" in payload or not partial:
        color = payload.get("color", "yellow")
        if color not in NOTE_COLORS:
            raise ValueError("Colour must be one of: %s." % ", ".join(NOTE_COLORS))
        out["color"] = color
    for key in ("x", "y"):
        if key in payload or not partial:
            value = payload.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
                raise ValueError("The note's position must be within the page.")
            out[key] = float(value)
    return out


def workspace_info(token, workspace_id):
    """The workspace (Coder's API object), if this session may see it (else None)."""
    try:
        status, ws = http_json(
            CODER_URL + "/api/v2/workspaces/" + workspace_id,
            headers={"Coder-Session-Token": token},
            timeout=5,
        )
    except Exception:  # noqa: BLE001 - unreachable: no access decision
        return None
    return ws if status == 200 and isinstance(ws, dict) else None


def workspace_owner(token, workspace_id):
    """The owner id of the workspace, if this session may see it (else None)."""
    return (workspace_info(token, workspace_id) or {}).get("owner_id")


def coder_user(token):
    """(status, user): status is ok | unauthenticated | unavailable."""
    key = "me:" + hashlib.sha256(token.encode()).hexdigest()
    hit = CACHE.get(key)
    if hit:
        return hit
    try:
        status, me = http_json(
            CODER_URL + "/api/v2/users/me",
            headers={"Coder-Session-Token": token},
            timeout=5,
        )
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
        "roles": sorted(
            {r.get("name") for r in me.get("roles") or [] if r.get("name")}
        ),
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
    live = (
        b
        if status == 200
        and isinstance(b, dict)
        and b.get("enabled")
        and b.get("message")
        and b.get("id")
        else {}
    )
    CACHE.put("banner", live, BANNER_TTL)
    return live or None


def active_users(token):
    key = "users:" + hashlib.sha256(token.encode()).hexdigest()
    hit = CACHE.get(key)
    if hit is not None:
        return hit
    users, offset = [], 0
    while offset < 5000:
        q = urllib.parse.urlencode(
            {"q": "status:active", "limit": 500, "offset": offset}
        )
        status, page = http_json(
            CODER_URL + "/api/v2/users?" + q, headers={"Coder-Session-Token": token}
        )
        if status != 200:
            raise RuntimeError("Coder users API: HTTP %s" % status)
        rows = page.get("users") or []
        users += [
            {
                "id": u.get("id"),
                "username": u.get("username") or "",
                "name": u.get("name") or "",
                "email": u.get("email") or "",
                "loginType": u.get("login_type") or "",
            }
            for u in rows
        ]
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
        self.base = "https://%s:%s" % (
            os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc"),
            os.environ.get("KUBERNETES_SERVICE_PORT", "443"),
        )
        self.ctx = (
            ssl.create_default_context(cafile=self.SA + "/ca.crt") if self.ok else None
        )

    def call(self, method, path, body=None, patch_type=None):
        if not self.ok:
            return 0, "no service account"
        with open(self.SA + "/token") as f:
            token = f.read().strip()
        headers = {"Authorization": "Bearer " + token}
        if patch_type:
            headers["Content-Type"] = patch_type
        return http_json(
            self.base + path,
            method=method,
            body=body,
            headers=headers,
            context=self.ctx,
        )

    def stream(self, path, timeout=65):
        """An open streaming response (pod logs with follow=true); the caller reads lines and closes it."""
        with open(self.SA + "/token") as f:
            token = f.read().strip()
        req = urllib.request.Request(
            self.base + path, headers={"Authorization": "Bearer " + token}
        )
        return urllib.request.urlopen(req, timeout=timeout, context=self.ctx)

    def secret(self, ns, name):
        """{key: str} or None."""
        status, s = self.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (ns, name))
        if status != 200:
            return None
        return {
            k: base64.b64decode(v).decode(errors="replace")
            for k, v in (s.get("data") or {}).items()
        }

    def put_secret(self, ns, name, data):
        body = {
            "apiVersion": "v1",
            "kind": "Secret",
            "type": "Opaque",
            "metadata": {
                "name": name,
                "namespace": ns,
                "labels": {
                    "app.kubernetes.io/part-of": "coder",
                    "coder-ui-updates/managed": "keycloak",
                },
            },
            "data": {k: base64.b64encode(v.encode()).decode() for k, v in data.items()},
        }
        status, _ = self.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (ns, name))
        if status == 200:
            status, out = self.call(
                "PATCH",
                "/api/v1/namespaces/%s/secrets/%s" % (ns, name),
                {"data": body["data"]},
                "application/merge-patch+json",
            )
        else:
            status, out = self.call("POST", "/api/v1/namespaces/%s/secrets" % ns, body)
        if status not in (200, 201):
            raise RuntimeError(
                "could not write Secret %s/%s (HTTP %s): %s"
                % (ns, name, status, str(out)[:200])
            )


KUBE = Kube()


def logs_db_url():
    """LOGS_DB_URL with its {password} taken from Secret LOGS_DB_SECRET, which is created with a random password the
    first time. A Helm chart can't render such a Secret without re-randomizing it on every Argo CD sync; created here
    it is made once and kept (the log database pod waits for it). Without the marker the URL is used as it is.
    """
    if not LOGS_DB_SECRET or "{password}" not in LOGS_DB_URL:
        return LOGS_DB_URL
    path = "/api/v1/namespaces/%s/secrets" % CODER_NAMESPACE
    for _ in range(60):
        found = KUBE.secret(CODER_NAMESPACE, LOGS_DB_SECRET)
        if found and found.get("password"):
            return LOGS_DB_URL.replace(
                "{password}", urllib.parse.quote(found["password"], safe="")
            )
        password = base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("=")
        status, out = KUBE.call(
            "POST",
            path,
            {
                "apiVersion": "v1",
                "kind": "Secret",
                "type": "Opaque",
                "metadata": {
                    "name": LOGS_DB_SECRET,
                    "labels": {
                        "app.kubernetes.io/part-of": "coder",
                        "app.kubernetes.io/created-by": "coder-ui-updates",
                    },
                },
                "data": {"password": base64.b64encode(password.encode()).decode()},
            },
        )
        if status in (201, 409):
            continue  # read it back (409: another replica or an earlier start made it)
        log(event="logs-db-secret", status=status, detail=str(out)[:200])
        time.sleep(2)
    log(
        event="logs-db-secret",
        status="gave up",
        detail="Monitoring is unavailable until Secret %s exists" % LOGS_DB_SECRET,
    )
    return ""


# --------------------------------------------------------------------------- Keycloak


class Keycloak:
    def __init__(self, url):
        self.url = url.rstrip("/")
        self.token, self.expires = None, 0
        self.error = None
        self.via = None
        # why the cluster's admin login did not work (for the Connect card): stale | missing | unreadable | unreachable
        self.secret_state, self.secret_user = None, None

    def _token(self, form):
        try:
            status, tok = http_json(
                self.url + "/realms/master/protocol/openid-connect/token",
                method="POST",
                context=TLS,
                form=form,
            )
        except (
            Exception
        ) as e:  # noqa: BLE001 - network / TLS: reported as a failed check, not a crash
            return (
                None,
                "Keycloak could not be reached (%s)."
                % str(getattr(e, "reason", e))[:160],
            )
        if status == 200 and isinstance(tok, dict) and tok.get("access_token"):
            return tok, None
        detail = (
            (tok.get("error_description") or tok.get("error"))
            if isinstance(tok, dict)
            else "HTTP %s" % status
        )
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
            tok, err = self._token(
                {
                    "grant_type": "client_credentials",
                    "client_id": stored["clientId"],
                    "client_secret": stored["secret"],
                }
            )
            if tok:
                return self._use(tok, "service account '%s'" % stored["clientId"])
            attempts.append("service account '%s': %s" % (stored["clientId"], err))
        creds = (
            KUBE.secret(KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET)
            if KEYCLOAK_ADMIN_SECRET
            else None
        )
        self.secret_user = (creds or {}).get("username") or (creds or {}).get("client-id")
        if creds and creds.get("client-id") and creds.get("client-secret"):
            tok, err = self._token(
                {
                    "grant_type": "client_credentials",
                    "client_id": creds["client-id"],
                    "client_secret": creds["client-secret"],
                }
            )
        elif creds and creds.get("username"):
            tok, err = self._token(
                {
                    "grant_type": "password",
                    "client_id": "admin-cli",
                    "username": creds["username"],
                    "password": creds.get("password", ""),
                }
            )
        else:
            tok, err = None, "not readable by this service"
        if tok:
            return self._use(
                tok, "Secret %s/%s" % (KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET)
            )
        self.secret_state = ("unreadable" if creds is None else "missing" if not self.secret_user
                             else "unreachable" if str(err).startswith("Keycloak could not be reached") else "stale")
        attempts.append(
            "Secret %s/%s: %s" % (KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET, err)
        )
        self.error = "No working Keycloak admin access (" + "; ".join(attempts) + ")."
        return False

    def _use(self, tok, via):
        self.token, self.expires, self.error, self.via = (
            tok["access_token"],
            time.time() + int(tok.get("expires_in", 60)),
            None,
            via,
        )
        return True

    def api(self, method, path, body=None):
        if not self.login():
            raise RuntimeError(self.error)
        status, out = http_json(
            self.url + "/admin/realms" + path,
            method=method,
            body=body,
            context=TLS,
            headers={"Authorization": "Bearer " + self.token},
        )
        if status >= 400:
            raise RuntimeError(
                "Keycloak %s %s: HTTP %s %s" % (method, path, status, str(out)[:200])
            )
        return out


# --------------------------------------------------------------------------- admins' kubectl: the Keycloak group
CLUSTER_ACCESS_GROUP = os.environ.get("CLUSTER_ACCESS_GROUP", "")  # empty: no sync
CLUSTER_ACCESS_ROLES = [
    r.strip()
    for r in os.environ.get("CLUSTER_ACCESS_ROLES", "owner").split(",")
    if re.match(r"^[a-z0-9-]+$", r.strip())
]
CLUSTER_ACCESS_ISSUER = os.environ.get("CLUSTER_ACCESS_ISSUER", "")
CLUSTER_ACCESS_EVERY = 60  # seconds


def cluster_admin_targets(coder_admins, kc_users_by):
    """Which Keycloak users should be in the group: for each Coder admin, the Keycloak user with the same email,
    else the same username. kc_users_by(field, value) returns the matching Keycloak users."""
    out = {}
    for a in coder_admins:
        found = None
        for field in ("email", "username"):
            value = (a.get(field) or "").strip()
            if not value:
                continue
            hits = [
                u
                for u in kc_users_by(field, value)
                if (u.get(field) or "").lower() == value.lower()
            ]
            if len(hits) == 1:
                found = hits[0]
                break
        if found:
            out[found["id"]] = found.get("username") or found["id"]
    return out


class ClusterAdminSync(threading.Thread):
    """Keeps the Keycloak group of the admins' cluster sign-in (global.clusterAccess) equal to Coder's admins: the
    Coder users with one of CLUSTER_ACCESS_ROLES, whichever way they sign in to Coder (Keycloak or a password), each
    as the Keycloak account with the same email, else the same username (cluster_admin_targets). kubectl always
    signs in with Keycloak, so a password admin (the built-in admin) signs in there with its Keycloak account; an
    admin without one gets none. Read from Coder's database every minute; the group is created when missing.
    Members it does not list are removed: membership is managed here, not in Keycloak."""

    def __init__(self):
        super().__init__(daemon=True)
        m = re.match(r"^(https?://.+?)/realms/([^/]+)/?$", CLUSTER_ACCESS_ISSUER)
        self.kc_url, self.realm = (m.group(1), m.group(2)) if m else (None, None)
        self.last = None

    def run(self):
        if not self.kc_url:
            log(event="cluster-admins", status="off", reason="no Keycloak issuer URL")
            return
        while True:
            try:
                self.sync_once()
            except Exception as e:  # noqa: BLE001 - reported, retried next round
                err = str(e)[:300]
                if err != self.last:
                    log(event="cluster-admins", status="failed", error=err)
                self.last = err
            time.sleep(CLUSTER_ACCESS_EVERY)

    def coder_admins(self):
        pool = LOGOS.pool if LOGOS else None
        if not pool:
            raise RuntimeError("Coder's database is not reachable yet")
        rows = pool.query(
            """SELECT username, email FROM users WHERE NOT deleted AND status <> 'suspended'
            AND login_type IN ('oidc', 'password') AND rbac_roles && $1::text[]""",
            ["{" + ",".join(CLUSTER_ACCESS_ROLES) + "}"],
        )
        return [{"username": r[0], "email": r[1]} for r in rows]

    def sync_once(self):
        kc = Keycloak(self.kc_url)
        r = "/" + urllib.parse.quote(self.realm)
        q = urllib.parse.quote
        groups = kc.api("GET", r + "/groups?exact=true&briefRepresentation=true&search=" + q(CLUSTER_ACCESS_GROUP))
        gid = next((g["id"] for g in walk_groups(groups) if g.get("name") == CLUSTER_ACCESS_GROUP), None)
        if not gid:
            kc.api("POST", r + "/groups", {"name": CLUSTER_ACCESS_GROUP})
            groups = kc.api("GET", r + "/groups?exact=true&briefRepresentation=true&search=" + q(CLUSTER_ACCESS_GROUP))
            gid = next(g["id"] for g in walk_groups(groups) if g.get("name") == CLUSTER_ACCESS_GROUP)
            log(event="cluster-admins", status="group-created", group=CLUSTER_ACCESS_GROUP, realm=self.realm)
        want = cluster_admin_targets(
            self.coder_admins(),
            lambda field, value: kc.api("GET", r + "/users?exact=true&%s=%s" % (field, q(value))) or [],
        )
        have = {
            u["id"]: u.get("username") or u["id"]
            for u in kc.api("GET", r + "/groups/%s/members?briefRepresentation=true&max=1000" % gid) or []
        }
        for uid in sorted(set(want) - set(have)):
            kc.api("PUT", r + "/users/%s/groups/%s" % (uid, gid))
            log(event="cluster-admins", status="added", user=want[uid], group=CLUSTER_ACCESS_GROUP)
        for uid in sorted(set(have) - set(want)):
            kc.api("DELETE", r + "/users/%s/groups/%s" % (uid, gid))
            log(event="cluster-admins", status="removed", user=have[uid], group=CLUSTER_ACCESS_GROUP)
        state = "in sync: %s" % (", ".join(sorted(want.values())) or "no members")
        if state != self.last:
            log(event="cluster-admins", status="ok", group=CLUSTER_ACCESS_GROUP, members=sorted(want.values()))
        self.last = state


def keycloak_url_from_cluster():
    for version in ("v2beta1", "v2alpha1"):
        status, lst = KUBE.call(
            "GET",
            "/apis/k8s.keycloak.org/%s/namespaces/%s/keycloaks"
            % (version, KEYCLOAK_NAMESPACE),
        )
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
    if first[indent : indent + 2] == "- " or first[indent:].rstrip() == "-":
        seq = []
        while (
            i < len(lines)
            and len(lines[i]) - len(lines[i].lstrip()) == indent
            and lines[i][indent : indent + 1] == "-"
        ):
            rest = lines[i][indent + 1 :]
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
                if ind > indent or (ind == indent and lines[nxt][ind : ind + 1] == "-"):
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
    if re.match(r"^[A-Za-z_][A-Za-z0-9_./-]*$", s) and s.lower() not in (
        "true",
        "false",
        "yes",
        "no",
        "on",
        "off",
        "null",
        "y",
        "n",
    ):
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
                out.append(
                    pad
                    + k
                    + ": "
                    + ("[]" if v == [] else "{}" if v == {} else _emit_scalar(v))
                )
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

            def continues(k):
                return k < len(lines) and (
                    lines[k].startswith("   ") or lines[k].startswith("  -")
                )

            while j < len(lines):
                if continues(j) or lines[j].strip() == "":
                    j += 1
                    continue
                # A comment belongs to the block when the block goes on after it (e.g. one above the first item);
                # otherwise it is the next key's, and the block ends here.
                k = j
                while k < len(lines) and (
                    lines[k].lstrip().startswith("#") or lines[k].strip() == ""
                ):
                    k += 1
                if k > j and lines[j].lstrip().startswith("#") and continues(k):
                    j = k
                    continue
                break
            body = [
                l
                for l in lines[start + 1 : j]
                if l.strip() and not l.strip().startswith("#")
            ]
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
        lines[top + 1 : top + 1] = new_block
    out = "\n".join(lines)
    check = values_block(out, key)
    if not check or _norm(check[3]) != _norm(value):
        raise YamlSubsetError(
            "re-reading coder.%s after the edit gave a different result" % key
        )
    return out


def argo_app():
    if not ARGOCD_APP:
        return None
    status, app = KUBE.call(
        "GET",
        "/apis/argoproj.io/v1alpha1/namespaces/%s/applications/%s"
        % (ARGOCD_NAMESPACE, ARGOCD_APP),
    )
    return app if status == 200 else None


def env_map(env):
    return {e.get("name"): e for e in env or [] if isinstance(e, dict)}


def container_env(dep):
    """The first container's environment as Kubernetes resolves it: ConfigMaps named in envFrom (the coder-platform
    chart puts Coder's settings in one), overridden by the explicit env list."""
    c = (
        ((((dep or {}).get("spec") or {}).get("template") or {}).get("spec") or {}).get(
            "containers"
        )
        or [{}]
    )[0]
    merged = {}
    for src in c.get("envFrom") or []:
        ref = (src or {}).get("configMapRef") or {}
        if not ref.get("name"):
            continue
        status, cm = KUBE.call(
            "GET",
            "/api/v1/namespaces/%s/configmaps/%s" % (CODER_NAMESPACE, ref["name"]),
        )
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
                CREATE TABLE IF NOT EXISTS notes (
                  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL,
                  x REAL NOT NULL, y REAL NOT NULL, tilt REAL NOT NULL, author TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, dismissed_at TEXT);
                CREATE INDEX IF NOT EXISTS notes_workspace ON notes(workspace_id);
                """
            )
            # Notes made before 1.22.0 lack their workspace's owner and name: filled in when an admin lists them.
            have = {r["name"] for r in db.execute("PRAGMA table_info(notes)")}
            for column in ("owner_id", "owner_name", "workspace_name"):
                if column not in have:
                    db.execute("ALTER TABLE notes ADD COLUMN %s TEXT" % column)

    # ---- post-it notes (admins stick them on a user's workspace page)
    @staticmethod
    def _note(row):
        return {
            "id": row["id"],
            "workspaceId": row["workspace_id"],
            "text": row["text"],
            "color": row["color"],
            "x": row["x"],
            "y": row["y"],
            "tilt": row["tilt"],
            "author": row["author"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "dismissedAt": row["dismissed_at"],
            "ownerId": row["owner_id"],
            "ownerName": row["owner_name"],
            "workspaceName": row["workspace_name"],
        }

    def notes(self, workspace_id, include_dismissed):
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM notes WHERE workspace_id=?"
                + ("" if include_dismissed else " AND dismissed_at IS NULL")
                + " ORDER BY created_at",
                (workspace_id,),
            ).fetchall()
        return [self._note(r) for r in rows]

    def note(self, note_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
        return self._note(row) if row else None

    def note_create(self, workspace, fields, author):
        note_id = uuid.uuid4().hex[:16]
        stamp = now()
        with self.lock, self.connect() as db:
            db.execute(
                "INSERT INTO notes (id, workspace_id, text, color, x, y, tilt, author, created_at, updated_at,"
                " owner_id, owner_name, workspace_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (note_id, workspace["id"], fields["text"], fields["color"], fields["x"], fields["y"],
                 round(random.uniform(-5.5, 5.5), 1), author, stamp, stamp,
                 workspace.get("owner_id"), workspace.get("owner_name"), workspace.get("name")),
            )
        return self.note(note_id)

    def active_notes(self):
        """Every note its workspace's owner has not dismissed, oldest first."""
        with self.connect() as db:
            rows = db.execute("SELECT * FROM notes WHERE dismissed_at IS NULL ORDER BY created_at").fetchall()
        return [self._note(r) for r in rows]

    def note_set_owner(self, workspace_id, workspace):
        with self.lock, self.connect() as db:
            db.execute(
                "UPDATE notes SET owner_id=?, owner_name=?, workspace_name=? WHERE workspace_id=?",
                (workspace.get("owner_id"), workspace.get("owner_name"), workspace.get("name"), workspace_id),
            )

    def note_update(self, note_id, fields):
        sets = ", ".join("%s=?" % k for k in fields)
        with self.lock, self.connect() as db:
            db.execute(
                "UPDATE notes SET %s, updated_at=? WHERE id=?" % sets,
                (*fields.values(), now(), note_id),
            )
        return self.note(note_id)

    def note_delete(self, note_id):
        with self.lock, self.connect() as db:
            return db.execute("DELETE FROM notes WHERE id=?", (note_id,)).rowcount

    def note_dismiss(self, note_id):
        with self.lock, self.connect() as db:
            db.execute("UPDATE notes SET dismissed_at=COALESCE(dismissed_at, ?) WHERE id=?", (now(), note_id))
        return self.note(note_id)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    # ---- settings
    def get_setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute(
                "SELECT value FROM settings WHERE key=?", (key,)
            ).fetchone()
            return json.loads(row["value"]) if row else default

    def put_setting(self, key, value):
        with self.lock, self.connect() as db:
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

    # ---- value backups (Coder's Argo CD values before each change from the Keycloak view)
    def backup_values(self, user, app, text):
        with self.lock, self.connect() as db:
            db.execute(
                "INSERT INTO value_backups (saved_at, saved_by, app, values_text) VALUES (?,?,?,?)",
                (now(), user, app, text),
            )

    def last_backup(self):
        with self.connect() as db:
            return db.execute(
                "SELECT * FROM value_backups ORDER BY id DESC LIMIT 1"
            ).fetchone()

    def drop_backup(self, backup_id):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM value_backups WHERE id=?", (backup_id,))

    # ---- receipts
    def ensure_event(self, db, banner):
        db.execute(
            "INSERT OR IGNORE INTO events (id, level, title, message, link_text, link_url, first_seen) VALUES (?,?,?,?,?,?,?)",
            (
                banner["id"],
                banner.get("level"),
                banner.get("title"),
                banner.get("message"),
                banner.get("linkText"),
                banner.get("linkUrl"),
                now(),
            ),
        )

    def known(self, event_id):
        with self.connect() as db:
            return (
                db.execute("SELECT 1 FROM events WHERE id=?", (event_id,)).fetchone()
                is not None
            )

    def record(self, event_id, user, ack, banner):
        stamp = now()
        with self.lock, self.connect() as db:
            if banner and banner["id"] == event_id:
                self.ensure_event(db, banner)
            db.execute(
                "INSERT INTO receipts (event_id, user_id, username, name, email, viewed_at, acked_at) VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(event_id, user_id) DO UPDATE SET username=excluded.username, name=excluded.name, email=excluded.email, "
                "acked_at=COALESCE(receipts.acked_at, excluded.acked_at)",
                (
                    event_id,
                    user["id"],
                    user["username"],
                    user["name"],
                    user["email"],
                    stamp,
                    stamp if ack else None,
                ),
            )

    def delete_event(self, event_id):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM receipts WHERE event_id=?", (event_id,))
            return db.execute("DELETE FROM events WHERE id=?", (event_id,)).rowcount

    def clear_events(self):
        """Every announcement's record and receipts (the live one's start again from nobody)."""
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM receipts")
            return db.execute("DELETE FROM events").rowcount

    def acked(self, event_id, user_id):
        return bool(self.receipt_times(event_id, user_id)[1])

    def receipt_times(self, event_id, user_id):
        """(viewed_at, acked_at) of this user's receipt for the announcement: when they first saw it and confirmed it."""
        with self.connect() as db:
            row = db.execute(
                "SELECT viewed_at, acked_at FROM receipts WHERE event_id=? AND user_id=?",
                (event_id, user_id),
            ).fetchone()
            return (row["viewed_at"], row["acked_at"]) if row else (None, None)

    def report(self, banner, users):
        with self.lock, self.connect() as db:
            if banner:
                self.ensure_event(db, banner)
            events = db.execute(
                "SELECT * FROM events ORDER BY first_seen DESC LIMIT ?", (MAX_EVENTS,)
            ).fetchall()
            out = []
            for ev in events:
                rows = db.execute(
                    "SELECT * FROM receipts WHERE event_id=? ORDER BY acked_at IS NULL, acked_at DESC, viewed_at DESC",
                    (ev["id"],),
                ).fetchall()
                seen = {r["user_id"] for r in rows}
                out.append(
                    {
                        "id": ev["id"],
                        "level": ev["level"],
                        "title": ev["title"],
                        "message": ev["message"],
                        "firstSeen": ev["first_seen"],
                        "current": bool(banner and banner["id"] == ev["id"]),
                        "viewed": len(rows),
                        "acked": sum(1 for r in rows if r["acked_at"]),
                        "receipts": [
                            {
                                "username": r["username"],
                                "name": r["name"],
                                "email": r["email"],
                                "viewedAt": r["viewed_at"],
                                "ackedAt": r["acked_at"],
                            }
                            for r in rows
                        ],
                        "pending": (
                            [u for u in users if u["id"] not in seen]
                            if users is not None
                            else None
                        ),
                    }
                )
            return out


STORE = None

# The sign-in page (where signing out lands too): its title, drawn with a text effect, and a message for each.
LOGIN_EFFECTS = ("wireframe", "neon", "plain")
LOGIN_PAGE_DEFAULT = {
    "title": "",          # empty: the deployment's name (Coder, or the one set in Appearance)
    "effect": "wireframe",  # the traced outline the sign-in page has always had
    "color": "#4ff8ff",
    "speed": 3.2,         # seconds for one trace (wireframe) or one pulse (neon)
    "message": "",
    "signedOutMessage": "",
}


def clean_login_page(p):
    title = str(p.get("title", "")).strip()
    if len(title) > 40 or any(c in title for c in "\n\r"):
        raise ValueError("The title must be one line of at most 40 characters.")
    effect = p.get("effect", "wireframe")
    if effect not in LOGIN_EFFECTS:
        raise ValueError("The effect must be one of: %s." % ", ".join(LOGIN_EFFECTS))
    color = str(p.get("color", ""))
    if not HEX_RE.match(color):
        raise ValueError("The colour must be #rrggbb.")
    speed = p.get("speed", 3.2)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not 0.5 <= speed <= 20:
        raise ValueError("The speed must be between 0.5 and 20 seconds.")
    out = {"title": title, "effect": effect, "color": color.lower(), "speed": round(float(speed), 1)}
    for key, label in (("message", "sign-in"), ("signedOutMessage", "sign-out")):
        text = str(p.get(key, "")).strip()
        if len(text) > 300:
            raise ValueError("The %s message must be at most 300 characters." % label)
        out[key] = text
    return out


def login_page_settings():
    return dict(LOGIN_PAGE_DEFAULT, **(STORE.get_setting("login_page", {}) or {}))


# The quick access wheel (Escape, on every page): its wedges, as admins arrange them (Admin Settings > Quick Menu).
# The dashboard knows the choices (the admin categories and its own pages) by their IDs; none saved: its default wheel.
QUICK_MENU_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
QUICK_MENU_WEDGES = (3, 12)


def clean_quick_menu_shortcut(value):
    if not isinstance(value, str) or not value or len(value) > 80:
        raise ValueError("shortcut: choose a key or key combination.")
    parts = value.split("+")
    modifiers, key = parts[:-1], parts[-1]
    order = ("Ctrl", "Alt", "Shift", "Meta")
    named = {"Escape", "Space", "Plus", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"}
    valid_key = (len(key) == 1 and key.isprintable() and not key.isspace()) or key in named or re.fullmatch(r"F([1-9]|1[0-9]|2[0-4])", key)
    if len(set(modifiers)) != len(modifiers) or any(m not in order for m in modifiers) or not valid_key:
        raise ValueError("shortcut: choose a supported key with Ctrl, Alt, Shift, or Meta.")
    return "+".join([m for m in order if m in modifiers] + [key.upper() if len(key) == 1 else key])


def clean_quick_menu(p):
    items = p.get("items")
    if not isinstance(items, list) or not all(isinstance(i, str) and QUICK_MENU_ID.match(i) for i in items):
        raise ValueError("items: the wedges' choices, by their IDs.")
    if len(set(items)) != len(items):
        raise ValueError("A choice can be on the wheel once.")
    least, most = QUICK_MENU_WEDGES
    if not least <= len(items) <= most:
        raise ValueError("The wheel takes %d to %d wedges." % (least, most))
    return {"items": items, "shortcut": clean_quick_menu_shortcut(p.get("shortcut", "Escape"))}


def quick_menu_settings():
    saved = STORE.get_setting("quick_menu", None) or {}
    return {"items": saved.get("items") or None, "shortcut": saved.get("shortcut") or "Escape", "updatedBy": saved.get("updatedBy"), "updatedAt": saved.get("updatedAt"),
            "wedges": list(QUICK_MENU_WEDGES)}


CLASSIFICATION_DEFAULT = {
    "enabled": False,
    "text": "UNCLASSIFIED",
    "height": 24,
    "background": "#007a33",
    "color": "#ffffff",
}


# --------------------------------------------------------------------------- Keycloak <-> Coder: discovery and fixes

DEFAULT_KC_SETTINGS = {
    "realm": "master",
    "clientId": "coder",
    "scopes": "openid,profile,email",
    "usernameField": "preferred_username",
    "emailField": "email",
    "ignoreEmailVerified": True,
    "signInText": "Sign in with Keycloak",
    "iconUrl": "/icon/keycloak.svg",
    "allowSignups": True,
    "flowAlias": "x509-browser",
    "tokenLifespan": 36000,
}


def kc_settings(declared_env):
    """Suggested settings: what Coder is configured with where it is sensible, else the defaults."""
    s = dict(DEFAULT_KC_SETTINGS)
    s.update(STORE.get_setting("keycloak", {}) or {})
    issuer = (declared_env.get("CODER_OIDC_ISSUER_URL") or {}).get("value") or ""
    m = re.match(r"^(https?://[^/]+(?:/auth)?)/realms/([^/]+)/?$", issuer)
    discovered_url = keycloak_url_from_cluster()
    s["keycloakUrl"] = (
        s.get("keycloakUrl") or discovered_url or (m.group(1) if m else "")
    )
    if m:
        s["realm"] = m.group(2)
    for env, key in (
        ("CODER_OIDC_CLIENT_ID", "clientId"),
        ("CODER_OIDC_SIGN_IN_TEXT", "signInText"),
        ("CODER_OIDC_ICON_URL", "iconUrl"),
    ):
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
        "clientId": s["clientId"],
        "name": "Coder",
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": False,
        "clientAuthenticatorType": "client-secret",
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": False,
        "implicitFlowEnabled": False,
        "serviceAccountsEnabled": False,
        "rootUrl": access_url,
        "baseUrl": "/",
        "redirectUris": [cb],
        "webOrigins": [access_url],
        "attributes": {
            "post.logout.redirect.uris": access_url + "/*",
            "access.token.lifespan": str(int(s["tokenLifespan"])),
        },
    }
    if flow_id:
        client["authenticationFlowBindingOverrides"] = {"browser": flow_id}
    return client


def desired_env(s, kc_url):
    issuer = "%s/realms/%s" % (kc_url.rstrip("/"), s["realm"])
    return [
        {"name": "CODER_OIDC_ISSUER_URL", "value": issuer},
        {"name": "CODER_OIDC_CLIENT_ID", "value": s["clientId"]},
        {
            "name": "CODER_OIDC_CLIENT_SECRET",
            "valueFrom": {
                "secretKeyRef": {"name": OIDC_SECRET, "key": "client-secret"}
            },
        },
        {"name": "CODER_OIDC_SCOPES", "value": s["scopes"]},
        {"name": "CODER_OIDC_USERNAME_FIELD", "value": s["usernameField"]},
        {"name": "CODER_OIDC_EMAIL_FIELD", "value": s["emailField"]},
        {
            "name": "CODER_OIDC_IGNORE_EMAIL_VERIFIED",
            "value": "true" if s["ignoreEmailVerified"] else "false",
        },
        {"name": "CODER_OIDC_SIGN_IN_TEXT", "value": s["signInText"]},
        {"name": "CODER_OIDC_ICON_URL", "value": s["iconUrl"]},
        {
            "name": "CODER_OIDC_ALLOW_SIGNUPS",
            "value": "true" if s["allowSignups"] else "false",
        },
    ]


def oidc_secret_ref(env):
    """(name, key) of the Secret Coder really reads its OIDC client secret from, or None (inline / unset)."""
    ref = (
        ((env.get("CODER_OIDC_CLIENT_SECRET") or {}).get("valueFrom") or {}).get(
            "secretKeyRef"
        )
    ) or {}
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


def check(
    checks, cid, group, title, status, current=None, expected=None, detail="", fix=None
):
    checks.append(
        {
            "id": cid,
            "group": group,
            "title": title,
            "status": status,
            "current": current,
            "expected": expected,
            "detail": detail,
            "fix": fix,
        }
    )


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
    check(
        checks,
        "coder.groups",
        "Coder",
        "Group-based sign-in settings",
        "info",
        current=", ".join(
            "%s=%s" % (k.replace("CODER_OIDC_", ""), v) for k, v in used.items()
        )[:300],
        detail="Groups named: %s" % (", ".join(names) or "none"),
    )
    flat = [n for n in names if "/" not in n]
    if not kc:
        if flat:
            check(
                checks,
                "coder.groups.flat",
                "Coder",
                "Group names without a path",
                "warn",
                current=", ".join(flat),
                detail="These match only if Keycloak's group mapper has 'Full group path' OFF, and then ANY group with "
                "that name matches (e.g. every child group called Admin). Prefer full paths like /Parent/Admin.",
            )
        return
    realm = settings["realm"]
    # the claim: a group-membership mapper on the client or on one of its default client scopes
    mappers = []
    try:
        if client:
            mappers += (
                kc.api(
                    "GET",
                    "/%s/clients/%s/protocol-mappers/models" % (realm, client["id"]),
                )
                or []
            )
            for sc in (
                kc.api(
                    "GET",
                    "/%s/clients/%s/default-client-scopes" % (realm, client["id"]),
                )
                or []
            ):
                mappers += (
                    kc.api(
                        "GET",
                        "/%s/client-scopes/%s/protocol-mappers/models"
                        % (realm, sc["id"]),
                    )
                    or []
                )
    except Exception:  # noqa: BLE001
        pass
    gm = [
        m
        for m in mappers
        if m.get("protocolMapper") == "oidc-group-membership-mapper"
        and ((m.get("config") or {}).get("claim.name") or "") == field
    ]
    if field and not gm:
        check(
            checks,
            "kc.groups.claim",
            "Keycloak",
            "Group claim '%s' in the token" % field,
            "error",
            current="no group-membership mapper with that claim name on client '%s'"
            % settings["clientId"],
            detail="Coder reads groups from the '%s' claim; without a mapper Keycloak doesn't send it, so allowed-group "
            "sign-in fails for everyone." % field,
        )
        return
    full_path = any(
        ((m.get("config") or {}).get("full.path") or "false") == "true" for m in gm
    )
    if gm:
        check(
            checks,
            "kc.groups.claim",
            "Keycloak",
            "Group claim '%s' in the token" % field,
            "ok",
            current="group-membership mapper, full group path %s"
            % ("on (/Parent/Child)" if full_path else "off (Child)"),
        )
    for n in names:
        try:
            if full_path or "/" in n:
                path = n if n.startswith("/") else "/" + n
                try:
                    g = kc.api(
                        "GET",
                        "/%s/group-by-path/%s"
                        % (realm, urllib.parse.quote(path.lstrip("/"), safe="/")),
                    )
                except Exception as e:  # noqa: BLE001
                    if "404" not in str(e):
                        raise
                    g = None
                ok_form = full_path and n.startswith("/")
                hint = ""
                if not g:
                    # the same last name elsewhere in the realm: the likely new path after a rename or a move
                    last = path.rstrip("/").rsplit("/", 1)[-1]
                    cands = [
                        x.get("path")
                        for x in walk_groups(
                            kc.api(
                                "GET",
                                "/%s/groups?search=%s&briefRepresentation=true"
                                % (realm, urllib.parse.quote(last)),
                            )
                            or []
                        )
                        if x.get("name") == last
                    ]
                    hint = "; in the realm: %s" % ", ".join(cands) if cands else ""
                current = "exists" if g else "not in realm %s%s" % (realm, hint)
                if g and not ok_form:
                    current += "; the token carries " + (
                        "the full path: write it as %s" % path
                        if full_path
                        else "only the last name (full group path is off)"
                    )
                check(
                    checks,
                    "kc.group:" + n,
                    "Keycloak",
                    "Group %s" % n,
                    "ok" if (g and ok_form) else "error",
                    current=current,
                    detail=(
                        ""
                        if (g and ok_form)
                        else "Members of a group Coder's settings name wrongly can't sign in (or lose what the "
                        "group gives them). A group renamed or moved in Keycloak (e.g. KeycloakAdminGroup -> /KeycloakGroup/Admin) "
                        "must be renamed where Coder is deployed from too."
                    ),
                )
            else:
                found = (
                    kc.api(
                        "GET",
                        "/%s/groups?search=%s&briefRepresentation=true"
                        % (realm, urllib.parse.quote(n)),
                    )
                    or []
                )
                hits = [g.get("path") for g in walk_groups(found) if g.get("name") == n]
                check(
                    checks,
                    "kc.group:" + n,
                    "Keycloak",
                    "Group %s" % n,
                    "warn" if len(hits) != 1 else "ok",
                    current="%d group(s) named %s: %s"
                    % (len(hits), n, ", ".join(hits) or "none"),
                    detail=(
                        ""
                        if len(hits) == 1
                        else "With 'Full group path' off, every group called %s matches. Turn full "
                        "paths on and name the group by its path in Coder's settings."
                        % n
                    ),
                )
        except Exception as e:  # noqa: BLE001
            check(
                checks,
                "kc.group:" + n,
                "Keycloak",
                "Group %s" % n,
                "unknown",
                current=str(e)[:160],
            )


def keycloak_report(token):
    checks, facts = [], {}
    access_url = CODER_ACCESS_URL
    facts["coderUrl"] = access_url
    facts["argoApp"] = ARGOCD_APP or None
    app = argo_app()
    values_text = (
        (((app or {}).get("spec") or {}).get("source") or {})
        .get("helm", {})
        .get("values")
        if app
        else None
    )
    declared = {}
    dep_status, dep = KUBE.call(
        "GET",
        "/apis/apps/v1/namespaces/%s/deployments/%s"
        % (CODER_NAMESPACE, CODER_DEPLOYMENT),
    )
    running = container_env(dep) if dep_status == 200 else {}
    from_chart = any(
        ((src or {}).get("configMapRef") or {}).get("name") == "coder-platform-config"
        for src in (
            (
                (
                    (((dep or {}).get("spec") or {}).get("template") or {}).get("spec")
                    or {}
                ).get("containers")
                or [{}]
            )[0].get("envFrom")
            or []
        )
    )
    if app is None and ATTACHED:
        declared = running
        check(
            checks,
            "coder.source",
            "Coder",
            "Where Coder's settings live",
            "info",
            current="Coder's own Helm release or Argo CD Application",
            detail="The platform is attached to an existing Coder: change Coder's settings where Coder is deployed "
            "from. Keycloak's side and the Secrets Coder reads can be fixed here.",
        )
    elif app is None and from_chart:
        declared = running
        check(
            checks,
            "coder.source",
            "Coder",
            "Where Coder's settings live",
            "info",
            current="the coder-platform chart's values",
            detail="Coder's own settings come from the installation's values: change them in install.conf (or "
            "values-local.yaml) and run ./install deploy. Keycloak's side and the Secrets can be fixed here.",
        )
    elif app is None:
        declared = running
        check(
            checks,
            "coder.source",
            "Coder",
            "Where Coder's settings live",
            "warn",
            current="not an Argo CD Application this service can read",
            detail="Coder's settings can only be changed from here when Argo CD manages Coder. The checks below still "
            "show what is wrong; change them where Coder is deployed from.",
        )
    elif not isinstance(values_text, str):
        check(
            checks,
            "coder.source",
            "Coder",
            "Where Coder's settings live",
            "warn",
            current="Argo CD (valuesObject)",
            detail="The Application uses helm.valuesObject; this view only edits helm.values. Use keycloaking-coder.",
        )
        app = None
    else:
        blk = values_block(values_text, "env")
        declared = env_map(blk[3] if blk else [])
        sync = ((app.get("status") or {}).get("sync") or {}).get("status")
        health = ((app.get("status") or {}).get("health") or {}).get("status")
        check(
            checks,
            "coder.source",
            "Coder",
            "Where Coder's settings live",
            "ok",
            current="Argo CD Application %s/%s (%s, %s)"
            % (ARGOCD_NAMESPACE, ARGOCD_APP, sync, health),
            detail="Changes are written to the Application's Helm values; Argo CD rolls Coder out with them.",
        )
    facts["canEditCoder"] = app is not None

    settings, discovered_url = kc_settings(declared)
    facts["settings"] = settings
    facts["discoveredKeycloakUrl"] = discovered_url
    kc_url = settings["keycloakUrl"]
    if not kc_url:
        check(
            checks,
            "kc.url",
            "Connection",
            "Keycloak address",
            "error",
            detail="No Keycloak resource was found and Coder has no issuer URL. Enter Keycloak's address.",
        )
        return {"checks": checks, "facts": facts}
    check(
        checks,
        "kc.url",
        "Connection",
        "Keycloak address",
        "ok",
        current=kc_url,
        detail=(
            "Found from the Keycloak resource in namespace %s." % KEYCLOAK_NAMESPACE
            if discovered_url
            else "Taken from Coder's issuer URL."
        ),
    )

    issuer = "%s/realms/%s" % (kc_url, settings["realm"])
    try:
        status, disc = http_json(
            issuer + "/.well-known/openid-configuration", context=TLS, timeout=6
        )
        if status == 200 and isinstance(disc, dict) and disc.get("issuer") == issuer:
            check(
                checks,
                "kc.discovery",
                "Connection",
                "Keycloak answers for realm '%s'" % settings["realm"],
                "ok",
                current=issuer,
            )
        else:
            check(
                checks,
                "kc.discovery",
                "Connection",
                "Keycloak answers for realm '%s'" % settings["realm"],
                "error",
                current="HTTP %s" % status,
                detail="Coder reads this discovery document at start-up; without it Coder does not start with OIDC enabled.",
            )
    except ssl.SSLError as e:
        check(
            checks,
            "kc.discovery",
            "Connection",
            "Keycloak's TLS certificate is trusted",
            "error",
            current=str(e)[:120],
            detail="Keycloak's certificate is not signed by a CA this service (and Coder) trusts.",
        )
    except Exception as e:  # noqa: BLE001
        check(
            checks,
            "kc.discovery",
            "Connection",
            "Keycloak is reachable",
            "error",
            current=str(e)[:160],
        )

    kc = Keycloak(kc_url)
    client, flow_id, kc_ok = None, None, kc.login()
    check(
        checks,
        "kc.admin",
        "Connection",
        "Keycloak admin access",
        "ok" if kc_ok else "warn",
        current="via " + kc.via if kc_ok else "not connected",
        fix=None if kc_ok else "kc.connect",
        detail=(
            ""
            if kc_ok
            else (kc.error or "")
            + " Keycloak-side checks are skipped until this service is connected: "
            "sign in once below with a Keycloak admin account and it creates its own, limited service account."
        ),
    )
    facts["keycloakConnected"] = kc_ok
    if not kc_ok:
        facts["connect"] = connect_help(kc, kc_url)
    kc_secret = None
    if kc_ok:
        try:
            kc.api("GET", "/%s" % settings["realm"])
            check(
                checks,
                "kc.realm",
                "Keycloak",
                "Realm '%s' exists" % settings["realm"],
                "ok",
            )
            flows = kc.api("GET", "/%s/authentication/flows" % settings["realm"]) or []
            flow = next(
                (f for f in flows if f.get("alias") == settings["flowAlias"]), None
            )
            flow_id = flow and flow.get("id")
            clients = kc.api(
                "GET",
                "/%s/clients?clientId=%s"
                % (settings["realm"], urllib.parse.quote(settings["clientId"])),
            )
            client = clients[0] if clients else None
            want = desired_client(settings, access_url, flow_id)
            if not client:
                check(
                    checks,
                    "kc.client",
                    "Keycloak",
                    "OIDC client '%s'" % settings["clientId"],
                    "error",
                    current="missing",
                    expected="confidential client, callback %s"
                    % want["redirectUris"][0],
                    fix="kc.client",
                    detail="Coder signs people in through this client. It will be created with Coder's callback URL.",
                )
            else:
                problems = []
                if not client.get("enabled"):
                    problems.append("disabled")
                if client.get("publicClient"):
                    problems.append(
                        "public (Coder needs a confidential client with a secret)"
                    )
                if not client.get("standardFlowEnabled"):
                    problems.append("standard (authorization code) flow off")
                cb = want["redirectUris"][0]
                uris = client.get("redirectUris") or []
                if not any(
                    u == cb or (u.endswith("*") and cb.startswith(u[:-1])) for u in uris
                ):
                    problems.append(
                        "callback %s not allowed (has: %s)"
                        % (cb, ", ".join(uris) or "none")
                    )
                if access_url not in (client.get("webOrigins") or []) and "+" not in (
                    client.get("webOrigins") or []
                ):
                    problems.append("web origin %s missing" % access_url)
                if (
                    flow_id
                    and (client.get("authenticationFlowBindingOverrides") or {}).get(
                        "browser"
                    )
                    != flow_id
                ):
                    problems.append("browser flow is not '%s'" % settings["flowAlias"])
                check(
                    checks,
                    "kc.client",
                    "Keycloak",
                    "OIDC client '%s'" % settings["clientId"],
                    "warn" if problems else "ok",
                    current="; ".join(problems)
                    or "confidential, callback and origin allowed"
                    + (", certificate flow" if flow_id else ""),
                    expected=(
                        None
                        if not problems
                        else "callback %s, origin %s" % (cb, access_url)
                    ),
                    fix="kc.client" if problems else None,
                    detail=(
                        "Existing redirect URIs and origins are kept; the missing ones are added."
                        if problems
                        else ""
                    ),
                )
                sec = (
                    kc.api(
                        "GET",
                        "/%s/clients/%s/client-secret"
                        % (settings["realm"], client["id"]),
                    )
                    or {}
                )
                kc_secret = sec.get("value")
                scopes = {
                    s.get("name")
                    for s in kc.api(
                        "GET",
                        "/%s/clients/%s/default-client-scopes"
                        % (settings["realm"], client["id"]),
                    )
                    or []
                }
                missing = [n for n in ("profile", "email") if n not in scopes]
                check(
                    checks,
                    "kc.scopes",
                    "Keycloak",
                    "Client scopes give Coder a username and e-mail",
                    "warn" if missing else "ok",
                    current="default scopes: " + (", ".join(sorted(scopes)) or "none"),
                    expected="profile, email" if missing else None,
                    fix="kc.scopes" if missing else None,
                    detail="Coder reads preferred_username (profile) and email (email) from the ID token.",
                )
            check(
                checks,
                "kc.flow",
                "Keycloak",
                "Certificate sign-in flow '%s'" % settings["flowAlias"],
                "ok" if flow_id else "info",
                current="present" if flow_id else "not in this realm",
                detail=(
                    ""
                    if flow_id
                    else "Coder will use the realm's normal browser login. ../keycloak/keycloak-x509-sso sets up certificate sign-in."
                ),
            )
        except Exception as e:  # noqa: BLE001
            check(
                checks,
                "kc.realm",
                "Keycloak",
                "Realm '%s'" % settings["realm"],
                "error",
                current=str(e)[:200],
            )

    # ---- Coder side (declared = Argo CD values; running = the Deployment)
    want_env = env_map(desired_env(settings, kc_url))
    source = declared if app else running
    diffs = []
    secret_ref = oidc_secret_ref(source) or (OIDC_SECRET, "client-secret")
    for name, want in want_env.items():
        if name == "CODER_OIDC_CLIENT_SECRET":
            # any Secret will do (its content is compared with Keycloak's below); an inline value is worth fixing
            if not oidc_secret_ref(source) and (source.get(name) or {}).get("value"):
                diffs.append(
                    {
                        "name": name,
                        "current": "inline value",
                        "expected": "from a Secret",
                    }
                )
            elif not source.get(name):
                diffs.append(
                    {
                        "name": name,
                        "current": None,
                        "expected": "from Secret %s (client-secret)" % OIDC_SECRET,
                    }
                )
            continue
        have, wanted = env_value(source, name), want["value"]
        if name == "CODER_OIDC_SCOPES":
            if {"openid", "profile", "email"} <= set(
                (have or "").replace(" ", ",").split(",")
            ):
                continue
        if name == "CODER_OIDC_ISSUER_URL" and (have or "").rstrip("/") == (
            wanted or ""
        ).rstrip("/"):
            continue
        if (have or "") != (wanted or ""):
            diffs.append(
                {
                    "name": name,
                    "current": have,
                    "expected": wanted,
                    "choice": name in OIDC_CHOICES,
                }
            )
    serious = [d for d in diffs if not d.get("choice")]
    check(
        checks,
        "coder.env",
        "Coder",
        "Coder's OIDC settings",
        "error" if serious else "info" if diffs else "ok",
        current=None if diffs else "match Keycloak",
        expected=None,
        fix="coder.values" if serious and app else None,
        detail=(
            ""
            if not diffs
            else (
                "Coder restarts to apply these (about 30 seconds; signed-in sessions survive)."
                if serious
                else "Only differences in this deployment's own choices (sign-in text, icon, sign-ups, email verification)."
            )
        ),
    )
    facts["envDiffs"] = diffs
    running_ok = (
        dep_status == 200
        and ((dep or {}).get("status") or {}).get("availableReplicas", 0) >= 1
    )
    started_with_issuer = (env_value(running, "CODER_OIDC_ISSUER_URL") or "").rstrip(
        "/"
    ) == ("%s/realms/%s" % (kc_url.rstrip("/"), settings["realm"]))
    if running_ok and started_with_issuer:
        check(
            checks,
            "coder.ca",
            "Coder",
            "Coder trusts Keycloak's certificate",
            "ok",
            current="Coder is running with this issuer",
            detail="Coder reads the issuer's discovery document at start and doesn't start without it, so it reached and trusted Keycloak.",
        )
    elif not ssl_dirs_ok(source):
        check(
            checks,
            "coder.ca",
            "Coder",
            "Coder trusts Keycloak's certificate",
            "error",
            current="SSL_CERT_DIR does not include %s" % CA_MOUNT,
            expected="/etc/ssl/certs:%s" % CA_MOUNT,
            fix="coder.values" if app else None,
            detail="Coder verifies Keycloak's TLS certificate against these directories; the local CA is mounted there.",
        )

    # Secrets Coder reads
    facts["oidcSecret"] = "%s/%s" % secret_ref
    oidc = KUBE.secret(CODER_NAMESPACE, secret_ref[0])
    have_secret = (oidc or {}).get(secret_ref[1])
    if kc_secret is None:
        check(
            checks,
            "coder.secret",
            "Coder",
            "Client secret shared with Keycloak",
            "unknown" if have_secret else "error",
            current="Secret %s/%s (%s) %s"
            % (
                CODER_NAMESPACE,
                secret_ref[0],
                secret_ref[1],
                "present" if have_secret else "missing or not readable here",
            ),
            detail="It can only be compared with Keycloak's copy once Keycloak admin access works.",
        )
    else:
        same = have_secret is not None and have_secret == kc_secret
        check(
            checks,
            "coder.secret",
            "Coder",
            "Client secret shared with Keycloak",
            "ok" if same else "error",
            current="Secret %s/%s (%s) %s"
            % (
                CODER_NAMESPACE,
                secret_ref[0],
                secret_ref[1],
                (
                    "matches Keycloak"
                    if same
                    else ("differs from Keycloak" if have_secret else "missing")
                ),
            ),
            fix=None if same else "coder.secret",
            detail=(
                ""
                if same
                else "Coder presents this secret when it exchanges the sign-in code; a mismatch fails every sign-in with 'unauthorized_client'."
            ),
        )
    group_report(checks, facts, source, kc if kc_ok else None, settings, client)

    ca_src = KUBE.secret(CODER_NAMESPACE, CA_SOURCE_SECRET)
    ca_now = KUBE.secret(CODER_NAMESPACE, CA_SECRET)
    if ca_src and ca_src.get("ca.crt"):
        same = bool(ca_now) and ca_now.get("ca.crt") == ca_src.get("ca.crt")
        check(
            checks,
            "coder.ca_secret",
            "Coder",
            "Keycloak's CA available to Coder",
            "ok" if same else "warn",
            current="Secret %s/%s %s"
            % (
                CODER_NAMESPACE,
                CA_SECRET,
                (
                    "present"
                    if same
                    else ("differs from %s" % CA_SOURCE_SECRET if ca_now else "missing")
                ),
            ),
            fix=None if same else "coder.ca",
            detail=(
                ""
                if same
                else "Copied from Secret %s/%s, the CA that signed Keycloak's certificate."
                % (CODER_NAMESPACE, CA_SOURCE_SECRET)
            ),
        )

    # Live: what the running Coder offers
    try:
        status, am = http_json(CODER_URL + "/api/v2/users/authmethods", timeout=5)
        oidc_on = status == 200 and bool(((am or {}).get("oidc") or {}).get("enabled"))
        pw_on = status == 200 and bool(
            ((am or {}).get("password") or {}).get("enabled")
        )
        check(
            checks,
            "coder.live",
            "Coder",
            "Sign-in methods Coder offers now",
            "ok" if oidc_on else "error",
            current=", ".join(
                [
                    m
                    for m, on in (("Keycloak (OIDC)", oidc_on), ("password", pw_on))
                    if on
                ]
            )
            or "none",
            detail=(
                ""
                if oidc_on
                else "Coder is not offering OIDC sign-in; fix the items above and let it restart."
            ),
        )
    except Exception as e:  # noqa: BLE001
        check(
            checks,
            "coder.live",
            "Coder",
            "Sign-in methods Coder offers now",
            "unknown",
            current=str(e)[:120],
        )
    if app and running and declared:
        pending = any(
            (declared.get(n) or {}) != (running.get(n) or {}) for n in want_env
        )
        if pending:
            check(
                checks,
                "coder.rollout",
                "Coder",
                "Coder is running the saved settings",
                "info",
                current="Argo CD is rolling Coder out with the new settings",
                detail="This page refreshes on its own.",
            )

    # Users: Coder links accounts by e-mail, so each Coder user needs a Keycloak twin with the same e-mail
    if kc_ok and client is not None:
        try:
            users = active_users(token)
            missing, mismatch = [], []
            for u in users[:200]:
                found = kc.api(
                    "GET",
                    "/%s/users?username=%s&exact=true"
                    % (settings["realm"], urllib.parse.quote(u["username"])),
                )
                if not found:
                    missing.append(u["username"])
                elif (found[0].get("email") or "").lower() != (
                    u["email"] or ""
                ).lower():
                    mismatch.append(u["username"])
            status_u = "ok" if not missing and not mismatch else "info"
            detail = []
            if missing:
                detail.append(
                    "No Keycloak user yet: "
                    + ", ".join(missing[:12])
                    + (" ..." if len(missing) > 12 else "")
                )
            if mismatch:
                detail.append(
                    "Different e-mail in Keycloak: " + ", ".join(mismatch[:12])
                )
            check(
                checks,
                "kc.users",
                "Keycloak",
                "Coder users can sign in through Keycloak",
                status_u,
                current="%d of %d Coder users have a matching Keycloak user"
                % (len(users) - len(missing) - len(mismatch), len(users)),
                detail=" ".join(detail)
                + (
                    " Coder matches accounts by e-mail; ../keycloak/keycloaking-coder creates the missing twins."
                    if detail
                    else ""
                ),
            )
        except Exception as e:  # noqa: BLE001
            check(
                checks,
                "kc.users",
                "Keycloak",
                "Coder users can sign in through Keycloak",
                "unknown",
                current=str(e)[:160],
            )

    backup = STORE.last_backup()
    facts["undo"] = (
        {"savedAt": backup["saved_at"], "savedBy": backup["saved_by"]}
        if backup
        else None
    )
    return {"checks": checks, "facts": facts}


def clean_kc_settings(raw):
    s = dict(DEFAULT_KC_SETTINGS)
    s.update(STORE.get_setting("keycloak", {}) or {})
    for key in (
        "keycloakUrl",
        "realm",
        "clientId",
        "scopes",
        "usernameField",
        "emailField",
        "signInText",
        "iconUrl",
        "flowAlias",
    ):
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
    if s.get("keycloakUrl") and not re.match(
        r"^https?://[A-Za-z0-9.\-:]+(/auth)?$", s["keycloakUrl"].rstrip("/")
    ):
        raise ValueError("Keycloak address must look like https://keycloak.example.com")
    if not re.match(r"^[A-Za-z0-9_.\-]+$", s["realm"]) or not re.match(
        r"^[A-Za-z0-9_.\-]+$", s["clientId"]
    ):
        raise ValueError(
            "Realm and client ID may only contain letters, digits, '.', '_' and '-'."
        )
    if "openid" not in [x.strip() for x in s["scopes"].split(",")]:
        raise ValueError("Scopes must include openid.")
    s["keycloakUrl"] = (s.get("keycloakUrl") or "").rstrip("/")
    return s


ADMIN_CLIENT_ID = "coder-ui-updates"
# Least privilege for the realm Coder uses: read the realm and its flows, manage its clients, look up its users.
ADMIN_ROLES_NEEDED = (
    "view-realm",
    "view-clients",
    "manage-clients",
    "view-users",
    "query-users",
)


def connect_help(kc, kc_url):
    """What the Connect card can tell the admin, from the cluster: where they sign in, who to sign in as, and why the
    admin login kept in the cluster did not do it by itself."""
    secret = "%s/%s" % (KEYCLOAK_NAMESPACE, KEYCLOAK_ADMIN_SECRET)
    state, who = kc.secret_state, kc.secret_user
    why = {
        "stale": ("Keycloak rejects the admin login kept in Secret %s (user '%s'). That is the temporary admin Keycloak "
                  "creates when it is first installed; it is usually deleted, or its password changed, once a permanent "
                  "admin exists. Sign in once with the admin account you use for Keycloak's admin console." % (secret, who)),
        "missing": "Secret %s has no admin login (username / password, or client-id / client-secret)." % secret,
        "unreadable": ("Secret %s does not exist or this service may not read it, so it cannot sign in to Keycloak by "
                       "itself." % secret),
        "unreachable": "Keycloak at %s could not be reached from the cluster: %s" % (kc_url, kc.error or ""),
    }.get(state, kc.error or "No working Keycloak admin access.")
    return {
        "keycloakUrl": kc_url, "realm": "master", "secret": secret, "reason": state or "unknown", "why": why,
        # the account named in the cluster: right if only its password changed; replace it otherwise
        "username": who if state == "stale" else "",
        "console": kc_url.rstrip("/") + "/admin/master/console/" if kc_url else None,
        "recovery": "https://www.keycloak.org/server/bootstrap-admin-recovery",
    }


def connect_keycloak(username, password, raw_settings, user):
    """One-time: sign in as a Keycloak admin (credentials used for this call only, never stored), create the
    confidential service-account client ADMIN_CLIENT_ID in the master realm with the realm-management roles above for
    Coder's realm, and store that client's secret. From then on the service uses the client, not the admin account.
    """
    s = clean_kc_settings(raw_settings or {})
    kc_url = s["keycloakUrl"] or keycloak_url_from_cluster()
    if not kc_url:
        raise ValueError(
            "Keycloak's address is unknown; enter it in the settings first."
        )
    kc = Keycloak(kc_url)
    tok, err = kc._token(
        {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": username,
            "password": password,
        }
    )
    if not tok:
        raise RuntimeError("Keycloak refused that admin sign-in (%s)." % err)
    kc._use(tok, "admin %s" % username)
    found = kc.api("GET", "/master/clients?clientId=%s" % ADMIN_CLIENT_ID)
    if not found:
        kc.api(
            "POST",
            "/master/clients",
            {
                "clientId": ADMIN_CLIENT_ID,
                "name": "coder-ui-updates (Coder dashboard: Keycloak view)",
                "enabled": True,
                "protocol": "openid-connect",
                "publicClient": False,
                "clientAuthenticatorType": "client-secret",
                "serviceAccountsEnabled": True,
                "standardFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "implicitFlowEnabled": False,
                "description": "Created from Coder > Deployment > Keycloak. Delete it to revoke access.",
            },
        )
        found = kc.api("GET", "/master/clients?clientId=%s" % ADMIN_CLIENT_ID)
    client = found[0]
    sa = kc.api("GET", "/master/clients/%s/service-account-user" % client["id"])
    # "<realm>-realm" in the master realm holds the management roles for <realm> (master-realm for master itself).
    mgmt = kc.api(
        "GET", "/master/clients?clientId=%s" % urllib.parse.quote(s["realm"] + "-realm")
    )
    if not mgmt:
        raise RuntimeError(
            "Keycloak has no management client '%s-realm' in the master realm."
            % s["realm"]
        )
    roles = [
        r
        for r in kc.api("GET", "/master/clients/%s/roles" % mgmt[0]["id"]) or []
        if r.get("name") in ADMIN_ROLES_NEEDED
    ]
    kc.api(
        "POST",
        "/master/users/%s/role-mappings/clients/%s" % (sa["id"], mgmt[0]["id"]),
        roles,
    )
    secret = (
        kc.api("GET", "/master/clients/%s/client-secret" % client["id"]) or {}
    ).get("value")
    if not secret:
        raise RuntimeError(
            "Keycloak returned no secret for client '%s'." % ADMIN_CLIENT_ID
        )
    STORE.put_setting(
        "keycloak_admin_client",
        {
            "url": kc_url,
            "clientId": ADMIN_CLIENT_ID,
            "secret": secret,
            "realm": s["realm"],
            "by": user,
            "at": now(),
        },
    )
    return [
        "Connected to Keycloak with service account '%s' (roles for realm '%s': %s). The admin password was not stored."
        % (ADMIN_CLIENT_ID, s["realm"], ", ".join(sorted(r["name"] for r in roles)))
    ]


def apply_keycloak(fixes, raw_settings, user):
    s = clean_kc_settings(raw_settings or {})
    STORE.put_setting(
        "keycloak",
        {
            k: v
            for k, v in s.items()
            if k != "keycloakUrl" or v != keycloak_url_from_cluster()
        },
    )
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
        found = kc.api(
            "GET",
            "/%s/clients?clientId=%s" % (realm, urllib.parse.quote(s["clientId"])),
        )
        if not found:
            kc.api("POST", "/%s/clients" % realm, want)
            done.append("Created Keycloak client '%s'" % s["clientId"])
            fixes = list(fixes) + [
                "coder.secret"
            ]  # a new client has a new secret: Coder's copy is necessarily stale
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
        found = kc.api(
            "GET",
            "/%s/clients?clientId=%s" % (realm, urllib.parse.quote(s["clientId"])),
        )
        if not found:
            raise RuntimeError(
                "Keycloak client '%s' does not exist yet; create it first."
                % s["clientId"]
            )
        client = found[0]
    if "kc.scopes" in fixes:
        have = {
            x.get("name")
            for x in kc.api(
                "GET", "/%s/clients/%s/default-client-scopes" % (realm, client["id"])
            )
            or []
        }
        scopes = {
            x.get("name"): x.get("id")
            for x in kc.api("GET", "/%s/client-scopes" % realm) or []
        }
        for name in ("profile", "email"):
            if name not in have and scopes.get(name):
                kc.api(
                    "PUT",
                    "/%s/clients/%s/default-client-scopes/%s"
                    % (realm, client["id"], scopes[name]),
                )
                done.append("Added scope '%s' to the client" % name)
    if "coder.secret" in fixes:
        sec = (
            kc.api("GET", "/%s/clients/%s/client-secret" % (realm, client["id"])) or {}
        ).get("value")
        if not sec:
            raise RuntimeError(
                "Keycloak returned no client secret for '%s'." % s["clientId"]
            )
        status, dep = KUBE.call(
            "GET",
            "/apis/apps/v1/namespaces/%s/deployments/%s"
            % (CODER_NAMESPACE, CODER_DEPLOYMENT),
        )
        name, key = oidc_secret_ref(container_env(dep) if status == 200 else {}) or (
            OIDC_SECRET,
            "client-secret",
        )
        KUBE.put_secret(CODER_NAMESPACE, name, {key: sec})
        done.append(
            "Stored the client secret in Secret %s/%s (key %s)"
            % (CODER_NAMESPACE, name, key)
        )
    if "coder.ca" in fixes:
        src = KUBE.secret(CODER_NAMESPACE, CA_SOURCE_SECRET)
        if not src or not src.get("ca.crt"):
            raise RuntimeError(
                "Secret %s/%s has no ca.crt." % (CODER_NAMESPACE, CA_SOURCE_SECRET)
            )
        KUBE.put_secret(CODER_NAMESPACE, CA_SECRET, {"ca.crt": src["ca.crt"]})
        done.append(
            "Stored Keycloak's CA in Secret %s/%s" % (CODER_NAMESPACE, CA_SECRET)
        )
    if "coder.values" in fixes:
        done += apply_coder_values(s, kc_url, user)
    return done


def apply_coder_values(s, kc_url, user):
    app = argo_app()
    text = (
        (((app or {}).get("spec") or {}).get("source") or {})
        .get("helm", {})
        .get("values")
        if app
        else None
    )
    if not isinstance(text, str):
        raise RuntimeError(
            "Coder's Argo CD Application (helm.values) is not readable; nothing was changed."
        )
    blk = values_block(text, "env")
    env = list(blk[3] if blk else [])
    want = desired_env(s, kc_url)
    names = {e["name"] for e in want}
    env = [
        e for e in env if not (isinstance(e, dict) and e.get("name") in names)
    ] + want
    ssl_entry = next(
        (e for e in env if isinstance(e, dict) and e.get("name") == "SSL_CERT_DIR"),
        None,
    )
    if not ssl_entry:
        env.append({"name": "SSL_CERT_DIR", "value": "/etc/ssl/certs:" + CA_MOUNT})
    elif CA_MOUNT not in str(ssl_entry.get("value", "")).split(":"):
        ssl_entry["value"] = (
            (ssl_entry.get("value") or "/etc/ssl/certs") + ":" + CA_MOUNT
        )
    new = replace_values_block(text, "env", env)
    vols = values_block(new, "volumes")
    vol_list = list(vols[3] if vols else [])
    if not any(
        isinstance(v, dict) and v.get("name") == "keycloaking-ca" for v in vol_list
    ):
        vol_list.append({"name": "keycloaking-ca", "secret": {"secretName": CA_SECRET}})
        new = replace_values_block(new, "volumes", vol_list)
    mounts = values_block(new, "volumeMounts")
    mount_list = list(mounts[3] if mounts else [])
    if not any(
        isinstance(v, dict) and v.get("name") == "keycloaking-ca" for v in mount_list
    ):
        mount_list.append(
            {"name": "keycloaking-ca", "mountPath": CA_MOUNT, "readOnly": True}
        )
        new = replace_values_block(new, "volumeMounts", mount_list)
    if new == text:
        return ["Coder's settings already matched"]
    STORE.backup_values(user, ARGOCD_APP, text)
    patch_argo_values(new)
    return [
        "Saved Coder's OIDC settings in Argo CD Application %s; Coder is restarting with them"
        % ARGOCD_APP
    ]


def patch_argo_values(text):
    status, out = KUBE.call(
        "PATCH",
        "/apis/argoproj.io/v1alpha1/namespaces/%s/applications/%s"
        % (ARGOCD_NAMESPACE, ARGOCD_APP),
        {
            "metadata": {"annotations": {"argocd.argoproj.io/refresh": "normal"}},
            "spec": {"source": {"helm": {"values": text}}},
        },
        "application/merge-patch+json",
    )
    if status != 200:
        raise RuntimeError(
            "Argo CD Application update failed (HTTP %s): %s" % (status, str(out)[:200])
        )


# --------------------------------------------------------------------------- Logo (Coder's CNPG database)
PNG, JPEG, GIF, WEBP = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    (b"GIF87a", b"GIF89a"),
    b"RIFF",
)
LOGO_TYPES = {
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/webp",
    "image/gif",
    "image/avif",
}
SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"  # an SVG opened directly runs nothing


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
        if "<svg" in text and not re.search(
            r"<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed", text
        ):
            return "image/svg+xml"
    return None


class Defaults:
    """The default images installed with this tool (resources/defaults/: logo.<ext>, avatar.<ext>), each from its own
    optional ConfigMap mounted at DEFAULTS_DIR/<kind>/. Re-read at most every 30 seconds, so a changed or removed
    ConfigMap takes effect without a restart. Checked like uploads: the logo may be SVG, the avatar may not.
    """

    def __init__(self, root):
        self.root = root
        self.cache = {}  # kind -> (read at, {"type", "data", "sha", "file"} or None)
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
        for root in (self.root, BAKED_DEFAULTS_DIR):
            found = self._read_in(os.path.join(root, kind), kind)
            if found:
                return found
        return None

    def _read_in(self, folder, kind):
        try:
            names = sorted(
                n
                for n in os.listdir(folder)
                if re.match(r"^%s\.(png|jpe?g|gif|webp|avif|svg)$" % kind, n)
            )
        except OSError:
            return None
        for name in names:
            try:
                with open(os.path.join(folder, name), "rb") as f:
                    data = f.read(LOGO_MAX_BYTES + 1)
            except OSError:
                continue
            ctype = (
                image_type(data, svg=kind == "logo")
                if 0 < len(data) <= LOGO_MAX_BYTES
                else None
            )
            if ctype:
                return {
                    "type": ctype,
                    "data": data,
                    "sha": hashlib.sha256(data).hexdigest()[:16],
                    "file": name,
                }
            log(
                event="default-image-ignored",
                kind=kind,
                file=name,
                reason="not a supported image or larger than %d MB"
                % (LOGO_MAX_BYTES // 1048576),
            )
        return None


DEFAULTS = None


class Gallery:
    """The pictures installed with this tool for the logo and avatar editors to offer (resources defaults/gallery/:
    each file in its own optional ConfigMap, all projected into DEFAULTS_DIR/gallery/). Re-read at most every 30
    seconds. Only images the avatar editor can take too (no SVG), up to LOGO_MAX_BYTES each."""

    NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|gif|webp|avif)$")

    def __init__(self, folder):
        self.folder = folder
        self.cache = (0, {})
        self.lock = threading.Lock()

    def items(self):
        with self.lock:
            if time.time() - self.cache[0] < 30:
                return self.cache[1]
            found = {}
            try:
                names = sorted(os.listdir(self.folder))
            except OSError:
                names = []
            for name in names:
                if not self.NAME_RE.match(name):
                    continue
                try:
                    with open(os.path.join(self.folder, name), "rb") as f:
                        data = f.read(LOGO_MAX_BYTES + 1)
                except OSError:
                    continue
                ctype = image_type(data) if 0 < len(data) <= LOGO_MAX_BYTES else None
                if ctype:
                    found[name] = {"type": ctype, "data": data, "sha": hashlib.sha256(data).hexdigest()[:16]}
                else:
                    log(event="gallery-image-ignored", file=name, reason="not a supported image or too large")
            self.cache = (time.time(), found)
            return found

    def listing(self):
        return [
            {"name": name, "type": it["type"], "bytes": len(it["data"]),
             "url": "%s/gallery/%s?v=%s" % (BASE, urllib.parse.quote(name), it["sha"])}
            for name, it in self.items().items()
        ]


GALLERY = None


# --------------------------------------------------------------------------- The image store (baked pictures)
IMAGE_STORE_DIR = os.environ.get("IMAGE_STORE_DIR", "/image-store")
STORE_PICTURE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(gif|png|jpe?g|webp|avif)$", re.I)
STORE_PICTURE_TYPES = {"gif": "image/gif", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                       "webp": "image/webp", "avif": "image/avif"}


class ImageStore:
    """The image store's baked pictures: the files of IMAGE_STORE_DIR/pictures (development/image-store, in this
    service's image, a layer of its own), each with a small animated preview, thumbs/<name>.webp. Served publicly at
    /__coder-ui/image-store/<name> (the sign-in page's background, avatars and the announcement show them, signed in
    or not) and listed - with the gallery's pictures and the announcement's uploaded ones - for every picture chooser
    (GET /api/image-store). The listing is re-read at most every 60 seconds."""

    def __init__(self, folder):
        self.folder = folder
        self.cache = (0, {})
        self.lock = threading.Lock()

    def items(self):
        """{name: {"path", "type", "bytes", "tag", "thumb"}}; tag: the file's size and time (its address's version)."""
        with self.lock:
            if time.time() - self.cache[0] < 60:
                return self.cache[1]
            found = {}
            try:
                names = sorted(os.listdir(os.path.join(self.folder, "pictures")))
            except OSError:
                names = []
            for name in names:
                m = STORE_PICTURE_RE.match(name)
                path = os.path.join(self.folder, "pictures", name)
                if not m or not os.path.isfile(path):
                    continue
                st = os.stat(path)
                thumb = os.path.join(self.folder, "thumbs", name + ".webp")
                found[name] = {"path": path, "type": STORE_PICTURE_TYPES[m.group(1).lower()], "bytes": st.st_size,
                               "tag": "%x%x" % (st.st_size, int(st.st_mtime)),
                               "thumb": thumb if os.path.isfile(thumb) else None}
            self.cache = (time.time(), found)
            return found

    def path_of(self, name):
        """A store picture's address (no version: what a background keeps), or None."""
        return "%s/image-store/%s" % (BASE, name) if name in self.items() else None

    def listing(self):
        out = []
        for name, it in self.items().items():
            q = urllib.parse.quote(name)
            out.append({"name": name, "type": it["type"], "bytes": it["bytes"], "source": "store",
                        "url": "%s/image-store/%s?v=%s" % (BASE, q, it["tag"]),
                        "thumb": "%s/image-store/thumbs/%s?v=%s" % (BASE, q, it["tag"]) if it["thumb"] else None})
        return out


STORE_IMAGES = None


def image_store_listing():
    """Every picture a chooser offers, from the image store: its baked pictures, the gallery's, and the announcement's
    uploaded ones (newest first). The dashboard adds the pictures baked into itself (/pictures/)."""
    images = STORE_IMAGES.listing() if STORE_IMAGES else []
    for it in GALLERY.listing() if GALLERY else []:
        images.append(dict(it, source="gallery", thumb=None))
    if BANNER_PICTURES and BANNER_PICTURES.pool:
        try:
            images += BANNER_PICTURES.listing()
        except Exception as e:  # noqa: BLE001 - the baked ones still
            log(event="image-store-uploads-unread", error=str(e)[:200])
    return images


class LogoStore:
    """The uploaded logo, one row in coder_ui_updates.logo of Coder's own database (so it survives everything this
    tool's pods and volumes go through), cached in memory and re-read at most every 30 seconds.
    """

    def __init__(self):
        self._pool, self.tried_at = None, 0
        self.ready = False
        self.cache, self.loaded_at = None, 0
        self.lock = threading.Lock()
        self.refreshing = False
        self.peek()  # start loading it now, in the background

    def connect(self):
        """The database pool, made on first use. When this pod started before Coder's database existed (Argo CD
        creates the database in a later sync wave), the connection Secret was missing then: it is read through the
        API instead, re-tried at most every 30 seconds."""
        if self._pool or time.time() - self.tried_at < 30:
            return self._pool
        self.tried_at = time.time()
        uri, ca = CODER_DB_URI, (
            CODER_DB_CA if CODER_DB_CA and os.path.exists(CODER_DB_CA) else None
        )
        if not uri and CODER_DB_SECRET:
            uri = (KUBE.secret(CODER_NAMESPACE, CODER_DB_SECRET) or {}).get(
                CODER_DB_SECRET_KEY, ""
            )
            if uri and not ca and CODER_DB_CA_SECRET:
                pem = (KUBE.secret(CODER_NAMESPACE, CODER_DB_CA_SECRET) or {}).get(
                    "ca.crt", ""
                )
                if pem:
                    ca = os.path.join(os.path.dirname(DB_PATH), "coder-db-ca.crt")
                    with open(ca, "w") as f:
                        f.write(pem)
        if uri:
            self._pool = pgwire.Pool(uri, ca, size=2)
            log(
                event="logo-store",
                status="connected",
                via="environment" if CODER_DB_URI else "Secret " + CODER_DB_SECRET,
            )
        return self._pool

    @property
    def pool(self):
        return self.connect()

    def _schema(self):
        if self.ready:
            return
        # No logo table yet = a fresh installation (or one whose logo was purged): it starts with the default logo, if
        # one is installed. Only then: an existing installation keeps what it has, Coder's own logo included.
        fresh = (
            self.pool.query("SELECT to_regclass('coder_ui_updates.logo')")[0][0] is None
        )
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query(
            """CREATE TABLE IF NOT EXISTS coder_ui_updates.logo (
            id int PRIMARY KEY CHECK (id = 1), content_type text NOT NULL, data bytea NOT NULL,
            sha256 text NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now())"""
        )
        default = DEFAULTS.get("logo") if fresh and DEFAULTS else None
        if default:
            self.pool.query(
                """INSERT INTO coder_ui_updates.logo (id, content_type, data, sha256, updated_by, updated_at)
                VALUES (1, $1, $2, $3, 'default', now()) ON CONFLICT (id) DO NOTHING""",
                [default["type"], default["data"], default["sha"]],
            )
            log(
                event="logo-default",
                status="installed",
                file=default["file"],
                bytes=len(default["data"]),
            )
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
            self.loaded_at = (
                time.time()
            )  # try again in 30 seconds, keep the last good copy
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
            rows = self.pool.query(
                "SELECT content_type, data, sha256, updated_by, updated_at FROM coder_ui_updates.logo WHERE id = 1"
            )
            self.cache = (
                {
                    "type": rows[0][0],
                    "data": rows[0][1],
                    "sha": rows[0][2],
                    "by": rows[0][3],
                    "at": rows[0][4],
                }
                if rows
                else None
            )
            self.loaded_at = time.time()
            return self.cache

    def put(self, ctype, data, user):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            self.pool.query(
                """INSERT INTO coder_ui_updates.logo (id, content_type, data, sha256, updated_by, updated_at)
                VALUES (1, $1, $2, $3, $4, now()) ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type,
                data = excluded.data, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()""",
                [ctype, data, sha, user],
            )
            self.loaded_at = 0
        self.get(fresh=True)  # the cache boot.js reads is current at once
        return sha

    def reset(self):
        with self.lock:
            self._schema()
            self.pool.query("DELETE FROM coder_ui_updates.logo WHERE id = 1")
            self.loaded_at = 0
            self.cache = None  # boot.js stops pointing at it at once


def parse_logo(data_url):
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in LOGO_TYPES:
        raise ValueError("Upload a PNG, JPEG, SVG, WebP, GIF or AVIF image.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > LOGO_MAX_BYTES:
        raise ValueError(
            "The image must be smaller than %d MB." % (LOGO_MAX_BYTES // 1048576)
        )
    ctype = m.group(1)
    ok = {
        "image/png": data.startswith(PNG),
        "image/jpeg": data.startswith(JPEG),
        "image/gif": data.startswith(GIF),
        "image/webp": data.startswith(WEBP) and data[8:12] == b"WEBP",
        "image/avif": is_avif(data),
    }.get(ctype)
    if ctype == "image/svg+xml":
        text = data.decode("utf-8", errors="replace").lower()
        ok = "<svg" in text and not re.search(
            r"<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed", text
        )
        if not ok:
            raise ValueError(
                "That SVG contains scripts or embedded content, which is not allowed."
            )
    if not ok:
        raise ValueError(
            "The file is not a valid %s image." % ctype.split("/")[1].upper()
        )
    return ctype, data


LOGOS = None


# --------------------------------------------------------------------------- Background images (Coder's database)
BG_SLOTS = ("login", "dashboard")
BG_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}
BG_MAX_BYTES = 4 * 1024 * 1024  # the dashboard sends at most 1920 x 1200 (WebP); an animated GIF as it is
BG_FITS = ("cover", "contain", "tile")
BG_LAYERS = ("under", "over")  # behind the page's content, or a faint watermark over it
BG_OPACITY = (0.02, 0.3, 0.06)  # min, max, default: hardly noticeable
BG_HTML_MAX = 256 * 1024  # an HTML / CSS background (an animated one like the Particles preset)
BG_PARAMS_MAX = 16 * 1024
# The dials every HTML background has, and their bounds: playback speed of its animations, then CSS filters.
BG_DIALS = {"speed": (0.1, 4.0, 1.0), "hue": (-180.0, 180.0, 0.0), "saturation": (0.0, 3.0, 1.0),
            "brightness": (0.3, 2.0, 1.0), "blur": (0.0, 20.0, 0.0)}
# How an HTML background is served (its own response, shown in a sandboxed frame): no access to Coder's page, its
# cookies or the network; inline styles and scripts only, pictures only as data: URLs.
BG_HTML_CSP = ("sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; "
               "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; "
               "form-action 'none'; base-uri 'none'; frame-ancestors 'self'")
# Added to every HTML background: plays its CSS (and Web) animations at the speed in the frame's #speed=, paused with
# #paused=1 (the dashboard's Animations switch). The same script as the dashboard's preview (backgroundHtml.ts).
BG_HTML_CONTROLLER = (
    "<script>(()=>{const q=()=>new URLSearchParams(location.hash.slice(1));let r=1;const a=()=>{const h=q();"
    "r=h.get('paused')==='1'?0:Math.min(4,Math.max(0.1,Number(h.get('speed'))||1));for(const x of "
    "document.getAnimations())if(x.playbackRate!==r)x.playbackRate=r};addEventListener('hashchange',a);"
    "addEventListener('load',a);setInterval(a,500);a()})();</script>"
)


def clean_bg_params(value):
    """The dials of an HTML background (bounded numbers) and, for a preset, its own settings (kept as given, small)."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("params must be an object.")
    out = {}
    for key, (lo, hi, _default) in BG_DIALS.items():
        if value.get(key) is not None:
            try:
                out[key] = round(min(hi, max(lo, float(value[key]))), 3)
            except (TypeError, ValueError):
                raise ValueError("%s must be a number." % key) from None
    if value.get("preset") is not None:
        if not isinstance(value["preset"], dict):
            raise ValueError("preset must be an object.")
        out["preset"] = value["preset"]
    if len(json.dumps(out)) > BG_PARAMS_MAX:
        raise ValueError("The settings are too large.")
    return out


def clean_bg_settings(payload, current=None):
    """{opacity, fit, layer, params} from a request, within bounds; missing ones keep `current` (else the defaults)."""
    current = current or {}
    out = {
        "opacity": current.get("opacity", BG_OPACITY[2]),
        "fit": current.get("fit", "cover"),
        "layer": current.get("layer", "under"),
        "params": current.get("params") or {},
    }
    if payload.get("params") is not None:
        out["params"] = clean_bg_params(payload["params"])
    if payload.get("opacity") is not None:
        try:
            value = float(payload["opacity"])
        except (TypeError, ValueError):
            raise ValueError("opacity must be a number.") from None
        out["opacity"] = round(min(BG_OPACITY[1], max(BG_OPACITY[0], value)), 3)
    if payload.get("fit") is not None:
        if payload["fit"] not in BG_FITS:
            raise ValueError("fit must be one of %s." % ", ".join(BG_FITS))
        out["fit"] = payload["fit"]
    if payload.get("layer") is not None:
        if payload["layer"] not in BG_LAYERS:
            raise ValueError("layer must be one of %s." % ", ".join(BG_LAYERS))
        out["layer"] = payload["layer"]
    return out


def parse_background_html(html):
    """An HTML / CSS background: text, at most BG_HTML_MAX bytes. It is not sanitised: it only ever runs sandboxed."""
    if not isinstance(html, str) or not html.strip():
        raise ValueError("The HTML is empty.")
    data = html.encode("utf-8")
    if len(data) > BG_HTML_MAX:
        raise ValueError("The HTML must be smaller than %d KB." % (BG_HTML_MAX // 1024))
    return "text/html", data


def serve_background_html(data):
    """The stored HTML with the speed controller added (before </body>, else at the end)."""
    html = data.decode("utf-8", errors="replace")
    i = html.lower().rfind("</body>")
    return (html[:i] + BG_HTML_CONTROLLER + html[i:] if i >= 0 else html + BG_HTML_CONTROLLER).encode("utf-8")


# A picture baked into the dashboard (the Coder image's site/static/pictures/), chosen as a background: only its path
# is stored, and pages draw it from Coder itself - nothing to upload or keep in the database, so it is there wherever
# Coder is.
BG_PICTURE_REF = "text/x-coder-picture"
BG_PICTURE_RE = re.compile(r"^/pictures/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(gif|png|jpe?g|webp|avif)$")
# ... or one of the image store's (ImageStore): its address on this service
BG_STORE_PICTURE_RE = re.compile(r"^/__coder-ui/image-store/([A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(gif|png|jpe?g|webp|avif))$",
                                 re.I)
BG_PICTURE_TYPES = {"gif": "image/gif", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                    "webp": "image/webp", "avif": "image/avif"}


def parse_background_picture(path):
    """A dashboard picture by its path: (BG_PICTURE_REF, b"<path>\n<bytes>"), once Coder serves it as an image; or
    one of the image store's, once it has it."""
    store = BG_STORE_PICTURE_RE.match(path) if isinstance(path, str) else None
    if store:
        hit = (STORE_IMAGES.items() if STORE_IMAGES else {}).get(store.group(1))
        if not hit:
            raise ValueError("The image store has no %s." % store.group(1))
        return BG_PICTURE_REF, ("%s\n%d" % (path, hit["bytes"])).encode()
    if not isinstance(path, str) or not BG_PICTURE_RE.match(path):
        raise ValueError("Not one of the dashboard's pictures (/pictures/<name>) or the image store's.")
    req = urllib.request.Request(CODER_URL + path, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            size = int(resp.headers.get("Content-Length") or 0)
    except Exception as e:  # noqa: BLE001
        raise ValueError("Coder does not serve %s: %s" % (path, str(e)[:120])) from None
    if not ctype.startswith("image/"):
        raise ValueError("Coder does not serve %s as a picture (%s)." % (path, ctype or "no type"))
    return BG_PICTURE_REF, ("%s\n%d" % (path, size)).encode()


def background_picture(bg):
    """(path, bytes) of a picture reference."""
    path, _, size = bytes(bg["data"]).decode("utf-8", errors="replace").partition("\n")
    return path, int(size or 0)


def parse_background(data_url):
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in BG_TYPES:
        raise ValueError("Upload a PNG, JPEG, WebP, GIF or AVIF image.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > BG_MAX_BYTES:
        raise ValueError("The image must be smaller than %d MB." % (BG_MAX_BYTES // 1048576))
    if image_type(data) != m.group(1):
        raise ValueError("The file is not a valid %s image." % m.group(1).split("/")[1].upper())
    return m.group(1), data


class BackgroundStore:
    """The background images of the sign-in page and of the dashboard (Customize > Background image): one row per
    slot in coder_ui_updates.background of Coder's own database, with how faint it is (opacity), how it fills the
    window (fit) and whether it lies behind the page's content or over it (layer). boot.js hands them to every page.
    Cached like the logo: boot.js never waits for the database."""

    def __init__(self, logos):
        self.logos = logos  # shares the logo store's connection to Coder's database
        self.ready = False
        self.lock = threading.Lock()
        self.cache, self.loaded_at, self.refreshing = {}, 0, False
        self.peek()  # start loading them now, so the first pages after a restart have them

    @property
    def pool(self):
        return self.logos.pool if self.logos else None

    def _schema(self):
        if self.ready:
            return
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query(
            """CREATE TABLE IF NOT EXISTS coder_ui_updates.background (
            slot text PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, sha256 text NOT NULL,
            opacity real NOT NULL, fit text NOT NULL, layer text NOT NULL, updated_by text,
            updated_at timestamptz NOT NULL DEFAULT now())"""
        )
        # 1.24.0: HTML backgrounds' dials (speed, filters) and preset settings
        self.pool.query(
            "ALTER TABLE coder_ui_updates.background ADD COLUMN IF NOT EXISTS params text NOT NULL DEFAULT '{}'"
        )
        self.ready = True

    def all(self, fresh=False):
        """{slot: {"type", "data", "sha", "opacity", "fit", "layer", "by", "at"}}. Raises when the database is down."""
        if not self.pool:
            return {}
        with self.lock:
            if not fresh and time.time() - self.loaded_at < 30:
                return self.cache
            self._schema()
            rows = self.pool.query(
                "SELECT slot, content_type, data, sha256, opacity, fit, layer, updated_by, updated_at::text, params "
                "FROM coder_ui_updates.background"
            )

            def params(text):
                try:
                    value = json.loads(text or "{}")
                    return value if isinstance(value, dict) else {}
                except ValueError:
                    return {}

            self.cache = {
                r[0]: {"type": r[1], "data": r[2], "sha": r[3], "opacity": float(r[4]), "fit": r[5], "layer": r[6],
                       "by": r[7], "at": r[8], "params": params(r[9])}
                for r in rows if r[0] in BG_SLOTS
            }
            self.loaded_at = time.time()
            return self.cache

    def peek(self):
        """The cached copy, refreshed in the background (at most every 30 seconds)."""
        if time.time() - self.loaded_at >= 30 and not self.refreshing and self.pool:
            self.refreshing = True

            def refresh():
                try:
                    self.all(fresh=True)
                except Exception as e:  # noqa: BLE001 - keep the last good copy
                    log(event="background-read-failed", error=str(e)[:200])
                    self.loaded_at = time.time()
                finally:
                    self.refreshing = False

            threading.Thread(target=refresh, daemon=True).start()
        return self.cache

    def put(self, slot, ctype, data, settings, user):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            self.pool.query(
                """INSERT INTO coder_ui_updates.background (slot, content_type, data, sha256, opacity, fit, layer,
                updated_by, updated_at, params) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9) ON CONFLICT (slot)
                DO UPDATE SET content_type = excluded.content_type, data = excluded.data, sha256 = excluded.sha256,
                opacity = excluded.opacity, fit = excluded.fit, layer = excluded.layer, params = excluded.params,
                updated_by = excluded.updated_by, updated_at = now()""",
                [slot, ctype, data, sha, settings["opacity"], settings["fit"], settings["layer"], user,
                 json.dumps(settings["params"])],
            )
            self.loaded_at = 0
        self.all(fresh=True)

    def set_settings(self, slot, settings, user):
        with self.lock:
            self._schema()
            hit = self.pool.query(
                "UPDATE coder_ui_updates.background SET opacity = $2, fit = $3, layer = $4, updated_by = $5, "
                "params = $6, updated_at = now() WHERE slot = $1 RETURNING slot",
                [slot, settings["opacity"], settings["fit"], settings["layer"], user, json.dumps(settings["params"])],
            )
            self.loaded_at = 0
        self.all(fresh=True)
        return bool(hit)

    def reset(self, slot):
        with self.lock:
            self._schema()
            self.pool.query("DELETE FROM coder_ui_updates.background WHERE slot = $1", [slot])
            self.loaded_at = 0
        self.all(fresh=True)


def seed_background_defaults():
    """The install's backgrounds (BACKGROUND_DEFAULTS), set once - in the slots no one has set - and never again (an
    admin's Reset stays reset). Tried again a few times while the database or the image store are not up yet."""
    try:
        wanted = json.loads(BACKGROUND_DEFAULTS) if BACKGROUND_DEFAULTS else {}
    except ValueError:
        log(event="background-defaults-ignored", reason="not JSON")
        return
    if not wanted or not STORE or not BACKGROUNDS:
        return
    for attempt in range(20):
        try:
            if STORE.get_setting("background_defaults_seeded"):
                return
            have = BACKGROUNDS.all(fresh=True)
            for slot, d in wanted.items():
                if slot not in BG_SLOTS or slot in have or not isinstance(d, dict):
                    continue
                ctype, data = parse_background_picture("%s/image-store/%s" % (BASE, d.get("picture", "")))
                settings = {"opacity": float(d.get("opacity", 0.06)), "fit": d.get("fit", "cover"),
                            "layer": d.get("layer", "under"), "params": {}}
                BACKGROUNDS.put(slot, ctype, data, settings, "install defaults")
                log(event="background-default", slot=slot, picture=d.get("picture"))
            STORE.put_setting("background_defaults_seeded", {"at": now()})
            return
        except Exception as e:  # noqa: BLE001 - the database or the image store not up yet: again soon
            if attempt == 19:
                log(event="background-defaults-failed", error=str(e)[:200])
            time.sleep(15)


def background_public(slot, bg):
    """What a page needs to draw it (boot.js, the settings page)."""
    if not bg:
        return None
    if bg["type"] == BG_PICTURE_REF:  # one of the dashboard's own pictures: drawn from Coder itself
        return {"url": background_picture(bg)[0], "opacity": bg["opacity"], "fit": bg["fit"], "layer": bg["layer"],
                "kind": "image", "builtin": True, "params": {}}
    return {"url": "%s/background/%s?v=%s" % (BASE, slot, bg["sha"]), "opacity": bg["opacity"], "fit": bg["fit"],
            "layer": bg["layer"], "kind": "html" if bg["type"] == "text/html" else "image",
            "params": bg.get("params") or {}}


BACKGROUNDS = None


# --------------------------------------------------------------------------- Announcement pictures (Coder's database)
BANNER_PICTURE_TYPES = BG_TYPES  # PNG, JPEG, WebP, GIF (animated too), AVIF; stored exactly as uploaded
BANNER_PICTURE_MAX_BYTES = 8 * 1024 * 1024
BANNER_PICTURE_KEEP = 100  # the newest pictures kept; an older one goes when a new one comes
BANNER_PICTURE_ID = re.compile(r"^[0-9a-f]{16}$")


def parse_banner_picture(data_url):
    """An uploaded picture for the announcement: (content type, bytes), its content checked against its type."""
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in BANNER_PICTURE_TYPES:
        raise ValueError("Upload a PNG, JPEG, GIF, WebP or AVIF picture.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > BANNER_PICTURE_MAX_BYTES:
        raise ValueError("The picture must be smaller than %d MB." % (BANNER_PICTURE_MAX_BYTES // 1048576))
    if image_type(data) != m.group(1):
        raise ValueError("The file is not a valid %s picture." % m.group(1).split("/")[1].upper())
    return m.group(1), data


class BannerPictureStore:
    """Pictures admins upload for the announcement (General > Announcement > Insert picture): rows in
    coder_ui_updates.banner_picture of Coder's own database, each named by its content's hash (the same file twice is
    one picture) and served at /__coder-ui/banner-picture/<id>, publicly (the sign-in page may show the banner) and
    for good (the address never changes what it shows). The newest BANNER_PICTURE_KEEP are kept."""

    def __init__(self, logos):
        self.logos = logos  # shares the logo store's connection to Coder's database
        self.ready = False
        self.lock = threading.Lock()

    @property
    def pool(self):
        return self.logos.pool if self.logos else None

    def _schema(self):
        if self.ready:
            return
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query(
            """CREATE TABLE IF NOT EXISTS coder_ui_updates.banner_picture (
            id text PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, name text NOT NULL,
            created_by text, created_at timestamptz NOT NULL DEFAULT now())"""
        )
        self.ready = True

    def put(self, ctype, data, name, user):
        pid = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            # Uploaded again: it is the newest again, so it is not the next to go.
            self.pool.query(
                """INSERT INTO coder_ui_updates.banner_picture (id, content_type, data, name, created_by)
                VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET created_at = now(), name = excluded.name""",
                [pid, ctype, data, name, user],
            )
            self.pool.query(
                """DELETE FROM coder_ui_updates.banner_picture WHERE id NOT IN (
                SELECT id FROM coder_ui_updates.banner_picture ORDER BY created_at DESC LIMIT $1)""",
                [BANNER_PICTURE_KEEP],
            )
        return pid

    def listing(self):
        """The pictures uploaded for the announcement, newest first, as the image store lists them."""
        with self.lock:
            self._schema()
        rows = self.pool.query(
            "SELECT id, name, content_type, length(data) FROM coder_ui_updates.banner_picture ORDER BY created_at DESC"
        )
        return [{"name": r[1], "type": r[2], "bytes": int(r[3]), "source": "uploaded", "thumb": None,
                 "url": "%s/banner-picture/%s" % (BASE, r[0])} for r in rows]

    def get(self, pid):
        """(content type, bytes) or None."""
        if not BANNER_PICTURE_ID.match(pid or ""):
            return None
        with self.lock:
            self._schema()
        rows = self.pool.query(
            "SELECT content_type, data FROM coder_ui_updates.banner_picture WHERE id = $1", [pid]
        )
        return (rows[0][0], bytes(rows[0][1])) if rows else None


BANNER_PICTURES = None


# --------------------------------------------------------------------------- Template icons (Coder's database)
ICON_MAX_BYTES = (
    1024 * 1024
)  # the dashboard sends a 256 px picture; an animated one keeps its frames
ICON_MAX_COUNT = 500
ICON_TYPES = (
    LOGO_TYPES  # the same formats as the logo, SVG included (served under SVG_CSP)
)
ICON_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
ICON_MANAGER_ROLES = {
    "template-admin"
}  # besides ADMIN_ROLES: who may add and remove icons


def parse_icon(data_url):
    """An uploaded icon: the same checks as the logo, at most ICON_MAX_BYTES."""
    ctype, data = parse_logo(data_url)
    if len(data) > ICON_MAX_BYTES:
        raise ValueError(
            "The icon must be smaller than %d MB." % (ICON_MAX_BYTES // 1048576)
        )
    return ctype, data


class IconStore:
    """Icons uploaded for templates and workspaces (Templates > Icons): one row per name in coder_ui_updates.icon of
    Coder's own database, served at /__coder-ui/icons/<name> so a template can use them like Coder's /icon/ files.
    """

    def __init__(self, logos):
        self.logos = logos  # shares the logo store's connection to Coder's database
        self.ready = False
        self.lock = threading.Lock()

    @property
    def pool(self):
        return self.logos.pool if self.logos else None

    def _schema(self):
        if self.ready:
            return
        self.pool.query("CREATE SCHEMA IF NOT EXISTS coder_ui_updates")
        self.pool.query(
            """CREATE TABLE IF NOT EXISTS coder_ui_updates.icon (
            name text PRIMARY KEY, content_type text NOT NULL, data bytea NOT NULL, sha256 text NOT NULL,
            bytes int NOT NULL, updated_by text, updated_at timestamptz NOT NULL DEFAULT now())"""
        )
        self.ready = True

    def list(self):
        with self.lock:
            self._schema()
            rows = self.pool.query(
                "SELECT name, content_type, sha256, bytes, updated_by, updated_at::text "
                "FROM coder_ui_updates.icon ORDER BY name"
            )
        return [
            {
                "name": r[0],
                "type": r[1],
                "url": "%s/icons/%s?v=%s" % (BASE, r[0], r[2]),
                "bytes": int(r[3]),
                "uploadedBy": r[4],
                "uploadedAt": r[5],
            }
            for r in rows
        ]

    def get(self, name):
        """(content type, data, sha) or None."""
        with self.lock:
            self._schema()
            rows = self.pool.query(
                "SELECT content_type, data, sha256 FROM coder_ui_updates.icon WHERE name = $1",
                [name],
            )
        return (rows[0][0], rows[0][1], rows[0][2]) if rows else None

    def put(self, name, ctype, data, user):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            count = int(
                self.pool.query(
                    "SELECT count(*) FROM coder_ui_updates.icon WHERE name <> $1",
                    [name],
                )[0][0]
            )
            if count >= ICON_MAX_COUNT:
                raise ValueError(
                    "There are already %d icons; delete some first." % ICON_MAX_COUNT
                )
            self.pool.query(
                """INSERT INTO coder_ui_updates.icon (name, content_type, data, sha256, bytes, updated_by, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (name) DO UPDATE SET content_type = excluded.content_type,
                data = excluded.data, sha256 = excluded.sha256, bytes = excluded.bytes, updated_by = excluded.updated_by,
                updated_at = now()""",
                [name, ctype, data, sha, len(data), user],
            )
        return sha

    def delete(self, name):
        with self.lock:
            self._schema()
            return bool(
                self.pool.query(
                    "DELETE FROM coder_ui_updates.icon WHERE name = $1 RETURNING name",
                    [name],
                )
            )


ICONS = None
FAVICONS = TTLCache()

# --------------------------------------------------------------------------- User avatars (Coder's database)

AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}
AVATAR_MAX_BYTES = (
    4 * 1024 * 1024
)  # the dashboard sends a 256 px square; an animated one keeps its frames


def parse_avatar(data_url):
    """The dashboard turns any picture into a 256 px square (an animated one stays animated); only PNG / JPEG / WebP /
    GIF / AVIF are stored, never SVG."""
    m = re.match(r"^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url or "")
    if not m or m.group(1) not in AVATAR_TYPES:
        raise ValueError("Expected a PNG, JPEG, WebP, GIF or AVIF image.")
    data = base64.b64decode(m.group(2))
    if not data or len(data) > AVATAR_MAX_BYTES:
        raise ValueError(
            "The picture must be smaller than %d MB." % (AVATAR_MAX_BYTES // 1048576)
        )
    ctype = m.group(1)
    ok = {
        "image/png": data.startswith(PNG),
        "image/jpeg": data.startswith(JPEG),
        "image/gif": data.startswith(GIF),
        "image/webp": data.startswith(WEBP) and data[8:12] == b"WEBP",
        "image/avif": is_avif(data),
    }[ctype]
    if not ok:
        raise ValueError(
            "The file is not a valid %s image." % ctype.split("/")[1].upper()
        )
    return ctype, data


class AvatarStore:
    """Each user's own avatar picture: one row per Coder user in coder_ui_updates.avatar, in Coder's CloudNativePG
    database (so it is in that database's backups and survives this tool's pods). boot.js hands every page the
    username -> picture URL map, cached here and re-read at most every 30 seconds (never waits for the database).
    """

    def __init__(self, logos):
        self.logos = logos  # shares the logo store's connection pool
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
        self.pool.query(
            """CREATE TABLE IF NOT EXISTS coder_ui_updates.avatar (
            user_id text PRIMARY KEY, username text NOT NULL, content_type text NOT NULL, data bytea NOT NULL,
            sha256 text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())"""
        )
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
                rows = self.pool.query(
                    "SELECT username, user_id, sha256 FROM coder_ui_updates.avatar"
                )
                self.cache = {
                    r[0]: "%s/avatar/%s?v=%s" % (BASE, r[1], r[2]) for r in rows
                }
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
            rows = self.pool.query(
                "SELECT content_type, data FROM coder_ui_updates.avatar WHERE user_id = $1",
                [user_id],
            )
        return (rows[0][0], rows[0][1]) if rows else None

    def put(self, user, ctype, data):
        sha = hashlib.sha256(data).hexdigest()[:16]
        with self.lock:
            self._schema()
            # a username is unique in Coder: a stale row left by a renamed user must not shadow the new owner's name
            self.pool.query(
                "DELETE FROM coder_ui_updates.avatar WHERE username = $1 AND user_id <> $2",
                [user["username"], user["id"]],
            )
            self.pool.query(
                """INSERT INTO coder_ui_updates.avatar (user_id, username, content_type, data, sha256, updated_at)
                VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (user_id) DO UPDATE SET username = excluded.username,
                content_type = excluded.content_type, data = excluded.data, sha256 = excluded.sha256, updated_at = now()""",
                [user["id"], user["username"], ctype, data, sha],
            )
        self._refresh()
        self.default_at = 0  # no longer one of the default avatar's users
        return "%s/avatar/%s?v=%s" % (BASE, user["id"], sha)

    def reset(self, user):
        with self.lock:
            self._schema()
            self.pool.query(
                "DELETE FROM coder_ui_updates.avatar WHERE user_id = $1", [user["id"]]
            )
        self._refresh()
        self.default_at = 0  # they may get the default avatar now

    @staticmethod
    def default_url():
        default = DEFAULTS.get("avatar") if DEFAULTS else None
        return "%s/avatar/default?v=%s" % (BASE, default["sha"]) if default else ""

    def default_users(self):
        """Usernames that get the default avatar: users (not deleted) with no picture at all, neither uploaded here nor
        Coder's own (avatar_url, e.g. from OIDC). Read from Coder's users table (username, avatar_url, deleted: the
        same since Coder's first releases), at most every 30 seconds; only signed-in pages are told.
        """
        if not self.default_url() or not self.pool:
            return []
        if time.time() - self.default_at < 30:
            return self.default_for
        try:
            with self.lock:
                self._schema()
                rows = self.pool.query(
                    """SELECT u.username FROM public.users u WHERE NOT u.deleted
                    AND coalesce(u.avatar_url, '') = '' AND NOT EXISTS (
                        SELECT 1 FROM coder_ui_updates.avatar a WHERE a.user_id = u.id::text) ORDER BY u.username"""
                )
            self.default_for = [r[0] for r in rows]
        except (
            Exception
        ) as e:  # noqa: BLE001 - no default avatars rather than an error on every page
            log(event="avatar-default-users-failed", error=str(e)[:200])
        self.default_at = time.time()
        return self.default_for


AVATARS = None


# --------------------------------------------------------------------------- Monitoring (temporary log database)


class LogStore:
    """Pod log lines of the workspaces being watched, in the temporary Postgres (coder-ui-logs-db). Each stream keeps
    at most LOG_CAP_BYTES: older lines are deleted as new ones arrive, so the browser never holds more than it shows.
    """

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
            self.pool.query(
                """CREATE TABLE IF NOT EXISTS log_lines (seq bigserial PRIMARY KEY, stream text NOT NULL,
                ts text, line text NOT NULL, bytes int NOT NULL)"""
            )
            self.pool.query(
                "CREATE INDEX IF NOT EXISTS log_lines_stream_seq ON log_lines (stream, seq)"
            )
            self.ready = True

    def insert(self, stream, batch):
        self.schema()
        self.pool.query(
            """INSERT INTO log_lines (stream, ts, line, bytes)
            SELECT $1, x->>0, x->>1, (x->>2)::int FROM json_array_elements($2::json) x""",
            [
                stream,
                json.dumps([[ts, line, len(line.encode())] for ts, line in batch]),
            ],
        )

    def trim(self, stream, keep=LOG_CAP_BYTES):
        """Keeps the newest `keep` bytes of the stream; returns the bytes kept."""
        rows = self.pool.query(
            """SELECT seq FROM (SELECT seq, SUM(bytes) OVER (ORDER BY seq DESC) AS kept
            FROM log_lines WHERE stream = $1) x WHERE kept > $2 ORDER BY seq DESC LIMIT 1""",
            [stream, max(0, keep)],
        )
        if rows:
            self.pool.query(
                "DELETE FROM log_lines WHERE stream = $1 AND seq <= $2",
                [stream, rows[0][0]],
            )
        return int(
            self.pool.query(
                "SELECT COALESCE(SUM(bytes), 0) FROM log_lines WHERE stream = $1",
                [stream],
            )[0][0]
        )

    def read(self, stream, after, limit=2000):
        self.schema()
        if (
            after <= 0
        ):  # first look: only the newest lines, the browser does not need the whole 5 MB
            rows = self.pool.query(
                """SELECT seq, ts, line FROM (SELECT seq, ts, line FROM log_lines WHERE stream = $1
                ORDER BY seq DESC LIMIT 500) x ORDER BY seq""",
                [stream],
            )
        else:
            rows = self.pool.query(
                "SELECT seq, ts, line FROM log_lines WHERE stream = $1 AND seq > $2 ORDER BY seq LIMIT $3",
                [stream, after, limit],
            )
        return [[int(r[0]), r[1], r[2]] for r in rows]

    def stats(self, stream):
        self.schema()
        r = self.pool.query(
            "SELECT COUNT(*), COALESCE(SUM(bytes), 0), COALESCE(MAX(ts), '') FROM log_lines WHERE stream = $1",
            [stream],
        )[0]
        return int(r[0]), int(r[1]), r[2]


def norm_ts(ts):
    """Kubernetes log timestamps drop trailing zeros (…49.9Z, …49.91Z): pad to nanoseconds so they sort as text."""
    if not ts.endswith("Z"):
        return ts
    base, _, frac = ts[:-1].partition(".")
    return "%s.%sZ" % (base, (frac or "0").ljust(9, "0")[:9])


class Follower(threading.Thread):
    """Streams one pod container's log (Kubernetes API, follow=true) into the LogStore until nobody has looked for
    IDLE_STOP seconds or the pod is gone. Reconnects (from the last timestamp) when the stream breaks.
    """

    IDLE_STOP = 120

    def __init__(self, logs, ns, pod, container, stream):
        super().__init__(daemon=True)
        self.logs, self.ns, self.pod, self.container, self.stream_id = (
            logs,
            ns,
            pod,
            container,
            stream,
        )
        self.last_poll = time.time()
        self.state = "starting"
        self.error = None

    def _write(self, batch, stored):
        """Makes room first (the oldest lines go), then inserts: the stream never holds more than the cap, not even
        between the two steps."""
        sizes = [len(t.encode()) for _, t in batch]
        size = sum(sizes)
        while (
            size > LOG_CAP_BYTES and batch
        ):  # one batch bigger than the whole cap: keep its newest lines
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
                q["sinceTime"] = (
                    last_ts[:19] + "Z"
                )  # whole seconds, inclusive: already-stored lines are skipped below
            else:
                q["tailLines"] = "5000"
            try:
                res = KUBE.stream(
                    "/api/v1/namespaces/%s/pods/%s/log?%s"
                    % (self.ns, self.pod, urllib.parse.urlencode(q))
                )
            except urllib.error.HTTPError as e:
                self.state, self.error = (
                    ("gone", "The pod no longer exists.")
                    if e.code == 404
                    else ("error", "Kubernetes: HTTP %s" % e.code)
                )
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
            except (
                Exception
            ) as e:  # noqa: BLE001 - timeouts and broken streams: reconnect
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
        status, lst = KUBE.call(
            "GET",
            "/api/v1/namespaces/%s/pods?labelSelector=%s"
            % (WORKSPACE_NAMESPACE, urllib.parse.quote(sel)),
        )
        if status != 200:
            raise RuntimeError(
                "Kubernetes pods in %s: HTTP %s" % (WORKSPACE_NAMESPACE, status)
            )
        return lst.get("items") or []

    def overview(self, token):
        users = active_users(token)
        status, ws = http_json(
            CODER_URL
            + "/api/v2/workspaces?"
            + urllib.parse.urlencode({"q": "status:running", "limit": 1000}),
            headers={"Coder-Session-Token": token},
        )
        if status != 200:
            raise RuntimeError("Coder workspaces API: HTTP %s" % status)
        pods = {}
        try:
            for pod in self.pods():
                wid = ((pod.get("metadata") or {}).get("labels") or {}).get(
                    "com.coder.workspace.id"
                )
                if wid and (pod.get("status") or {}).get("phase") == "Running":
                    pods[wid] = pod["metadata"]["name"]
        except RuntimeError as e:
            log(event="monitoring-pods-failed", error=str(e))
        by_user = {}
        for w in ws.get("workspaces") or []:
            build = w.get("latest_build") or {}
            agents = [
                {
                    "name": a.get("name"),
                    "status": a.get("status"),
                    "lifecycle": a.get("lifecycle_state"),
                    "health": (a.get("health") or {}).get("healthy"),
                }
                for r in build.get("resources") or []
                for a in r.get("agents") or []
            ]
            by_user.setdefault(w.get("owner_id"), []).append(
                {
                    "workspaceId": w.get("id"),
                    "name": w.get("name"),
                    "owner": w.get("owner_name"),
                    "template": w.get("template_display_name")
                    or w.get("template_name"),
                    "startedAt": build.get("updated_at"),
                    "agents": agents,
                    "healthy": (w.get("health") or {}).get("healthy", True),
                    "pod": pods.get(w.get("id")),
                    "watching": any(
                        f.is_alive()
                        for k, f in self.followers.items()
                        if k.startswith((pods.get(w.get("id")) or "-") + "/")
                    ),
                }
            )
        return {
            "namespace": WORKSPACE_NAMESPACE,
            "capBytes": LOG_CAP_BYTES,
            "users": [
                {"user": u, "instances": by_user.get(u["id"], [])} for u in users
            ],
        }

    def lines(self, workspace_id, after):
        pods = [
            p
            for p in self.pods(workspace_id)
            if (p.get("status") or {}).get("phase") == "Running"
        ]
        if not pods:
            raise LookupError(
                "This workspace has no running pod in namespace %s."
                % WORKSPACE_NAMESPACE
            )
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
        return {
            "pod": name,
            "container": container,
            "state": f.state,
            "error": f.error,
            "lines": rows,
            "stored": {"lines": count, "bytes": size, "capBytes": LOG_CAP_BYTES},
        }


MONITOR = None

# --------------------------------------------------------------------------- Network (General > Network map)

QUANTITY_SUFFIX = {
    "n": 1e-9,
    "u": 1e-6,
    "m": 1e-3,
    "": 1,
    "k": 1e3,
    "K": 1e3,
    "M": 1e6,
    "G": 1e9,
    "T": 1e12,
    "P": 1e15,
    "Ki": 2**10,
    "Mi": 2**20,
    "Gi": 2**30,
    "Ti": 2**40,
    "Pi": 2**50,
    "E": 1e18,
    "Ei": 2**60,
}


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
    meta, spec, st = (
        pod.get("metadata") or {},
        pod.get("spec") or {},
        pod.get("status") or {},
    )
    containers = st.get("containerStatuses") or []
    return {
        "name": meta.get("name"),
        "namespace": meta.get("namespace"),
        "node": spec.get("nodeName"),
        "podIP": st.get("podIP"),
        "hostIP": st.get("hostIP"),
        "phase": st.get("phase"),
        "ready": bool(containers) and all(c.get("ready") for c in containers),
        "restarts": sum(c.get("restartCount") or 0 for c in containers),
        "started": st.get("startTime"),
    }


def coder_role(pod):
    """What a pod in Coder's namespace is, for the map's legend."""
    labels = (pod.get("metadata") or {}).get("labels") or {}
    if labels.get("com.coder.workspace.id"):
        return "workspace"
    if labels.get("cnpg.io/cluster"):
        return "database"
    if labels.get("app.kubernetes.io/instance") == CODER_RELEASE and labels.get(
        "app.kubernetes.io/name"
    ) in ("coder", None):
        return "coder"
    return "add-on"


def cluster_snapshot():
    """Nodes, running pods, node metrics (None without metrics-server) and the version, read cluster-wide through the
    ClusterRole; shared by the Network map and the Admin menu's resource bars, cached for 3 seconds.
    """
    hit = CACHE.get("network")
    if hit is None:
        status, nodes = KUBE.call("GET", "/api/v1/nodes")
        if status != 200:
            raise RuntimeError(
                "Kubernetes nodes: HTTP %s (the service needs its ClusterRole coder-ui-updates-%s)"
                % (status, CODER_NAMESPACE)
            )
        status, pods = KUBE.call(
            "GET",
            "/api/v1/pods?fieldSelector="
            + urllib.parse.quote("status.phase!=Succeeded,status.phase!=Failed"),
        )
        pods = (
            (pods.get("items") or [])
            if status == 200 and isinstance(pods, dict)
            else []
        )
        status, usage = KUBE.call("GET", "/apis/metrics.k8s.io/v1beta1/nodes")
        usage = (
            {
                (u.get("metadata") or {}).get("name"): u.get("usage") or {}
                for u in (usage.get("items") or [])
            }
            if status == 200 and isinstance(usage, dict)
            else None
        )
        status, version = KUBE.call("GET", "/version")
        hit = {
            "nodes": nodes.get("items") or [],
            "pods": pods,
            "usage": usage,
            "version": (
                version.get("gitVersion")
                if status == 200 and isinstance(version, dict)
                else None
            ),
        }
        CACHE.put("network", hit, 3)
    return hit


def cluster_usage():
    """The cluster's CPU (cores) and memory (bytes) at a glance, over the Ready nodes: allocatable (what pods may use),
    in use (live, from metrics-server; else what is requested), requested (reserved by running pods' requests) and free
    (allocatable - requested: what new workspaces can still be given)."""
    hit = cluster_snapshot()
    ready = {
        (n.get("metadata") or {}).get("name"): n
        for n in hit["nodes"]
        if any(
            c.get("type") == "Ready" and c.get("status") == "True"
            for c in (n.get("status") or {}).get("conditions") or []
        )
    }
    out = {}
    for res in ("cpu", "memory"):
        total = sum(
            quantity(((n.get("status") or {}).get("allocatable") or {}).get(res)) or 0
            for n in ready.values()
        )
        requested = 0.0
        for pod in hit["pods"]:
            if (pod.get("spec") or {}).get("nodeName") in ready:
                for c in (pod.get("spec") or {}).get("containers") or []:
                    requested += (
                        quantity(
                            ((c.get("resources") or {}).get("requests") or {}).get(res)
                        )
                        or 0
                    )
        used = (
            sum(
                quantity((hit["usage"].get(name) or {}).get(res)) or 0 for name in ready
            )
            if hit["usage"] is not None
            else requested
        )
        out[res] = {
            "total": total,
            "used": used,
            "requested": requested,
            "free": max(total - requested, 0.0),
        }
    return {
        **out,
        "nodes": len(ready),
        "live": hit["usage"] is not None,
        "generatedAt": now(),
    }


def network_report(token):
    """Nodes, their addresses, capacity and live usage, and which Coder pods and workspaces run on each."""
    hit = cluster_snapshot()

    status, ws = http_json(
        CODER_URL
        + "/api/v2/workspaces?"
        + urllib.parse.urlencode({"q": "status:running", "limit": 1000}),
        headers={"Coder-Session-Token": token},
    )
    workspaces = (
        (ws.get("workspaces") or []) if status == 200 and isinstance(ws, dict) else []
    )

    per_node = {}
    for pod in hit["pods"]:
        node = (pod.get("spec") or {}).get("nodeName")
        if not node:
            continue
        acc = per_node.setdefault(
            node, {"pods": 0, "cpu": 0.0, "memory": 0.0, "namespaces": {}}
        )
        acc["pods"] += 1
        ns = (pod.get("metadata") or {}).get("namespace") or ""
        acc["namespaces"][ns] = acc["namespaces"].get(ns, 0) + 1
        for c in (pod.get("spec") or {}).get("containers") or []:
            req = (c.get("resources") or {}).get("requests") or {}
            acc["cpu"] += quantity(req.get("cpu")) or 0
            acc["memory"] += quantity(req.get("memory")) or 0

    out_nodes = []
    for n in hit["nodes"]:
        meta, spec, st = (
            n.get("metadata") or {},
            n.get("spec") or {},
            n.get("status") or {},
        )
        labels, info = meta.get("labels") or {}, st.get("nodeInfo") or {}
        addresses = {}
        for a in st.get("addresses") or []:
            addresses.setdefault(a.get("type"), []).append(a.get("address"))
        conditions = st.get("conditions") or []
        ready = next((c for c in conditions if c.get("type") == "Ready"), {})
        u = (hit["usage"] or {}).get(meta.get("name"))
        acc = per_node.get(
            meta.get("name"), {"pods": 0, "cpu": 0.0, "memory": 0.0, "namespaces": {}}
        )
        res = lambda d: {
            "cpu": quantity((d or {}).get("cpu")),
            "memory": quantity((d or {}).get("memory")),  # noqa: E731
            "pods": quantity((d or {}).get("pods")),
            "storage": quantity((d or {}).get("ephemeral-storage")),
        }
        out_nodes.append(
            {
                "name": meta.get("name"),
                "created": meta.get("creationTimestamp"),
                "roles": sorted(
                    k.split("/", 1)[1]
                    for k in labels
                    if k.startswith("node-role.kubernetes.io/") and "/" in k
                )
                or ["worker"],
                "zone": labels.get("topology.kubernetes.io/zone"),
                "region": labels.get("topology.kubernetes.io/region"),
                "instanceType": labels.get("node.kubernetes.io/instance-type"),
                "ready": ready.get("status") == "True",
                "readySince": ready.get("lastTransitionTime"),
                "unschedulable": bool(spec.get("unschedulable")),
                "pressure": [
                    c.get("type")
                    for c in conditions
                    if c.get("type") != "Ready" and c.get("status") == "True"
                ],
                "taints": [
                    "%s%s:%s"
                    % (
                        t.get("key"),
                        "=" + t["value"] if t.get("value") else "",
                        t.get("effect"),
                    )
                    for t in spec.get("taints") or []
                ],
                "addresses": addresses,
                "podCIDRs": spec.get("podCIDRs")
                or ([spec["podCIDR"]] if spec.get("podCIDR") else []),
                "kubelet": info.get("kubeletVersion"),
                "os": info.get("osImage"),
                "kernel": info.get("kernelVersion"),
                "runtime": info.get("containerRuntimeVersion"),
                "arch": info.get("architecture"),
                "capacity": res(st.get("capacity")),
                "allocatable": res(st.get("allocatable")),
                "usage": (
                    {"cpu": quantity(u.get("cpu")), "memory": quantity(u.get("memory"))}
                    if u
                    else None
                ),
                "requests": {"cpu": acc["cpu"], "memory": acc["memory"]},
                "podCount": acc["pods"],
                "namespaces": dict(
                    sorted(acc["namespaces"].items(), key=lambda kv: -kv[1])
                ),
            }
        )

    # Coder's own pods (server, database, add-ons), the platform's pods elsewhere (Traefik, ...) and the workspace pods,
    # matched to Coder's workspaces; each with its kind (clusternet.py: one colour per kind in the dashboard).
    by_ws = {}
    coder = []
    for pod in hit["pods"]:
        meta = pod.get("metadata") or {}
        wid = (meta.get("labels") or {}).get("com.coder.workspace.id")
        if wid:
            by_ws.setdefault(wid, pod)
        elif clusternet.on_map(pod):
            coder.append({**pod_brief(pod), "role": coder_role(pod), **clusternet.map_extras(pod)})
    out_ws, unplaced = [], []
    for w in workspaces:
        build = w.get("latest_build") or {}
        agents = []
        for r in build.get("resources") or []:
            for a in r.get("agents") or []:
                lat = [
                    v.get("latency_ms")
                    for v in (a.get("latency") or {}).values()
                    if isinstance(v, dict) and v.get("preferred")
                ]
                agents.append(
                    {
                        "name": a.get("name"),
                        "status": a.get("status"),
                        "lifecycle": a.get("lifecycle_state"),
                        "version": a.get("version"),
                        "os": a.get("operating_system"),
                        "arch": a.get("architecture"),
                        "latencyMs": lat[0] if lat else None,
                    }
                )
        entry = {
            "id": w.get("id"),
            "name": w.get("name"),
            "owner": w.get("owner_name"),
            "template": w.get("template_display_name") or w.get("template_name"),
            "healthy": (w.get("health") or {}).get("healthy", True),
            "agents": agents,
        }
        pod = by_ws.pop(w.get("id"), None)
        if pod:
            out_ws.append({**entry, **{"pod": {**pod_brief(pod), **clusternet.map_extras(pod)}}})
        else:
            unplaced.append(entry)
    # Workspace pods Coder does not list as running (stopping, orphaned, or the API could not be read): still on the map,
    # named from the labels Coder's templates put on them.
    for wid, pod in by_ws.items():
        labels = (pod.get("metadata") or {}).get("labels") or {}
        out_ws.append(
            {
                "id": wid,
                "name": labels.get("com.coder.workspace.name") or wid[:8],
                "owner": labels.get("com.coder.user.username") or "?",
                "template": None,
                "healthy": None,
                "agents": [],
                "orphan": True,
                "pod": {**pod_brief(pod), **clusternet.map_extras(pod)},
            }
        )
    try:
        services = clusternet.services_report(hit["pods"])
    except Exception as e:  # noqa: BLE001 - the map without its Services
        services = {"services": [], "error": str(e)[:300]}
    return {
        "generatedAt": now(),
        "kubernetesVersion": hit["version"],
        "accessUrl": CODER_ACCESS_URL,
        "metrics": hit["usage"] is not None,
        "coderNamespace": CODER_NAMESPACE,
        "nodes": sorted(out_nodes, key=lambda n: n["name"] or ""),
        "coder": sorted(coder, key=lambda p: (p["role"], p["name"] or "")),
        "workspaces": sorted(
            out_ws,
            key=lambda w: ((w["owner"] or "").lower(), (w["name"] or "").lower()),
        ),
        "unplaced": unplaced,
        "workspacesApi": status == 200,
        "services": services["services"],
        "servicesError": services["error"],
    }


# --------------------------------------------------------------------------- Persistence (Coder's database)


CNPG_API = "/apis/postgresql.cnpg.io/v1"
PG_IMAGE = os.environ.get(
    "PG_IMAGE", ""
)  # the image a Cluster created here runs (air-gapped registries); "" = the operator's
PERSISTENCE_FIXES = ("cnpg.cluster", "cnpg.instances", "cnpg.storage", "cnpg.backup")
DEFAULT_PG_SETTINGS = {
    "clusterName": os.environ.get("CODER_DB_CLUSTER") or "coder-db",
    "instances": 3,
    "storageSize": "10Gi",
    "storageClass": "",
    "snapshotClass": "",
    "backupSchedule": "0 0 2 * * *",
}
NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9]{0,48}[a-z0-9])?$")
CRON6_RE = re.compile(r"^\S+( \S+){5}$")  # CloudNativePG schedules have a seconds field
STORAGE_HIGH = 0.8  # warn when the database fills this share of its volume

# Hosted PostgreSQL recognised from the host name: (suffix or fragment, provider).
CLOUD_DB_HOSTS = (
    (".rds.amazonaws.com", "Amazon RDS"),
    (".postgres.database.azure.com", "Azure Database for PostgreSQL"),
    (".postgres.cosmos.azure.com", "Azure Cosmos DB for PostgreSQL"),
    (".cloudsql", "Google Cloud SQL"),
    (".alloydb", "Google AlloyDB"),
    (".neon.tech", "Neon"),
    (".supabase.co", "Supabase"),
    (".crunchybridge.com", "Crunchy Bridge"),
    (".aivencloud.com", "Aiven"),
    (".db.ondigitalocean.com", "DigitalOcean Managed PostgreSQL"),
)

# What a StorageClass's provisioner means for the data: (fragment, label, kind). First match wins.
STORAGE_PROVISIONERS = (
    ("ebs.csi.aws.com", "AWS EBS", "cloud"),
    ("kubernetes.io/aws-ebs", "AWS EBS", "cloud"),
    ("efs.csi.aws.com", "AWS EFS", "cloud"),
    ("disk.csi.azure.com", "Azure Disk", "cloud"),
    ("kubernetes.io/azure-disk", "Azure Disk", "cloud"),
    ("file.csi.azure.com", "Azure Files", "cloud"),
    ("pd.csi.storage.gke.io", "Google Persistent Disk", "cloud"),
    ("kubernetes.io/gce-pd", "Google Persistent Disk", "cloud"),
    ("csi.vsphere.vmware.com", "vSphere CNS", "network"),
    ("driver.longhorn.io", "Longhorn", "network"),
    ("rbd.csi.ceph.com", "Ceph RBD", "network"),
    ("cephfs.csi.ceph.com", "CephFS", "network"),
    ("portworx", "Portworx", "network"),
    ("openebs.io/local", "OpenEBS LocalPV", "local"),
    ("rancher.io/local-path", "local-path", "local"),
    ("topolvm", "TopoLVM", "local"),
    ("kubernetes.io/no-provisioner", "local volumes", "local"),
    ("hostpath", "host path", "local"),
    ("openebs.io", "OpenEBS", "network"),
    ("nfs", "NFS", "network"),
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
        found.append(
            {
                "name": meta.get("name"),
                "provisioner": sc.get("provisioner"),
                "label": label,
                "kind": kind,
                "isDefault": "true"
                in (
                    ann.get("storageclass.kubernetes.io/is-default-class"),
                    ann.get("storageclass.beta.kubernetes.io/is-default-class"),
                ),
                "allowExpansion": bool(sc.get("allowVolumeExpansion")),
                "reclaimPolicy": sc.get("reclaimPolicy"),
                "bindingMode": sc.get("volumeBindingMode"),
            }
        )
    return sorted(found, key=lambda s: (not s["isDefault"], s["name"] or ""))


def snapshot_classes():
    status, out = KUBE.call(
        "GET", "/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses"
    )
    items = (out.get("items") or []) if status == 200 and isinstance(out, dict) else []
    return sorted(
        n for n in ((c.get("metadata") or {}).get("name") for c in items) if n
    )


def cnpg_operator():
    """Whether CloudNativePG is installed: its CRD, and its Deployment (any namespace) for the version and readiness."""
    status, _ = KUBE.call(
        "GET",
        "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/clusters.postgresql.cnpg.io",
    )
    found = {
        "installed": status == 200,
        "crd": status == 200,
        "namespace": None,
        "version": None,
        "ready": None,
    }
    status, deps = KUBE.call(
        "GET",
        "/apis/apps/v1/deployments?labelSelector="
        + urllib.parse.quote("app.kubernetes.io/name=cloudnative-pg"),
    )
    items = (
        (deps.get("items") or []) if status == 200 and isinstance(deps, dict) else []
    )
    if items:
        d = items[0]
        image = (
            (((d.get("spec") or {}).get("template") or {}).get("spec") or {}).get(
                "containers"
            )
            or [{}]
        )[0].get("image") or ""
        tag = image.rsplit("/", 1)[-1].split("@")[0]
        found.update(
            {
                "installed": True,
                "namespace": (d.get("metadata") or {}).get("namespace"),
                "version": tag.split(":", 1)[1] if ":" in tag else None,
                "ready": ((d.get("status") or {}).get("readyReplicas") or 0) >= 1,
            }
        )
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
        out.update(
            {
                "host": u.hostname,
                "port": port or 5432,
                "database": (u.path or "/")[1:] or None,
                "user": urllib.parse.unquote(u.username) if u.username else None,
                "sslMode": (q.get("sslmode") or [None])[0],
            }
        )
        return out
    kv = dict(m.groups() for m in re.finditer(r"(\w+)\s*=\s*('[^']*'|\S+)", uri))
    kv = {k: v.strip("'") for k, v in kv.items()}
    port = kv.get("port")
    out.update(
        {
            "host": kv.get("host"),
            "port": int(port) if port and port.isdigit() else 5432,
            "database": kv.get("dbname"),
            "user": kv.get("user"),
            "sslMode": kv.get("sslmode"),
        }
    )
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
        return None  # an outside host (a cloud database) is not a CloudNativePG cluster, whatever its Secret is called
    ns = parts[1] if len(parts) >= 2 else CODER_NAMESPACE
    names = []
    m = re.match(r"^(.*)-(rw|ro|r)$", parts[0])
    if m:
        names.append(m.group(1))
    if (conn.get("secret") or "").endswith(("-app", "-superuser")):
        names.append(conn["secret"].rsplit("-", 1)[0])
    for name in dict.fromkeys(names):
        status, c = KUBE.call(
            "GET", "%s/namespaces/%s/clusters/%s" % (CNPG_API, ns, name)
        )
        if status == 200 and isinstance(c, dict):
            return c
    return None


def cnpg_list(ns, kind, cluster=None):
    status, out = KUBE.call("GET", "%s/namespaces/%s/%s" % (CNPG_API, ns, kind))
    items = (out.get("items") or []) if status == 200 and isinstance(out, dict) else []
    if cluster is None:
        return items
    return [
        i
        for i in items
        if (((i.get("spec") or {}).get("cluster") or {}).get("name")) == cluster
    ]


def database_stats():
    """Size, connections and replication of Coder's database, read through the service's own connection to it."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    try:
        row = pool.query(
            "select pg_database_size(current_database()), (select count(*) from pg_stat_activity), "
            "current_setting('max_connections'), current_setting('server_version'), "
            "pg_postmaster_start_time()::text"
        )[0]
    except Exception as e:  # noqa: BLE001
        log(event="persistence-db-stats-failed", error=str(e)[:200])
        return None
    num = lambda v: float(v) if v not in (None, "") else None  # noqa: E731
    replication = []
    try:  # rows are visible to the monitoring role; an ordinary user sees them with the positions left out
        for r in pool.query(
            "select application_name, state, sync_state, "
            "pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) from pg_stat_replication"
        ):
            replication.append(
                {"name": r[0], "state": r[1], "syncState": r[2], "lagBytes": num(r[3])}
            )
    except Exception as e:  # noqa: BLE001
        log(event="persistence-replication-failed", error=str(e)[:200])
    return {
        "sizeBytes": num(row[0]),
        "connections": int(row[1]) if row[1] is not None else None,
        "maxConnections": int(row[2]) if row[2] else None,
        "version": row[3],
        "startedAt": row[4],
        "replication": replication,
    }


def managed_by(obj):
    meta = obj.get("metadata") or {}
    labels, ann = meta.get("labels") or {}, meta.get("annotations") or {}
    if ann.get("argocd.argoproj.io/tracking-id") or labels.get(
        "argocd.argoproj.io/instance"
    ):
        return "Argo CD (%s)" % (
            ann.get("argocd.argoproj.io/tracking-id", "").split(":", 1)[0]
            or labels.get("argocd.argoproj.io/instance")
        )
    if labels.get("app.kubernetes.io/managed-by") == "Helm":
        return "Helm release %s" % (
            ann.get("meta.helm.sh/release-name")
            or labels.get("app.kubernetes.io/instance")
            or "?"
        )
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
    status, pvcs = KUBE.call(
        "GET", "/api/v1/namespaces/%s/persistentvolumeclaims%s" % (ns, selector)
    )
    pvcs = {
        (p.get("metadata") or {}).get("name"): p
        for p in (
            (pvcs.get("items") or [])
            if status == 200 and isinstance(pvcs, dict)
            else []
        )
    }
    zones = {}
    try:
        zones = {
            (n.get("metadata") or {})
            .get("name"): ((n.get("metadata") or {}).get("labels") or {})
            .get("topology.kubernetes.io/zone")
            for n in cluster_snapshot()["nodes"]
        }
    except RuntimeError:
        pass
    lag = {r["name"]: r for r in replication or []}

    def volume(pvc):
        if not pvc:
            return None
        spec, pst = pvc.get("spec") or {}, pvc.get("status") or {}
        return {
            "name": (pvc.get("metadata") or {}).get("name"),
            "storageClass": spec.get("storageClassName"),
            "capacityBytes": quantity((pst.get("capacity") or {}).get("storage")),
            "requestedBytes": quantity(
                ((spec.get("resources") or {}).get("requests") or {}).get("storage")
            ),
            "phase": pst.get("phase"),
        }

    out = []
    for pod in pods:
        labels = (pod.get("metadata") or {}).get("labels") or {}
        if labels.get("cnpg.io/podRole") not in (None, "instance"):
            continue  # jobs (initdb, join) share the label
        brief = pod_brief(pod)
        role = labels.get("cnpg.io/instanceRole") or labels.get("role") or ""
        primary = role == "primary" or brief["name"] == st.get("currentPrimary")
        rep = lag.get(brief["name"]) or {}
        out.append(
            {
                **brief,
                "role": "primary" if primary else "replica",
                "zone": zones.get(brief["node"]),
                "pvc": volume(pvcs.get(brief["name"])),
                "walPvc": volume(pvcs.get(brief["name"] + "-wal")),
                "lagBytes": None if primary else rep.get("lagBytes"),
                "replicationState": None if primary else rep.get("state"),
                "syncState": None if primary else rep.get("syncState"),
            }
        )
    return sorted(out, key=lambda i: (i["role"] != "primary", i["name"] or ""))


def suggested_settings(cluster, classes, snaps):
    s = dict(DEFAULT_PG_SETTINGS)
    default_class = next((c["name"] for c in classes if c["isDefault"]), "")
    s.update(
        {"storageClass": default_class, "snapshotClass": snaps[0] if snaps else ""}
    )
    if cluster:
        spec = cluster.get("spec") or {}
        storage = spec.get("storage") or {}
        instances = int(
            spec.get("instances") or 1
        )  # a single instance is the one to change; replicas are kept as they are
        s.update(
            {
                "clusterName": (cluster.get("metadata") or {}).get("name"),
                "instances": instances if instances >= 2 else 3,
                "storageSize": storage.get("size") or s["storageSize"],
                "storageClass": storage.get("storageClass") or default_class,
                "snapshotClass": (
                    ((spec.get("backup") or {}).get("volumeSnapshot") or {}).get(
                        "className"
                    )
                )
                or s["snapshotClass"],
            }
        )
    return s


def persistence_report(token):
    checks, facts = [], {}
    status, dep = KUBE.call(
        "GET",
        "/apis/apps/v1/namespaces/%s/deployments/%s"
        % (CODER_NAMESPACE, CODER_DEPLOYMENT),
    )
    env = container_env(dep) if status == 200 else {}
    conn = coder_db_connection(env)
    operator = cnpg_operator()
    classes, snaps = storage_classes(), snapshot_classes()
    cluster = coder_cnpg_cluster(conn) if operator["crd"] else None
    stats = database_stats()
    host = conn.get("host") or ""
    provider = next((p for frag, p in CLOUD_DB_HOSTS if frag in host), None)
    mode = "cloudnative-pg" if cluster else ("external" if host else "unknown")
    facts.update(
        {
            "coderDatabase": conn,
            "operator": operator,
            "storageClasses": classes,
            "snapshotClasses": snaps,
            "database": stats,
            "cluster": None,
            "instances": [],
            "backups": None,
            "otherClusters": [],
            "provider": (
                "CloudNativePG"
                if cluster
                else (provider or ("PostgreSQL" if host else None))
            ),
        }
    )

    # Database
    if host:
        check(
            checks,
            "db.connection",
            "Database",
            "Coder's database",
            "ok",
            current="%s:%s/%s"
            % (host, conn.get("port") or 5432, conn.get("database") or "?"),
            detail="Coder connects as %s, TLS %s. Read from %s."
            % (
                conn.get("user") or "?",
                conn.get("sslMode") or "default (prefer)",
                conn.get("source"),
            ),
        )
    elif conn.get("source") == "Coder's built-in PostgreSQL":
        check(
            checks,
            "db.connection",
            "Database",
            "Coder's database",
            "error",
            current="Coder's built-in PostgreSQL",
            expected="a PostgreSQL cluster",
            detail="The built-in database lives inside the Coder pod and has no replicas or backups. "
            "Create a CloudNativePG cluster below, move Coder's data to it, and point CODER_PG_CONNECTION_URL at its <name>-app Secret.",
        )
    else:
        check(
            checks,
            "db.connection",
            "Database",
            "Coder's database",
            "unknown",
            detail="CODER_PG_CONNECTION_URL could not be read (Coder's Deployment, or the Secret it names, is not readable here).",
        )
    if stats:
        check(
            checks,
            "db.reachable",
            "Database",
            "Database answers",
            "ok",
            current="PostgreSQL %s, %s of %s connections in use"
            % (stats["version"], stats["connections"], stats["maxConnections"]),
        )
    elif LOGOS and LOGOS.pool:
        check(
            checks,
            "db.reachable",
            "Database",
            "Database answers",
            "error",
            detail="This service could not query Coder's database.",
        )
    if provider and not cluster:
        check(
            checks,
            "db.provider",
            "Database",
            "Managed by a cloud provider",
            "info",
            current=provider,
            detail="High availability, storage and backups are configured with %s, not in this cluster. "
            "Check there that Multi-AZ (or zone-redundant HA) and automated backups are on."
            % provider,
        )

    # Operator
    if cluster or not provider:
        if operator["installed"]:
            check(
                checks,
                "cnpg.operator",
                "Operator",
                "CloudNativePG operator",
                "ok" if operator["ready"] is not False else "error",
                current="CloudNativePG %s in %s%s"
                % (
                    operator["version"] or "",
                    operator["namespace"] or "the cluster",
                    "" if operator["ready"] is not False else " (not ready)",
                ),
                detail=(
                    ""
                    if operator["ready"] is not False
                    else "The operator's Deployment has no ready pod; database changes and fail-over wait for it."
                ),
            )
        else:
            check(
                checks,
                "cnpg.operator",
                "Operator",
                "CloudNativePG operator",
                "error",
                current="not installed",
                expected="CloudNativePG in cnpg-system",
                fix="cnpg.operator",
                detail="The operator runs PostgreSQL clusters in Kubernetes: replicas, automatic fail-over, volume management and "
                "backups. Install it once (see Set up the operator), then create Coder's cluster here.",
            )

    if not cluster:
        if operator["crd"]:
            facts["otherClusters"] = [
                (c.get("metadata") or {}).get("name")
                for c in cnpg_list(CODER_NAMESPACE, "clusters")
            ]
        if operator["installed"] and not provider:
            check(
                checks,
                "cnpg.cluster",
                "High availability",
                "A PostgreSQL cluster for Coder",
                "warn",
                current="Coder does not use a CloudNativePG cluster",
                expected="a %d-instance cluster" % DEFAULT_PG_SETTINGS["instances"],
                fix="cnpg.cluster",
                detail="Creating the cluster does not move Coder: copy the data over (pg_dump / pg_restore) and point "
                "CODER_PG_CONNECTION_URL at the new <name>-app Secret, then restart Coder.",
            )
        facts["settings"] = suggested_settings(None, classes, snaps)
        return {"generatedAt": now(), "mode": mode, "checks": checks, "facts": facts}

    # The cluster Coder uses
    meta, spec, st = (
        cluster.get("metadata") or {},
        cluster.get("spec") or {},
        cluster.get("status") or {},
    )
    storage = spec.get("storage") or {}
    backup_spec = spec.get("backup") or {}
    instances = cluster_instances(cluster, (stats or {}).get("replication"))
    owner = managed_by(cluster)
    facts["cluster"] = {
        "name": meta.get("name"),
        "namespace": meta.get("namespace"),
        "phase": st.get("phase"),
        "instances": int(spec.get("instances") or 1),
        "readyInstances": int(st.get("readyInstances") or 0),
        "primary": st.get("currentPrimary"),
        "image": st.get("image") or spec.get("imageName"),
        "storageSize": storage.get("size"),
        "storageClass": storage.get("storageClass"),
        "walStorageSize": (spec.get("walStorage") or {}).get("size"),
        "managedBy": owner,
        "created": meta.get("creationTimestamp"),
    }
    facts["instances"] = instances
    n, ready = facts["cluster"]["instances"], facts["cluster"]["readyInstances"]

    # High availability
    if owner and owner != "General > Persistence":
        check(
            checks,
            "cnpg.owner",
            "High availability",
            "Where the cluster's settings live",
            "info",
            current=owner,
            detail="Changes made here are applied to the Cluster directly. Make the same change where it is deployed from "
            "(postgres.instances / postgres.storage.size in the coder-platform values) or the next deploy undoes it.",
        )
    if n >= 2:
        check(
            checks,
            "cnpg.instances",
            "High availability",
            "Replicas for automatic fail-over",
            "ok",
            current="%d instances (1 primary, %d %s)"
            % (n, n - 1, "replica" if n == 2 else "replicas"),
        )
    else:
        check(
            checks,
            "cnpg.instances",
            "High availability",
            "Replicas for automatic fail-over",
            "warn",
            current="1 instance (no replica)",
            expected="3 instances (1 primary, 2 replicas)",
            fix="cnpg.instances",
            detail="With a single instance, Coder is down whenever that pod or its node is. Replicas stream every change and "
            "one is promoted automatically if the primary fails.",
        )
    check(
        checks,
        "cnpg.ready",
        "High availability",
        "Instances ready",
        "ok" if ready >= n else "error",
        current="%d of %d ready (%s)" % (ready, n, st.get("phase") or "phase unknown"),
        detail=(
            ""
            if ready >= n
            else "See the instances below; `kubectl -n %s get pods -l cnpg.io/cluster=%s` shows why."
            % (meta.get("namespace"), meta.get("name"))
        ),
    )
    nodes = {i["node"] for i in instances if i["node"]}
    zones = {i["zone"] for i in instances if i["zone"]}
    if len(instances) >= 2:
        spread_ok = len(nodes) == len(instances)
        check(
            checks,
            "cnpg.spread",
            "High availability",
            "Instances on separate nodes",
            "ok" if spread_ok else "warn",
            current="%d %s%s"
            % (
                len(nodes),
                "node" if len(nodes) == 1 else "nodes",
                (
                    ", %d %s" % (len(zones), "zone" if len(zones) == 1 else "zones")
                    if zones
                    else ""
                ),
            ),
            detail=(
                ""
                if spread_ok
                else "Two instances share a node, so losing that node loses both. Add nodes or enable required pod anti-affinity on the Cluster."
            ),
        )

    # Storage
    sc_name = storage.get("storageClass") or next(
        (c["name"] for c in classes if c["isDefault"]), None
    )
    sc = next((c for c in classes if c["name"] == sc_name), None)
    if sc:
        local = sc["kind"] == "local"
        check(
            checks,
            "cnpg.storageclass",
            "Storage",
            "Storage class",
            "warn" if local and n < 2 else "ok",
            current="%s (%s%s)"
            % (sc["name"], sc["label"], ", default" if sc["isDefault"] else ""),
            detail=(
                "A local volume stays on its node; with a single instance, losing the node loses the data until it is restored "
                "from a backup. Add replicas."
                if local and n < 2
                else (
                    "Node-local disks: each replica has its own copy, so the cluster survives losing a node."
                    if local
                    else "Volumes are network-attached: an instance can move to another node with its data."
                )
            ),
        )
    capacity = next(
        (
            i["pvc"]["capacityBytes"]
            for i in instances
            if i["role"] == "primary" and i["pvc"]
        ),
        None,
    ) or quantity(storage.get("size"))
    size = (stats or {}).get("sizeBytes")
    if capacity and size is not None:
        used = size / capacity
        high = used >= STORAGE_HIGH
        grow = bool(sc and sc["allowExpansion"])
        check(
            checks,
            "cnpg.storage",
            "Storage",
            "Room on the database volume",
            "warn" if high else "ok",
            current="%.0f%% used (%s)" % (used * 100, storage.get("size") or "?"),
            expected="%s" % suggested_size(capacity) if high else None,
            fix="cnpg.storage" if high and grow else None,
            detail=(
                (
                    "The volume can be grown in place."
                    if grow
                    else "The storage class does not allow growing volumes: create a cluster with more storage and move the data."
                )
                if high
                else "Measured as the database's size against the volume; WAL and indexes need room too."
            ),
        )

    # Backups
    scheduled = cnpg_list(meta.get("namespace"), "scheduledbackups", meta.get("name"))
    done_backups = sorted(
        (
            b
            for b in cnpg_list(meta.get("namespace"), "backups", meta.get("name"))
            if ((b.get("status") or {}).get("phase")) == "completed"
        ),
        key=lambda b: (b.get("status") or {}).get("stoppedAt") or "",
    )
    method = (
        "object store (Barman)"
        if backup_spec.get("barmanObjectStore")
        else ("volume snapshots" if backup_spec.get("volumeSnapshot") else None)
    )
    last = st.get("lastSuccessfulBackup") or (
        (done_backups[-1].get("status") or {}).get("stoppedAt")
        if done_backups
        else None
    )
    facts["backups"] = {
        "configured": bool(method and scheduled),
        "method": method,
        "schedule": (
            ((scheduled[0].get("spec") or {}).get("schedule")) if scheduled else None
        ),
        "lastSuccess": last,
        "lastFailure": st.get("lastFailedBackup"),
        "recoverableSince": st.get("firstRecoverabilityPoint"),
        "count": len(done_backups),
    }
    if method and scheduled:
        check(
            checks,
            "cnpg.backup",
            "Backups",
            "Scheduled backups",
            "ok",
            current="%s, schedule %s" % (method, facts["backups"]["schedule"]),
        )
        age = (
            (
                time.time()
                - datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
            )
            / 3600
            if last
            else None
        )
        check(
            checks,
            "cnpg.lastbackup",
            "Backups",
            "Last successful backup",
            "ok" if age is not None and age < 48 else "warn",
            current=last or "none yet",
            detail=(
                ""
                if age is not None and age < 48
                else "No backup completed in the last two days: check the Backup resources' status."
            ),
        )
    elif snaps:
        check(
            checks,
            "cnpg.backup",
            "Backups",
            "Scheduled backups",
            "warn",
            current="none",
            expected="daily volume snapshots (%s)" % snaps[0],
            fix="cnpg.backup",
            detail="Replicas protect against a lost node, not against deleted or corrupted data. "
            "Volume snapshots are taken by the storage system and can seed a new cluster.",
        )
    else:
        check(
            checks,
            "cnpg.backup",
            "Backups",
            "Scheduled backups",
            "warn",
            current="none",
            detail="This cluster has no VolumeSnapshotClass, so snapshot backups can't be set up here. Configure "
            "spec.backup.barmanObjectStore (S3, Azure Blob, Google Cloud Storage or MinIO) on the Cluster and add a ScheduledBackup.",
        )
    facts["settings"] = suggested_settings(cluster, classes, snaps)
    return {"generatedAt": now(), "mode": mode, "checks": checks, "facts": facts}


def suggested_size(capacity):
    """Double the volume, rounded to whole GiB, as a Kubernetes quantity."""
    return "%dGi" % max(1, round(capacity * 2 / 2**30))


def clean_pg_settings(raw):
    s = dict(DEFAULT_PG_SETTINGS)
    name = str(raw.get("clusterName") or s["clusterName"]).strip()
    if not NAME_RE.match(name):
        raise ValueError(
            "Cluster name: lower-case letters, digits and '-', at most 50 characters."
        )
    try:
        instances = int(raw.get("instances") or s["instances"])
    except (TypeError, ValueError):
        raise ValueError("Instances must be a whole number.")
    if not 1 <= instances <= 9:
        raise ValueError("Instances: between 1 and 9.")
    size = str(raw.get("storageSize") or s["storageSize"]).strip()
    if (quantity(size) or 0) < 2**30:
        raise ValueError(
            "Storage size: a Kubernetes quantity of at least 1Gi, for example 20Gi."
        )
    out = {"clusterName": name, "instances": instances, "storageSize": size}
    for key in ("storageClass", "snapshotClass"):
        value = str(raw.get(key) or "").strip()
        if value and not re.match(r"^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$", value):
            raise ValueError("%s: not a valid Kubernetes name." % key)
        out[key] = value
    schedule = str(raw.get("backupSchedule") or s["backupSchedule"]).strip()
    if not CRON6_RE.match(schedule):
        raise ValueError(
            "Backup schedule: six cron fields (seconds first), for example '0 0 2 * * *'."
        )
    out["backupSchedule"] = schedule
    return out


def apply_persistence(fixes, raw_settings, user):
    s = clean_pg_settings(raw_settings or {})
    ns, name = CODER_NAMESPACE, s["clusterName"]
    path = "%s/namespaces/%s/clusters/%s" % (CNPG_API, ns, name)
    labels = {
        "app.kubernetes.io/part-of": "coder",
        "app.kubernetes.io/created-by": "coder-ui-updates",
    }
    done = []
    if "cnpg.cluster" in fixes:
        status, _ = KUBE.call("GET", path)
        if status == 200:
            done.append("Cluster %s/%s already exists" % (ns, name))
        else:
            storage = {"size": s["storageSize"]}
            if s["storageClass"]:
                storage["storageClass"] = s["storageClass"]
            spec = {
                "instances": s["instances"],
                "primaryUpdateStrategy": "unsupervised",
                "storage": storage,
                "affinity": {
                    "enablePodAntiAffinity": True,
                    "topologyKey": "kubernetes.io/hostname",
                },
            }
            if PG_IMAGE:
                spec["imageName"] = PG_IMAGE
            status, out = KUBE.call(
                "POST",
                "%s/namespaces/%s/clusters" % (CNPG_API, ns),
                {
                    "apiVersion": "postgresql.cnpg.io/v1",
                    "kind": "Cluster",
                    "metadata": {"name": name, "namespace": ns, "labels": labels},
                    "spec": spec,
                },
            )
            if status not in (200, 201):
                raise RuntimeError(
                    "Creating Cluster %s/%s failed (HTTP %s): %s"
                    % (ns, name, status, str(out)[:200])
                )
            done.append(
                "Created CloudNativePG cluster %s/%s: %d %s, %s each%s; its connection Secret is %s-app"
                % (
                    ns,
                    name,
                    s["instances"],
                    "instance" if s["instances"] == 1 else "instances",
                    s["storageSize"],
                    " on " + s["storageClass"] if s["storageClass"] else "",
                    name,
                )
            )
    if not {"cnpg.instances", "cnpg.storage", "cnpg.backup"} & set(fixes):
        return done
    status, cluster = KUBE.call("GET", path)
    if status != 200 or not isinstance(cluster, dict):
        raise RuntimeError(
            "Cluster %s/%s does not exist (HTTP %s)." % (ns, name, status)
        )
    spec = cluster.get("spec") or {}
    patch = {}
    if "cnpg.instances" in fixes and int(spec.get("instances") or 1) != s["instances"]:
        patch["instances"] = s["instances"]
        done.append("Cluster %s now runs %d instances" % (name, s["instances"]))
    if "cnpg.storage" in fixes:
        current = quantity((spec.get("storage") or {}).get("size")) or 0
        if (quantity(s["storageSize"]) or 0) <= current:
            raise ValueError(
                "Storage can only grow: the cluster has %s."
                % (spec.get("storage") or {}).get("size")
            )
        sc_name = (spec.get("storage") or {}).get("storageClass") or next(
            (c["name"] for c in storage_classes() if c["isDefault"]), None
        )
        sc = next((c for c in storage_classes() if c["name"] == sc_name), None)
        if sc and not sc["allowExpansion"]:
            raise ValueError(
                "Storage class %s does not allow growing volumes." % sc_name
            )
        patch["storage"] = {"size": s["storageSize"]}
        done.append("Growing %s's volumes to %s" % (name, s["storageSize"]))
    if "cnpg.backup" in fixes:
        snap = s["snapshotClass"] or next(iter(snapshot_classes()), "")
        if not snap:
            raise ValueError("No VolumeSnapshotClass exists in this cluster.")
        patch["backup"] = {"volumeSnapshot": {"className": snap}}
    if patch:
        status, out = KUBE.call(
            "PATCH", path, {"spec": patch}, "application/merge-patch+json"
        )
        if status != 200:
            raise RuntimeError(
                "Updating Cluster %s/%s failed (HTTP %s): %s"
                % (ns, name, status, str(out)[:200])
            )
    if "cnpg.backup" in fixes:
        sb = name + "-daily"
        status, _ = KUBE.call(
            "GET", "%s/namespaces/%s/scheduledbackups/%s" % (CNPG_API, ns, sb)
        )
        if status != 200:
            status, out = KUBE.call(
                "POST",
                "%s/namespaces/%s/scheduledbackups" % (CNPG_API, ns),
                {
                    "apiVersion": "postgresql.cnpg.io/v1",
                    "kind": "ScheduledBackup",
                    "metadata": {"name": sb, "namespace": ns, "labels": labels},
                    "spec": {
                        "schedule": s["backupSchedule"],
                        "backupOwnerReference": "self",
                        "cluster": {"name": name},
                        "method": "volumeSnapshot",
                        "immediate": True,
                    },
                },
            )
            if status not in (200, 201):
                raise RuntimeError(
                    "Creating ScheduledBackup %s failed (HTTP %s): %s"
                    % (sb, status, str(out)[:200])
                )
        done.append(
            "Scheduled volume-snapshot backups of %s (%s), the first one now"
            % (name, s["backupSchedule"])
        )
    owner = managed_by(cluster)
    if owner and owner != "General > Persistence" and patch:
        done.append(
            "Also change it where the cluster is deployed from (%s), or the next deploy undoes it"
            % owner
        )
    log(event="persistence-applied", user=user, cluster=name, fixes=list(fixes))
    return done or ["Cluster %s already matched; nothing changed" % name]


# --------------------------------------------------------------------------- Chat (admins <-> users)
CHAT_MAX_TEXT = 4000
CHAT_KEEP_DAYS = 30  # the default; admins set it (CHAT_KEEP_RANGE) in Admin Controls > Chat
CHAT_KEEP_RANGE = (1, 365)
CHAT_PRUNE_EVERY = 3600  # messages past the retention go every hour (and when it is changed)
CHAT_ONLINE_SECONDS = 75  # every open tab's long poll comes back within CHAT_POLL_SECONDS: seen within this, online
CHAT_ACTIVE_SECONDS = 86400  # Coder saw them within this: active today (the people list's second group)
CHAT_TYPING_SECONDS = 6  # a "typing" signal lasts this long unless renewed (the dashboard renews it every 2.5 s)
CHAT_POLL_SECONDS = 25  # a long poll answers at the latest after this, with nothing new
CHAT_RATE = (30, 60)  # at most 30 messages per 60 seconds per sender
CHAT_ADMIN_RATE = (120, 60)  # admins answering many conversations at once
CHAT_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CHAT_CLIENT_IDS = 20000  # sends remembered by their client id (a retried send is not stored twice), for 10 minutes
CHAT_MAX_IMAGE = (
    4 * 1024 * 1024
)  # a screenshot attached to a message (PNG / JPEG / WebP)


CHAT_IDLE_SECONDS = 30  # a tab without input this long is idle: grey in the People lists (the tab says so itself)
CHAT_MAX_FILE = int(float(os.environ.get("CHAT_MAX_FILE_MB", "25")) * 1024 * 1024)  # a file attached to a message
CHAT_FILE_RESERVE = 200 * 1024 * 1024  # an upload must leave this much free on the service's volume
CHAT_UPLOAD_TTL = 3600  # an uploaded file not sent within this is removed
CHAT_TAB_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CHAT_UPLOAD_RE = re.compile(r"^[0-9a-f]{32}$")
# A group chat (an admin's, from Admin > Accounts: the accounts chosen, in one thread): its id stands where a user's
# would, as the conversation's peer.
CHAT_GROUP_RE = re.compile(r"^g:[0-9a-f]{32}$")
CHAT_GROUP_MAX = 200  # people in one group chat


def chat_peer_id_ok(peer_id):
    """A user's id, or a group chat's."""
    return bool(UUID_RE.match(peer_id) or CHAT_GROUP_RE.match(peer_id))
# Attached files shown in the conversation as pictures (checked against their content); every other file is a
# download, never shown in the browser.
CHAT_INLINE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")


def chat_file_name(name):
    """A file name to keep and offer for download: its last path part, no control characters, at most 200 chars."""
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = "".join(c for c in name if ord(c) >= 32 and c not in '"<>|*?')[:200]
    return name or "file"


class ChatStore:
    """Direct messages: an admin starts a conversation from Admin > Users ("Chat"), or a user writes to an admin from the
    Chats panel (their line to support); both answer in the window that opens on every Coder page (the dashboard's chat).
    Admins may write to anyone; everyone else to admins, or to whoever wrote to them first, and, when the admins turn
    peer-to-peer chat on (settings "peers"), to the other developers in the People list. A message may carry a
    screenshot (chat_files, read only by the two people in the conversation). Messages are kept settings "keepDays" days
    (admins set it; CHAT_KEEP_DAYS by default) in the service's SQLite file (its PersistentVolumeClaim), and admins may
    purge them all. Who is online (a tab's poll in the last CHAT_ONLINE_SECONDS), each tab's idle or active state (its
    own report: no input for CHAT_IDLE_SECONDS) and typing signals live in memory only; a closed tab says goodbye, and
    a sweep every few seconds drops tabs that went quiet: each change of who is online, idle or gone bumps a presence
    version that wakes every poll, so People lists follow at once. A user may be invisible (chat_presence): left out
    of everyone's People list but admins'. A message may also carry a file (any kind, CHAT_MAX_FILE), kept on the
    volume beside the SQLite file (chat-files/<message id>) and pruned and purged with its message. A tab keeps one
    long poll open (/api/chat/poll), answered as soon as a message, a typing change or a presence change concerns it.
    """

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.changed = threading.Condition()
        self.latest = (
            {}
        )  # user id -> newest message id they sent or received (filled lazily)
        self.typing = {}  # (from id, to id) -> expiry time
        self.sent = {}  # user id -> recent send times (rate limit)
        # (user id, client id) -> (time, message): a send retried with the same client id (a lost answer, a double
        # Enter) returns the message stored the first time instead of storing it again
        self.by_client = collections.OrderedDict()
        # deleted conversations, told to both sides through the poll: user id -> [(version, peer id)]. Versions start at
        # this boot's time in ms, so they only grow, across restarts too.
        self.clear_ver = int(time.time() * 1000)
        self.cleared = {}
        # admins who turned their chat off (the switch in their Chats panel): developers can't write to them. A version
        # (also boot time in ms) wakes every poll when it changes, so everyone's panel updates at once.
        self.off = set()
        self.avail_ver = int(time.time() * 1000)
        # Admin Controls > Chat: peer-to-peer chat, the retention, and a version bumped by each purge (so every open
        # tab reloads its conversations). Who is invisible; when each user's tabs last polled (online).
        self.settings = {
            "peers": False,
            "keepDays": CHAT_KEEP_DAYS,
            "purgeVersion": 0,
            "updatedBy": None,
            "updatedAt": None,
        }
        self.invisible = set()
        self.seen = {}
        # Each open tab, for presence: {user id: {tab id: {seen, idle, activeAt, since}}}, and a version bumped when
        # anyone comes online, goes idle or active, or leaves.
        self.tabs = {}
        # Tabs that said goodbye: {tab id: when}. A request of theirs still under way (a poll sent as the page closed)
        # must not bring them back.
        self.left = {}
        self.presence_ver = int(time.time() * 1000)
        # Messages an admin forced onto someone's screen (Forced Focus, Force Response): {user id: {message id}} not
        # acknowledged yet; the version wakes the polls when one is forced or acknowledged.
        self.forced = {}
        self.focus_ver = int(time.time() * 1000)
        # Files attached to messages, on the volume beside the SQLite file; an upload waits (pending) until it is sent.
        self.files_dir = os.path.join(os.path.dirname(os.path.abspath(path)), "chat-files")
        os.makedirs(self.files_dir, exist_ok=True)
        self.pending = {}
        self.last_prune = 0.0
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS chat_messages (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, from_name TEXT NOT NULL, from_display TEXT,
                  to_id TEXT NOT NULL, to_name TEXT NOT NULL, to_display TEXT, text TEXT NOT NULL, sent_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS chat_messages_to ON chat_messages (to_id, id);
                CREATE INDEX IF NOT EXISTS chat_messages_from ON chat_messages (from_id, id);
                CREATE TABLE IF NOT EXISTS chat_read (
                  user_id TEXT NOT NULL, peer_id TEXT NOT NULL, last_id INTEGER NOT NULL, PRIMARY KEY (user_id, peer_id));
            """
            )
            # whether sender / recipient were admins when it was sent: admins' messages are drawn on the left
            columns = {
                r["name"] for r in db.execute("PRAGMA table_info(chat_messages)")
            }
            for column, kind in (
                ("from_admin", "INTEGER NOT NULL DEFAULT 0"),
                ("to_admin", "INTEGER NOT NULL DEFAULT 0"),
                ("image_type", "TEXT NOT NULL DEFAULT ''"),
                ("page", "TEXT NOT NULL DEFAULT ''"),
                ("file_name", "TEXT NOT NULL DEFAULT ''"),
                ("file_type", "TEXT NOT NULL DEFAULT ''"),
                ("file_size", "INTEGER NOT NULL DEFAULT 0"),
                # a Cloud Drive share (drivepeers) the message is about: its card in the conversation
                ("drive_request", "TEXT NOT NULL DEFAULT ''"),
            ):
                if column not in columns:
                    db.execute(
                        "ALTER TABLE chat_messages ADD COLUMN %s %s" % (column, kind)
                    )
            # attachments apart from the messages, so polls and lists never read image bytes
            db.execute(
                "CREATE TABLE IF NOT EXISTS chat_files (message_id INTEGER PRIMARY KEY, data BLOB NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS chat_status (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL)"
            )
            self.off = {
                r[0]
                for r in db.execute("SELECT user_id FROM chat_status WHERE enabled = 0")
            }
            db.execute(
                "CREATE TABLE IF NOT EXISTS chat_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS chat_presence (user_id TEXT PRIMARY KEY, invisible INTEGER NOT NULL, updated_at TEXT NOT NULL)"
            )
            # Group chats: the thread (its admin, whether its first message takes everyone's focus, and which message
            # that was), its members, and who has clicked that first message.
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS chat_groups (
                  id TEXT PRIMARY KEY, title TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
                  focus INTEGER NOT NULL DEFAULT 1, focus_message_id INTEGER);
                CREATE TABLE IF NOT EXISTS chat_group_members (
                  group_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
                  PRIMARY KEY (group_id, user_id));
                CREATE TABLE IF NOT EXISTS chat_focus_ack (
                  group_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (group_id, user_id));
                CREATE TABLE IF NOT EXISTS chat_forced (
                  message_id INTEGER NOT NULL, user_id TEXT NOT NULL, forced_by TEXT NOT NULL, at TEXT NOT NULL,
                  acked_at TEXT, PRIMARY KEY (message_id, user_id));
            """
            )
            for r in db.execute("SELECT message_id, user_id FROM chat_forced WHERE acked_at IS NULL"):
                self.forced.setdefault(r[1], set()).add(r[0])
            self.groups = {}
            for r in db.execute("SELECT * FROM chat_groups"):
                self.groups[r["id"]] = {"id": r["id"], "title": r["title"], "createdBy": r["created_by"],
                                        "createdAt": r["created_at"], "focus": bool(r["focus"]),
                                        "focusMessage": r["focus_message_id"], "members": {}}
            for r in db.execute("SELECT * FROM chat_group_members"):
                if r["group_id"] in self.groups:
                    self.groups[r["group_id"]]["members"][r["user_id"]] = {
                        "id": r["user_id"], "username": r["username"], "name": r["name"] or ""}
            self.acks = {(r[0], r[1]) for r in db.execute("SELECT group_id, user_id FROM chat_focus_ack")}
            for r in db.execute("SELECT key, value FROM chat_settings"):
                if r[0] in self.settings:
                    try:
                        self.settings[r[0]] = json.loads(r[1])
                    except ValueError:
                        pass
            self.invisible = {
                r[0]
                for r in db.execute(
                    "SELECT user_id FROM chat_presence WHERE invisible = 1"
                )
            }
        self.prune()
        threading.Thread(target=self._prune_loop, name="chat-prune", daemon=True).start()
        threading.Thread(target=self._presence_loop, name="chat-presence", daemon=True).start()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _message(r):
        return {
            "id": r["id"],
            "from": r["from_id"],
            "fromName": r["from_name"],
            "fromDisplay": r["from_display"] or "",
            "to": r["to_id"],
            "toName": r["to_name"],
            "toDisplay": r["to_display"] or "",
            "text": r["text"],
            "at": r["sent_at"],
            "fromAdmin": bool(r["from_admin"]),
            "toAdmin": bool(r["to_admin"]),
            "image": (
                "%s/api/chat/file/%d" % (BASE, r["id"]) if r["image_type"] else None
            ),
            "page": r["page"] or None,
            "file": (
                {"url": "%s/api/chat/file/%d" % (BASE, r["id"]), "name": r["file_name"],
                 "size": r["file_size"], "type": r["file_type"]}
                if "file_name" in r.keys() and r["file_name"] else None
            ),
            "driveRequest": (r["drive_request"] or None) if "drive_request" in r.keys() else None,
        }

    # ---- group chats

    def create_group(self, creator, members, focus=True):
        """A thread with the creator (an admin) and members ([{id, username, name}]): its peer. Nobody sees it before
        its first message."""
        group_id = "g:" + uuid.uuid4().hex
        everyone = {creator["id"]: {"id": creator["id"], "username": creator["username"], "name": creator.get("name") or ""}}
        for m in members:
            everyone.setdefault(m["id"], {"id": m["id"], "username": m["username"], "name": m.get("name") or ""})
        others = [m for uid, m in everyone.items() if uid != creator["id"]]
        names = [m["name"] or m["username"] for m in others]
        title = ", ".join(names[:3]) + (" and %d more" % (len(names) - 3) if len(names) > 3 else "")
        group = {"id": group_id, "title": title, "createdBy": creator["id"], "createdAt": now(), "focus": bool(focus),
                 "focusMessage": None, "members": everyone}
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO chat_groups (id, title, created_by, created_at, focus) VALUES (?, ?, ?, ?, ?)",
                       (group_id, title, creator["id"], group["createdAt"], int(bool(focus))))
            db.executemany("INSERT INTO chat_group_members (group_id, user_id, username, name) VALUES (?, ?, ?, ?)",
                           [(group_id, m["id"], m["username"], m["name"]) for m in everyone.values()])
            self.groups[group_id] = group
        return self.group_peer(group_id)

    def group(self, group_id):
        return self.groups.get(group_id)

    def group_peer(self, group_id):
        """A group chat as a conversation's peer: its title, its members."""
        g = self.groups[group_id]
        members = sorted(g["members"].values(), key=lambda m: m["username"])
        return {"id": group_id, "username": g["title"],
                "name": ", ".join(m["name"] or m["username"] for m in members), "group": True,
                "members": members, "admin": False}

    def groups_of(self, user_id):
        return [gid for gid, g in self.groups.items() if user_id in g["members"]]

    def in_group(self, user_id, group_id):
        g = self.groups.get(group_id)
        return bool(g and user_id in g["members"])

    def focus_pending(self, user_id):
        """The first messages of group chats that take this user's focus and that they have not clicked yet."""
        out = []
        ids = {gid: g["focusMessage"] for gid, g in self.groups.items()
               if g["focus"] and g["focusMessage"] and user_id in g["members"] and g["createdBy"] != user_id
               and (gid, user_id) not in self.acks}
        forced = sorted(self.forced.get(user_id, set()))
        if not ids and not forced:
            return out
        with self.connect() as db:
            for gid, mid in ids.items():
                r = db.execute("SELECT * FROM chat_messages WHERE id = ?", (mid,)).fetchone()
                if r:
                    out.append({"group": self.group_peer(gid), "message": self._message(r)})
            # forced messages (an admin's Forced Focus, Force Response): the conversation is the group chat, or the
            # admin who wrote it; one deleted since asks nothing
            for mid in forced:
                r = db.execute("SELECT * FROM chat_messages WHERE id = ?", (mid,)).fetchone()
                if not r:
                    continue
                peer = (self.group_peer(r["to_id"]) if r["to_id"] in self.groups else
                        {"id": r["from_id"], "username": r["from_name"], "name": r["from_display"] or "",
                         "admin": bool(r["from_admin"])})
                out.append({"group": peer, "message": self._message(r), "forced": True})
        return out

    def force(self, by, message_id, user_ids):
        """Forced Focus: the message comes up in front of everything for these users until they acknowledge it (again
        when it was acknowledged before)."""
        at = now()
        with self.lock, self.connect() as db:
            db.executemany(
                """INSERT INTO chat_forced (message_id, user_id, forced_by, at) VALUES (?, ?, ?, ?)
                   ON CONFLICT (message_id, user_id) DO UPDATE SET forced_by = excluded.forced_by, at = excluded.at,
                   acked_at = NULL""",
                [(message_id, uid, by["username"], at) for uid in user_ids])
        with self.changed:
            for uid in user_ids:
                self.forced.setdefault(uid, set()).add(message_id)
            self.focus_ver += 1
            self.changed.notify_all()

    def ack_forced(self, user_id, message_id):
        """The user acknowledged a forced message: False when it was not forced on them (or acknowledged already)."""
        if message_id not in self.forced.get(user_id, set()):
            return False
        with self.lock, self.connect() as db:
            db.execute("UPDATE chat_forced SET acked_at = ? WHERE message_id = ? AND user_id = ?",
                       (now(), message_id, user_id))
        with self.changed:
            self.forced.get(user_id, set()).discard(message_id)
            self.focus_ver += 1
            self.changed.notify_all()
        return True

    def newest_admin_message(self, peer_id):
        """Force Response: the newest message an admin wrote in this conversation - to the user, or in the group chat."""
        with self.connect() as db:
            r = db.execute("SELECT * FROM chat_messages WHERE to_id = ? AND from_admin = 1 ORDER BY id DESC LIMIT 1",
                           (peer_id,)).fetchone()
        return self._message(r) if r else None

    def ack_focus(self, user_id, group_id):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO chat_focus_ack (group_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                       (group_id, user_id, now()))
            self.acks.add((group_id, user_id))

    def _concerns(self, user_id):
        """SQL (and its parameters) for the messages that concern a user: theirs, to them, in their group chats."""
        groups = self.groups_of(user_id)
        sql = "(from_id = ? OR to_id = ?" + (" OR to_id IN (%s)" % ",".join("?" * len(groups)) if groups else "") + ")"
        return sql, [user_id, user_id] + groups

    def newest(self, user_id):
        if user_id not in self.latest:
            where, params = self._concerns(user_id)
            with self.connect() as db:
                row = db.execute("SELECT max(id) FROM chat_messages WHERE " + where, params).fetchone()
            self.latest[user_id] = row[0] or 0
        return self.latest[user_id]

    def set_enabled(self, user_id, on):
        with self.lock, self.connect() as db:
            db.execute(
                """INSERT INTO chat_status (user_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id)
                          DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at""",
                (user_id, int(on), now()),
            )
        with self.changed:
            (self.off.discard if on else self.off.add)(user_id)
            self.avail_ver += 1
            self.changed.notify_all()

    # ---- Admin Controls > Chat: peer-to-peer chat, retention, purge, who talks to whom

    def put_settings(self, changes, by):
        """Saves {peers?, keepDays?} (already checked); a shorter retention prunes at once. Every open tab hears of it."""
        with self.lock, self.connect() as db:
            self.settings.update(changes, updatedBy=by, updatedAt=now())
            for key, value in self.settings.items():
                db.execute(
                    "INSERT INTO chat_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    (key, json.dumps(value)),
                )
        if "keepDays" in changes:
            self.prune()
        with self.changed:
            self.avail_ver += 1
            self.changed.notify_all()
        return dict(self.settings)

    def prune(self):
        """Deletes the messages (and screenshots) older than the retention; how many."""
        cutoff = datetime.fromtimestamp(
            time.time() - int(self.settings.get("keepDays") or CHAT_KEEP_DAYS) * 86400,
            timezone.utc,
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self.lock, self.connect() as db:
            with_files = [r[0] for r in db.execute(
                "SELECT id FROM chat_messages WHERE sent_at < ? AND file_name != ''", (cutoff,))]
            n = db.execute(
                "DELETE FROM chat_messages WHERE sent_at < ?", (cutoff,)
            ).rowcount
            db.execute(
                "DELETE FROM chat_files WHERE message_id NOT IN (SELECT id FROM chat_messages)"
            )
            kept = {str(r[0]) for r in db.execute("SELECT id FROM chat_messages WHERE file_name != ''")}
        self._remove_files(with_files)
        # group chats with nothing left in them, started before the retention
        with self.lock, self.connect() as db:
            empty = [r[0] for r in db.execute(
                "SELECT id FROM chat_groups WHERE created_at < ? AND id NOT IN (SELECT DISTINCT to_id FROM chat_messages)",
                (cutoff,))]
            for gid in empty:
                for table, column in (("chat_group_members", "group_id"), ("chat_focus_ack", "group_id"),
                                      ("chat_read", "peer_id"), ("chat_groups", "id")):
                    db.execute("DELETE FROM %s WHERE %s = ?" % (table, column), (gid,))
                self.groups.pop(gid, None)
            self.acks = {a for a in self.acks if a[0] in self.groups}
        # files whose message is gone some other way
        for name in os.listdir(self.files_dir):
            if name.isdigit() and name not in kept:
                self._remove_files([name])
        self._expire_uploads()
        self.last_prune = time.time()
        return n

    def _prune_loop(self):
        while True:
            time.sleep(CHAT_PRUNE_EVERY)
            try:
                n = self.prune()
                if n:
                    log(event="chat-pruned", messages=n, keep_days=self.settings.get("keepDays"))
            except Exception as e:  # noqa: BLE001 - the next hour tries again
                log(event="chat-prune-failed", error=str(e)[:200])

    def purge(self):
        """Every message, screenshot and read mark, gone; the file compacted (VACUUM) to give the space back. Every
        open tab reloads its (now empty) conversations. How many messages."""
        with self.lock, self.connect() as db:
            n = db.execute("DELETE FROM chat_messages").rowcount
            db.execute("DELETE FROM chat_files")
            for name in os.listdir(self.files_dir):
                if name.isdigit():
                    self._remove_files([name])
            db.execute("DELETE FROM chat_read")
            for table in ("chat_groups", "chat_group_members", "chat_focus_ack"):
                db.execute("DELETE FROM " + table)
            self.groups.clear()
            self.acks.clear()
            self.settings["purgeVersion"] = int(self.settings.get("purgeVersion") or 0) + 1
            db.execute(
                "INSERT INTO chat_settings (key, value) VALUES ('purgeVersion', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (json.dumps(self.settings["purgeVersion"]),),
            )
        try:
            db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
            db.execute("VACUUM")
            db.close()
        except sqlite3.Error as e:  # the rows are gone; only the space waits
            log(event="chat-vacuum-failed", error=str(e)[:200])
        with self.changed:
            self.latest.clear()
            self.typing.clear()
            self.avail_ver += 1
            self.changed.notify_all()
        return n

    def export(self, by):
        """Every record, for Admin Controls > Chat > Export: the messages (an attachment's name, type and size, not its
        bytes), the groups and their members, the read marks and focus acknowledgements, and the settings - with when
        and by whom it was exported."""
        with self.lock, self.connect() as db:
            rows = lambda sql: [dict(r) for r in db.execute(sql)]  # noqa: E731 - four reads alike
            messages = rows("SELECT * FROM chat_messages ORDER BY id")
            groups = rows("SELECT * FROM chat_groups ORDER BY created_at")
            members = rows("SELECT * FROM chat_group_members ORDER BY group_id, username")
            reads = rows("SELECT * FROM chat_read ORDER BY user_id, peer_id")
            acks = rows("SELECT * FROM chat_focus_ack ORDER BY group_id, user_id")
        return {
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "exportedBy": by,
            "settings": {k: self.settings.get(k) for k in ("peers", "keepDays")},
            "counts": {"messages": len(messages), "groups": len(groups)},
            "messages": messages,
            "groups": groups,
            "groupMembers": members,
            "readMarks": reads,
            "focusAcknowledgements": acks,
        }

    def stats(self):
        """How much is kept: messages (and between developers), screenshots, their size, the oldest; the file's size."""
        with self.connect() as db:
            m = db.execute(
                "SELECT count(*), coalesce(sum(from_admin = 0 AND to_admin = 0), 0), min(sent_at), coalesce(sum(length(text)), 0) FROM chat_messages"
            ).fetchone()
            f = db.execute(
                "SELECT count(*), coalesce(sum(length(data)), 0) FROM chat_files"
            ).fetchone()
            a = db.execute(
                "SELECT count(*), coalesce(sum(file_size), 0) FROM chat_messages WHERE file_name != ''"
            ).fetchone()
        try:
            size = os.path.getsize(self.path)
        except OSError:
            size = None
        return {
            "messages": m[0],
            "peerMessages": m[1],
            "oldest": m[2],
            "screenshots": f[0],
            "attachments": a[0],
            "attachmentBytes": a[1],
            "bytes": m[3] + f[1] + a[1],
            "fileBytes": size,
        }

    PAIRS_PAGE = 25

    def pairs(self, limit=PAIRS_PAGE, offset=0):
        """Who talks to whom between developers (neither an admin): each pair once, how many messages, the first and
        the last; newest first, a page of them (limit from offset) and how many pairs there are in all. Never what
        they wrote."""
        grouped = """SELECT CASE WHEN from_id < to_id THEN from_id ELSE to_id END AS a,
                            CASE WHEN from_id < to_id THEN to_id ELSE from_id END AS b,
                            count(*) AS n, min(sent_at) AS first, max(sent_at) AS last, max(id) AS newest
                     FROM chat_messages WHERE from_admin = 0 AND to_admin = 0
                     GROUP BY a, b"""
        with self.connect() as db:
            total = db.execute(f"SELECT count(*) FROM ({grouped})").fetchone()[0]
            rows = db.execute(
                f"{grouped} ORDER BY newest DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            out = []
            for r in rows:
                m = db.execute(
                    "SELECT from_id, from_name, from_display, to_id, to_name, to_display FROM chat_messages WHERE id = ?",
                    (r["newest"],),
                ).fetchone()
                names = {
                    m["from_id"]: (m["from_name"], m["from_display"]),
                    m["to_id"]: (m["to_name"], m["to_display"]),
                }

                def person(i):
                    username, name = names.get(i, ("", ""))
                    return {"id": i, "username": username, "name": name or ""}

                out.append(
                    {
                        "a": person(r["a"]),
                        "b": person(r["b"]),
                        "messages": r["n"],
                        "first": r["first"],
                        "last": r["last"],
                    }
                )
        return {"pairs": out, "total": total}

    def set_invisible(self, user_id, invisible):
        with self.lock, self.connect() as db:
            db.execute(
                """INSERT INTO chat_presence (user_id, invisible, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id)
                   DO UPDATE SET invisible = excluded.invisible, updated_at = excluded.updated_at""",
                (user_id, int(invisible), now()),
            )
        with self.changed:
            (self.invisible.add if invisible else self.invisible.discard)(user_id)
            self.avail_ver += 1
            self.changed.notify_all()

    def touch(self, user_id):
        """A tab of this user's is open (its state or poll request, from a tab that has no id)."""
        self.seen[user_id] = time.time()

    # ---- presence: each tab's own report

    def _status(self, user_id, now_t=None):
        """offline, idle or active: from the user's live tabs; a user whose tabs never gave an id, from their polls."""
        now_t = now_t or time.time()
        tabs = [t for t in self.tabs.get(user_id, {}).values() if now_t - t["seen"] < CHAT_ONLINE_SECONDS]
        if not tabs:
            if user_id in self.tabs or now_t - self.seen.get(user_id, 0) >= CHAT_ONLINE_SECONDS:
                return "offline"
            return "active"
        return "idle" if all(t["idle"] for t in tabs) else "active"

    def _presence_changed(self):
        """(self.changed held) Wakes every poll: someone came online, went idle or active, or left."""
        self.presence_ver += 1
        self.changed.notify_all()

    def tab(self, user_id, tab_id, idle=None, leave=False):
        """A tab's poll (it is open), its user's input (idle or not), or its goodbye (leave)."""
        now_t = time.time()
        with self.changed:
            before = self._status(user_id, now_t)
            tabs = self.tabs.setdefault(user_id, {})
            if leave:
                tabs.pop(tab_id, None)
                self.left[tab_id] = now_t
            elif tab_id in self.left:
                return  # the page is gone: this request left before its goodbye arrived
            else:
                t = tabs.get(tab_id)
                if t is None:
                    t = tabs[tab_id] = {"seen": now_t, "idle": False, "activeAt": now_t, "since": now_t}
                t["seen"] = now_t
                if idle is not None:
                    if t["idle"] and not idle:
                        t["activeAt"] = now_t
                    t["idle"] = bool(idle)
                    if not idle:
                        t["activeAt"] = now_t
            if self._status(user_id, now_t) != before:
                self._presence_changed()

    def presence(self, user_id):
        """The user's presence now: {status: active | idle | offline, activeAt, since (online since), tabs}."""
        now_t = time.time()
        tabs = [t for t in self.tabs.get(user_id, {}).values() if now_t - t["seen"] < CHAT_ONLINE_SECONDS]
        active = max([t["activeAt"] for t in tabs] or [0])
        since = min([t["since"] for t in tabs] or [0])

        def iso(t):
            return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None

        return {"status": self._status(user_id, now_t), "activeAt": iso(active), "since": iso(since), "tabs": len(tabs)}

    def _presence_loop(self):
        """Every few seconds: tabs that stopped polling (closed without a goodbye, a lost connection) are dropped."""
        while True:
            time.sleep(5)
            now_t = time.time()
            with self.changed:
                changed = False
                for user_id, tabs in list(self.tabs.items()):
                    dead = [k for k, t in tabs.items() if now_t - t["seen"] >= CHAT_ONLINE_SECONDS]
                    if not dead:
                        continue
                    before = self._status(user_id, now_t - 1e-6)
                    for k in dead:
                        tabs.pop(k, None)
                    changed = changed or self._status(user_id, now_t) != before
                for k, at in list(self.left.items()):
                    if now_t - at >= CHAT_ONLINE_SECONDS:
                        del self.left[k]
                if changed:
                    self._presence_changed()

    def is_online(self, user_id):
        return self._status(user_id) != "offline"

    # ---- files attached to messages

    def _file_path(self, message_id):
        return os.path.join(self.files_dir, str(int(message_id)))

    def _remove_files(self, message_ids):
        for i in message_ids:
            try:
                os.remove(self._file_path(i))
            except OSError:
                pass

    def put_upload(self, user_id, to_id, name, ctype, length, stream):
        """A file to attach, read from the request (length bytes), kept until sent (CHAT_UPLOAD_TTL)."""
        self._expire_uploads()
        upload_id = uuid.uuid4().hex
        path = os.path.join(self.files_dir, "pending-" + upload_id)
        left = length
        try:
            with open(path, "wb") as f:
                while left > 0:
                    chunk = stream.read(min(1024 * 1024, left))
                    if not chunk:
                        raise ValueError("The upload stopped before the end of the file.")
                    f.write(chunk)
                    left -= len(chunk)
        except BaseException:
            try:
                os.remove(path)
            except OSError:
                pass
            raise
        with self.lock:
            self.pending[upload_id] = {"user": user_id, "to": to_id, "name": name, "type": ctype, "size": length,
                                       "path": path, "at": time.time()}
        return {"upload": upload_id, "name": name, "size": length, "type": ctype}

    def take_upload(self, user_id, upload_id, to_id):
        """The upload of this user's for this recipient, taken out of pending (None if there is none)."""
        with self.lock:
            hit = self.pending.get(upload_id)
            if not hit or hit["user"] != user_id or hit["to"] != to_id:
                return None
            return self.pending.pop(upload_id)

    def _expire_uploads(self):
        now_t = time.time()
        with self.lock:
            old = [k for k, v in self.pending.items() if now_t - v["at"] > CHAT_UPLOAD_TTL]
            gone = [self.pending.pop(k) for k in old]
        for v in gone:
            try:
                os.remove(v["path"])
            except OSError:
                pass

    def attachment(self, user_id, message_id):
        """(path, name, type, size) of a message's attached file, for the two people in that conversation only."""
        where, params = self._concerns(user_id)
        with self.connect() as db:
            r = db.execute(
                "SELECT file_name, file_type, file_size FROM chat_messages WHERE id = ? AND file_name != '' AND "
                + where, [message_id] + params,
            ).fetchone()
        path = self._file_path(message_id)
        return (path, r[0], r[1], r[2]) if r and os.path.exists(path) else None

    def has_history(self, user_id, peer_id, from_admin=False):
        """They exchanged messages (or the peer wrote to this user as an admin, with from_admin)."""
        with self.connect() as db:
            if from_admin:
                hit = db.execute(
                    "SELECT 1 FROM chat_messages WHERE from_id = ? AND to_id = ? AND from_admin = 1 LIMIT 1",
                    (peer_id, user_id),
                ).fetchone()
            else:
                hit = db.execute(
                    "SELECT 1 FROM chat_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) LIMIT 1",
                    (peer_id, user_id, user_id, peer_id),
                ).fetchone()
        return hit is not None

    def may_write(self, user, admin, peer_id, admin_ids=(), all_admin_ids=()):
        """None if allowed, else why not. Admins write to anyone. Everyone else writes to admins who have chat on, or
        answers an admin who wrote to them (unless that admin has turned chat off); and, with peer-to-peer chat on, to
        other developers (an invisible one only if they have talked before).
        """
        if peer_id == user["id"]:
            return "You can't chat with yourself."
        if CHAT_GROUP_RE.match(peer_id):
            return None if self.in_group(user["id"], peer_id) else "You are not in that chat."
        if admin:
            return None
        if peer_id in self.off:
            return "This admin has turned chat off; try another admin."
        if peer_id in admin_ids:
            return None
        if peer_id not in all_admin_ids and self.settings.get("peers"):
            if peer_id in self.invisible and not self.has_history(user["id"], peer_id):
                return "That person isn't available for chat."
            return None
        if self.has_history(user["id"], peer_id, from_admin=True):
            return None
        if peer_id not in all_admin_ids and self.has_history(user["id"], peer_id):
            return "Chat between developers is turned off by your admins."
        return "You can start a conversation with an admin only."

    def peer_from_history(self, user_id, peer_id):
        """{id, username, name} of someone this user has exchanged messages with, from the newest message."""
        with self.connect() as db:
            r = db.execute(
                """SELECT * FROM chat_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
                              ORDER BY id DESC LIMIT 1""",
                (user_id, peer_id, peer_id, user_id),
            ).fetchone()
        if not r:
            return None
        if r["from_id"] == peer_id:
            return {
                "id": peer_id,
                "username": r["from_name"],
                "name": r["from_display"] or "",
            }
        return {"id": peer_id, "username": r["to_name"], "name": r["to_display"] or ""}

    def rate_ok(self, user_id, admin=False):
        limit, window = CHAT_ADMIN_RATE if admin else CHAT_RATE
        with self.lock:
            times = [t for t in self.sent.get(user_id, []) if time.time() - t < window]
            self.sent[user_id] = times
            if len(times) >= limit:
                return False
            times.append(time.time())
            return True

    def sent_before(self, user_id, client_id):
        """The message this user already sent with this client id (in the last 10 minutes), else None."""
        if not client_id:
            return None
        with self.lock:
            hit = self.by_client.get((user_id, client_id))
            return hit[1] if hit and time.time() - hit[0] < 600 else None

    def send(self, user, admin, peer, text, image=None, page="", client_id="", attachment=None, drive=""):
        """image: (content type, bytes) or None; page: where it was taken (path on Coder's host). attachment: an upload
        (take_upload). client_id: the sender's id for this message; sending it again returns the first message.
        drive: a Cloud Drive share's id (drivepeers): the message shows its card."""
        with self.lock, self.connect() as db:
            hit = self.by_client.get((user["id"], client_id)) if client_id else None
            if hit and time.time() - hit[0] < 600:
                return hit[1]
            cur = db.execute(
                """INSERT INTO chat_messages (from_id, from_name, from_display, to_id, to_name, to_display, text, sent_at,
                                from_admin, to_admin, image_type, page, file_name, file_type, file_size, drive_request)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user["id"],
                    user["username"],
                    user.get("name") or "",
                    peer["id"],
                    peer["username"],
                    peer.get("name") or "",
                    text,
                    now(),
                    int(admin),
                    int(bool(peer.get("admin"))),
                    image[0] if image else "",
                    page if image else "",
                    attachment["name"] if attachment else "",
                    attachment["type"] if attachment else "",
                    attachment["size"] if attachment else 0,
                    drive or "",
                ),
            )
            if attachment:
                os.replace(attachment["path"], self._file_path(cur.lastrowid))
            if image:
                db.execute(
                    "INSERT INTO chat_files (message_id, data) VALUES (?, ?)",
                    (cur.lastrowid, sqlite3.Binary(image[1])),
                )
            row = db.execute(
                "SELECT * FROM chat_messages WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
            message = self._message(row)
            if client_id:
                self.by_client[(user["id"], client_id)] = (time.time(), message)
                while len(self.by_client) > CHAT_CLIENT_IDS:
                    self.by_client.popitem(last=False)
            group = self.groups.get(peer["id"])
            if group and group["focus"] and not group["focusMessage"] and user["id"] == group["createdBy"]:
                # the admin's first message: it takes every member's focus, once
                group["focusMessage"] = row["id"]
                db.execute("UPDATE chat_groups SET focus_message_id = ? WHERE id = ?", (row["id"], peer["id"]))
        with self.changed:
            self.latest[user["id"]] = self.latest[peer["id"]] = row["id"]
            for member in (group or {}).get("members", {}):
                self.latest[member] = row["id"]
            self.typing.pop(
                (user["id"], peer["id"]), None
            )  # a sent message ends "typing"
            self.changed.notify_all()
        return message

    def set_typing(self, user_id, peer_id):
        with self.changed:
            for k in [
                k for k, until in self.typing.items() if until < time.time() - 60
            ]:
                del self.typing[k]  # long expired
            fresh = self.typing.get((user_id, peer_id), 0) < time.time()
            self.typing[(user_id, peer_id)] = time.time() + CHAT_TYPING_SECONDS
            if fresh:
                self.changed.notify_all()

    def typing_to(self, user_id):
        """Who is typing to this user, and the group chats of theirs where someone else is."""
        t = time.time()
        return sorted(
            {f for (f, to), until in list(self.typing.items()) if to == user_id and until > t}
            | {to for (f, to), until in list(self.typing.items())
               if until > t and f != user_id and CHAT_GROUP_RE.match(to) and self.in_group(user_id, to)}
        )

    def since(self, user_id, after):
        where, params = self._concerns(user_id)
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM chat_messages WHERE id > ? AND " + where + " ORDER BY id LIMIT 200",
                [after] + params,
            ).fetchall()
        return [self._message(r) for r in rows]

    def history(self, user_id, peer_id, before=None, limit=100):
        if CHAT_GROUP_RE.match(peer_id):
            if not self.in_group(user_id, peer_id):
                return [], 0
            with self.connect() as db:
                rows = db.execute("SELECT * FROM chat_messages WHERE to_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
                                  (peer_id, before or 2**62, limit)).fetchall()
                read = db.execute("SELECT last_id FROM chat_read WHERE user_id = ? AND peer_id = ?",
                                  (user_id, peer_id)).fetchone()
            return [self._message(r) for r in reversed(rows)], read[0] if read else 0
        with self.connect() as db:
            rows = db.execute(
                """SELECT * FROM chat_messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
                                 AND id < ? ORDER BY id DESC LIMIT ?""",
                (user_id, peer_id, peer_id, user_id, before or 2**62, limit),
            ).fetchall()
            read = db.execute(
                "SELECT last_id FROM chat_read WHERE user_id = ? AND peer_id = ?",
                (user_id, peer_id),
            ).fetchone()
        return [self._message(r) for r in reversed(rows)], read[0] if read else 0

    def conversations(self, user_id):
        """Everyone this user exchanged messages with (newest first): the last message and how many are unread."""
        with self.connect() as db:
            rows = db.execute(
                """SELECT m.* FROM chat_messages m JOIN (
                                   SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer, max(id) AS last
                                   FROM chat_messages WHERE from_id = ? OR to_id = ? GROUP BY peer) c ON m.id = c.last
                                 ORDER BY m.id DESC""",
                (user_id, user_id, user_id),
            ).fetchall()
            unread = {
                r[0]: r[1]
                for r in db.execute(
                    """SELECT m.from_id, count(*) FROM chat_messages m LEFT JOIN chat_read r ON r.user_id = ? AND r.peer_id = m.from_id
                   WHERE m.to_id = ? AND m.id > coalesce(r.last_id, 0) GROUP BY m.from_id""",
                    (user_id, user_id),
                )
            }
        out = []
        for r in rows:
            if CHAT_GROUP_RE.match(r["to_id"]):
                continue  # a group's (below), sent by this user
            mine = r["from_id"] == user_id
            peer = {
                "id": r["to_id"] if mine else r["from_id"],
                "username": r["to_name"] if mine else r["from_name"],
                "name": (r["to_display"] if mine else r["from_display"]) or "",
            }
            out.append(
                {
                    "peer": peer,
                    "last": self._message(r),
                    "unread": unread.get(peer["id"], 0),
                }
            )
        groups = self.groups_of(user_id)
        if groups:
            marks = ",".join("?" * len(groups))
            with self.connect() as db:
                lasts = db.execute(
                    "SELECT m.* FROM chat_messages m JOIN (SELECT to_id, max(id) AS last FROM chat_messages WHERE to_id IN "
                    "(%s) GROUP BY to_id) c ON m.id = c.last" % marks, groups).fetchall()
                counts = dict(db.execute(
                    "SELECT m.to_id, count(*) FROM chat_messages m LEFT JOIN chat_read r ON r.user_id = ? AND "
                    "r.peer_id = m.to_id WHERE m.to_id IN (%s) AND m.from_id != ? AND m.id > coalesce(r.last_id, 0) "
                    "GROUP BY m.to_id" % marks, [user_id] + groups + [user_id]).fetchall())
            for r in lasts:  # a group nobody has written in yet is nobody's conversation
                out.append({"peer": self.group_peer(r["to_id"]), "last": self._message(r),
                            "unread": counts.get(r["to_id"], 0)})
            out.sort(key=lambda c: c["last"]["id"], reverse=True)
        return out

    def delete(self, user_id, peer_id):
        """Removes the whole conversation between the two, for both of them (either may do it). The number deleted.
        A group chat: its admin removes it for everyone."""
        if CHAT_GROUP_RE.match(peer_id):
            return self.delete_group(user_id, peer_id)
        with self.lock, self.connect() as db:
            with_files = [r[0] for r in db.execute(
                """SELECT id FROM chat_messages WHERE file_name != '' AND
                          ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))""",
                (user_id, peer_id, peer_id, user_id))]
            db.execute(
                """DELETE FROM chat_files WHERE message_id IN (SELECT id FROM chat_messages
                          WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))""",
                (user_id, peer_id, peer_id, user_id),
            )
            n = db.execute(
                """DELETE FROM chat_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)""",
                (user_id, peer_id, peer_id, user_id),
            ).rowcount
            db.execute(
                """DELETE FROM chat_read WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)""",
                (user_id, peer_id, peer_id, user_id),
            )
        with self.changed:
            self.clear_ver += 1
            for me, other in ((user_id, peer_id), (peer_id, user_id)):
                self.cleared[me] = (
                    self.cleared.get(me, []) + [(self.clear_ver, other)]
                )[-50:]
            self.typing.pop((user_id, peer_id), None)
            self.typing.pop((peer_id, user_id), None)
            self.changed.notify_all()
        self._remove_files(with_files)
        return n

    def delete_group(self, user_id, group_id):
        g = self.groups.get(group_id)
        if not g or g["createdBy"] != user_id:
            raise PermissionError("Only the admin who started this chat can delete it.")
        with self.lock, self.connect() as db:
            with_files = [r[0] for r in db.execute(
                "SELECT id FROM chat_messages WHERE file_name != '' AND to_id = ?", (group_id,))]
            db.execute("DELETE FROM chat_files WHERE message_id IN (SELECT id FROM chat_messages WHERE to_id = ?)",
                       (group_id,))
            n = db.execute("DELETE FROM chat_messages WHERE to_id = ?", (group_id,)).rowcount
            db.execute("DELETE FROM chat_read WHERE peer_id = ?", (group_id,))
            db.execute("DELETE FROM chat_group_members WHERE group_id = ?", (group_id,))
            db.execute("DELETE FROM chat_focus_ack WHERE group_id = ?", (group_id,))
            db.execute("DELETE FROM chat_groups WHERE id = ?", (group_id,))
            self.groups.pop(group_id, None)
            self.acks = {a for a in self.acks if a[0] != group_id}
        with self.changed:
            self.clear_ver += 1
            for member in g["members"]:
                self.cleared[member] = (self.cleared.get(member, []) + [(self.clear_ver, group_id)])[-50:]
            self.changed.notify_all()
        self._remove_files(with_files)
        return n

    def file(self, user_id, message_id):
        """(content type, bytes) of a message's screenshot, for the two people in that conversation only."""
        where, params = self._concerns(user_id)
        with self.connect() as db:
            r = db.execute(
                "SELECT m.image_type, f.data FROM chat_messages m JOIN chat_files f ON f.message_id = m.id "
                "WHERE m.id = ? AND " + where.replace("from_id", "m.from_id").replace("to_id", "m.to_id"),
                [message_id] + params,
            ).fetchone()
        return (r[0], bytes(r[1])) if r else None

    def cleared_since(self, user_id, version):
        return sorted(
            {peer for v, peer in self.cleared.get(user_id, []) if v > version}
        )

    def last_clear(self, user_id):
        return max([v for v, _ in self.cleared.get(user_id, [])] or [0])

    def mark_read(self, user_id, peer_id, last_id):
        with self.lock, self.connect() as db:
            db.execute(
                """INSERT INTO chat_read (user_id, peer_id, last_id) VALUES (?, ?, ?) ON CONFLICT (user_id, peer_id)
                          DO UPDATE SET last_id = max(last_id, excluded.last_id)""",
                (user_id, peer_id, last_id),
            )

    def wait(self, user_id, after, typing_known, clear_known, avail_known=0, presence_known=None, focus_known=None):
        """Until a message newer than `after` concerns this user, or who is typing to them differs from typing_known
        (a sorted list), or a conversation of theirs was deleted after clear_known, or CHAT_POLL_SECONDS pass. Typing
        signals expire without a notification: re-checked every second."""
        deadline = time.time() + CHAT_POLL_SECONDS
        with self.changed:
            while True:
                typing = self.typing_to(user_id)
                if (
                    self.newest(user_id) > after
                    or typing != typing_known
                    or self.last_clear(user_id) > clear_known
                    or self.avail_ver > avail_known
                    or (presence_known is not None and self.presence_ver > presence_known)
                    or (focus_known is not None and self.focus_ver > focus_known)
                    or time.time() >= deadline
                ):
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
            rows = pool.query(
                """SELECT id::text, username, name FROM public.users WHERE NOT deleted AND status = 'active'
                                 AND rbac_roles && $1::text[] ORDER BY last_seen_at DESC NULLS LAST LIMIT 50""",
                ["{%s}" % ",".join(sorted(ADMIN_ROLES))],
            )
            admins = [
                {"id": r[0], "username": r[1], "name": r[2] or "", "admin": True}
                for r in rows
            ]
    except Exception as e:  # noqa: BLE001 - no list rather than an error
        log(event="chat-admins-failed", error=str(e)[:200])
    CACHE.put("chat-admins", admins, 60)
    return admins


# --------------------------------------------------------------------------- Keycloak status (General sidebar check)
def keycloak_status():
    """Whether this service can use Keycloak's admin API (General's sidebar marks Authentication with it), cached for 30
    seconds: the sign-in itself, without the full report's checks."""
    hit = CACHE.get("kc-status")
    if hit is not None:
        return hit
    status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
    url = kc_settings(container_env(dep) if status == 200 else {})[0].get("keycloakUrl") or ""
    if not url:
        out = {"connected": False, "keycloakUrl": None, "reason": "Keycloak's address is unknown"}
    else:
        kc = Keycloak(url)
        ok = kc.login()
        out = {"connected": ok, "keycloakUrl": url, "via": kc.via if ok else None,
               "reason": None if ok else (kc.secret_state or kc.error or "not connected")}
    CACHE.put("kc-status", out, 30)
    return out


# --------------------------------------------------------------------------- User quota (Health > User Quota)
# Per developer: how many workspaces, and how many CPU cores / GiB of memory those workspaces may be built with in all
# (the template's "cpu" and "memory" parameters). A default for everyone, overrides per user; empty = no limit. Coder
# (the platform build) asks /api/quota/check before it creates a workspace and refuses when a limit would be passed.
QUOTA_DEFAULT = {"default": {"workspaces": None, "cpu": None, "memory": None}, "users": {}, "exemptAdmins": True}
QUOTA_KEYS = ("workspaces", "cpu", "memory")
QUOTA_PARAMS = {"cpu": "cpu", "memory": "memory"}   # template parameter names: cores, GiB


def quota_settings():
    s = STORE.get_setting("user_quota", None) or {}
    return {"default": {k: (s.get("default") or {}).get(k) for k in QUOTA_KEYS},
            "users": {u: {k: v for k, v in (o or {}).items() if k in QUOTA_KEYS} for u, o in (s.get("users") or {}).items()},
            "exemptAdmins": s.get("exemptAdmins", True) is not False}


def _quota_number(v, what, integer=False):
    if v in (None, ""):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ValueError("%s must be a number (or empty for no limit)." % what)
    if n < 0 or n > 1e6 or (integer and n != int(n)):
        raise ValueError("%s must be a %s between 0 and 1,000,000." % (what, "whole number" if integer else "number"))
    return int(n) if integer else round(n, 3)


def clean_quota(raw):
    def limits(o, who):
        o = o or {}
        return {k: _quota_number(o.get(k), "%s: %s" % (who, {"workspaces": "Workspaces", "cpu": "CPU cores", "memory": "Memory (GiB)"}[k]),
                                 integer=k == "workspaces") for k in QUOTA_KEYS if k in o}
    users = {}
    for name, o in (raw.get("users") or {}).items():
        if not re.match(r"^[A-Za-z0-9._@-]{1,64}$", str(name)):
            raise ValueError("Unknown user name %r." % name)
        users[str(name)] = limits(o, name)
    d = limits(raw.get("default") or {}, "Default")
    return {"default": {k: d.get(k) for k in QUOTA_KEYS}, "users": users, "exemptAdmins": raw.get("exemptAdmins", True) is not False}


def quota_limits(settings, username):
    """The limits for one user: their overrides where set (None there = no limit), else the default."""
    own = settings["users"].get(username) or {}
    return {k: own[k] if k in own else settings["default"].get(k) for k in QUOTA_KEYS}


def _coder_get(token, path, timeout=10):
    return http_json(CODER_URL + path, headers={"Coder-Session-Token": token}, timeout=timeout)


def _coder_send(token, method, path, body=None, timeout=15):
    return http_json(CODER_URL + path, method=method, body=body, headers={"Coder-Session-Token": token},
                     timeout=timeout)


def _param_resources(params):
    """(cores, GiB) from a build's or a request's parameters ([{name, value}])."""
    vals = {p.get("name"): p.get("value") for p in params or []}
    out = []
    for key in ("cpu", "memory"):
        try:
            out.append(max(float(vals.get(QUOTA_PARAMS[key]) or 0), 0.0))
        except (TypeError, ValueError):
            out.append(0.0)
    return tuple(out)


def quota_workspaces(token, owner=None):
    """Every workspace (of `owner`, else all the token can see) with the cores / GiB it was built with."""
    q = {"limit": 1000}
    if owner:
        q["q"] = "owner:" + owner
    status, data = _coder_get(token, "/api/v2/workspaces?" + urllib.parse.urlencode(q))
    if status != 200 or not isinstance(data, dict):
        raise RuntimeError("Coder's workspaces API answered HTTP %s" % status)
    out = []
    for w in data.get("workspaces") or []:
        build = w.get("latest_build") or {}
        key = "build-params:" + str(build.get("id"))
        params = CACHE.get(key)
        if params is None and build.get("id"):
            st, params = _coder_get(token, "/api/v2/workspacebuilds/%s/parameters" % build["id"])
            params = params if st == 200 and isinstance(params, list) else []
            CACHE.put(key, params, 3600)   # a build's parameters never change
        cpu, mem = _param_resources(params)
        out.append({"id": w.get("id"), "name": w.get("name"), "owner": w.get("owner_name"), "ownerId": w.get("owner_id"),
                    "template": w.get("template_display_name") or w.get("template_name"), "cpu": cpu, "memory": mem,
                    "status": build.get("status"), "running": build.get("status") == "running" and build.get("transition") == "start"})
    return out


def _pod_usage_by_owner():
    """Live CPU (cores) / memory (GiB) of workspace pods per owner, from metrics-server; {} without it."""
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods" % WORKSPACE_NAMESPACE)
    if status != 200:
        return {}
    owner_of = {(p.get("metadata") or {}).get("name"): ((p.get("metadata") or {}).get("labels") or {}).get("com.coder.user.username")
                for p in pods.get("items") or [] if ((p.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")}
    status, usage = KUBE.call("GET", "/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods" % WORKSPACE_NAMESPACE)
    if status != 200:
        return {}
    out = {}
    for item in usage.get("items") or []:
        owner = owner_of.get((item.get("metadata") or {}).get("name"))
        if not owner:
            continue
        acc = out.setdefault(owner, {"cpu": 0.0, "memory": 0.0})
        for c in item.get("containers") or []:
            acc["cpu"] += quantity((c.get("usage") or {}).get("cpu")) or 0
            acc["memory"] += (quantity((c.get("usage") or {}).get("memory")) or 0) / 1024 ** 3
    return out


def quota_report(token):
    """Health > User Quota: the settings, every active user's limits and what their workspaces take (built with,
    running, live), and the cluster's capacity, so an admin sees how taxed the cluster is."""
    settings = quota_settings()
    users, offset = [], 0
    while offset < 5000:
        status, page = _coder_get(token, "/api/v2/users?" + urllib.parse.urlencode({"q": "status:active", "limit": 500, "offset": offset}))
        if status != 200:
            raise RuntimeError("Coder's users API answered HTTP %s" % status)
        rows = page.get("users") or []
        users += rows
        if len(rows) < 500:
            break
        offset += 500
    workspaces = quota_workspaces(token)
    live = _pod_usage_by_owner()
    out_users = []
    for u in users:
        name = u.get("username") or ""
        mine = [w for w in workspaces if w["owner"] == name]
        admin = bool({r.get("name") for r in u.get("roles") or []} & ADMIN_ROLES)
        limits = quota_limits(settings, name)
        usage = {"workspaces": len(mine), "cpu": sum(w["cpu"] for w in mine), "memory": sum(w["memory"] for w in mine),
                 "runningCpu": sum(w["cpu"] for w in mine if w["running"]), "runningMemory": sum(w["memory"] for w in mine if w["running"]),
                 "running": sum(1 for w in mine if w["running"]), "liveCpu": (live.get(name) or {}).get("cpu"),
                 "liveMemory": (live.get(name) or {}).get("memory")}
        exempt = admin and settings["exemptAdmins"]
        out_users.append({"id": u.get("id"), "username": name, "name": u.get("name") or "", "avatar": u.get("avatar_url") or "",
                          "admin": admin, "exempt": exempt, "override": settings["users"].get(name) or None, "limits": limits,
                          "usage": usage, "atLimit": (not exempt) and any(limits[k] is not None and usage[k] >= limits[k] for k in QUOTA_KEYS),
                          "workspaces": mine})
    out_users.sort(key=lambda x: (-(x["usage"]["cpu"] + x["usage"]["memory"]), x["username"].lower()))
    try:
        cluster = cluster_usage()
        cluster = {"cpu": cluster["cpu"]["total"], "memory": cluster["memory"]["total"] / 1024 ** 3,
                   "usedCpu": cluster["cpu"]["used"], "usedMemory": cluster["memory"]["used"] / 1024 ** 3,
                   "requestedCpu": cluster["cpu"]["requested"], "requestedMemory": cluster["memory"]["requested"] / 1024 ** 3,
                   "nodes": cluster["nodes"], "live": cluster["live"]}
    except Exception as e:  # noqa: BLE001 - the page still works without the cluster's totals
        cluster = {"error": str(e)[:200]}
    return {"settings": settings, "users": out_users, "cluster": cluster, "liveUsage": bool(live),
            "parameters": dict(QUOTA_PARAMS), "generatedAt": now()}


GATEWAY_NAME = os.environ.get("GATEWAY_NAME", "")
GATEWAY_NAMESPACE = os.environ.get("GATEWAY_NAMESPACE", "")


def dashboard_address():
    """Where users reach the dashboard: its host name (Coder's access URL) and the addresses of the Gateway in front
    of it (its status: a load balancer's IP or host name). Cached a minute."""
    cached = CACHE.get("dashboard-address")
    if cached is not None:
        return cached
    host = urllib.parse.urlsplit(CODER_ACCESS_URL).hostname or ""
    addresses = []
    if GATEWAY_NAME and GATEWAY_NAMESPACE:
        status, gw = KUBE.call("GET", "/apis/gateway.networking.k8s.io/v1/namespaces/%s/gateways/%s" % (
            urllib.parse.quote(GATEWAY_NAMESPACE), urllib.parse.quote(GATEWAY_NAME)))
        if status == 200 and isinstance(gw, dict):
            addresses = [a.get("value") for a in (gw.get("status") or {}).get("addresses") or [] if a.get("value")]
    out = {"host": host, "addresses": addresses,
           "gateway": "%s/%s" % (GATEWAY_NAMESPACE, GATEWAY_NAME) if GATEWAY_NAME else ""}
    CACHE.put("dashboard-address", out, 60)
    return out

def quota_me(token, user):
    """The Workspaces page's quota pill: the caller's own limits and what their workspaces take. "limited" is false
    for no limit at all, or an exempt admin - the pill then stays away."""
    settings = quota_settings()
    limits = quota_limits(settings, user["username"])
    exempt = bool(settings["exemptAdmins"] and set(user["roles"]) & ADMIN_ROLES)
    if exempt or all(limits[k] is None for k in QUOTA_KEYS):
        return {"limited": False, "exempt": exempt, "limits": limits}
    mine = quota_workspaces(token, owner=user["username"])
    usage = {"workspaces": len(mine), "cpu": sum(w["cpu"] for w in mine), "memory": sum(w["memory"] for w in mine)}
    left = {k: (None if limits[k] is None else max(limits[k] - usage[k], 0)) for k in QUOTA_KEYS}
    return {"limited": True, "exempt": False, "limits": limits, "usage": usage, "left": left,
            "atLimit": any(left[k] is not None and left[k] <= 0 for k in QUOTA_KEYS)}

def quota_check(token, user, body):
    """Before Coder creates a workspace: would it pass the owner's limits? {"allowed", "message", ...}. Asked by Coder
    with the requester's own session, so it sees exactly what they may see."""
    settings = quota_settings()
    owner = str(body.get("owner") or "me")
    if owner in ("me", user["username"], user["id"]):
        target = {"username": user["username"], "id": user["id"], "roles": user["roles"]}
    else:
        status, u = _coder_get(token, "/api/v2/users/%s" % urllib.parse.quote(owner))
        if status != 200 or not isinstance(u, dict):
            return {"allowed": True, "message": "owner not readable; not checked"}
        target = {"username": u.get("username"), "id": u.get("id"), "roles": sorted({r.get("name") for r in u.get("roles") or []})}
    limits = quota_limits(settings, target["username"])
    if settings["exemptAdmins"] and set(target["roles"]) & ADMIN_ROLES:
        return {"allowed": True, "message": "admins are exempt", "limits": limits}
    if all(limits[k] is None for k in QUOTA_KEYS):
        return {"allowed": True, "message": "no limits", "limits": limits}
    # what the new workspace asks for: its parameters, else the template version's defaults
    params = {p.get("name"): p.get("value") for p in body.get("rich_parameter_values") or [] if isinstance(p, dict)}
    version = body.get("template_version_id")
    if not version and body.get("template_id"):
        st, t = _coder_get(token, "/api/v2/templates/%s" % body["template_id"])
        version = (t or {}).get("active_version_id") if st == 200 and isinstance(t, dict) else None
    if version:
        st, rich = _coder_get(token, "/api/v2/templateversions/%s/rich-parameters" % version)
        for p in rich if st == 200 and isinstance(rich, list) else []:
            params.setdefault(p.get("name"), p.get("default_value"))
    want_cpu, want_mem = _param_resources([{"name": k, "value": v} for k, v in params.items()])
    mine = quota_workspaces(token, owner=target["username"])
    usage = {"workspaces": len(mine), "cpu": sum(w["cpu"] for w in mine), "memory": sum(w["memory"] for w in mine)}
    after = {"workspaces": usage["workspaces"] + 1, "cpu": usage["cpu"] + want_cpu, "memory": usage["memory"] + want_mem}
    fmt = lambda v: ("%g" % round(v, 2))  # noqa: E731
    over = []
    if limits["workspaces"] is not None and after["workspaces"] > limits["workspaces"]:
        over.append("workspaces: %d of %d already" % (usage["workspaces"], limits["workspaces"]))
    if limits["cpu"] is not None and after["cpu"] > limits["cpu"]:
        over.append("CPU: this one needs %s cores, %s of %s cores are taken" % (fmt(want_cpu), fmt(usage["cpu"]), fmt(limits["cpu"])))
    if limits["memory"] is not None and after["memory"] > limits["memory"]:
        over.append("memory: this one needs %s GiB, %s of %s GiB are taken" % (fmt(want_mem), fmt(usage["memory"]), fmt(limits["memory"])))
    if over:
        who = "Your" if target["username"] == user["username"] else "%s's" % target["username"]
        return {"allowed": False, "limits": limits, "usage": usage, "request": {"cpu": want_cpu, "memory": want_mem},
                "message": "%s workspace quota is reached (%s). Delete or shrink a workspace, or ask an admin to raise the "
                           "quota in Health > User Quota." % (who, "; ".join(over))}
    return {"allowed": True, "message": "within quota", "limits": limits, "usage": usage, "request": {"cpu": want_cpu, "memory": want_mem}}


# --------------------------------------------------------------------------- Global Workspace Scheduler (Health > User Quota)
# Makes every workspace have a start and a stop time. "user": each user picks their own (a daily start time on chosen
# days, and a stop time, i.e. Coder's autostart schedule and its time-to-stop); "fixed": the admin's schedule applies to
# every workspace. Optionally a cap on how long a workspace may stay up after it starts. Admins can be left out, and
# users excluded by name. Coder (the platform build) asks /api/scheduler/check before it creates a workspace or changes
# a schedule, and refuses (or, "fixed", applies the admin's schedule); the dashboard asks /api/scheduler/me and makes
# the user fix workspaces that break the rules before going on.
SCHEDULER_DEFAULT = {"enabled": False, "mode": "user",
                     "fixed": {"start": "08:00", "stop": "18:00", "days": [1, 2, 3, 4, 5], "timezone": "UTC"},
                     "maxActiveHours": None, "ignoreAdmins": True, "excludedUsers": []}
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def scheduler_settings():
    s = STORE.get_setting("workspace_scheduler", None) or {}
    out = json.loads(json.dumps(SCHEDULER_DEFAULT))
    out.update({k: v for k, v in s.items() if k in SCHEDULER_DEFAULT})
    out["fixed"] = {**SCHEDULER_DEFAULT["fixed"], **(s.get("fixed") or {})}
    return out


def clean_scheduler(raw):
    mode = raw.get("mode", "user")
    if mode not in ("user", "fixed"):
        raise ValueError("Mode must be \"user\" or \"fixed\".")
    fixed = raw.get("fixed") or {}
    start, stop = str(fixed.get("start") or "08:00"), str(fixed.get("stop") or "18:00")
    if not _HHMM.match(start) or not _HHMM.match(stop):
        raise ValueError("Start and stop times must be HH:MM (24-hour).")
    if start == stop:
        raise ValueError("The stop time must differ from the start time.")
    days = sorted({int(d) for d in fixed.get("days") or [] if str(d).isdigit() and 0 <= int(d) <= 6})
    if mode == "fixed" and not days:
        raise ValueError("Pick at least one day for the schedule.")
    tz = str(fixed.get("timezone") or "UTC")
    if not re.match(r"^[A-Za-z0-9_+\-/]{1,64}$", tz):
        raise ValueError("Unknown time zone %r." % tz)
    hours = raw.get("maxActiveHours")
    if hours in (None, "", 0):
        hours = None
    else:
        try:
            hours = round(float(hours), 2)
        except (TypeError, ValueError):
            raise ValueError("The maximum active time must be a number of hours.")
        if not 0.5 <= hours <= 168:
            raise ValueError("The maximum active time must be between 0.5 and 168 hours.")
    if mode == "fixed" and hours and _fixed_ttl_ms(start, stop) > hours * 3600000:
        raise ValueError("The schedule (%s to %s) is longer than the maximum active time (%g h)." % (start, stop, hours))
    excluded = []
    for name in raw.get("excludedUsers") or []:
        if not re.match(r"^[A-Za-z0-9._@-]{1,64}$", str(name)):
            raise ValueError("Unknown user name %r." % name)
        if str(name) not in excluded:
            excluded.append(str(name))
    return {"enabled": raw.get("enabled") is True, "mode": mode,
            "fixed": {"start": start, "stop": stop, "days": days, "timezone": tz},
            "maxActiveHours": hours, "ignoreAdmins": raw.get("ignoreAdmins", True) is not False,
            "excludedUsers": excluded}


def _fixed_ttl_ms(start, stop):
    (h1, m1), (h2, m2) = (map(int, start.split(":")), map(int, stop.split(":")))
    minutes = (h2 * 60 + m2) - (h1 * 60 + m1)
    return (minutes if minutes > 0 else minutes + 24 * 60) * 60000


def fixed_schedule(settings):
    """The admin's schedule as Coder stores it: an autostart cron (CRON_TZ=<tz> M H * * <days>) and a time-to-stop."""
    f = settings["fixed"]
    h, m = map(int, f["start"].split(":"))
    days = "*" if len(f["days"]) == 7 else ",".join(str(d) for d in f["days"])
    return {"autostart_schedule": "CRON_TZ=%s %d %d * * %s" % (f["timezone"], m, h, days),
            "ttl_ms": _fixed_ttl_ms(f["start"], f["stop"])}


def scheduler_exempt(settings, username, roles):
    if not settings["enabled"]:
        return "the scheduler is off"
    if username in settings["excludedUsers"]:
        return "excluded"
    if settings["ignoreAdmins"] and set(roles) & ADMIN_ROLES:
        return "admins are not required"
    return ""


def schedule_problem(settings, autostart, ttl_ms):
    """Why a workspace's schedule breaks the rules, or "" when it complies."""
    if settings["mode"] == "fixed":
        want = fixed_schedule(settings)
        if (autostart or "") != want["autostart_schedule"] or (ttl_ms or 0) != want["ttl_ms"]:
            return "it must use the required schedule"
        return ""
    if not autostart:
        return "it has no start time"
    if not ttl_ms or ttl_ms <= 0:
        return "it has no stop time"
    cap = settings["maxActiveHours"]
    if cap and ttl_ms > cap * 3600000:
        return "it stays up %g h, more than the %g h allowed" % (round(ttl_ms / 3600000, 2), cap)
    return ""


def _scheduler_target(token, user, owner):
    owner = str(owner or "me")
    if owner in ("me", user["username"], user["id"]):
        return {"username": user["username"], "id": user["id"], "roles": user["roles"]}
    status, u = _coder_get(token, "/api/v2/users/%s" % urllib.parse.quote(owner))
    if status != 200 or not isinstance(u, dict):
        return None
    return {"username": u.get("username"), "id": u.get("id"), "roles": sorted({r.get("name") for r in u.get("roles") or []})}


def scheduler_check(token, user, body):
    """Before Coder creates a workspace (action "create") or changes its start ("autostart") or stop ("ttl") time:
    {"allowed", "message", "apply"?}. "apply" (mode "fixed", on create) is the schedule Coder sets on the workspace."""
    settings = scheduler_settings()
    target = _scheduler_target(token, user, body.get("owner"))
    if target is None:
        return {"allowed": True, "message": "owner not readable; not checked"}
    why = scheduler_exempt(settings, target["username"], target["roles"])
    if why:
        return {"allowed": True, "message": why}
    action = body.get("action") or "create"
    autostart, ttl = body.get("autostart_schedule") or "", body.get("ttl_ms")
    if settings["mode"] == "fixed":
        want = fixed_schedule(settings)
        if action == "create":
            return {"allowed": True, "message": "the required schedule is applied", "apply": want}
        want_part = {"autostart": (autostart or "") == want["autostart_schedule"],
                     "ttl": (ttl or 0) == want["ttl_ms"]}.get(action, not schedule_problem(settings, autostart, ttl))
        if not want_part:
            return {"allowed": False, "message": "An administrator sets every workspace's schedule (%s to %s, %s). "
                    "It cannot be changed here." % (settings["fixed"]["start"], settings["fixed"]["stop"],
                                                     settings["fixed"]["timezone"])}
        return {"allowed": True, "message": "the required schedule"}
    # A change is judged on its own half (start time, or stop time), so a schedule can be set in two steps; creating
    # a workspace needs both, and the dashboard makes users complete them.
    if action == "autostart":
        problem = "" if autostart else "it has no start time"
    elif action == "ttl":
        problem = schedule_problem(settings, "-", ttl)
    else:
        problem = schedule_problem(settings, autostart, ttl)
    if problem:
        cap = settings["maxActiveHours"]
        rule = "Every workspace needs a start time and a stop time" + (" (up to %g hours apart)" % cap if cap else "")
        return {"allowed": False, "message": "%s: %s. Set them in the workspace's schedule." % (rule, problem)}
    return {"allowed": True, "message": "the schedule complies"}


def _workspace_schedules(token, owner=None):
    q = {"limit": 1000}
    if owner:
        q["q"] = "owner:" + owner
    status, data = _coder_get(token, "/api/v2/workspaces?" + urllib.parse.urlencode(q))
    if status != 200 or not isinstance(data, dict):
        raise RuntimeError("Coder's workspaces API answered HTTP %s" % status)
    return [{"id": w.get("id"), "name": w.get("name"), "owner": w.get("owner_name"),
             "autostart_schedule": w.get("autostart_schedule") or None, "ttl_ms": w.get("ttl_ms") or None}
            for w in data.get("workspaces") or []]


def scheduler_me(token, user):
    """For the dashboard: the rules that apply to this user, and their workspaces that break them."""
    settings = scheduler_settings()
    why = scheduler_exempt(settings, user["username"], user["roles"])
    out = {"enforced": not why, "reason": why, "mode": settings["mode"], "maxActiveHours": settings["maxActiveHours"]}
    if settings["mode"] == "fixed":
        out["fixed"] = dict(settings["fixed"], **fixed_schedule(settings))
    if why:
        out["workspaces"] = []
        return out
    rows = []
    for w in _workspace_schedules(token, owner=user["username"]):
        problem = schedule_problem(settings, w["autostart_schedule"], w["ttl_ms"])
        rows.append(dict(w, compliant=not problem, problem=problem))
    out["workspaces"] = rows
    return out


def scheduler_report(token):
    """Health > User Quota > Global Workspace Scheduler: the settings and the workspaces that break them."""
    settings = scheduler_settings()
    users, offset = {}, 0
    while offset < 5000:
        status, page = _coder_get(token, "/api/v2/users?" + urllib.parse.urlencode({"q": "status:active", "limit": 500, "offset": offset}))
        if status != 200:
            raise RuntimeError("Coder's users API answered HTTP %s" % status)
        rows = page.get("users") or []
        for u in rows:
            users[u.get("username")] = sorted({r.get("name") for r in u.get("roles") or []})
        if len(rows) < 500:
            break
        offset += 500
    workspaces, broken, exempt = _workspace_schedules(token), [], 0
    for w in workspaces:
        if scheduler_exempt(settings, w["owner"], users.get(w["owner"], [])):
            exempt += 1
            continue
        problem = schedule_problem(settings, w["autostart_schedule"], w["ttl_ms"])
        if problem:
            broken.append(dict(w, problem=problem))
    out = {"settings": settings, "workspaces": len(workspaces), "exempt": exempt, "noncompliant": broken,
           "users": sorted(users), "generatedAt": now()}
    if settings["mode"] == "fixed":
        out["fixedSchedule"] = fixed_schedule(settings)
    return out


# --------------------------------------------------------------------------- Security posture (General > Monitoring)
# Zero-trust checks and runtime signals no other page shows: who holds privilege and how they sign in, what is exposed
# beyond its owner, how workspace pods run, and what is failing. Each check: severity critical | warning | ok | unknown,
# a summary, the items behind it and how to fix them. Read with the requesting admin's session (Coder), the service's
# own Kubernetes access (pods, network policies in the workspace namespace) and Keycloak admin access (MFA).
POSTURE_IDLE_DAYS = 30
POSTURE_TOKEN_MAX_DAYS = 30


def _ts(iso):
    """Epoch seconds of an RFC 3339 time, or None (Coder writes 0001-01-01 for "never")."""
    if not iso or str(iso).startswith("0001-"):
        return None
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _days_since(iso):
    t = _ts(iso)
    return None if t is None else (time.time() - t) / 86400


def _check(cid, category, title, severity, summary, items=None, fix=""):
    return {"id": cid, "category": category, "title": title, "severity": severity, "summary": summary,
            "items": (items or [])[:200], "count": len(items or []), "fix": fix}


def _all_users(token):
    users, offset = [], 0
    while offset < 5000:
        status, page = _coder_get(token, "/api/v2/users?" + urllib.parse.urlencode({"q": "status:active", "limit": 500, "offset": offset}))
        if status != 200:
            raise RuntimeError("Coder's users API answered HTTP %s" % status)
        rows = page.get("users") or []
        users += rows
        if len(rows) < 500:
            break
        offset += 500
    return users


def _mfa_check(users):
    """OIDC users whose Keycloak account has no second factor (OTP or WebAuthn)."""
    status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
    settings = kc_settings(container_env(dep) if status == 200 else {})[0]
    url, realm = settings.get("keycloakUrl") or "", settings.get("realm") or "master"
    oidc = [u for u in users if u.get("login_type") == "oidc" and u.get("email")]
    if not url:
        return _check("identity.mfa", "Identity", "Multi-factor sign-in", "unknown", "Keycloak's address is unknown.")
    kc = Keycloak(url)
    if not kc.login():
        return _check("identity.mfa", "Identity", "Multi-factor sign-in", "unknown",
                      "Keycloak's admin API is not reachable (%s)." % (kc.secret_state or kc.error or "no access"))
    missing = []
    for u in oidc[:500]:
        found = kc.api("GET", "/%s/users?%s" % (realm, urllib.parse.urlencode({"email": u["email"], "exact": "true"}))) or []
        if not found:
            continue
        creds = kc.api("GET", "/%s/users/%s/credentials" % (realm, found[0]["id"])) or []
        types = {c.get("type") for c in creds}
        if not types & {"otp", "webauthn", "webauthn-passwordless"} and not (found[0].get("requiredActions") or []).count("CONFIGURE_TOTP"):
            missing.append({"label": u.get("username"), "note": u.get("email")})
    if not oidc:
        return _check("identity.mfa", "Identity", "Multi-factor sign-in", "ok", "No Keycloak (OIDC) accounts yet.")
    sev = "warning" if missing else "ok"
    return _check("identity.mfa", "Identity", "Multi-factor sign-in", sev,
                  "%d of %d Keycloak accounts have no second factor (OTP or security key)." % (len(missing), len(oidc))
                  if missing else "Every Keycloak account has a second factor.",
                  missing, "In Keycloak, require OTP or WebAuthn (Authentication > Required actions, or a flow with a "
                           "conditional OTP step) for the Coder realm.")


def monitoring_posture(token):
    hit = CACHE.get("posture:" + token[:16])
    if hit is not None:
        return hit
    checks = []
    users = _all_users(token)
    roles_of = {u.get("username"): {r.get("name") for r in u.get("roles") or []} for u in users}

    # ---- Identity: privilege, sign-in method, dormant accounts, MFA, tokens
    admins = [u for u in users if roles_of[u.get("username")] & ADMIN_ROLES]
    idle_admins = [u for u in admins if (_days_since(u.get("last_seen_at")) or 10 ** 6) > POSTURE_IDLE_DAYS]
    checks.append(_check(
        "identity.privileged", "Identity", "Privileged accounts", "warning" if idle_admins or len(admins) > 5 else "ok",
        "%d accounts hold administrator roles%s." % (len(admins), ", %d of them unused for %d+ days" % (len(idle_admins), POSTURE_IDLE_DAYS) if idle_admins else ""),
        [{"label": u.get("username"), "note": "%s · last seen %s" % (", ".join(sorted(roles_of[u.get("username")] & ADMIN_ROLES)),
          "never" if _days_since(u.get("last_seen_at")) is None else "%d d ago" % _days_since(u.get("last_seen_at")))} for u in admins],
        "Keep few administrators; remove the role from accounts that do not need it, suspend unused ones."))
    pw = [u for u in users if u.get("login_type") == "password"]
    checks.append(_check(
        "identity.password", "Identity", "Accounts that bypass SSO", "warning" if pw else "ok",
        "%d accounts sign in with a password instead of Keycloak (no SSO policy or MFA applies to them)." % len(pw) if pw else "Everyone signs in with Keycloak.",
        [{"label": u.get("username"), "note": "admin" if u in admins else "user"} for u in pw],
        "Give each person a Keycloak account; keep at most one break-glass password admin, with a strong password."))
    dormant = [u for u in users if (_days_since(u.get("last_seen_at")) or 10 ** 6) > POSTURE_IDLE_DAYS]
    checks.append(_check(
        "identity.dormant", "Identity", "Dormant accounts", "warning" if dormant else "ok",
        "%d active accounts have not been used for %d+ days." % (len(dormant), POSTURE_IDLE_DAYS) if dormant else "Every active account was used in the last %d days." % POSTURE_IDLE_DAYS,
        [{"label": u.get("username"), "note": "never signed in" if _days_since(u.get("last_seen_at")) is None else "%d days" % _days_since(u.get("last_seen_at"))} for u in dormant],
        "Suspend accounts that are no longer used (Admin > Accounts); they keep their workspaces."))
    try:
        checks.append(_mfa_check(users))
    except Exception as e:  # noqa: BLE001
        checks.append(_check("identity.mfa", "Identity", "Multi-factor sign-in", "unknown", "Not checked: %s" % str(e)[:160]))
    status, toks = _coder_get(token, "/api/v2/users/me/keys/tokens?include_all=true")
    if status == 200 and isinstance(toks, list):
        risky = []
        for t in toks:
            life = (t.get("lifetime_seconds") or 0) / 86400
            unused = _days_since(t.get("last_used"))
            age = _days_since(t.get("created_at")) or 0
            why = []
            if life > POSTURE_TOKEN_MAX_DAYS:
                why.append("valid %d days" % life)
            if unused is None and age > 7:
                why.append("never used")
            elif unused is not None and unused > POSTURE_IDLE_DAYS:
                why.append("unused %d days" % unused)
            if why:
                risky.append({"label": "%s / %s" % (t.get("username") or "?", t.get("token_name") or t.get("id")), "note": ", ".join(why)})
        checks.append(_check(
            "access.tokens", "Identity", "API tokens", "warning" if risky else "ok",
            "%d of %d API tokens are long-lived or unused." % (len(risky), len(toks)) if risky else "%d API tokens, none long-lived or stale." % len(toks),
            risky, "Delete stale tokens; cap token lifetimes (--max-token-lifetime) and prefer short-lived sessions."))
    else:
        checks.append(_check("access.tokens", "Identity", "API tokens", "unknown", "Coder's tokens API answered HTTP %s." % status))

    # ---- Exposure, agents and builds (one pass over the workspaces)
    status, data = _coder_get(token, "/api/v2/workspaces?" + urllib.parse.urlencode({"limit": 1000}))
    workspaces = (data or {}).get("workspaces") or [] if status == 200 else []
    st, info = _coder_get(token, "/api/v2/buildinfo")
    server_version = str((info or {}).get("version") or "").split("+")[0] if st == 200 else ""
    ports, apps, offline, outdated, failed, no_stop = [], [], [], [], [], []
    for w in workspaces:
        name = "%s/%s" % (w.get("owner_name"), w.get("name"))
        build = w.get("latest_build") or {}
        running = build.get("status") == "running" and build.get("transition") == "start"
        if build.get("status") == "failed":
            failed.append({"label": name, "note": ((build.get("job") or {}).get("error") or "build failed")[:140]})
        if running and not w.get("ttl_ms"):
            no_stop.append({"label": name, "note": "running, no stop time"})
        for res in build.get("resources") or []:
            for a in res.get("agents") or []:
                if running and a.get("status") in ("disconnected", "timeout"):
                    offline.append({"label": "%s.%s" % (name, a.get("name")), "note": a.get("status")})
                ver = str(a.get("version") or "").split("+")[0]
                if running and ver and server_version and ver != server_version:
                    outdated.append({"label": "%s.%s" % (name, a.get("name")), "note": "agent %s, server %s" % (ver, server_version)})
                for app in a.get("apps") or []:
                    if app.get("sharing_level") in ("public", "authenticated", "organization"):
                        apps.append({"label": "%s · %s" % (name, app.get("display_name") or app.get("slug")), "note": app.get("sharing_level"),
                                     "level": app.get("sharing_level")})
        if running:
            stp, shares = _coder_get(token, "/api/v2/workspaces/%s/port-share" % w.get("id"))
            for sh in (shares or {}).get("shares") or [] if stp == 200 else []:
                ports.append({"label": "%s · port %s" % (name, sh.get("port")), "note": "%s (%s)" % (sh.get("share_level"), sh.get("protocol")),
                              "level": sh.get("share_level")})
    exposed = ports + apps
    public = [x for x in exposed if x.get("level") == "public"]
    checks.append(_check(
        "exposure.shared", "Exposure", "Shared ports and apps", "critical" if public else "warning" if exposed else "ok",
        ("%d shared beyond their owner, %d of them public (anyone with the link, no sign-in)." % (len(exposed), len(public))) if exposed else "Nothing is shared beyond its owner.",
        [{"label": x["label"], "note": x["note"]} for x in exposed],
        "Share only what is needed and only with signed-in users; public shares bypass Coder's sign-in entirely."))

    # ---- Runtime: workspace pods (security context, images), network policies, restarts
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods" % WORKSPACE_NAMESPACE)
    pods = [p for p in (pods or {}).get("items") or [] if ((p.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")] if status == 200 else []
    privileged, rootish, images, restarts = [], [], [], []
    for pod in pods:
        meta, spec = pod.get("metadata") or {}, pod.get("spec") or {}
        who = "%s/%s" % ((meta.get("labels") or {}).get("com.coder.user.username"), (meta.get("labels") or {}).get("com.coder.workspace.name"))
        flags = [k for k in ("hostNetwork", "hostPID", "hostIPC") if spec.get(k)]
        flags += ["hostPath %s" % v["hostPath"].get("path") for v in spec.get("volumes") or [] if v.get("hostPath")]
        psc = spec.get("securityContext") or {}
        for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
            sc = c.get("securityContext") or {}
            if sc.get("privileged"):
                flags.append("%s privileged" % c.get("name"))
            uid = sc.get("runAsUser", psc.get("runAsUser"))
            if uid == 0 or (uid is None and not sc.get("runAsNonRoot", psc.get("runAsNonRoot"))):
                rootish.append({"label": who, "note": "container %s may run as root" % c.get("name")})
            img = c.get("image") or ""
            if img.endswith(":latest") or ":" not in img.rsplit("/", 1)[-1]:
                images.append({"label": who, "note": "%s (no fixed version)" % img})
        if flags:
            privileged.append({"label": who, "note": ", ".join(flags)})
        for cs in (pod.get("status") or {}).get("containerStatuses") or []:
            last = ((cs.get("lastState") or {}).get("terminated") or {})
            if cs.get("restartCount") or last.get("reason") == "OOMKilled":
                restarts.append({"label": who, "note": "%s restarted %d× (last: %s)" % (cs.get("name"), cs.get("restartCount") or 0, last.get("reason") or "-")})
    checks.append(_check(
        "runtime.isolation", "Runtime", "Workspace pod isolation", "critical" if privileged else "warning" if rootish else "ok",
        ("%d workspace pods reach into the node (privileged, host namespaces or host paths)." % len(privileged)) if privileged
        else ("%d containers may run as root." % len(rootish)) if rootish else "%d workspace pods run unprivileged, as non-root." % len(pods),
        privileged + rootish, "Run workspaces non-privileged as a non-root user (the template's security_context); never mount host paths."))
    st_np, np = KUBE.call("GET", "/apis/networking.k8s.io/v1/namespaces/%s/networkpolicies" % WORKSPACE_NAMESPACE)
    if st_np == 200:
        policies = (np or {}).get("items") or []
        checks.append(_check(
            "runtime.network", "Runtime", "Network segmentation", "ok" if policies else "warning",
            "%d network policies in namespace %s." % (len(policies), WORKSPACE_NAMESPACE) if policies
            else "No network policy in namespace %s: every workspace can reach every pod and service in the cluster." % WORKSPACE_NAMESPACE,
            [{"label": (x.get("metadata") or {}).get("name"), "note": ", ".join((x.get("spec") or {}).get("policyTypes") or [])} for x in policies],
            "Add a default-deny NetworkPolicy for workspaces, allowing only Coder, DNS and what they need."))
    else:
        checks.append(_check("runtime.network", "Runtime", "Network segmentation", "unknown", "Network policies not readable (HTTP %s)." % st_np))
    checks.append(_check(
        "runtime.images", "Runtime", "Image provenance", "warning" if images else "ok",
        "%d workspace containers use an image without a fixed version." % len(images) if images else "Every workspace image has a fixed version.",
        images, "Pin workspace images to versioned tags (or digests) from your own registry."))

    # ---- Signals
    checks.append(_check("signals.stability", "Signals", "Restarts and out-of-memory kills", "warning" if restarts else "ok",
                         "%d workspace containers restarted." % len(restarts) if restarts else "No workspace container restarted.",
                         restarts, "Look at the workspace's logs (below); raise its memory if it was OOMKilled."))
    checks.append(_check("signals.builds", "Signals", "Failed workspaces", "warning" if failed else "ok",
                         "%d workspaces' latest build failed." % len(failed) if failed else "No workspace's latest build failed.",
                         failed, "Open the workspace's build log; fix the template or the parameters and rebuild."))
    checks.append(_check("signals.agents", "Signals", "Workspace agents", "warning" if offline else "info" if outdated else "ok",
                         ("%d running workspaces' agents are not connected." % len(offline)) if offline
                         else ("%d agents run an older version than the server." % len(outdated)) if outdated else "Every running workspace's agent is connected and current.",
                         offline + outdated, "Restart workspaces whose agent is disconnected; restarting also updates the agent."))
    checks.append(_check("signals.autostop", "Signals", "Workspaces without a stop time", "info" if no_stop else "ok",
                         "%d running workspaces never stop on their own." % len(no_stop) if no_stop else "Every running workspace has a stop time.",
                         no_stop, "Turn on the Global Workspace Scheduler (Health > User Quota) to require stop times."))

    summary = {k: sum(1 for c in checks if c["severity"] == k) for k in ("critical", "warning", "info", "ok", "unknown")}
    out = {"checks": checks, "summary": summary, "workspaces": len(workspaces), "pods": len(pods), "users": len(users),
           "generatedAt": now()}
    CACHE.put("posture:" + token[:16], out, 30)
    return out


# --------------------------------------------------------------------------- HUD (top-level overview, admins)
# The platform at a glance, refreshed every few seconds by the dashboard: totals (users, workspaces, claimed CPU /
# memory / GPUs), who leads (highest live CPU / memory, most GPUs, most workspaces, longest online, most failures,
# highest latency), the workspace failing longest, and the cluster's own figures. Each metric: id, label, group, value
# (a number, or None), unit, and who / what it is about.
HUD_FAILURE_DAYS = 7
GPU_RESOURCE = re.compile(r"(^|/)gpu$|\.com/gpu$|gpu\.")


def _gpus(resources):
    """GPUs a container asks for (limits, else requests): any extended resource named like a GPU."""
    total = 0.0
    for key in ("limits", "requests"):
        for name, v in ((resources or {}).get(key) or {}).items():
            if GPU_RESOURCE.search(name):
                total = max(total, quantity(v) or 0)
        if total:
            break
    return total


def _workspace_failures(token, workspace_id):
    """Failed builds of one workspace in the last HUD_FAILURE_DAYS days (cached two minutes)."""
    key = "hud-failures:" + workspace_id
    hit = CACHE.get(key)
    if hit is not None:
        return hit
    status, builds = _coder_get(token, "/api/v2/workspaces/%s/builds?limit=50" % workspace_id)
    since = time.time() - HUD_FAILURE_DAYS * 86400
    n = sum(1 for b in builds if b.get("status") == "failed" and (_ts(b.get("created_at")) or 0) >= since) \
        if status == 200 and isinstance(builds, list) else 0
    CACHE.put(key, n, 120)
    return n


def _pod_usage_by_workspace():
    """Live CPU (cores) / memory (GiB) of each workspace's pods, by workspace ID, from metrics-server; {} without it."""
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods" % WORKSPACE_NAMESPACE)
    if status != 200:
        return {}
    ws_of = {(p.get("metadata") or {}).get("name"): ((p.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")
             for p in pods.get("items") or []}
    status, usage = KUBE.call("GET", "/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods" % WORKSPACE_NAMESPACE)
    if status != 200:
        return {}
    out = {}
    for item in usage.get("items") or []:
        wid = ws_of.get((item.get("metadata") or {}).get("name"))
        if not wid:
            continue
        acc = out.setdefault(wid, {"cpu": 0.0, "memory": 0.0})
        for c in item.get("containers") or []:
            acc["cpu"] += quantity((c.get("usage") or {}).get("cpu")) or 0
            acc["memory"] += (quantity((c.get("usage") or {}).get("memory")) or 0) / 1024 ** 3
    return out


def _requested(containers, name):
    """What containers ask for of a resource (requests, else limits), in cores / GiB."""
    total = 0.0
    for c in containers or []:
        res = c.get("resources") or {}
        v = quantity((res.get("requests") or {}).get(name)) or quantity((res.get("limits") or {}).get(name)) or 0
        total += v / 1024 ** 3 if name == "memory" else v
    return total


def _leader(rows):
    """The top of [(value, owner, workspace)] rows: (value, owners tied at it, workspace of the first), or None.
    Ties are broken by name, so the answer does not flip between updates."""
    rows = [r for r in rows if r[0]]
    if not rows:
        return None
    top = max(r[0] for r in rows)
    tied = sorted((r for r in rows if abs(r[0] - top) < 1e-9), key=lambda r: (r[1], r[2] or ""))
    return top, sorted({r[1] for r in tied}), tied[0][2]


def _who(lead):
    """'alice', or 'alice +2 tied'."""
    owners = lead[1]
    return owners[0] + (" +%d tied" % (len(owners) - 1) if len(owners) > 1 else "")


def _ws_href(owner, name):
    return "/@%s/%s" % (urllib.parse.quote(owner), urllib.parse.quote(name)) if owner and name else ""


def _workspaces_href(query=""):
    return "/workspaces?" + urllib.parse.urlencode({"filter": query})


def hud_report(token):
    hit = CACHE.get("hud:" + token[:16])
    if hit is not None:
        return hit
    users = _all_users(token)
    status, data = _coder_get(token, "/api/v2/workspaces?" + urllib.parse.urlencode({"limit": 1000}))
    workspaces = (data or {}).get("workspaces") or [] if status == 200 else []
    claimed = {w["id"]: w for w in quota_workspaces(token)}      # cores / GiB each workspace was built with
    live = _pod_usage_by_workspace()                              # live usage per workspace (metrics-server)
    snapshot = cluster_snapshot()
    metrics_live = snapshot["usage"] is not None                  # metrics-server answers (nodes)
    pods = [p for p in snapshot["pods"] if ((p.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")]
    gpu_by_ws, requested = {}, {}
    for pod in pods:
        wid = ((pod.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")
        containers = (pod.get("spec") or {}).get("containers") or []
        gpu_by_ws[wid] = gpu_by_ws.get(wid, 0) + sum(_gpus(c.get("resources")) for c in containers)
        r = requested.setdefault(wid, {"cpu": 0.0, "memory": 0.0})
        r["cpu"] += _requested(containers, "cpu")
        r["memory"] += _requested(containers, "memory")
    gpu_capacity = sum(sum(quantity(v) or 0 for k, v in ((n.get("status") or {}).get("capacity") or {}).items() if GPU_RESOURCE.search(k))
                       for n in snapshot["nodes"])

    def usage(wid, key):
        """A running workspace's CPU / memory: live, else what it was built with, else what its pod requests."""
        if wid in live:
            return live[wid][key]
        built = (claimed.get(wid) or {}).get(key) or 0
        return built or (requested.get(wid) or {}).get(key) or 0

    nowt = time.time()
    per_owner = {}
    cpu_rows, mem_rows, gpu_rows, ping_rows, up_rows = [], [], [], [], []
    running, starting, worst_failure, latencies, disconnected, unhealthy = 0, 0, None, [], 0, 0
    for w in workspaces:
        owner, name, wid = w.get("owner_name") or "?", w.get("name"), w.get("id")
        o = per_owner.setdefault(owner, {"workspaces": 0, "failures": 0, "cpu": 0.0, "memory": 0.0, "gpus": 0.0,
                                         "top": {}})
        o["workspaces"] += 1
        build = w.get("latest_build") or {}
        if build.get("status") in ("pending", "starting", "stopping", "deleting"):
            starting += 1
        if build.get("status") == "running" and build.get("transition") == "start":
            running += 1
            for key, value in (("cpu", usage(wid, "cpu")), ("memory", usage(wid, "memory")), ("gpus", gpu_by_ws.get(wid, 0))):
                o[key] += value
                if value > o["top"].get(key, (0, None))[0]:
                    o["top"][key] = (value, name)      # the owner's workspace that uses the most of it
            up_rows.append((nowt - (_ts(build.get("created_at")) or nowt), owner, name))
            for res in build.get("resources") or []:
                for a in res.get("agents") or []:
                    if a.get("status") != "connected":
                        disconnected += 1
                        continue
                    unhealthy += sum(1 for app in a.get("apps") or [] if app.get("health") == "unhealthy")
                    lat = [v.get("latency_ms") for v in (a.get("latency") or {}).values() if v.get("preferred")] or \
                          [v.get("latency_ms") for v in (a.get("latency") or {}).values()]
                    lat = [x for x in lat if isinstance(x, (int, float))]
                    if lat:
                        latencies.append(min(lat))
                        ping_rows.append((min(lat), owner, name))
        if build.get("status") == "failed":
            since = nowt - (_ts((build.get("job") or {}).get("completed_at")) or _ts(build.get("updated_at")) or nowt)
            if worst_failure is None or since > worst_failure[0]:
                worst_failure = (since, owner, name, ((build.get("job") or {}).get("error") or "")[:120])
    for w in workspaces[:300]:
        per_owner[w.get("owner_name") or "?"]["failures"] += _workspace_failures(token, w.get("id"))
    for owner, o in per_owner.items():
        for key, rows in (("cpu", cpu_rows), ("memory", mem_rows), ("gpus", gpu_rows)):
            rows.append((o[key], owner, (o["top"].get(key) or (0, None))[1]))

    def fmt_hours(sec):
        return "%dd %dh" % (sec // 86400, (sec % 86400) // 3600) if sec >= 86400 else "%dh %dm" % (sec // 3600, (sec % 3600) // 60)

    cpu_claimed = sum(claimed[w["id"]]["cpu"] for w in workspaces if w.get("id") in claimed and claimed[w["id"]]["running"])
    mem_claimed = sum(claimed[w["id"]]["memory"] for w in workspaces if w.get("id") in claimed and claimed[w["id"]]["running"])
    gpu_ws = sum(1 for v in gpu_by_ws.values() if v)
    try:
        cluster = cluster_usage()
    except Exception:  # noqa: BLE001
        cluster = None
    online = sum(1 for u in users if (_days_since(u.get("last_seen_at")) or 10 ** 6) * 1440 <= 5)
    top_cpu, top_mem, top_gpu = _leader(cpu_rows), _leader(mem_rows), _leader(gpu_rows)
    top_ping, top_up = _leader(ping_rows), _leader(up_rows)
    top_ws = _leader([(o["workspaces"], k, None) for k, o in per_owner.items()])
    top_fail = _leader([(o["failures"], k, None) for k, o in per_owner.items()])
    latencies.sort()
    source = "Live, from metrics-server" if metrics_live else "What running workspaces were built with (no metrics-server)"
    ws_cpu_live = sum(v["cpu"] for v in live.values()) if metrics_live else None
    ws_mem_live = sum(v["memory"] for v in live.values()) if metrics_live else None

    def m(mid, label, group, value, unit="", detail="", hint="", href=""):
        return {"id": mid, "label": label, "group": group, "value": value, "unit": unit, "detail": detail, "hint": hint,
                "href": href}

    def leader_metric(mid, label, lead, unit, hint, digits=2, none=""):
        """A per-account figure: the top account (and ties); its link opens that account's workspace behind it."""
        if not lead:
            return m(mid, label, "leaders", None, unit, none, hint)
        owner, ws = lead[1][0], lead[2]
        return m(mid, label, "leaders", round(lead[0], digits), unit, _who(lead) + (" · " + ws if ws else ""), hint,
                 _ws_href(owner, ws) if ws else _workspaces_href("owner:" + owner))

    metrics = [
        m("users", "Unique users", "totals", len(users), "", "%d online now" % online, "Active accounts", "/deployment/users"),
        m("workspaces", "Workspaces created", "totals", len(workspaces), "", "%d starting or stopping" % starting if starting else "",
          "Existing workspaces", _workspaces_href()),
        m("active", "Workspaces active", "totals", running, "", "of %d" % len(workspaces), "Running now",
          _workspaces_href("status:running")),
        m("cpu-used", "CPU in use", "totals", round(ws_cpu_live, 2) if ws_cpu_live is not None else None, "cores",
          "by running workspaces, live", "What running workspaces use now (metrics-server)" if metrics_live
          else "Needs metrics-server", _workspaces_href("status:running")),
        m("memory-used", "Memory in use", "totals", round(ws_mem_live, 2) if ws_mem_live is not None else None, "GiB",
          "by running workspaces, live", "What running workspaces use now (metrics-server)" if metrics_live
          else "Needs metrics-server", _workspaces_href("status:running")),
        m("cpu", "CPU claimed", "totals", round(cpu_claimed, 2), "cores",
          "of %g allocatable" % round(cluster["cpu"]["total"], 1) if cluster else "", "Cores running workspaces were built with",
          "/health/user-quota"),
        m("memory", "Memory claimed", "totals", round(mem_claimed, 2), "GiB",
          "of %g allocatable" % round(cluster["memory"]["total"] / 1024 ** 3, 1) if cluster else "", "GiB running workspaces were built with",
          "/health/user-quota"),
        m("gpu", "GPU workspaces", "totals", gpu_ws, "",
          ("%g of %g GPUs claimed" % (sum(gpu_by_ws.values()), gpu_capacity)) if gpu_capacity else "no GPU nodes yet",
          "Running workspaces with a GPU (nvidia.com/gpu, amd.com/gpu, ...)", _workspaces_href("status:running")),
        leader_metric("top-cpu", "Highest CPU", top_cpu, "cores", source, none="no running workspace"),
        leader_metric("top-memory", "Highest memory", top_mem, "GiB", source, none="no running workspace"),
        leader_metric("top-gpu", "Most GPUs", top_gpu, "GPUs", "GPUs claimed by running workspaces", digits=1,
                      none="no workspace has a GPU"),
        leader_metric("top-workspaces", "Most workspaces", top_ws, "", "Workspaces per account", digits=0, none="no workspaces"),
        m("top-online", "Longest online", "leaders", round(top_up[0] / 3600, 2) if top_up else None, "h",
          ("%s · %s · %s" % (_who(top_up), top_up[2], fmt_hours(top_up[0]))) if top_up else "no running workspace",
          "Longest-running workspace", _ws_href(top_up[1][0], top_up[2]) if top_up else ""),
        m("top-failures", "Most failures", "leaders", top_fail[0] if top_fail else 0, "builds",
          _who(top_fail) if top_fail else "none in %d days" % HUD_FAILURE_DAYS, "Failed builds in the last %d days" % HUD_FAILURE_DAYS,
          _workspaces_href("owner:" + top_fail[1][0]) if top_fail else ""),
        leader_metric("top-ping", "Highest ping", top_ping, "ms", "Agent latency to Coder", digits=1, none="no connected agent"),
        m("long-failure", "Failing longest", "health", round(worst_failure[0] / 3600, 2) if worst_failure else None, "h",
          ("%s/%s · %s" % (worst_failure[1], worst_failure[2], fmt_hours(worst_failure[0]))) if worst_failure else "no failed workspace",
          (worst_failure[3] if worst_failure else "") or "Workspace whose latest build failed longest ago",
          _ws_href(worst_failure[1], worst_failure[2]) if worst_failure else ""),
        m("cluster-cpu", "Cluster CPU in use", "health", round(100 * cluster["cpu"]["used"] / cluster["cpu"]["total"], 1) if cluster and cluster["cpu"]["total"] else None, "%",
          "%d nodes" % cluster["nodes"] if cluster else "", "Live" if cluster and cluster["live"] else "Requested (no metrics-server)",
          "/health/workspace-health"),
        m("cluster-memory", "Cluster memory in use", "health", round(100 * cluster["memory"]["used"] / cluster["memory"]["total"], 1) if cluster and cluster["memory"]["total"] else None, "%",
          "", "Live" if cluster and cluster["live"] else "Requested (no metrics-server)", "/health/workspace-health"),
        m("median-ping", "Median ping", "health", round(latencies[len(latencies) // 2], 1) if latencies else None, "ms",
          "%d agents" % len(latencies) if latencies else "", "", _workspaces_href("status:running")),
        m("disconnected", "Agents disconnected", "health", disconnected, "", "running workspaces", "", _workspaces_href("status:running")),
        m("unhealthy-apps", "Unhealthy apps", "health", unhealthy, "", "in running workspaces", "", "/health/workspace-health"),
    ]
    out = {"metrics": metrics, "generatedAt": now(), "live": metrics_live, "uptime": coder_uptime()}
    CACHE.put("hud:" + token[:16], out, 5)
    return out


def coder_uptime():
    """How long the Coder server has been up and online: since its oldest ready replica's coder container started
    (a restart starts it again; during a rollout the replica still serving keeps it going). None when Kubernetes
    cannot be asked."""
    selector = "?labelSelector=" + urllib.parse.quote("app.kubernetes.io/name=coder")
    try:
        status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods%s" % (CODER_NAMESPACE, selector))
    except Exception:  # noqa: BLE001 - the HUD shows it without uptime
        return None
    if status != 200 or not isinstance(pods, dict):
        return None
    started = []
    for pod in pods.get("items") or []:
        for cs in (pod.get("status") or {}).get("containerStatuses") or []:
            at = ((cs.get("state") or {}).get("running") or {}).get("startedAt")
            if cs.get("name") == "coder" and cs.get("ready") and at:
                started.append(at)
    if not started:
        return {"since": None, "replicas": 0}
    return {"since": min(started), "replicas": len(started)}


# Kubelets with self-signed serving certificates (Minikube, kind): metricsServer.kubeletInsecureTLS, as metrics-server.
KUBELET_INSECURE_TLS = os.environ.get("KUBELET_INSECURE_TLS", "false").lower() in ("1", "true", "yes")


def node_network_counters():
    """Each Ready node's network bytes received and sent so far, {node: (rx, tx)}: its interfaces' counters in the
    kubelet's summary, read on the kubelet's own port as metrics-server reads it (RBAC nodes/stats only, not
    nodes/proxy); its certificate checked against the cluster CA unless KUBELET_INSECURE_TLS. A node whose kubelet
    does not answer is left out."""
    if not KUBE.ok:
        return {}
    with open(KUBE.SA + "/token") as f:
        token = f.read().strip()
    if KUBELET_INSECURE_TLS:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    else:
        ctx = KUBE.ctx
    out = {}
    for n in cluster_snapshot()["nodes"]:
        st = n.get("status") or {}
        if not any(c.get("type") == "Ready" and c.get("status") == "True" for c in st.get("conditions") or []):
            continue
        ip = next((a.get("address") for a in st.get("addresses") or [] if a.get("type") == "InternalIP"), None)
        port = ((st.get("daemonEndpoints") or {}).get("kubeletEndpoint") or {}).get("Port") or 10250
        if not ip:
            continue
        host = "[%s]" % ip if ":" in ip else ip
        req = urllib.request.Request("https://%s:%s/stats/summary" % (host, port),
                                     headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=4, context=ctx) as r:
                net = (json.loads(r.read()).get("node") or {}).get("network") or {}
        except Exception:  # noqa: BLE001 - this node's kubelet is unreachable or refuses: left out this round
            continue
        ifaces = net.get("interfaces") or [net]
        rx = sum(i.get("rxBytes") or 0 for i in ifaces)
        tx = sum(i.get("txBytes") or 0 for i in ifaces)
        out[(n.get("metadata") or {}).get("name")] = (rx, tx)
    return out


HUD_SAMPLE_EVERY = int(os.environ.get("HUD_SAMPLE_EVERY", "15"))
HUD_HISTORY_DAYS = int(os.environ.get("HUD_HISTORY_DAYS", "7"))
HUD_RANGES = {"15m": 900, "1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400}


NET_HISTORY_SECONDS = 300  # the workspace page's network pill: the last 5 minutes
NET_HISTORY_EVERY = 2  # seconds between looks at the agents' latest network readings
NET_READING_RE = re.compile(r"^\s*(\d+)\s+(\d+)\s*$")


class AgentNetHistory(threading.Thread):
    """The workspaces' network traffic, the last NET_HISTORY_SECONDS of it for each agent, whether or not anyone
    looks: every NET_HISTORY_EVERY seconds each agent's latest network reading (the template's "*net_io" metadata:
    the bytes received and sent so far, as `metadata.sh net` reports them) from Coder's database; a new reading is a
    sample of bytes a second since the one before. The workspace page's network pill and lights start from it, so a
    page opened (or reloaded) shows the last minutes, not only what comes in after. Kept in memory: a restart of this
    service starts it afresh."""

    def __init__(self):
        super().__init__(daemon=True, name="net-history")
        self.lock = threading.Lock()
        self.last = {}  # agent id -> (t ms, rx, tx): its latest reading
        self.samples = {}  # agent id -> deque of {"from", "t", "rx", "tx"} (ms, bytes a second)

    def add(self, rows, now_ms=None):
        """Readings [(agent id, value, collected_at ms)] in; a sample for each reading newer than the agent's last."""
        now_ms = now_ms or time.time() * 1000
        with self.lock:
            for agent, value, t in rows:
                m = NET_READING_RE.match(value or "")
                if not m or t is None:
                    continue
                t, rx, tx = int(float(t)), int(m[1]), int(m[2])
                prev = self.last.get(agent)
                if prev and t <= prev[0]:
                    continue
                self.last[agent] = (t, rx, tx)
                seconds = (t - prev[0]) / 1000 if prev else 0
                # a long gap (the workspace was stopped, this service just started): no rate across it
                if 0 < seconds <= 120:
                    self.samples.setdefault(agent, collections.deque()).append({
                        "from": prev[0], "t": t,
                        # the counters restart with the workspace: a drop is no traffic
                        "rx": round((rx - prev[1]) / seconds, 1) if rx >= prev[1] else 0,
                        "tx": round((tx - prev[2]) / seconds, 1) if tx >= prev[2] else 0,
                    })
            cutoff = now_ms - NET_HISTORY_SECONDS * 1000
            for agent in list(self.samples):
                q = self.samples[agent]
                while q and q[0]["t"] < cutoff:
                    q.popleft()
                if not q:
                    del self.samples[agent]
            for agent in [a for a, last in self.last.items() if last[0] < cutoff]:
                del self.last[agent]

    def recent(self, agent_ids):
        """{agent id: {"samples": [...], "last": {"at", "rx", "tx"} or None}} for those agents."""
        with self.lock:
            out = {}
            for agent in agent_ids:
                last = self.last.get(agent)
                out[agent] = {"samples": list(self.samples.get(agent, ())),
                              "last": {"at": last[0], "rx": last[1], "tx": last[2]} if last else None}
            return out

    def poll(self):
        pool = LOGOS.pool if LOGOS else None
        if not pool:
            return
        rows = pool.query(
            """SELECT workspace_agent_id::text, value, (extract(epoch FROM collected_at) * 1000)::bigint
               FROM workspace_agent_metadata
               WHERE key ~ '(^|_)net_io$' AND collected_at > now() - interval '120 seconds'"""
        )
        self.add(rows)

    def run(self):
        last_error = None
        while True:
            try:
                self.poll()
                last_error = None
            except Exception as e:  # noqa: BLE001 - reported once, tried again next round
                if str(e) != last_error:
                    log(event="net-history-failed", error=str(e)[:300])
                last_error = str(e)
            time.sleep(NET_HISTORY_EVERY)


NET_HISTORY = None


class HudHistory(threading.Thread):
    """The HUD's graphs: every HUD_SAMPLE_EVERY seconds, whether or not anyone looks, the cluster's CPU and memory in
    use (live, from metrics-server; what workspaces use of it too) and the latency of users' connections to their
    workspaces (Coder's agent stats: the median of each connection, over the last minute). Kept HUD_HISTORY_DAYS days
    in /data/hud.sqlite; read back in up to 120 buckets per range. Also the cluster's network traffic (bytes per second
    received and sent by the nodes, from their kubelets' counters): the Settings menu's network graph."""

    def __init__(self, path):
        super().__init__(daemon=True)
        self.path = path
        self.net_prev = {}
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS samples (t INTEGER PRIMARY KEY, live INTEGER,
                cpu REAL, cpu_ws REAL, cpu_total REAL, mem REAL, mem_ws REAL, mem_total REAL,
                lat_p50 REAL, lat_p95 REAL, lat_max REAL, connections INTEGER)""")
            columns = {r[1] for r in db.execute("PRAGMA table_info(samples)")}
            for column in ("net_rx", "net_tx"):
                if column not in columns:
                    db.execute("ALTER TABLE samples ADD COLUMN %s REAL" % column)

    def network_rates(self):
        """Bytes per second the nodes received and sent since the last round, (rx, tx); (None, None) on the first
        round, or when no kubelet answers. A node whose counters went back (it restarted) is left out of this round."""
        counters = node_network_counters()
        t = time.time()
        rx = tx = 0.0
        seen = False
        for node, (r, s) in counters.items():
            prev = self.net_prev.get(node)
            if prev and t > prev[0] and r >= prev[1] and s >= prev[2]:
                rx += (r - prev[1]) / (t - prev[0])
                tx += (s - prev[2]) / (t - prev[0])
                seen = True
        self.net_prev = {node: (t, r, s) for node, (r, s) in counters.items()}
        return (rx, tx) if seen else (None, None)

    def network_recent(self, seconds=900):
        """The cluster's traffic over the last `seconds` (one point a round): {"rx", "tx" (the latest, bytes/s),
        "points": [{"t", "rx", "tx"}]}, or None before there is any."""
        with self.connect() as db:
            rows = db.execute("SELECT t, net_rx, net_tx FROM samples WHERE t >= ? AND net_rx IS NOT NULL ORDER BY t",
                              (int(time.time()) - seconds,)).fetchall()
        if not rows:
            return None
        points = [{"t": r["t"], "rx": round(r["net_rx"], 1), "tx": round(r["net_tx"], 1)} for r in rows]
        return {"rx": points[-1]["rx"], "tx": points[-1]["tx"], "points": points, "every": HUD_SAMPLE_EVERY}

    def usage_recent(self, seconds=900):
        """The cluster's CPU (cores) and memory (bytes) in use and allocatable over the last `seconds`, one point a
        round: {"points": [{"t", "cpu", "cpuTotal", "memory", "memoryTotal"}], "every"}, or None before there is any.
        The Settings menu's CPU and memory graphs; "in use" as the bars have it (live, or requested without
        metrics-server)."""
        with self.connect() as db:
            rows = db.execute("""SELECT t, cpu, cpu_total, mem, mem_total FROM samples
                WHERE t >= ? AND cpu IS NOT NULL AND mem IS NOT NULL ORDER BY t""",
                              (int(time.time()) - seconds,)).fetchall()
        if not rows:
            return None
        gib = 1024 ** 3
        return {"points": [{"t": r["t"], "cpu": round(r["cpu"], 3), "cpuTotal": round(r["cpu_total"] or 0, 3),
                            "memory": round(r["mem"] * gib), "memoryTotal": round((r["mem_total"] or 0) * gib)}
                           for r in rows],
                "every": HUD_SAMPLE_EVERY}

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def latency(self):
        pool = LOGOS.pool if LOGOS else None
        if not pool:
            return None
        rows = pool.query(
            """SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY connection_median_latency_ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY connection_median_latency_ms),
                      max(connection_median_latency_ms), count(DISTINCT agent_id)
               FROM workspace_agent_stats
               WHERE created_at > now() - interval '60 seconds' AND connection_median_latency_ms > 0"""
        )
        return rows[0] if rows else None

    def sample(self):
        cluster = cluster_usage()
        live = cluster_snapshot()["usage"] is not None
        ws = _pod_usage_by_workspace() if live else {}
        lat = None
        try:
            lat = self.latency()
        except Exception:  # noqa: BLE001 - the database is unreachable: no latency this round
            lat = None
        try:
            net_rx, net_tx = self.network_rates()
        except Exception:  # noqa: BLE001 - no traffic figures this round
            net_rx = net_tx = None
        gib = 1024 ** 3
        row = (int(time.time()), int(live),
               cluster["cpu"]["used"], sum(v["cpu"] for v in ws.values()) if live else None, cluster["cpu"]["total"],
               cluster["memory"]["used"] / gib, sum(v["memory"] for v in ws.values()) if live else None,
               cluster["memory"]["total"] / gib,
               lat[0] if lat else None, lat[1] if lat else None, lat[2] if lat else None, int(lat[3]) if lat else 0,
               net_rx, net_tx)
        with self.connect() as db:
            db.execute("""INSERT OR REPLACE INTO samples (t, live, cpu, cpu_ws, cpu_total, mem, mem_ws, mem_total,
                lat_p50, lat_p95, lat_max, connections, net_rx, net_tx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", row)
            db.execute("DELETE FROM samples WHERE t < ?", (int(time.time()) - HUD_HISTORY_DAYS * 86400,))

    def run(self):
        last = None
        while True:
            try:
                self.sample()
                last = None
            except Exception as e:  # noqa: BLE001 - reported once, retried next round
                if str(e) != last:
                    log(event="hud-sample-failed", error=str(e)[:300])
                last = str(e)
            time.sleep(HUD_SAMPLE_EVERY)

    def series(self, range_):
        span = HUD_RANGES.get(range_, 3600)
        end = int(time.time())
        start = end - span
        step = max(HUD_SAMPLE_EVERY, span // 120)
        with self.connect() as db:
            rows = db.execute(
                """SELECT (t - ?) / ? AS b, max(t) AS t, max(live) AS live,
                    avg(cpu) AS cpu, max(cpu) AS cpu_peak, avg(cpu_ws) AS cpu_ws, max(cpu_total) AS cpu_total,
                    avg(mem) AS mem, max(mem) AS mem_peak, avg(mem_ws) AS mem_ws, max(mem_total) AS mem_total,
                    avg(lat_p50) AS lat_p50, max(lat_p95) AS lat_p95, max(lat_max) AS lat_max,
                    max(connections) AS connections
                   FROM samples WHERE t >= ? GROUP BY b ORDER BY b""",
                (start, step, start),
            ).fetchall()
        r2 = lambda v: None if v is None else round(v, 3)  # noqa: E731
        points = [{"t": r["b"] * step + start, "live": bool(r["live"]), "cpu": r2(r["cpu"]), "cpuPeak": r2(r["cpu_peak"]),
                   "cpuWorkspaces": r2(r["cpu_ws"]), "cpuTotal": r2(r["cpu_total"]), "memory": r2(r["mem"]),
                   "memoryPeak": r2(r["mem_peak"]), "memoryWorkspaces": r2(r["mem_ws"]), "memoryTotal": r2(r["mem_total"]),
                   "latency": r2(r["lat_p50"]), "latencyP95": r2(r["lat_p95"]), "latencyMax": r2(r["lat_max"]),
                   "connections": r["connections"] or 0} for r in rows]
        return {"range": range_ if range_ in HUD_RANGES else "1h", "start": start, "end": end, "step": step,
                "points": points}


HUD_HISTORY = None


# --------------------------------------------------------------------------- Certificates (General > Security)
def _secret_bytes(ns, name):
    status, s = KUBE.call("GET", "/api/v1/namespaces/%s/secrets/%s" % (ns, name))
    if status != 200:
        return None, status
    return {k: base64.b64decode(v) for k, v in (s.get("data") or {}).items()}, status


def _configmap_bytes(ns, name):
    status, c = KUBE.call("GET", "/api/v1/namespaces/%s/configmaps/%s" % (ns, name))
    if status != 200:
        return None, status
    out = {k: v.encode() for k, v in (c.get("data") or {}).items()}
    out.update({k: base64.b64decode(v) for k, v in (c.get("binaryData") or {}).items()})
    return out, status


CERT_FILE_RE = re.compile(r"\.(crt|pem|cer|key|p12|pfx)$|^(ca|tls)\.", re.I)


def certificates_overview():
    """Every certificate Coder depends on: what its address, Keycloak and its database present on the wire (TLS
    versions, cipher suites, chain), and each certificate, CA, key and PKCS#12 file mounted into Coder's pod or in
    its database's CA Secret. Cached for 10 minutes (the probes make a few dozen handshakes)."""
    hit = CACHE.get("certificates")
    if hit is not None:
        return hit
    import certinfo  # noqa: PLC0415 - next to this file
    endpoints = []
    status, dep = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments/%s" % (CODER_NAMESPACE, CODER_DEPLOYMENT))
    env = container_env(dep) if status == 200 else {}
    trust = CA_FILE if CA_FILE and os.path.exists(CA_FILE) else None
    targets = []
    access = CODER_ACCESS_URL or (env.get("CODER_ACCESS_URL") or {}).get("value") or ""
    if access.startswith("https://"):
        u = urllib.parse.urlsplit(access)
        targets.append(("Coder (its address)", u.hostname, u.port or 443, False))
    kc = (keycloak_status() or {}).get("keycloakUrl") or ""
    if kc.startswith("https://"):
        u = urllib.parse.urlsplit(kc)
        targets.append(("Keycloak (sign-in)", u.hostname, u.port or 443, False))
    db_uri = CODER_DB_URI or ""
    if db_uri:
        u = urllib.parse.urlsplit(db_uri)
        targets.append(("Coder's database", u.hostname, u.port or 5432, True))
    db_trust = CODER_DB_CA if CODER_DB_CA and os.path.exists(CODER_DB_CA) else None   # CloudNativePG's own CA
    for label, host, port, pg in targets:
        try:
            endpoints.append({"name": label, **certinfo.probe(host, port, postgres=pg, trust=db_trust if pg else trust)})
        except Exception as e:  # noqa: BLE001 - one endpoint failing must not hide the others
            endpoints.append({"name": label, "host": host, "port": port, "error": str(e)[:200]})

    files = []
    spec = (((dep or {}).get("spec") or {}).get("template") or {}).get("spec") or {}
    mounts = {m.get("name"): m for m in ((spec.get("containers") or [{}])[0].get("volumeMounts") or [])}
    sources = []
    for v in spec.get("volumes") or []:
        mount = mounts.get(v.get("name")) or {}
        if v.get("secret"):
            sources.append(("Secret", v["secret"].get("secretName"), mount))
        elif v.get("configMap"):
            sources.append(("ConfigMap", v["configMap"].get("name"), mount))
    if CODER_DB_CA_SECRET:
        sources.append(("Secret", CODER_DB_CA_SECRET, {}))   # not mounted into Coder: it verifies the database with it
    for kind, name, mount in sources:
        data, st = (_secret_bytes if kind == "Secret" else _configmap_bytes)(CODER_NAMESPACE, name)
        if data is None:
            files.append({"source": "%s %s/%s" % (kind, CODER_NAMESPACE, name), "mountPath": mount.get("mountPath"),
                          "error": "not readable by this service (HTTP %s)" % st})
            continue
        found = []
        for key in sorted(data):
            if not CERT_FILE_RE.search(key) and b"-----BEGIN" not in data[key][:4096]:
                continue
            path = mount.get("mountPath") or ""
            if mount.get("subPath"):
                path = path if mount["subPath"] == key else None
            elif path:
                path = path.rstrip("/") + "/" + key
            if path is None:
                continue   # a subPath mount of another key
            found.append({"source": "%s %s/%s" % (kind, CODER_NAMESPACE, name), "key": key, "mountPath": path,
                          "items": certinfo.read_bundle(key, data[key])})
        # a key matches the certificate with its public key, usually in a sibling entry (tls.key / tls.crt)
        certs = [i for f in found for i in f["items"] if i["kind"] == "certificate" and i.get("_public")]
        for k in (i for f in found for i in f["items"] if i["kind"] == "key" and not i.get("matches") and i.get("_public")):
            c = next((c for c in certs if c["_public"] == k["_public"]), None)
            k["matches"] = (c.get("commonName") or c.get("subject")) if c else None
        files += [{**f, "items": certinfo.public_items(f["items"])} for f in found]
    out = {"endpoints": endpoints, "files": files, "generatedAt": now()}
    CACHE.put("certificates", out, 600)
    return out


def chat_availability():
    """Which admins take chats: {"available": [ids with chat on], "off": [ids with chat off], "availVersion"}; whether
    peer-to-peer chat is on, the purge version (a change: reload the conversations), the presence version (a change:
    the People lists ask again) and the largest file a message may carry."""
    ids = [a["id"] for a in chat_admins()]
    return {
        "available": [i for i in ids if i not in CHAT.off],
        "off": [i for i in ids if i in CHAT.off],
        "availVersion": CHAT.avail_ver,
        "peers": bool(CHAT.settings.get("peers")),
        "purgeVersion": int(CHAT.settings.get("purgeVersion") or 0),
        "presenceVersion": CHAT.presence_ver,
        "maxFileMb": CHAT_MAX_FILE // 1048576,
    }


def chat_people():
    """{user id: {id, username, name, admin, lastSeen}} of Coder's active users (its users table; system users left
    out), most recently seen first, cached for a minute. Empty when Coder's database can't be read."""
    hit = CACHE.get("chat-people")
    if hit is not None:
        return hit
    people = {}
    try:
        pool = LOGOS.pool if LOGOS else None
        if pool:
            rows = pool.query(
                """SELECT u.id::text, u.username, u.name, u.rbac_roles && $1::text[],
                          to_char(u.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                   FROM public.users u WHERE NOT u.deleted AND u.status = 'active'
                   AND NOT coalesce((to_jsonb(u) ->> 'is_system')::boolean, false)
                   ORDER BY u.last_seen_at DESC NULLS LAST LIMIT 2000""",
                ["{%s}" % ",".join(sorted(ADMIN_ROLES))],
            )
            for r in rows:
                people[r[0]] = {
                    "id": r[0],
                    "username": r[1],
                    "name": r[2] or "",
                    "admin": r[3] in ("t", True),
                    "lastSeen": r[4],
                }
    except Exception as e:  # noqa: BLE001 - no list rather than an error
        log(event="chat-people-failed", error=str(e)[:200])
    CACHE.put("chat-people", people, 60)
    return people


def chat_people_for(user, admin):
    """The People list for this user: everyone online (a tab open: active, or idle for CHAT_IDLE_SECONDS) or seen by
    Coder today, but themselves; the invisible only for admins (marked). Online first, then the most recently seen."""
    now_t = time.time()
    out = []
    for p in chat_people().values():
        if p["id"] == user["id"]:
            continue
        invisible = p["id"] in CHAT.invisible
        if invisible and not admin:
            continue
        presence = CHAT.presence(p["id"])
        online = presence["status"] != "offline"
        seen = _ts(p.get("lastSeen"))
        if not online and (seen is None or now_t - seen > CHAT_ACTIVE_SECONDS):
            continue
        item = {**p, "online": online, "idle": presence["status"] == "idle", "activeAt": presence["activeAt"],
                "chatOff": p["id"] in CHAT.off}
        if admin:
            item["invisible"] = invisible
        out.append(item)
    out.sort(key=lambda p: (not p["online"], -(_ts(p.get("lastSeen")) or 0)))
    return out[:500]


def presence_report(token):
    """Admin Controls > Online Users: everyone with a Coder tab open now - active, or idle (no input for
    CHAT_IDLE_SECONDS) - with how many tabs, since when, their last input and their running workspaces; then who Coder
    saw in the last 15 minutes without a tab open (the CLI, SSH, an app). The invisible are included (marked)."""
    running = {}
    status, data = _coder_get(token, "/api/v2/workspaces?" + urllib.parse.urlencode(
        {"q": "status:running", "limit": 1000}))
    if status == 200:
        for w in (data or {}).get("workspaces") or []:
            running.setdefault(w.get("owner_id"), []).append(
                {"id": w.get("id"), "name": w.get("name"), "owner": w.get("owner_name")})
    now_t = time.time()
    online, recent = [], []
    for p in chat_people().values():
        presence = CHAT.presence(p["id"])
        item = {**p, **presence, "invisible": p["id"] in CHAT.invisible, "workspaces": running.get(p["id"], [])}
        if presence["status"] != "offline":
            online.append(item)
        else:
            seen = _ts(p.get("lastSeen"))
            if seen and now_t - seen < 900:
                recent.append(item)
    online.sort(key=lambda p: (p["status"] != "active", -(_ts(p.get("activeAt")) or 0)))
    recent.sort(key=lambda p: -(_ts(p.get("lastSeen")) or 0))
    return {"online": online, "recent": recent, "idleSeconds": CHAT_IDLE_SECONDS, "generatedAt": now()}


def boot_js():
    """Classic script every Coder page loads before its own code: which logo to show (read synchronously by the
    rewritten logo component) and the classification marking, so neither flickers in after the first paint.
    """
    logo = None
    try:
        logo = LOGOS.peek() if LOGOS else None  # never waits for the database
    except Exception as e:  # noqa: BLE001 - no logo rather than a broken page
        log(event="logo-read-failed", error=str(e)[:200])
    cls = STORE.get_setting("classification", CLASSIFICATION_DEFAULT)
    avatars = AVATARS.urls() if AVATARS else {}  # never waits for the database either
    default_avatar = AvatarStore.default_url()
    backgrounds = BACKGROUNDS.peek() if BACKGROUNDS else {}
    js = (
        "window.__cuiLogo=%s;window.__cuiClassification=%s;window.__cuiAvatars=%s;window.__cuiAvatarDefault=%s;\n"
        % (
            json.dumps(BASE + "/logo?v=" + logo["sha"] if logo else ""),
            json.dumps(cls),
            json.dumps(avatars),
            json.dumps(default_avatar),
        )
    )
    try:
        js += "window.__cuiLoginPage=%s;\n" % json.dumps(login_page_settings())
    except Exception as e:  # noqa: BLE001 - the default sign-in page rather than a broken one
        log(event="login-page-read-failed", error=str(e)[:200])
    js += "window.__cuiBackgrounds=%s;\n" % json.dumps(
        {slot: background_public(slot, backgrounds.get(slot)) for slot in BG_SLOTS})
    if default_avatar:
        # Who gets the default avatar is not public: this browser's last answer (the dashboard refreshes it once signed in).
        js += (
            "try{window.__cuiAvatarUsers=new Set(JSON.parse(localStorage.getItem('coder-ui-avatar-users')||'[]'))}"
            "catch(e){window.__cuiAvatarUsers=new Set()}\n"
        )
    return js


# --------------------------------------------------------------------------- HTTP


class Server(ThreadingHTTPServer):
    """One thread per request. Its accept queue holds a burst (everyone's chat at once; socketserver's default of 5
    made the proxy answer 502), and a client that went away mid-answer (a closed tab's long poll) is not an error."""

    request_queue_size = 1024

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = "coder-ui-updates"
    protocol_version = "HTTP/1.1"
    SECURITY = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"}

    def log_message(self, fmt, *args):  # request lines only; never headers or cookies
        log(event="request", line=fmt % args)

    def send(
        self, status, body=b"", content_type="text/plain; charset=utf-8", headers=None
    ):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        # A connection this handler will close is said to close: the proxy then never reuses it for the next
        # request (which would come back 502 under load).
        closing = {"Connection": "close"} if self.close_connection else {}
        for k, v in {
            **self.SECURITY,
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
            **closing,
            **(headers or {}),
        }.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, payload):
        self.send(
            status,
            json.dumps(payload),
            "application/json",
            {"Cache-Control": "no-store"},
        )

    def send_file(self, path, content_type, tag, versioned):
        """A file, streamed (the image store's pictures run to tens of MB), with its version as its ETag: for good when
        asked for by a versioned address, else checked again within the hour."""
        etag = '"%s"' % tag
        cache = "public, max-age=31536000, immutable" if versioned else "public, max-age=3600"
        if self.headers.get("If-None-Match") == etag:
            return self.send(304, b"", content_type, {"ETag": etag, "Cache-Control": cache})
        try:
            f = open(path, "rb")
        except OSError:
            return self.send(404, "not found\n", headers={"Cache-Control": "no-cache"})
        with f:
            self.send_response(200)
            for k, v in {**self.SECURITY, "Content-Type": content_type, "Content-Length": str(os.fstat(f.fileno()).st_size),
                         "ETag": etag, "Cache-Control": cache}.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                shutil.copyfileobj(f, self.wfile, 256 * 1024)

    def token(self):
        token = self.headers.get("Coder-Session-Token")
        if token:
            return token
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except (
            Exception
        ):  # noqa: BLE001 - a malformed cookie header is just "no session"
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
            self.send_json(
                503,
                {
                    "error": "Coder could not be reached to check your session. Try again in a moment."
                },
            )
            return None, True
        if admin and not set(user["roles"]) & ADMIN_ROLES:
            self.send_json(403, {"error": "Only Coder admins can do this."})
            return None, True
        return user, None

    def csrf_ok(self):
        if self.headers.get(CSRF_HEADER[0]) != CSRF_HEADER[1]:
            return False
        if (
            not (self.headers.get("Content-Type") or "")
            .lower()
            .startswith("application/json")
        ):
            return False
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
            return False
        return self.headers.get("Sec-Fetch-Site", "same-origin") in (
            "same-origin",
            "none",
        )

    def body(self, limit=16384):
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/logo":
            limit = LOGO_MAX_BYTES * 2  # base64 of the largest logo
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/avatar":
            limit = AVATAR_MAX_BYTES * 2
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/backgrounds":
            limit = BG_MAX_BYTES * 2 + BG_HTML_MAX * 2 + BG_PARAMS_MAX
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/banner-pictures":
            limit = BANNER_PICTURE_MAX_BYTES * 4 // 3 + 4096  # base64 of the largest picture, and its name
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/icons":
            limit = (
                ICON_MAX_BYTES * 2 + 1024
            )  # base64 of the largest icon, and its name
        if urllib.parse.urlsplit(self.path).path == BASE + "/api/chat/send":
            limit = (
                CHAT_MAX_TEXT * 8 + CHAT_MAX_IMAGE * 4 // 3 + 4096
            )  # text of any script, a screenshot as a data URL
        try:
            length = int(self.headers.get("Content-Length") or 0)
            return (
                json.loads(self.rfile.read(length) or b"{}")
                if 0 < length <= limit
                else None
            )
        except ValueError:
            return None

    def do_HEAD(self):
        self.do_GET()

    def template_icon(self, name):
        """A file of TEMPLATE_ICONS_DIR: plain names only, images only, public and cacheable (no session needed:
        the dashboard loads them as <img>)."""
        name = urllib.parse.unquote(name)
        ctype = TEMPLATE_ICON_TYPES.get(os.path.splitext(name)[1].lower())
        file = os.path.join(TEMPLATE_ICONS_DIR, name) if TEMPLATE_ICONS_DIR else ""
        if not (ctype and TEMPLATE_ICON_RE.match(name) and os.path.isfile(file)):
            return self.send(404, "not found\n")
        with open(file, "rb") as f:
            body = f.read()
        etag = '"%s"' % hashlib.sha256(body).hexdigest()[:20]
        headers = {"Cache-Control": "public, max-age=3600", "ETag": etag,
                   # an SVG opened directly runs in a sandbox: no scripts on Coder's origin
                   "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox"}
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", "0")
            return self.end_headers()
        return self.send(200, body, ctype, headers)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path == BASE + "/healthz":
            return self.send(200, "ok\n")
        if path.startswith(BASE + "/internal/") and imagebuilder.handle_internal(self, "GET", path):
            return
        if path.startswith(BASE + "/internal/") and workspacevolumes.handle_internal(self, "GET", path):
            return   # a restore Job fetching its backup
        if imagebuilder.handle(self, "GET", path, url.query, ADMIN_ROLES):
            return
        if workspacevolumes.handle(self, "GET", path, url.query):
            return
        if dr.handle(self, "GET", path, url.query):
            return
        if provisioners.handle(self, "GET", path, url.query):
            return
        if workspacepower.handle(self, "GET", path, url.query):
            return
        if workspacetunnels.handle(self, "GET", path, url.query):
            return
        if lockdown.handle(self, "GET", path, url.query):
            return
        if safe.handle(self, "GET", path, url.query) or safe.handle_libraries(self, "GET", path, url.query):
            return
        if path.startswith(TEMPLATE_ICONS_PATH):
            return self.template_icon(path[len(TEMPLATE_ICONS_PATH):])
        if path == BASE + "/refresh":
            return self.send(
                302,
                "",
                headers={
                    "Location": "/",
                    "Clear-Site-Data": '"cache"',
                    "Cache-Control": "no-store",
                },
            )
        if path == BASE + "/api/notes":
            user, err = self.user()
            if err:
                return
            workspace_id = urllib.parse.parse_qs(url.query).get("workspace", [""])[0]
            if not UUID_RE.match(workspace_id):
                return self.send_json(400, {"error": "Which workspace?"})
            admin = bool(set(user["roles"]) & ADMIN_ROLES)
            if not admin and workspace_owner(self.token(), workspace_id) != user["id"]:
                return self.send_json(403, {"error": "Only the workspace's owner and admins see its notes."})
            return self.send_json(200, {"notes": STORE.notes(workspace_id, admin), "canEdit": admin})
        if path == BASE + "/api/notes/users":
            user, err = self.user(admin=True)
            if err:
                return
            notes = STORE.active_notes()
            # Older notes do not know their workspace's owner yet: looked up once, then kept.
            for workspace_id in {n["workspaceId"] for n in notes if not n["ownerId"]}:
                ws = workspace_info(self.token(), workspace_id)
                if ws:
                    STORE.note_set_owner(workspace_id, ws)
            by_user = {}
            for n in STORE.active_notes():
                if n["ownerId"]:
                    by_user.setdefault(n["ownerId"], []).append(n)
            return self.send_json(200, {"users": by_user})
        if path == BASE + "/api/me":
            token = self.token()
            status, user = coder_user(token) if token else ("unauthenticated", None)
            if status == "unauthenticated":
                return self.send_json(200, {"signedIn": False})
            if status != "ok":
                return self.send_json(
                    503, {"error": "Coder could not be reached to check your session."}
                )
            event_id = urllib.parse.parse_qs(url.query).get("id", [""])[0]
            viewed_at, acked_at = (
                STORE.receipt_times(event_id, user["id"]) if ID_RE.match(event_id) else (None, None)
            )
            # viewedAt: when this user first saw it (what the admin's report shows), so they know it is on record.
            return self.send_json(
                200,
                {
                    "signedIn": True,
                    "username": user["username"],
                    "acked": bool(acked_at),
                    "viewedAt": viewed_at,
                    "ackedAt": acked_at,
                },
            )
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
            return self.send(
                200,
                body,
                "text/javascript; charset=utf-8",
                {"Cache-Control": "no-cache", "ETag": etag},
            )
        if path == BASE + "/logo":
            return self.logo(versioned="v=" in url.query)
        if path.startswith(BASE + "/icons/"):
            return self.icon(path[len(BASE) + 7 :], versioned="v=" in url.query)
        if path == BASE + "/api/icons":
            user, err = self.user()
            if err:
                return
            if not ICONS or not ICONS.pool:
                return self.send_json(
                    503,
                    {"error": "Coder's database is not configured for this service."},
                )
            try:
                return self.send_json(
                    200, {"icons": ICONS.list(), "canManage": self.manages_icons(user)}
                )
            except Exception as e:  # noqa: BLE001
                return self.send_json(
                    503, {"error": "Coder's database: %s" % str(e)[:200]}
                )
        if path.startswith(BASE + "/favicon/"):
            return self.favicon(path[len(BASE) + 9 :])
        if path.startswith(BASE + "/banner-picture/"):
            if not BANNER_PICTURES or not BANNER_PICTURES.pool:
                return self.send(404, "not found\n", headers={"Cache-Control": "no-cache"})
            try:
                hit = BANNER_PICTURES.get(path[len(BASE) + 16 :])
            except Exception as e:  # noqa: BLE001
                return self.send(503, "Coder's database is not reachable: %s\n" % str(e)[:200])
            if not hit:
                return self.send(404, "no such picture\n", headers={"Cache-Control": "no-cache"})
            # Named by its content: the same address always shows the same picture.
            return self.send(200, hit[1], hit[0], {"Cache-Control": "public, max-age=31536000, immutable",
                                                   "X-Content-Type-Options": "nosniff"})
        if path.startswith(BASE + "/background/"):
            slot = path[len(BASE) + 12 :]
            try:
                bg = (BACKGROUNDS.all() if BACKGROUNDS else {}).get(slot)
            except Exception as e:  # noqa: BLE001
                return self.send(503, "Coder's database is not reachable: %s\n" % str(e)[:200])
            if not bg:
                return self.send(404, "no background\n", headers={"Cache-Control": "no-cache"})
            if bg["type"] == BG_PICTURE_REF:
                self.send_response(302)
                self.send_header("Location", background_picture(bg)[0])
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", "0")
                return self.end_headers()
            if bg["type"] == "text/html":
                return self.send(200, serve_background_html(bg["data"]), "text/html; charset=utf-8", {
                    "Content-Security-Policy": BG_HTML_CSP,
                    "Cache-Control": "public, max-age=31536000, immutable" if "v=" in url.query else "no-cache"})
            return self.send(200, bg["data"], bg["type"], {
                "Cache-Control": "public, max-age=31536000, immutable" if "v=" in url.query else "no-cache"})
        if path == BASE + "/api/backgrounds":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                found = BACKGROUNDS.all(fresh=True) if BACKGROUNDS else {}
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database is not reachable: %s" % str(e)[:200]})
            out = {"available": bool(BACKGROUNDS and BACKGROUNDS.pool), "limits": {
                "opacity": {"min": BG_OPACITY[0], "max": BG_OPACITY[1], "default": BG_OPACITY[2]},
                "fits": list(BG_FITS), "layers": list(BG_LAYERS), "maxBytes": BG_MAX_BYTES,
                "htmlMaxBytes": BG_HTML_MAX,
                "dials": {k: {"min": v[0], "max": v[1], "default": v[2]} for k, v in BG_DIALS.items()}}}
            for slot in BG_SLOTS:
                bg = found.get(slot)
                if bg and bg["type"] == BG_PICTURE_REF:
                    path, size = background_picture(bg)
                    out[slot] = dict(background_public(slot, bg), bytes=size, updatedBy=bg["by"], updatedAt=bg["at"],
                                     type=BG_PICTURE_TYPES.get(path.rsplit(".", 1)[-1].lower(), "image/gif"))
                    continue
                out[slot] = dict(background_public(slot, bg), type=bg["type"], bytes=len(bg["data"]),
                                 updatedBy=bg["by"], updatedAt=bg["at"]) if bg else None
            return self.send_json(200, out)
        if path == BASE + "/api/logo":
            try:
                logo = LOGOS.get(fresh=True) if LOGOS else None
            except Exception as e:  # noqa: BLE001
                return self.send_json(
                    503,
                    {"error": "Coder's database is not reachable: %s" % str(e)[:200]},
                )
            return self.send_json(
                200,
                {
                    "available": LOGOS is not None and LOGOS.pool is not None,
                    "set": bool(logo),
                    "url": BASE + "/logo?v=" + logo["sha"] if logo else None,
                    "type": logo and logo["type"],
                    "bytes": logo and len(logo["data"]),
                    "updatedBy": logo and logo["by"],
                    "updatedAt": logo and logo["at"],
                },
            )
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
                return self.send_json(
                    503, {"error": "Logs are not available: %s" % str(e)[:300]}
                )
        if path.startswith(BASE + "/avatar/"):
            return self.avatar(path[len(BASE) + 8 :], versioned="v=" in url.query)
        if path == BASE + "/api/gallery":
            user, err = self.user()
            if err:
                return
            return self.send_json(200, {"images": GALLERY.listing() if GALLERY else []})
        if path == BASE + "/api/image-store":
            user, err = self.user()
            if err:
                return
            return self.send_json(200, {"images": image_store_listing()})
        if path.startswith(BASE + "/image-store/"):
            rest = urllib.parse.unquote(path[len(BASE) + 13 :])
            preview = rest.startswith("thumbs/")
            name = rest[7:] if preview else rest
            hit = (STORE_IMAGES.items() if STORE_IMAGES else {}).get(name)
            if not hit or (preview and not hit["thumb"]):
                return self.send(404, "not found\n", headers={"Cache-Control": "no-cache"})
            return self.send_file(hit["thumb"] if preview else hit["path"], "image/webp" if preview else hit["type"],
                                  hit["tag"] + ("t" if preview else ""), "v=" in url.query)
        if path.startswith(BASE + "/gallery/"):
            hit = (GALLERY.items() if GALLERY else {}).get(urllib.parse.unquote(path[len(BASE) + 9 :]))
            if not hit:
                return self.send(404, "not found\n", headers={"Cache-Control": "no-cache"})
            return self.send(200, hit["data"], hit["type"], {
                "Cache-Control": "public, max-age=31536000, immutable" if "v=" in url.query else "no-cache"})
        if path == BASE + "/api/avatar":
            user, err = self.user()
            if err:
                return
            url_ = (AVATARS.urls() if AVATARS else {}).get(user["username"])
            default = (
                AVATARS.default_url()
                if AVATARS and user["username"] in AVATARS.default_users()
                else None
            )
            return self.send_json(
                200,
                {
                    "available": bool(AVATARS and AVATARS.pool),
                    "set": bool(url_),
                    "url": url_,
                    "defaultUrl": default or None,
                    "username": user["username"],
                },
            )
        if path == BASE + "/api/avatar/defaults":
            user, err = self.user()
            if err:
                return
            default = AvatarStore.default_url()
            return self.send_json(
                200,
                {
                    "url": default or None,
                    "users": AVATARS.default_users() if default and AVATARS else [],
                },
            )
        if path.startswith(BASE + "/api/chat/"):
            return self.chat_get(
                path[len(BASE + "/api/chat/") :], urllib.parse.parse_qs(url.query)
            )
        if path.startswith(BASE + "/api/workspaces/") and path.endswith("/network"):
            # the workspace page's network pill and lights: the last minutes of each of its agents' traffic
            user, err = self.user()
            if err:
                return
            ws = workspace_info(self.token(), path[len(BASE + "/api/workspaces/"):-len("/network")])
            if not ws:
                return self.send_json(404, {"error": "There is no such workspace (or it is not yours to see)."})
            agents = [a.get("id") for r in (ws.get("latest_build") or {}).get("resources") or []
                      for a in r.get("agents") or []]
            return self.send_json(200, {"windowSeconds": NET_HISTORY_SECONDS,
                                        "agents": NET_HISTORY.recent(agents) if NET_HISTORY else {}})
        if path == BASE + "/api/presence":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, presence_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="presence-report-failed", error=str(e)[:300])
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/hud/history":
            user, err = self.user(admin=True)
            if err:
                return
            if not HUD_HISTORY:
                return self.send_json(503, {"error": "The HUD history is not running."})
            rng = (urllib.parse.parse_qs(url.query).get("range") or ["1h"])[0]
            return self.send_json(200, HUD_HISTORY.series(rng))
        if path == BASE + "/api/hud":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, hud_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="hud-failed", error=str(e)[:300])
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/monitoring/posture":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, monitoring_posture(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="posture-failed", error=str(e)[:300])
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/dashboard-address":
            user, err = self.user()
            if err:
                return
            return self.send_json(200, dashboard_address())
        if path == BASE + "/api/quota/me":
            user, err = self.user()
            if err:
                return
            try:
                return self.send_json(200, quota_me(self.token(), user))
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/scheduler/me":
            user, err = self.user()
            if err:
                return
            try:
                return self.send_json(200, scheduler_me(self.token(), user))
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/scheduler":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, scheduler_report(self.token()))
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": str(e)[:300]})
        if path in (BASE + "/api/keycloak/status", BASE + "/api/quota", BASE + "/api/certificates"):
            user, err = self.user(admin=True)
            if err:
                return
            try:
                if path.endswith("/status"):
                    return self.send_json(200, keycloak_status())
                if path.endswith("/quota"):
                    return self.send_json(200, quota_report(self.token()))
                if "refresh" in urllib.parse.parse_qs(url.query):
                    CACHE.put("certificates", None, 0)
                return self.send_json(200, certificates_overview())
            except Exception as e:  # noqa: BLE001
                log(event="report-failed", path=path, error=str(e)[:300])
                return self.send_json(503, {"error": str(e)[:300]})
        if path == BASE + "/api/cluster/usage":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, {
                    **cluster_usage(),
                    # The Settings menu's graphs: the last 15 minutes of the HUD's samples.
                    "history": HUD_HISTORY.usage_recent() if HUD_HISTORY else None,
                    "network": HUD_HISTORY.network_recent() if HUD_HISTORY else None,
                })
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
        if clusternet.handle(self, "GET", path, url.query):
            return
        if path == BASE + "/api/persistence":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, persistence_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="persistence-report-failed", error=str(e)[:300])
                return self.send_json(
                    500, {"error": "Discovery failed: %s" % str(e)[:300]}
                )
        if path == BASE + "/api/classification":
            return self.send_json(
                200, STORE.get_setting("classification", CLASSIFICATION_DEFAULT)
            )
        if path == BASE + "/api/login-page":
            return self.send_json(200, login_page_settings())
        if path == BASE + "/api/quick-menu":
            user, err = self.user()
            if err:
                return
            return self.send_json(200, quick_menu_settings())
        if path == BASE + "/api/keycloak":
            user, err = self.user(admin=True)
            if err:
                return
            try:
                return self.send_json(200, keycloak_report(self.token()))
            except Exception as e:  # noqa: BLE001
                log(event="keycloak-report-failed", error=str(e))
                return self.send_json(500, {"error": "Discovery failed: %s" % e})
        self.send(404, "not found\n")

    def logo(self, versioned):
        logo = (
            LOGOS.peek() if LOGOS else None
        )  # the cached copy: never waits for the database
        if not logo:
            return self.send(
                404, "no custom logo\n", headers={"Cache-Control": "no-cache"}
            )
        headers = {
            "Cache-Control": (
                "public, max-age=31536000, immutable" if versioned else "no-cache"
            )
        }
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
            return self.send(
                503, "Coder's database is not reachable: %s\n" % str(e)[:200]
            )
        if not hit:
            return self.send(
                404, "no such icon\n", headers={"Cache-Control": "no-cache"}
            )
        headers = {
            "Cache-Control": (
                "public, max-age=31536000, immutable"
                if versioned
                else "public, max-age=300"
            )
        }
        if hit[0] == "image/svg+xml":
            headers["Content-Security-Policy"] = SVG_CSP
        self.send(200, hit[1], hit[0], headers)

    def save_icon(self, delete, payload):
        user, err = self.user()
        if err:
            return
        if not self.manages_icons(user):
            return self.send_json(
                403, {"error": "Only owners and template admins can change icons."}
            )
        if not ICONS or not ICONS.pool:
            return self.send_json(
                503, {"error": "Coder's database is not configured for this service."}
            )
        name = payload.get("name")
        if not isinstance(name, str) or not ICON_NAME_RE.match(name):
            return self.send_json(
                400,
                {
                    "error": "Icon names use lower-case letters, digits, '.', '-' and '_' (at most 64)."
                },
            )
        try:
            if delete:
                removed = ICONS.delete(name)
                log(
                    event="icon-deleted",
                    user=user["username"],
                    icon=name,
                    removed=removed,
                )
                return self.send_json(200, {"ok": True, "removed": removed})
            ctype, data = parse_icon(payload.get("dataUrl"))
            sha = ICONS.put(name, ctype, data, user["username"])
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
        log(
            event="icon-saved",
            user=user["username"],
            icon=name,
            type=ctype,
            bytes=len(data),
        )
        self.send_json(200, {"ok": True, "url": "%s/icons/%s?v=%s" % (BASE, name, sha)})

    def avatar(self, user_id, versioned):
        if user_id == "default":
            default = DEFAULTS.get("avatar") if DEFAULTS else None
            if not default:
                return self.send(
                    404, "no default avatar\n", headers={"Cache-Control": "no-cache"}
                )
            return self.send(
                200,
                default["data"],
                default["type"],
                {
                    "Cache-Control": (
                        "public, max-age=31536000, immutable"
                        if versioned
                        else "no-cache"
                    )
                },
            )
        if not re.match(r"^[0-9a-f-]{36}$", user_id) or not AVATARS or not AVATARS.pool:
            return self.send(404, "not found\n")
        try:
            hit = AVATARS.get(user_id)
        except Exception as e:  # noqa: BLE001
            return self.send(
                503, "Coder's database is not reachable: %s\n" % str(e)[:200]
            )
        if not hit:
            return self.send(404, "no avatar\n", headers={"Cache-Control": "no-cache"})
        self.send(
            200,
            hit[1],
            hit[0],
            {
                "Cache-Control": (
                    "public, max-age=31536000, immutable" if versioned else "no-cache"
                )
            },
        )

    def favicon(self, name):
        if name not in (
            "favicon-light.png",
            "favicon-dark.png",
            "favicon-light.svg",
            "favicon-dark.svg",
        ):
            return self.send(404, "not found\n")
        logo = (
            LOGOS.peek() if LOGOS else None
        )  # the cached copy: never waits for the database
        if logo:
            headers = {"Cache-Control": "no-cache"}
            if logo["type"] == "image/svg+xml":
                headers["Content-Security-Policy"] = SVG_CSP
            return self.send(200, logo["data"], logo["type"], headers)
        hit = FAVICONS.get(name)
        if hit is None:
            try:
                with urllib.request.urlopen(
                    CODER_URL + "/favicons/" + name, timeout=5
                ) as res:
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
        admin = bool(set(user["roles"]) & ADMIN_ROLES)
        tab = (q.get("tab") or [""])[0]
        tab = tab if CHAT_TAB_RE.match(tab) else ""
        if what in ("state", "poll"):
            CHAT.tab(user["id"], tab) if tab else CHAT.touch(user["id"])
        if what == "people":  # who is online or active today (peer-to-peer chat; admins always)
            if not admin and not CHAT.settings.get("peers"):
                return self.send_json(200, {"enabled": False, "people": []})
            return self.send_json(
                200,
                {
                    "enabled": bool(CHAT.settings.get("peers")),
                    "people": chat_people_for(user, admin),
                },
            )
        if what == "export":  # Admin Controls > Chat > Export: every record, as a file to save
            if not admin:
                return self.send_json(403, {"error": "Only admins can export the chats."})
            record = CHAT.export(user["username"])
            log(event="chat-exported", user=user["username"], messages=record["counts"]["messages"])
            return self.send(
                200,
                json.dumps(record, indent=2),
                "application/json",
                {
                    "Cache-Control": "no-store",
                    "Content-Disposition": 'attachment; filename="chats-%s.json"'
                    % time.strftime("%Y%m%d-%H%M%S", time.gmtime()),
                },
            )
        if what in ("settings", "pairs"):  # Admin Controls > Chat
            if not admin:
                return self.send_json(
                    403, {"error": "Only admins can see the chat's settings."}
                )
            if what == "pairs":  # a page: ?offset= (from the newest), ?limit= (25, at most 100)
                try:
                    offset = max(0, int((q.get("offset") or ["0"])[0]))
                    limit = min(100, max(1, int((q.get("limit") or [str(CHAT.PAIRS_PAGE)])[0])))
                except ValueError:
                    return self.send_json(400, {"error": "offset and limit are numbers."})
                page = CHAT.pairs(limit, offset)
                for pair in page["pairs"]:
                    for side in ("a", "b"):
                        pair[side]["online"] = CHAT.is_online(pair[side]["id"])
                return self.send_json(200, {**page, "offset": offset, "limit": limit})
            return self.send_json(
                200,
                {
                    **{k: v for k, v in CHAT.settings.items() if k != "purgeVersion"},
                    "keepRange": list(CHAT_KEEP_RANGE),
                    "stats": CHAT.stats(),
                },
            )
        if what == "state":
            return self.send_json(
                200,
                {
                    "me": {
                        "id": user["id"],
                        "username": user["username"],
                        "name": user["name"],
                        "admin": admin,
                        "chatOn": user["id"] not in CHAT.off,
                        "invisible": user["id"] in CHAT.invisible,
                    },
                    "conversations": CHAT.conversations(user["id"]),
                    "cursor": CHAT.newest(user["id"]),
                    "typing": CHAT.typing_to(user["id"]),
                    "focus": CHAT.focus_pending(user["id"]),
                    "focusVersion": CHAT.focus_ver,
                    "clearVersion": max(CHAT.last_clear(user["id"]), CHAT.clear_ver),
                    **chat_availability(),
                },
            )
        if what == "admins":  # the admins taking chats (the developers' list)
            return self.send_json(
                200,
                {
                    "admins": [
                        a
                        for a in chat_admins()
                        if a["id"] != user["id"] and a["id"] not in CHAT.off
                    ]
                },
            )
        if what.startswith("file/"):
            try:
                attached = CHAT.attachment(user["id"], int(what[5:]))
            except ValueError:
                attached = None
            if attached:
                return self.chat_send_file(*attached)
            try:
                hit = CHAT.file(user["id"], int(what[5:]))
            except ValueError:
                hit = None
            if not hit:
                return self.send(404, "not found\n")
            return self.send(
                200,
                hit[1],
                hit[0],
                {
                    "Cache-Control": "private, max-age=86400",
                    "Content-Security-Policy": SVG_CSP,
                    "Content-Disposition": 'inline; filename="screenshot-%s.%s"'
                    % (what[5:], hit[0].split("/")[1]),
                },
            )
        if what == "messages":
            peer = (q.get("peer") or [""])[0]
            if not chat_peer_id_ok(peer):
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
                pv = int((q.get("pv") or ["0"])[0] or 0) if q.get("pv") else None
                fv = int((q.get("fv") or ["0"])[0] or 0) if q.get("fv") else None
            except ValueError:
                return self.send_json(
                    400, {"error": "after, cleared and av must be numbers."}
                )
            known = sorted(
                p for p in (q.get("typing") or [""])[0].split(",") if chat_peer_id_ok(p)
            )
            typing = CHAT.wait(user["id"], after, known, cleared, avail, pv, fv)
            CHAT.tab(user["id"], tab) if tab else CHAT.touch(user["id"])
            return self.send_json(
                200,
                {
                    "messages": CHAT.since(user["id"], after),
                    "typing": typing,
                    "focus": CHAT.focus_pending(user["id"]),
                    "focusVersion": CHAT.focus_ver,
                    "cleared": CHAT.cleared_since(user["id"], cleared),
                    "clearVersion": max(CHAT.last_clear(user["id"]), cleared),
                    **chat_availability(),
                },
            )
        self.send(404, "not found\n")

    def chat_peer(self, peer_id):
        """{id, username, name} of a Coder user, read with the caller's own session (admins may list users)."""
        key = "chat-peer:" + peer_id
        hit = CACHE.get(key)
        if hit:
            return hit
        status, u = http_json(
            CODER_URL + "/api/v2/users/" + peer_id,
            headers={"Coder-Session-Token": self.token()},
            timeout=5,
        )
        if status != 200 or not isinstance(u, dict) or not u.get("username"):
            return None
        roles = {r.get("name") for r in u.get("roles") or [] if isinstance(r, dict)}
        peer = {
            "id": u.get("id") or peer_id,
            "username": u["username"],
            "name": u.get("name") or "",
            "admin": bool(roles & ADMIN_ROLES),
        }
        CACHE.put(key, peer, 300)
        return peer

    def chat_send_file(self, path, name, ctype, size):
        """A file attached to a message: a picture (its content checked) shown in the conversation, anything else
        only ever downloaded (never run or shown by the browser)."""
        with open(path, "rb") as f:
            head = f.read(64)
        inline = ctype in CHAT_INLINE_TYPES and image_type(head) == ctype
        quoted = urllib.parse.quote(name)
        self.send_response(200)
        self.send_header("Content-Type", ctype if inline else "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Content-Disposition", "%s; filename*=UTF-8''%s" % ("inline" if inline else "attachment", quoted))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def chat_upload(self, query):
        """PUT /api/chat/upload?to=&name=&type=: a file to attach to the next message to that person."""
        if self.headers.get(CSRF_HEADER[0]) != CSRF_HEADER[1]:
            return self.send_json(403, {"error": "Request rejected (cross-site protection)."})
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
            return self.send_json(403, {"error": "Request rejected (cross-site protection)."})
        user, err = self.user()
        if err:
            return
        admin = bool(set(user["roles"]) & ADMIN_ROLES)
        q = urllib.parse.parse_qs(query or "")
        peer_id = (q.get("to") or [""])[0]
        if not chat_peer_id_ok(peer_id):
            return self.send_json(400, {"error": "Who is it for? (to=<user id>)"})
        try:
            length = int(self.headers.get("Content-Length") or -1)
        except ValueError:
            length = -1
        if length <= 0:
            return self.send_json(400, {"error": "The upload needs a Content-Length (an empty file can't be sent)."})
        if length > CHAT_MAX_FILE:
            return self.send_json(413, {"error": "A file can be at most %d MB." % (CHAT_MAX_FILE // 1048576)})
        try:
            free = shutil.disk_usage(CHAT.files_dir).free
        except OSError:
            free = None
        if free is not None and free - length < CHAT_FILE_RESERVE:
            return self.send_json(507, {"error": "The chat's storage is full; ask an admin to purge old chats."})
        all_admins = [] if admin else chat_admins()
        admins = [a for a in all_admins if a["id"] not in CHAT.off]
        why = CHAT.may_write(user, admin, peer_id, {a["id"] for a in admins}, {a["id"] for a in all_admins})
        if why:
            return self.send_json(403, {"error": why})
        name = chat_file_name((q.get("name") or [""])[0])
        ctype = (q.get("type") or [""])[0].lower()
        ctype = ctype if re.match(r"^[a-z0-9.+-]+/[a-z0-9.+-]+$", ctype) else "application/octet-stream"
        try:
            hit = CHAT.put_upload(user["id"], peer_id, name, ctype, length, self.rfile)
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        log(event="chat-upload", user=user["username"], to=peer_id, bytes=length)  # never the name or the content
        return self.send_json(200, hit)

    def chat_post(self, what, payload):
        user, err = self.user()
        if err:
            return
        admin = bool(set(user["roles"]) & ADMIN_ROLES)
        if what == "availability":  # an admin's own on/off switch
            if not admin:
                return self.send_json(
                    403, {"error": "Only admins can turn chat on or off."}
                )
            on = payload.get("enabled")
            if not isinstance(on, bool):
                return self.send_json(400, {"error": "enabled must be true or false."})
            CHAT.set_enabled(user["id"], on)
            log(event="chat-availability", user=user["username"], enabled=on)
            return self.send_json(200, {"enabled": on, **chat_availability()})
        if what in ("activity", "leave"):  # a tab: its user went idle or came back, or it closed
            tab = str(payload.get("tab") or "")
            if not CHAT_TAB_RE.match(tab):
                return self.send_json(400, {"error": "tab must be a tab id."})
            if what == "leave":
                CHAT.tab(user["id"], tab, leave=True)
            else:
                idle = payload.get("idle")
                if not isinstance(idle, bool):
                    return self.send_json(400, {"error": "idle must be true or false."})
                CHAT.tab(user["id"], tab, idle=idle)
            return self.send_json(200, {"ok": True, "presenceVersion": CHAT.presence_ver})
        if what == "presence":  # anyone: invisible to everyone but admins, or not
            invisible = payload.get("invisible")
            if not isinstance(invisible, bool):
                return self.send_json(400, {"error": "invisible must be true or false."})
            CHAT.set_invisible(user["id"], invisible)
            log(event="chat-presence", user=user["username"], invisible=invisible)
            return self.send_json(200, {"invisible": invisible})
        if what in ("settings", "purge"):  # Admin Controls > Chat
            if not admin:
                return self.send_json(
                    403, {"error": "Only admins can change the chat's settings."}
                )
            if what == "purge":
                n = CHAT.purge()
                log(event="chat-purged", user=user["username"], messages=n)
                return self.send_json(200, {"ok": True, "deleted": n, "stats": CHAT.stats()})
            changes = {}
            if "peers" in payload:
                if not isinstance(payload["peers"], bool):
                    return self.send_json(400, {"error": "peers must be true or false."})
                changes["peers"] = payload["peers"]
            if "keepDays" in payload:
                days = payload["keepDays"]
                lo, hi = CHAT_KEEP_RANGE
                if isinstance(days, bool) or not isinstance(days, int) or not lo <= days <= hi:
                    return self.send_json(
                        400, {"error": "Keep chats between %d and %d days." % (lo, hi)}
                    )
                changes["keepDays"] = days
            if not changes:
                return self.send_json(400, {"error": "Nothing to change (peers, keepDays)."})
            saved = CHAT.put_settings(changes, user["username"])
            log(event="chat-settings", user=user["username"], **changes)
            return self.send_json(
                200,
                {
                    **{k: v for k, v in saved.items() if k != "purgeVersion"},
                    "keepRange": list(CHAT_KEEP_RANGE),
                    "stats": CHAT.stats(),
                },
            )
        if what == "groups":  # an admin's one thread with the accounts chosen (Admin > Accounts, Chat)
            if not admin:
                return self.send_json(403, {"error": "Only admins start group chats."})
            ids = payload.get("members")
            if not isinstance(ids, list) or not all(isinstance(i, str) and UUID_RE.match(i) for i in ids):
                return self.send_json(400, {"error": "members: the user ids."})
            ids = [i for i in dict.fromkeys(ids) if i != user["id"]]
            if not ids or len(ids) > CHAT_GROUP_MAX:
                return self.send_json(400, {"error": "Choose 1 to %d other people." % CHAT_GROUP_MAX})
            members = []
            for i in ids:
                peer = self.chat_peer(i)
                if not peer:
                    return self.send_json(404, {"error": "A user chosen doesn't exist (any more)."})
                members.append(peer)
            group = CHAT.create_group(user, members, focus=payload.get("focus", True) is not False)
            log(event="chat-group", by=user["username"], group=group["id"], members=len(members))
            return self.send_json(200, {"peer": group})
        if what == "focus/ack" and payload.get("message") is not None:  # a forced message, acknowledged
            try:
                acked = CHAT.ack_forced(user["id"], int(payload["message"]))
            except (TypeError, ValueError):
                return self.send_json(400, {"error": "message: a message id."})
            if not acked:
                return self.send_json(404, {"error": "That message is not waiting for you."})
            log(event="chat-focus-ack", user=user["username"], message=int(payload["message"]))
            return self.send_json(200, {"ok": True})
        if what == "focus/force":  # Force Response: the newest admin message in the conversation, forced on them
            if not admin:
                return self.send_json(403, {"error": "Only admins force a response."})
            peer_id = str(payload.get("to") or "")
            if not chat_peer_id_ok(peer_id) or peer_id == user["id"]:
                return self.send_json(400, {"error": "to: the user (or group chat) to answer."})
            message = CHAT.newest_admin_message(peer_id)
            if not message:
                return self.send_json(404, {"error": "No admin has written to them yet: send a message with Forced "
                                                     "Focus instead."})
            members = (list(CHAT.group(peer_id)["members"]) if CHAT_GROUP_RE.match(peer_id) and CHAT.group(peer_id)
                       else [peer_id])
            members = [m for m in members if m != message["from"]]
            CHAT.force(user, message["id"], members)
            log(event="chat-force-response", by=user["username"], to=peer_id, message=message["id"])
            return self.send_json(200, {"message": message})
        if what == "focus/ack":  # a member clicked a group chat's first message
            group_id = str(payload.get("group") or "")
            if not CHAT_GROUP_RE.match(group_id) or not CHAT.in_group(user["id"], group_id):
                return self.send_json(404, {"error": "There is no such chat."})
            CHAT.ack_focus(user["id"], group_id)
            return self.send_json(200, {"ok": True})
        peer_id = str(payload.get("to") or "")
        if not chat_peer_id_ok(peer_id):
            return self.send_json(400, {"error": "Who is it for? (to=<user id>)"})
        if what == "read":
            try:
                CHAT.mark_read(user["id"], peer_id, int(payload.get("last") or 0))
            except (TypeError, ValueError):
                return self.send_json(400, {"error": "last must be a message id."})
            return self.send_json(200, {"ok": True})
        if what == "delete":
            try:
                n = CHAT.delete(user["id"], peer_id)
            except PermissionError as e:
                return self.send_json(403, {"error": str(e)})
            log(event="chat-deleted", by=user["username"], peer=peer_id, messages=n)
            return self.send_json(200, {"ok": True, "deleted": n})
        all_admins = [] if admin else chat_admins()
        admins = [a for a in all_admins if a["id"] not in CHAT.off]
        why = CHAT.may_write(
            user,
            admin,
            peer_id,
            {a["id"] for a in admins},
            {a["id"] for a in all_admins},
        )
        if what == "typing":
            if not why:
                CHAT.set_typing(user["id"], peer_id)
            return self.send_json(200, {"ok": True})
        if what != "send":
            return self.send(404, "not found\n")
        text = str(payload.get("text") or "").strip()
        image = None
        if payload.get("image"):
            m = re.match(
                r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$",
                str(payload["image"]),
            )
            data = base64.b64decode(m.group(2)) if m else b""
            if not m or image_type(data) != m.group(1):
                return self.send_json(
                    400, {"error": "The screenshot must be a PNG, JPEG or WebP image."}
                )
            if len(data) > CHAT_MAX_IMAGE:
                return self.send_json(
                    400,
                    {
                        "error": "The screenshot is larger than %d MB."
                        % (CHAT_MAX_IMAGE // 1048576)
                    },
                )
            image = (m.group(1), data)
        client_id = str(payload.get("clientId") or "")
        client_id = client_id if CHAT_CLIENT_ID_RE.match(client_id) else ""
        again = CHAT.sent_before(user["id"], client_id)
        if again:
            return self.send_json(200, {"message": again})
        upload = str(payload.get("upload") or "")
        attachment = None
        if upload:
            if not CHAT_UPLOAD_RE.match(upload):
                return self.send_json(400, {"error": "upload must be an upload's id."})
            attachment = CHAT.take_upload(user["id"], upload, peer_id)
            if not attachment:
                return self.send_json(400, {"error": "The attached file is gone (sent already, or kept too long): attach it again."})
        if not text and not image and not attachment:
            return self.send_json(400, {"error": "The message is empty."})
        if len(text) > CHAT_MAX_TEXT:
            return self.send_json(
                400, {"error": "Messages can be at most %d characters." % CHAT_MAX_TEXT}
            )
        if why:
            return self.send_json(403, {"error": why})
        group = CHAT.group(peer_id) if CHAT_GROUP_RE.match(peer_id) else None
        peer = (
            CHAT.group_peer(peer_id)
            if group
            else self.chat_peer(peer_id)
            if admin
            else next((a for a in admins if a["id"] == peer_id), None)
        )
        if not peer and not admin:
            # Another developer (peer-to-peer chat): from Coder's users table, as the People list shows them.
            found = chat_people().get(peer_id)
            if found:
                peer = {k: found[k] for k in ("id", "username", "name", "admin")}
        if not peer:
            peer = CHAT.peer_from_history(user["id"], peer_id)
            if peer and not admin:
                peer["admin"] = peer_id in {a["id"] for a in all_admins}
        if not peer:
            return self.send_json(404, {"error": "That user doesn't exist (any more)."})
        if not CHAT.rate_ok(user["id"], admin):
            return self.send_json(
                429, {"error": "Too many messages at once; wait a moment."}
            )
        page = str(payload.get("page") or "")[:300] if image else ""
        page = page if page.startswith("/") else ""
        message = CHAT.send(user, admin, peer, text, image, page, client_id, attachment)
        forced = bool(payload.get("focus")) and admin
        if forced:
            # Forced Focus: in front of everything on their screen (every member's, in a group chat) until acknowledged
            members = list((group or {}).get("members") or {}) if group else [peer["id"]]
            CHAT.force(user, message["id"], [m for m in members if m != user["id"]])
        log(
            event="chat",
            sender=user["username"],
            to=peer["username"],
            id=message["id"],
            image=bool(image),
            file=bool(attachment),
            forced=forced,
        )  # never the text
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
        self.send_json(
            200,
            {
                "current": banner["id"] if banner else None,
                "totalUsers": len(users) if users is not None else None,
                "events": STORE.report(banner, users),
                "generatedAt": now(),
            },
        )

    def do_PUT(self):
        """Uploads: the Images view's (files of an image being built), the Cloud Drive's and libraries', a chat's file,
        a workspace's home backup to restore."""
        self.close_connection = True
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith(BASE + "/internal/") and workspacevolumes.handle_internal(self, "PUT", url.path):
            return
        if workspacevolumes.handle(self, "PUT", url.path, url.query):   # a home backup to restore
            return
        if url.path == BASE + "/api/chat/upload":
            return self.chat_upload(url.query)
        if safe.handle(self, "PUT", url.path, url.query) or safe.handle_libraries(self, "PUT", url.path, url.query):
            return
        if not imagebuilder.handle(self, "PUT", url.path, url.query, ADMIN_ROLES):
            self.send(404, "not found\n")

    def clear_inbox(self):
        """The signed-in user's Inbox (the bell), emptied: Coder can only mark its notifications read, and a busy
        Inbox fills up. Only the caller's own rows of Coder's inbox_notifications go; nothing else is touched."""
        user, err = self.user()
        if err:
            return
        pool = LOGOS.pool if LOGOS else None
        if not pool:
            return self.send_json(503, {"error": "Coder's database is not reachable yet."})
        try:
            rows = pool.query("DELETE FROM inbox_notifications WHERE user_id = $1::uuid RETURNING id", [user["id"]])
        except Exception as e:  # noqa: BLE001 - said to the user
            log(event="inbox-clear-failed", user=user["username"], error=str(e)[:300])
            return self.send_json(503, {"error": "The Inbox could not be cleared: %s" % str(e)[:200]})
        log(event="inbox-cleared", user=user["username"], count=len(rows))
        return self.send_json(200, {"cleared": len(rows)})

    def do_DELETE(self):
        url = urllib.parse.urlsplit(self.path)
        if not workspacetunnels.handle(self, "DELETE", url.path, url.query):
            self.send(404, "not found\n")

    def do_POST(self):
        self.close_connection = True
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path.startswith(BASE + "/internal/") and imagebuilder.handle_internal(self, "POST", path):
            return
        if imagebuilder.handle(self, "POST", path, url.query, ADMIN_ROLES):
            return
        if workspacevolumes.handle(self, "POST", path, url.query):
            return
        if provisioners.handle(self, "POST", path, url.query):
            return
        if dr.handle(self, "POST", path, url.query):
            return
        if workspacepower.handle(self, "POST", path, url.query):
            return
        if workspacetunnels.handle(self, "POST", path, url.query):
            return
        if lockdown.handle(self, "POST", path, url.query):
            return
        if safe.handle(self, "POST", path, url.query) or safe.handle_libraries(self, "POST", path, url.query):
            return
        routes = {
            BASE + "/api/view",
            BASE + "/api/ack",
            BASE + "/api/events/delete",
            BASE + "/api/events/clear",
            BASE + "/api/classification",
            BASE + "/api/login-page",
            BASE + "/api/quick-menu",
            BASE + "/api/quick-menu/reset",
            BASE + "/api/keycloak/apply",
            BASE + "/api/keycloak/undo",
            BASE + "/api/keycloak/connect",
            BASE + "/api/persistence/apply",
            BASE + "/api/icons",
            BASE + "/api/icons/delete",
            BASE + "/api/logo",
            BASE + "/api/logo/reset",
            BASE + "/api/backgrounds",
            BASE + "/api/backgrounds/reset",
            BASE + "/api/banner-pictures",
            BASE + "/api/avatar",
            BASE + "/api/avatar/reset",
            BASE + "/api/quota",
            BASE + "/api/quota/check",
            BASE + "/api/scheduler",
            BASE + "/api/scheduler/check",
            BASE + "/api/notes",
            BASE + "/api/notes/update",
            BASE + "/api/notes/delete",
            BASE + "/api/notes/dismiss",
            BASE + "/api/inbox/clear",
        }
        if path not in routes and not path.startswith(BASE + "/api/chat/"):
            return self.send(404, "not found\n")
        if not self.csrf_ok():
            return self.send_json(
                403, {"error": "Request rejected (cross-site protection)."}
            )
        payload = self.body()
        if not isinstance(payload, dict):
            return self.send_json(400, {"error": "Expected a JSON object."})
        if path in (BASE + "/api/view", BASE + "/api/ack"):
            return self.receipt(path.endswith("/ack"), payload)
        if path == BASE + "/api/notes/dismiss":
            user, err = self.user()
            if err:
                return
            note = STORE.note(str(payload.get("id", "")))
            if not note:
                return self.send_json(404, {"error": "That note is gone."})
            admin = bool(set(user["roles"]) & ADMIN_ROLES)
            if not admin and workspace_owner(self.token(), note["workspaceId"]) != user["id"]:
                return self.send_json(403, {"error": "Only the workspace's owner can dismiss its notes."})
            log(event="note-dismissed", user=user["username"], note=note["id"], workspace=note["workspaceId"])
            return self.send_json(200, {"note": STORE.note_dismiss(note["id"])})
        if path == BASE + "/api/inbox/clear":
            return self.clear_inbox()
        if path in (BASE + "/api/avatar", BASE + "/api/avatar/reset"):
            return self.save_avatar(path.endswith("/reset"), payload)
        if path.startswith(BASE + "/api/chat/"):
            return self.chat_post(path[len(BASE + "/api/chat/") :], payload)
        if path in (BASE + "/api/icons", BASE + "/api/icons/delete"):
            return self.save_icon(path.endswith("/delete"), payload)
        if path == BASE + "/api/quota/check":   # Coder asks, with the requester's session, before it creates a workspace
            user, err = self.user()
            if err:
                return
            try:
                result = quota_check(self.token(), user, payload)
            except Exception as e:  # noqa: BLE001 - Coder lets the workspace through when the check itself fails
                log(event="quota-check-failed", user=user["username"], error=str(e)[:200])
                return self.send_json(503, {"error": "The quota could not be checked: %s" % str(e)[:200]})
            if not result.get("allowed"):
                log(event="quota-refused", user=user["username"], owner=payload.get("owner"), reason=result.get("message"))
            return self.send_json(200, result)
        if path == BASE + "/api/scheduler/check":   # Coder asks, with the requester's session
            user, err = self.user()
            if err:
                return
            try:
                result = scheduler_check(self.token(), user, payload)
            except Exception as e:  # noqa: BLE001 - Coder goes ahead when the check itself fails
                log(event="scheduler-check-failed", user=user["username"], error=str(e)[:200])
                return self.send_json(503, {"error": "The schedule could not be checked: %s" % str(e)[:200]})
            if not result.get("allowed"):
                log(event="scheduler-refused", user=user["username"], owner=payload.get("owner"),
                    action=payload.get("action"), reason=result.get("message"))
            return self.send_json(200, result)
        user, err = self.user(admin=True)
        if err:
            return
        if path in (BASE + "/api/notes", BASE + "/api/notes/update", BASE + "/api/notes/delete"):
            return self.notes_post(path, payload, user)
        if path == BASE + "/api/login-page":
            try:
                value = clean_login_page(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            value.update({"updatedBy": user["username"], "updatedAt": now()})
            STORE.put_setting("login_page", value)
            log(event="login-page-saved", user=user["username"], effect=value["effect"], title=value["title"])
            return self.send_json(200, login_page_settings())
        if path == BASE + "/api/quick-menu":
            try:
                value = clean_quick_menu(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            value.update({"updatedBy": user["username"], "updatedAt": now()})
            STORE.put_setting("quick_menu", value)
            log(event="quick-menu-saved", user=user["username"], items=",".join(value["items"]))
            return self.send_json(200, quick_menu_settings())
        if path == BASE + "/api/quick-menu/reset":
            STORE.put_setting("quick_menu", {"items": None, "updatedBy": user["username"], "updatedAt": now()})
            log(event="quick-menu-reset", user=user["username"])
            return self.send_json(200, quick_menu_settings())
        if path == BASE + "/api/scheduler":
            try:
                value = clean_scheduler(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            STORE.put_setting("workspace_scheduler", value)
            log(event="scheduler-saved", user=user["username"], enabled=value["enabled"], mode=value["mode"],
                max_hours=value["maxActiveHours"], excluded=len(value["excludedUsers"]))
            return self.send_json(200, {"ok": True, "settings": scheduler_settings()})
        if path == BASE + "/api/quota":
            try:
                value = clean_quota(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            STORE.put_setting("user_quota", value)
            log(event="quota-saved", user=user["username"], default=value["default"], overrides=len(value["users"]))
            return self.send_json(200, {"ok": True, "settings": quota_settings()})
        if path == BASE + "/api/banner-pictures":
            if not BANNER_PICTURES or not BANNER_PICTURES.pool:
                return self.send_json(503, {"error": "Coder's database is not configured for this service."})
            name = re.sub(r"[\[\]()\\*_`~!]", "", str(payload.get("name") or "")).strip()[:80] or "picture"
            try:
                ctype, data = parse_banner_picture(payload.get("dataUrl"))
                pid = BANNER_PICTURES.put(ctype, data, name, user["username"])
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
            log(event="banner-picture-saved", user=user["username"], id=pid, type=ctype, bytes=len(data), name=name)
            return self.send_json(200, {"id": pid, "url": "%s/banner-picture/%s" % (BASE, pid), "name": name,
                                        "type": ctype, "bytes": len(data)})
        if path in (BASE + "/api/backgrounds", BASE + "/api/backgrounds/reset"):
            slot = payload.get("slot")
            if slot not in BG_SLOTS:
                return self.send_json(400, {"error": "slot must be one of %s." % ", ".join(BG_SLOTS)})
            if not BACKGROUNDS or not BACKGROUNDS.pool:
                return self.send_json(503, {"error": "Coder's database is not configured for this service."})
            try:
                if path.endswith("/reset"):
                    BACKGROUNDS.reset(slot)
                    log(event="background-reset", user=user["username"], slot=slot)
                    return self.send_json(200, {"ok": True, "set": False})
                current = BACKGROUNDS.all(fresh=True).get(slot)
                settings = clean_bg_settings(payload, current)
                if payload.get("dataUrl") or payload.get("html") or payload.get("picture"):
                    ctype, data = (parse_background_html(payload["html"]) if payload.get("html")
                                   else parse_background_picture(payload["picture"]) if payload.get("picture")
                                   else parse_background(payload["dataUrl"]))
                    if ctype != "text/html" and payload.get("params") is None:
                        settings["params"] = {}  # an image has no dials
                    BACKGROUNDS.put(slot, ctype, data, settings, user["username"])
                    log(event="background-saved", user=user["username"], slot=slot, type=ctype, bytes=len(data),
                        opacity=settings["opacity"], fit=settings["fit"], layer=settings["layer"])
                elif current:
                    BACKGROUNDS.set_settings(slot, settings, user["username"])
                    log(event="background-settings", user=user["username"], slot=slot, opacity=settings["opacity"],
                        fit=settings["fit"], layer=settings["layer"])
                else:
                    return self.send_json(400, {"error": "Choose an image first."})
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self.send_json(503, {"error": "Coder's database: %s" % str(e)[:200]})
            return self.send_json(200, {"ok": True, "set": True, slot: background_public(
                slot, BACKGROUNDS.all().get(slot))})
        if path in (BASE + "/api/logo", BASE + "/api/logo/reset"):
            if not LOGOS or not LOGOS.pool:
                return self.send_json(
                    503,
                    {"error": "Coder's database is not configured for this service."},
                )
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
                return self.send_json(
                    503, {"error": "Coder's database: %s" % str(e)[:200]}
                )
            log(event="logo-saved", user=user["username"], type=ctype, bytes=len(data))
            return self.send_json(
                200, {"ok": True, "set": True, "url": BASE + "/logo?v=" + sha}
            )
        if path == BASE + "/api/events/delete":
            event_id = payload.get("id")
            if not isinstance(event_id, str) or not ID_RE.match(event_id):
                return self.send_json(
                    400, {"error": 'Expected {"id": "<announcement id>"}.'}
                )
            removed = STORE.delete_event(event_id)
            log(event="event-deleted", user=user["username"], announcement=event_id)
            return self.send_json(200, {"ok": True, "removed": removed})
        if path == BASE + "/api/events/clear":
            removed = STORE.clear_events()
            log(event="events-cleared", user=user["username"], removed=removed)
            return self.send_json(200, {"ok": True, "removed": removed})
        if path == BASE + "/api/classification":
            try:
                value = self.clean_classification(payload)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            value.update({"updatedBy": user["username"], "updatedAt": now()})
            STORE.put_setting("classification", value)
            log(
                event="classification-saved",
                user=user["username"],
                enabled=value["enabled"],
                text=value["text"],
            )
            return self.send_json(200, value)
        if path == BASE + "/api/keycloak/apply":
            fixes = [
                f
                for f in payload.get("fixes") or []
                if f
                in (
                    "kc.client",
                    "kc.scopes",
                    "coder.secret",
                    "coder.ca",
                    "coder.values",
                )
            ]
            try:
                done = apply_keycloak(
                    fixes, payload.get("settings") or {}, user["username"]
                )
            except (ValueError, RuntimeError, YamlSubsetError) as e:
                log(
                    event="keycloak-apply-failed",
                    user=user["username"],
                    fixes=fixes,
                    error=str(e),
                )
                return self.send_json(400, {"error": str(e)})
            log(event="keycloak-applied", user=user["username"], fixes=fixes, done=done)
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/persistence/apply":
            fixes = [f for f in payload.get("fixes") or [] if f in PERSISTENCE_FIXES]
            if not fixes:
                return self.send_json(400, {"error": "Nothing to apply."})
            try:
                done = apply_persistence(
                    fixes, payload.get("settings") or {}, user["username"]
                )
            except (ValueError, RuntimeError) as e:
                log(
                    event="persistence-apply-failed",
                    user=user["username"],
                    fixes=fixes,
                    error=str(e),
                )
                return self.send_json(400, {"error": str(e)})
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/keycloak/connect":
            username, password = payload.get("username"), payload.get("password")
            if (
                not isinstance(username, str)
                or not username.strip()
                or not isinstance(password, str)
                or not password
            ):
                return self.send_json(
                    400, {"error": "Enter a Keycloak admin username and password."}
                )
            try:
                done = connect_keycloak(
                    username.strip(),
                    password,
                    payload.get("settings") or {},
                    user["username"],
                )
            except (ValueError, RuntimeError) as e:
                log(
                    event="keycloak-connect-failed", user=user["username"], error=str(e)
                )
                return self.send_json(400, {"error": str(e)})
            log(
                event="keycloak-connected",
                user=user["username"],
                client=ADMIN_CLIENT_ID,
            )
            return self.send_json(200, {"ok": True, "done": done})
        if path == BASE + "/api/keycloak/undo":
            backup = STORE.last_backup()
            if not backup:
                return self.send_json(
                    400, {"error": "There is no earlier version to go back to."}
                )
            try:
                patch_argo_values(backup["values_text"])
            except RuntimeError as e:
                return self.send_json(400, {"error": str(e)})
            STORE.drop_backup(backup["id"])
            log(
                event="keycloak-undo",
                user=user["username"],
                restored=backup["saved_at"],
            )
            return self.send_json(
                200,
                {
                    "ok": True,
                    "done": ["Restored Coder's settings from %s" % backup["saved_at"]],
                },
            )

    @staticmethod
    def clean_classification(p):
        text = str(p.get("text", "")).strip()
        if len(text) > 120 or any(c in text for c in "\n\r"):
            raise ValueError(
                "The classification text must be one line of at most 120 characters."
            )
        height = p.get("height", 24)
        if (
            isinstance(height, bool)
            or not isinstance(height, int)
            or not 12 <= height <= 64
        ):
            raise ValueError("Height must be between 12 and 64 pixels.")
        bg, fg = p.get("background", ""), p.get("color", "")
        if not HEX_RE.match(str(bg)) or not HEX_RE.match(str(fg)):
            raise ValueError("Colours must be #rrggbb.")
        enabled = bool(p.get("enabled"))
        if enabled and not text:
            raise ValueError(
                "Enter the classification text before enabling the banners."
            )
        return {
            "enabled": enabled,
            "text": text,
            "height": height,
            "background": bg.lower(),
            "color": fg.lower(),
        }

    def save_avatar(self, reset, payload):
        """Every signed-in user sets (or removes) their own avatar, never someone else's."""
        user, err = self.user()
        if err:
            return
        if not AVATARS or not AVATARS.pool:
            return self.send_json(
                503, {"error": "Coder's database is not configured for this service."}
            )
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

    def notes_post(self, path, payload, user):
        """Admins: create, edit/move or delete a post-it note."""
        try:
            if path.endswith("/delete"):
                removed = STORE.note_delete(str(payload.get("id", "")))
                log(event="note-deleted", user=user["username"], note=payload.get("id"))
                return self.send_json(200, {"ok": True, "removed": removed})
            if path.endswith("/update"):
                note = STORE.note(str(payload.get("id", "")))
                if not note:
                    return self.send_json(404, {"error": "That note is gone."})
                fields = clean_note(payload, partial=True)
                if not fields:
                    return self.send_json(200, {"note": note})
                return self.send_json(200, {"note": STORE.note_update(note["id"], fields)})
            workspace_id = str(payload.get("workspace", ""))
            workspace = workspace_info(self.token(), workspace_id) if UUID_RE.match(workspace_id) else None
            if not workspace:
                return self.send_json(400, {"error": "That workspace does not exist."})
            note = STORE.note_create(workspace, clean_note(payload), user["username"])
            log(event="note-created", user=user["username"], note=note["id"], workspace=workspace_id)
            return self.send_json(200, {"note": note})
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})

    def receipt(self, ack, payload):
        event_id = payload.get("id")
        if not isinstance(event_id, str) or not ID_RE.match(event_id):
            return self.send_json(
                400, {"error": 'Expected {"id": "<announcement id>"}.'}
            )
        user, err = self.user()
        if err:
            return
        banner = current_banner()
        if not (banner and banner["id"] == event_id) and not STORE.known(event_id):
            banner = current_banner(
                fresh=True
            )  # published seconds ago: the cached copy may be the previous one
        if not (banner and banner["id"] == event_id) and not STORE.known(event_id):
            return self.send_json(409, {"error": "That announcement is not live."})
        STORE.record(event_id, user, ack, banner)
        log(
            event="ack" if ack else "view", user=user["username"], announcement=event_id
        )
        self.send_json(200, {"ok": True})


def safe_accounts():
    """Every account (Coder's database), for their safes' volumes: [(id, username)]; None before the database is up."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    return [(r[0], r[1]) for r in pool.query("SELECT id::text, username FROM users WHERE deleted = false")]


def safe_shared_workspaces():
    """The workspaces shared with other users or groups (Coder's workspace sharing): {workspace id: owner id}; None
    before the database is up. Their owner's Cloud Drive stays out of them."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    return {r[0]: r[1] for r in pool.query(
        "SELECT id::text, owner_id::text FROM workspaces WHERE deleted = false "
        "AND (user_acl <> '{}'::jsonb OR group_acl <> '{}'::jsonb)")}


def tunnel_live_workspaces():
    """Workspace IDs whose owners still have active accounts, for peer revocation."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        raise RuntimeError("Coder database is not reachable yet.")
    return [r[0] for r in pool.query(
        "SELECT w.id::text FROM workspaces w JOIN users u ON u.id = w.owner_id "
        "WHERE NOT w.deleted AND NOT u.deleted AND u.status = 'active'")]


def safe_cloud_drive_attachment(owner_id):
    """How an account's Cloud Drive is in each of its started workspaces (Coder's database): [(workspace id, value,
    collected at (epoch seconds; 0 or less: never), job status)] of the latest builds that start them, whose agent has
    the template's metadata cloud_drive (scripts/cloud-drive.sh status); None before the database is up."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    return [(r[0], r[1] or "", float(r[2]), r[3]) for r in pool.query(
        """SELECT w.id::text, m.value, extract(epoch FROM m.collected_at)::float8, b.job_status::text
           FROM workspaces w
           JOIN LATERAL (SELECT wb.job_id, wb.transition, pj.job_status
                           FROM workspace_builds wb JOIN provisioner_jobs pj ON pj.id = wb.job_id
                          WHERE wb.workspace_id = w.id ORDER BY wb.build_number DESC LIMIT 1) b ON true
           JOIN workspace_resources r ON r.job_id = b.job_id
           JOIN workspace_agents a ON a.resource_id = r.id AND a.parent_id IS NULL AND NOT a.deleted
           JOIN workspace_agent_metadata m ON m.workspace_agent_id = a.id AND m.key ~ '(^|_)cloud_drive$'
          WHERE w.owner_id = $1::uuid AND NOT w.deleted AND b.transition = 'start'
            AND b.job_status IN ('pending', 'running', 'succeeded')""", [owner_id])]


def safe_user(user_id):
    """{id, username, name, admin} of an account (Coder's database), for Cloud Drive shares; None if there is none."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    rows = pool.query("SELECT id::text, username, name, rbac_roles, status::text FROM users WHERE id = $1::uuid AND deleted = false",
                      [user_id])
    if not rows:
        return None
    roles = rows[0][3] or []
    if isinstance(roles, str):
        roles = [r for r in roles.strip("{}").split(",") if r]
    return {"id": rows[0][0], "username": rows[0][1], "name": rows[0][2] or "", "admin": bool(set(roles) & ADMIN_ROLES),
            "status": rows[0][4]}


def drive_inbox_send(notification_id, recipient, item):
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        raise RuntimeError("Coder's notification database is unavailable.")
    safe.driveaudit.send_inbox(pool, safe_user, notification_id, recipient, item, safe.driveaudit.inbox_query())


def drive_chat_post(user, to_id, text, share_id):
    """A Cloud Drive share's message (drivepeers): from the user to the other one, carrying the share's card."""
    peer = safe_user(to_id)
    if not (peer and CHAT):
        return
    CHAT.send(user, bool(set(user.get("roles") or []) & ADMIN_ROLES), peer, text, drive=share_id)


def safe_owner_workspaces(owner_id):
    """An account's workspaces (Coder's database): [{id, name}]; None before the database is up."""
    pool = LOGOS.pool if LOGOS else None
    if not pool:
        return None
    return [{"id": r[0], "name": r[1]} for r in pool.query(
        "SELECT id::text, name FROM workspaces WHERE deleted = false AND owner_id = $1::uuid ORDER BY name",
        [owner_id])]


def main():
    global STORE, LOGOS, MONITOR, AVATARS, DEFAULTS, CHAT, ICONS, GALLERY, BACKGROUNDS, BANNER_PICTURES, HUD_HISTORY
    global STORE_IMAGES
    global NET_HISTORY
    STORE = Store(DB_PATH)
    CHAT = ChatStore(DB_PATH)
    DEFAULTS = Defaults(
        DEFAULTS_DIR
    )  # before the logo store, which installs the default logo on a fresh database
    GALLERY = Gallery(os.path.join(DEFAULTS_DIR, "gallery"))
    STORE_IMAGES = ImageStore(IMAGE_STORE_DIR)
    LOGOS = LogoStore()
    AVATARS = AvatarStore(LOGOS)
    BACKGROUNDS = BackgroundStore(LOGOS)
    threading.Thread(target=seed_background_defaults, name="background-defaults", daemon=True).start()
    BANNER_PICTURES = BannerPictureStore(LOGOS)
    ICONS = IconStore(LOGOS)
    MONITOR = Monitor()
    HUD_HISTORY = HudHistory(os.path.join(os.path.dirname(DB_PATH) or "/data", "hud.sqlite"))
    HUD_HISTORY.start()
    NET_HISTORY = AgentNetHistory()
    NET_HISTORY.start()
    imagebuilder.setup(log, http_json, KUBE)
    imagebuilder.start()
    workspacevolumes.setup(log, http_json, KUBE)
    workspacevolumes.QUOTA_CHECK = quota_check   # a restore asks the user quota before it creates a workspace
    workspacevolumes.CODER_URL = CODER_URL
    workspacevolumes.start()
    workspacepower.setup(http_json, workspace_info, KUBE, CODER_URL, ADMIN_ROLES, log)
    workspacetunnels.setup(workspace_info, http_json, KUBE, CODER_URL, ADMIN_ROLES, tunnel_live_workspaces)
    lockdown.setup(log, KUBE, workspace_info, ADMIN_ROLES, CODER_ACCESS_URL)
    provisioners.setup(log, KUBE, ADMIN_ROLES, _coder_get, _coder_send)
    clusternet.setup(log, KUBE, _coder_get, cluster_snapshot, lambda: LOGOS.pool if LOGOS else None, quantity,
                     safe=safe, tls=TLS)
    dr.setup(log, KUBE)
    dr.start()
    lockdown.start()
    safe.setup(log, KUBE, safe_accounts, lambda user: imagebuilder.can_edit(user, ADMIN_ROLES),
               lambda user: bool(set(user.get("roles") or []) & ADMIN_ROLES), workspace_info,
               shared=safe_shared_workspaces, workspaces=safe_owner_workspaces,
               attachment=safe_cloud_drive_attachment)
    drivepeers.setup(log, lambda user: bool(set(user.get("roles") or []) & ADMIN_ROLES), safe_user,
                     drive_chat_post, safe.publish_now, people=lambda: list(chat_people().values()),
                     item=lambda owner, path: safe.item_kind(owner, path, fresh=True), admins=chat_admins)
    safe.setup_audit(safe_user, drive_inbox_send)
    safe.start()
    if imagebuilder.ENABLED:
        # the apt indices for the package check, ready before anyone opens the builder
        threading.Thread(target=lambda: imagebuilder.APT.load(), daemon=True).start()
    if CLUSTER_ACCESS_GROUP:
        ClusterAdminSync().start()
    server = Server(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log(
        event="listening",
        port=PORT,
        coder=CODER_URL,
        banner=BANNER_URL,
        admin_roles=sorted(ADMIN_ROLES),
        db=DB_PATH,
        argocd_app=ARGOCD_APP or None,
        kube=KUBE.ok,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
