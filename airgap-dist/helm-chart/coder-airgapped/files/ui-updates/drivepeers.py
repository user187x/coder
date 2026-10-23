"""Cloud Drives shared between users, whole or in part: one user asks another for their Cloud Drive in a chat message
(a request card in their conversation); its owner accepts it - read only, or read and write - or declines. Or the owner
shares it themselves: the entire drive, a folder or a file of it, with whom they choose, read only or read and write
(a chat message tells them). While admins approve shares (the default), one of them approves it too: every admin gets
a chat message asking for it ("Approve Cloud Drive share"), whose card approves or denies it at once. An active share
mounts the owner's Cloud Drive - or just the folder or file (the volume's subPath) - in the other user's workspaces, at
~/cloud-drive-shared/<owner's username> (a folder or file at ~/cloud-drive-shared/<owner>/<its name>), from their next
start (safe.publish_state gives the templates each user's shares; read only is the mount's own readOnly) - the
Workspaces page says which running workspaces a restart brings it to. In the Cloud Drive window they reach what is
shared with them, and no more (safe.py's file routes ask access_at for every path). The owner, the user it is shared
with or an admin ends a share at any time; it leaves their workspaces at their next restart. A workspace shared with
others (Coder's workspace sharing) mounts no shares, as it mounts no Cloud Drive of its owner's.

Admins turn the feature on and off, and choose whether they approve each share (Cloud Drive > Sharing): off, no
request can be made and no share is mounted (the shares are kept, and mount again when it is turned back on). Kept in
PEERS_FILE on the service's volume.

  GET  /__coder-ui/api/safe/peers                      the settings; the caller's shares (asked by them, of their
                                                       drive); admins: every share, and those waiting for them
  POST /__coder-ui/api/safe/peers/settings {enabled?, adminApproval?}   admins
  POST /__coder-ui/api/safe/peers/request {owner: user id, access: read | write}   asks, in a chat message
  POST /__coder-ui/api/safe/peers/share {to: user id, path, access}    the owner shares: path "" the entire drive, a
                                                       folder or a file of it
  GET  /__coder-ui/api/safe/peers/people               whom one can share with (Coder's active users but the caller)
  POST /__coder-ui/api/safe/peers/<id>/answer {accept, access?}    the owner (access: read only instead of asked write)
  POST /__coder-ui/api/safe/peers/<id>/approve {approve}           admins
  POST /__coder-ui/api/safe/peers/<id>/end                         the owner, the requester or an admin
"""
import json
import os
import re
import threading
import time
import uuid

BASE = "/__coder-ui"
PEERS_FILE = os.environ.get("SAFE_PEERS_FILE", "/data/cloud-drive-peers.json")
ID_RE = re.compile(r"^[0-9a-f]{32}$")
USER_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ACCESS = ("read", "write")
# A share's states: asked (its owner answers), approval (an admin approves), active, and how it ended.
OPEN = ("asked", "approval", "active")
DEFAULT_SETTINGS = {"enabled": False, "adminApproval": True, "updatedBy": None, "updatedAt": None}
ENDED_KEPT_SECONDS = 30 * 86400  # declined, denied and ended shares are listed for a month

LOG = print
IS_ADMIN = None
USER_BY_ID = None  # user id -> {id, username, name, admin} | None
CHAT_POST = None   # (from user, to user id, text, share id) -> None: a chat message carrying the share's card
CHANGED = None     # () -> None: the templates told at once (safe.publish_now)
PEOPLE = None      # () -> [{id, username, name}]: Coder's active users
ITEM = None        # (owner id, path) -> "file" | "folder" | None: what a path of the owner's drive is (safe.item_kind)
ADMINS = None      # () -> [{id, username, name}]: the admins, each asked in a chat message to approve a share
KINDS = ("drive", "folder", "file")
_lock = threading.Lock()


def setup(log, is_admin, user_by_id, chat_post, changed, people=None, item=None, admins=None):
    global LOG, IS_ADMIN, USER_BY_ID, CHAT_POST, CHANGED, PEOPLE, ITEM, ADMINS
    LOG, IS_ADMIN, USER_BY_ID, CHAT_POST, CHANGED = log, is_admin, user_by_id, chat_post, changed
    PEOPLE, ITEM, ADMINS = people, item, admins


def _load():
    try:
        with open(PEERS_FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    settings = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    shares = data.get("shares") if isinstance(data.get("shares"), dict) else {}
    return {"settings": settings, "shares": shares}


def _save(data):
    cutoff = time.time() - ENDED_KEPT_SECONDS
    data["shares"] = {sid: s for sid, s in data["shares"].items()
                      if s.get("state") in OPEN or (s.get("closedAt") or 0) >= cutoff}
    os.makedirs(os.path.dirname(PEERS_FILE) or ".", exist_ok=True)
    tmp = PEERS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, PEERS_FILE)


def _admin(user):
    return bool(IS_ADMIN and IS_ADMIN(user))


def _public(s):
    out = {k: s.get(k) for k in ("id", "from", "fromName", "owner", "ownerName", "access", "asked", "state",
                                 "askedAt", "answeredAt", "approvedBy", "approvedAt", "closedBy", "closedAt")}
    # a share from before parts of a drive could be shared: the entire drive, asked for
    out.update(path=s.get("path") or "", kind=s.get("kind") or "drive", by=s.get("by") or "request")
    return out


def covers(s, path):
    """Whether the share reaches the path (a/b/c, "" the drive's top): the entire drive everywhere, a folder at and
    under it, a file only itself."""
    kind, top = s.get("kind") or "drive", s.get("path") or ""
    if kind == "drive":
        return True
    if kind == "folder":
        return path == top or path.startswith(top + "/")
    return path == top


def settings():
    return _load()["settings"]


def active():
    """{user id: [{id, owner, name, access, path, kind}]} of the shares mounted now (none while the feature is off):
    name is the owner's username; path and kind what of their drive (path "" and kind "drive": all of it)."""
    data = _load()
    if not data["settings"]["enabled"]:
        return {}
    out = {}
    for s in data["shares"].values():
        if s.get("state") == "active":
            p = _public(s)
            out.setdefault(s["from"], []).append({"id": p["id"], "owner": p["owner"], "name": p["ownerName"],
                                                  "access": p["access"], "path": p["path"], "kind": p["kind"]})
    for peers in out.values():
        peers.sort(key=lambda p: (p["name"], p["kind"] != "drive", p["path"]))
    return out


def shares_of(user_id, owner_id):
    """The active shares of the owner's drive with the user (public form; none while the feature is off)."""
    data = _load()
    if not data["settings"]["enabled"]:
        return []
    return [_public(s) for s in data["shares"].values()
            if s.get("state") == "active" and s.get("from") == user_id and s.get("owner") == owner_id]


def access_at(user_id, owner_id, path):
    """What the user's active shares of the owner's drive give at the path: "write", "read" or None - the widest of
    those that reach it (the Cloud Drive window's file routes, ?drive=<owner id>)."""
    best = None
    for s in shares_of(user_id, owner_id):
        if covers(s, path):
            if s["access"] == "write":
                return "write"
            best = "read"
    return best


def view(user):
    data = _load()
    mine = [_public(s) for s in data["shares"].values() if user["id"] in (s.get("from"), s.get("owner"))]
    out = {"settings": data["settings"], "admin": _admin(user), "me": user["id"],
           "asked": sorted((s for s in mine if s["from"] == user["id"]), key=lambda s: -s["askedAt"]),
           "ofMine": sorted((s for s in mine if s["owner"] == user["id"]), key=lambda s: -s["askedAt"])}
    if out["admin"]:
        every = sorted((_public(s) for s in data["shares"].values()), key=lambda s: -s["askedAt"])
        out["all"] = every
        out["waiting"] = [s for s in every if s["state"] == "approval"]
    return out


def save_settings(user, body):
    if not _admin(user):
        raise PermissionError("Only admins turn sharing between users on or off.")
    changes = {}
    for key in ("enabled", "adminApproval"):
        if key in body:
            if not isinstance(body[key], bool):
                raise ValueError("%s: true or false." % key)
            changes[key] = body[key]
    if not changes:
        raise ValueError("Nothing to change: enabled, adminApproval.")
    with _lock:
        data = _load()
        data["settings"].update(changes, updatedBy=user["username"], updatedAt=int(time.time()))
        if changes.get("adminApproval") is False:
            # shares waiting for an admin go active: approving is no longer asked for
            for s in data["shares"].values():
                if s.get("state") == "approval":
                    s.update(state="active", approvedBy="(approval turned off by %s)" % user["username"],
                             approvedAt=int(time.time()))
        _save(data)
    LOG(event="cloud-drive-peers-settings", by=user["username"], **changes)
    _changed()
    return view(user)


def _changed():
    if CHANGED:
        try:
            CHANGED()
        except Exception as e:  # noqa: BLE001 - the watcher publishes within seconds anyway
            LOG(event="cloud-drive-peers-publish-failed", error=str(e)[:200])


def _post(user, to_id, text, sid):
    if not CHAT_POST:
        return
    try:
        CHAT_POST(user, to_id, text, sid)
    except Exception as e:  # noqa: BLE001 - the share stands; the card shows on the Cloud Drive's Sharing too
        LOG(event="cloud-drive-peers-chat-failed", share=sid, error=str(e)[:200])


def _access_words(access):
    return "read only" if access == "read" else "read and write"


def _ask_admins(user, share):
    """A share waits for an admin: each admin (but the one who made it wait) gets a chat message asking to approve it,
    with its card - Approve and Deny there, and the two people's names leading to the drive."""
    try:
        admins = ADMINS() if ADMINS else []
    except Exception as e:  # noqa: BLE001 - the share waits on the Cloud Drive's Sharing and Accounts all the same
        LOG(event="cloud-drive-peers-admins-failed", share=share["id"], error=str(e)[:200])
        admins = []
    what = "Cloud Drive" if (share.get("kind") or "drive") == "drive" else "%s %s" % (share["kind"], share["path"])
    text = "Approve Cloud Drive share: %s's %s with %s (%s)." % (
        share["ownerName"], what, share["fromName"], _access_words(share["access"]))
    for a in admins:
        if a.get("id") and a["id"] != user["id"]:
            _post(user, a["id"], text, share["id"])


def request(user, body):
    owner_id = str(body.get("owner") or "")
    access = body.get("access") or "read"
    if not USER_ID_RE.match(owner_id):
        raise ValueError("owner: a user id.")
    if access not in ACCESS:
        raise ValueError("access: read or write.")
    if owner_id == user["id"]:
        raise ValueError("It is your own Cloud Drive.")
    owner = USER_BY_ID(owner_id) if USER_BY_ID else None
    if not owner:
        raise ValueError("There is no such user.")
    with _lock:
        data = _load()
        if not data["settings"]["enabled"]:
            raise PermissionError("Sharing Cloud Drives between users is off: an admin turns it on.")
        for s in data["shares"].values():
            if s["from"] == user["id"] and s["owner"] == owner_id and s.get("state") in OPEN and \
                    (s.get("kind") or "drive") == "drive":
                raise ValueError("You asked %s already: %s." % (owner["username"], {
                    "asked": "waiting for their answer", "approval": "waiting for an admin's approval",
                    "active": "their Cloud Drive is shared with you"}[s["state"]]))
        sid = uuid.uuid4().hex
        share = {"id": sid, "from": user["id"], "fromName": user["username"], "owner": owner_id,
                 "ownerName": owner["username"], "access": access, "asked": access, "state": "asked",
                 "askedAt": round(time.time(), 3), "path": "", "kind": "drive", "by": "request"}
        data["shares"][sid] = share
        _save(data)
    LOG(event="cloud-drive-peers-request", share=sid, by=user["username"], owner=owner["username"], access=access)
    _post(user, owner_id, "Asks to use your Cloud Drive (%s)." % _access_words(access), sid)
    return {**view(user), "share": _public(share)}


def _what(kind, path):
    return "Cloud Drive" if kind == "drive" else "%s %s of my Cloud Drive" % (kind, path)


def share(user, body):
    """The owner shares their entire drive (path ""), or a folder or file of it, with a user: active at once, or once
    an admin approves it."""
    to_id = str(body.get("to") or "")
    access = body.get("access") or "read"
    path = body.get("path") or ""
    if not isinstance(path, str):
        raise ValueError("path: a folder or file of your Cloud Drive, or \"\" for all of it.")
    path = path.strip("/")
    if not USER_ID_RE.match(to_id):
        raise ValueError("to: a user id.")
    if access not in ACCESS:
        raise ValueError("access: read or write.")
    if to_id == user["id"]:
        raise ValueError("It is your own Cloud Drive.")
    to = USER_BY_ID(to_id) if USER_BY_ID else None
    if not to:
        raise ValueError("There is no such user.")
    kind = "drive"
    if path:
        if any(part in ("", ".", "..") for part in path.split("/")):
            raise ValueError("That is not a path of your Cloud Drive.")
        kind = ITEM(user["id"], path) if ITEM else None
        if kind not in ("file", "folder"):
            raise ValueError("There is no %s in your Cloud Drive (any more)." % path)
    with _lock:
        data = _load()
        if not data["settings"]["enabled"]:
            raise PermissionError("Sharing Cloud Drives between users is off: an admin turns it on.")
        for s in data["shares"].values():
            if s["owner"] == user["id"] and s["from"] == to_id and s.get("state") in OPEN and \
                    (s.get("path") or "") == path:
                raise ValueError("It is shared with %s already (%s, %s): end that share to change it." % (
                    to["username"], _access_words(s["access"]), s["state"]))
        sid = uuid.uuid4().hex
        now = time.time()
        item = {"id": sid, "from": to_id, "fromName": to["username"], "owner": user["id"],
                "ownerName": user["username"], "access": access, "asked": access, "askedAt": round(now, 3),
                "answeredAt": int(now), "state": "approval" if data["settings"]["adminApproval"] else "active",
                "path": path, "kind": kind, "by": "owner"}
        data["shares"][sid] = item
        _save(data)
    LOG(event="cloud-drive-peers-share", share=sid, by=user["username"], to=to["username"], kind=kind, path=path,
        access=access, state=item["state"])
    _post(user, to_id, "Shared my %s with you (%s)%s." % (
        _what(kind, path), _access_words(access),
        ": an admin approves it first" if item["state"] == "approval" else ", from your workspaces' next start"), sid)
    if item["state"] == "active":
        _changed()
    else:
        _ask_admins(user, item)
    return {**view(user), "share": _public(item)}


def people(user):
    """Whom the user can share with: Coder's active users but themselves, by username."""
    out = [{k: p.get(k) or "" for k in ("id", "username", "name")} for p in (PEOPLE() if PEOPLE else [])
           if p.get("id") != user["id"]]
    return {"people": sorted(out, key=lambda p: p["username"].lower())}


def _get(data, sid):
    if not ID_RE.match(sid or ""):
        raise ValueError("Not a share id.")
    s = data["shares"].get(sid)
    if not s:
        raise ValueError("There is no such share (any more).")
    return s


def answer(user, sid, body):
    accept = body.get("accept")
    if not isinstance(accept, bool):
        raise ValueError("accept: true or false.")
    with _lock:
        data = _load()
        s = _get(data, sid)
        if s["owner"] != user["id"]:
            raise PermissionError("Only the Cloud Drive's owner answers.")
        if s["state"] != "asked":
            raise ValueError("It was answered already.")
        if accept:
            access = body.get("access") or s["access"]
            if access not in ACCESS or (access == "write" and s["asked"] == "read"):
                raise ValueError("access: read, or write when write was asked for.")
            if not data["settings"]["enabled"]:
                raise PermissionError("Sharing Cloud Drives between users is off: an admin turns it on.")
            s.update(access=access, answeredAt=int(time.time()),
                     state="approval" if data["settings"]["adminApproval"] else "active")
        else:
            s.update(state="declined", answeredAt=int(time.time()), closedBy=user["username"],
                     closedAt=int(time.time()))
        _save(data)
        share = dict(s)
    LOG(event="cloud-drive-peers-answer", share=sid, by=user["username"], state=share["state"],
        access=share["access"])
    if accept:
        _post(user, share["from"], "Shared my Cloud Drive with you (%s)%s." % (
            _access_words(share["access"]),
            ": an admin approves it first" if share["state"] == "approval" else
            ", from your workspaces' next start"), sid)
        if share["state"] == "approval":
            _ask_admins(user, share)
        _changed()
    else:
        _post(user, share["from"], "Declined to share my Cloud Drive.", sid)
    return {**view(user), "share": _public(share)}


def approve(user, sid, body):
    if not _admin(user):
        raise PermissionError("Only admins approve shares.")
    ok = body.get("approve")
    if not isinstance(ok, bool):
        raise ValueError("approve: true or false.")
    with _lock:
        data = _load()
        s = _get(data, sid)
        if s["state"] != "approval":
            raise ValueError("It is not waiting for an admin.")
        now = int(time.time())
        if ok:
            s.update(state="active", approvedBy=user["username"], approvedAt=now)
        else:
            s.update(state="denied", approvedBy=user["username"], approvedAt=now, closedBy=user["username"],
                     closedAt=now)
        _save(data)
        share = dict(s)
    LOG(event="cloud-drive-peers-approve", share=sid, by=user["username"], approved=ok)
    what = "%s's Cloud Drive" % share["ownerName"] if (share.get("kind") or "drive") == "drive" else \
        "%s's %s %s" % (share["ownerName"], share["kind"], share["path"])
    _post(user, share["from"], ("Approved: %s is shared with you (%s), from your workspaces' next start." % (
        what, _access_words(share["access"]))) if ok else "Not approved: %s is not shared with you." % what, sid)
    _changed()
    return {**view(user), "share": _public(share)}


def end(user, sid):
    with _lock:
        data = _load()
        s = _get(data, sid)
        if user["id"] not in (s["owner"], s["from"]) and not _admin(user):
            raise PermissionError("Only its owner, the user it is shared with, or an admin ends a share.")
        if s["state"] not in OPEN:
            raise ValueError("It has ended already.")
        s.update(state="ended", closedBy=user["username"], closedAt=int(time.time()))
        _save(data)
        share = dict(s)
    LOG(event="cloud-drive-peers-end", share=sid, by=user["username"])
    other = share["from"] if user["id"] == share["owner"] else share["owner"]
    if other != user["id"]:
        what = "%s's Cloud Drive" % share["ownerName"] if (share.get("kind") or "drive") == "drive" else \
            "%s's %s %s" % (share["ownerName"], share["kind"], share["path"])
        _post(user, other, "Ended the share of %s: it leaves the workspaces at their next restart." % what, sid)
    _changed()
    return {**view(user), "share": _public(share)}


def handle(h, method, path, user, read_json):
    """The /api/safe/peers routes (safe.handle checked the session and the cross-site protection)."""
    rest = path[len(BASE + "/api/safe/peers"):]
    if method == "GET" and rest == "":
        return h.send_json(200, view(user))
    if method == "POST" and rest == "/settings":
        return h.send_json(200, save_settings(user, read_json(h)))
    if method == "POST" and rest == "/request":
        return h.send_json(200, request(user, read_json(h)))
    if method == "POST" and rest == "/share":
        return h.send_json(200, share(user, read_json(h)))
    if method == "GET" and rest == "/people":
        return h.send_json(200, people(user))
    m = re.match(r"^/([0-9a-f]{32})/(answer|approve|end)$", rest)
    if method == "POST" and m:
        sid, what = m.groups()
        if what == "answer":
            return h.send_json(200, answer(user, sid, read_json(h)))
        if what == "approve":
            return h.send_json(200, approve(user, sid, read_json(h)))
        return h.send_json(200, end(user, sid))
    return h.send_json(404, {"error": "not found"})
