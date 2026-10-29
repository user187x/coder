"""Organization-routed requests for global personal quota additions.

Only deployment owners approve or revoke additions. Approved amounts are added
by user UUID to the existing default/override baseline until explicitly revoked.
"""
import contextlib
import fcntl
import json
import math
import os
import re
import tempfile
import threading
import time
import uuid

BASE = "/__coder-ui/api"
FILE = os.environ.get("QUOTA_REQUESTS_FILE", "/data/quota-requests.json")
KEYS = ("workspaces", "cpu", "memory", "disk")
ROUTE = re.compile(r"^" + BASE + r"/organizations/([0-9a-f-]{36})/quota-requests(?:/([0-9a-f-]{36})/(approve|deny|revoke))?$")
SEND = LOG = NOTIFY = None
_LOCK = threading.Lock()
PERSISTENCE = None


class Conflict(RuntimeError):
    pass


def setup(send, log, notify=None):
    global SEND, LOG, NOTIFY
    SEND, LOG, NOTIFY = send, log, notify


@contextlib.contextmanager
def state(write=False):
    if PERSISTENCE is not None:
        with PERSISTENCE.file_state(FILE, {}, write=write) as data:
            yield data
        return
    os.makedirs(os.path.dirname(FILE) or ".", exist_ok=True)
    with _LOCK, open(FILE + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(FILE) as source:
                records = json.load(source)
        except FileNotFoundError:
            records = {}
        yield records
        if not write:
            return
        fd, temporary = tempfile.mkstemp(dir=os.path.dirname(FILE) or ".")
        try:
            with os.fdopen(fd, "w") as destination:
                json.dump(records, destination, allow_nan=False)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary, FILE)
            directory = os.open(os.path.dirname(FILE) or ".", os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def identifier(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Expected an organization, user, or request UUID.") from None


def resources(raw):
    if not isinstance(raw, dict) or any(k not in KEYS for k in raw):
        raise ValueError("Choose extra workspaces, CPU cores, memory GiB, or disk GB.")
    result = {}
    for key in KEYS:
        value = raw.get(key, 0)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1000000:
            raise ValueError("Extra resources must be finite numbers from zero through 1,000,000.")
        if key == "workspaces" and value != int(value):
            raise ValueError("Extra workspace count must be a whole number.")
        result[key] = int(value) if key == "workspaces" else round(value, 3)
    if not any(result.values()):
        raise ValueError("Request at least one positive resource addition.")
    return result


def reason(value, required=False):
    if not isinstance(value, str) or len(value) > 2000 or (required and not value.strip()):
        raise ValueError("Explain the request using at most 2,000 characters.")
    return value.strip()


def call(token, method, path, body=None):
    status, data = SEND(token, method, "/api/v2" + path, body)
    if status in (401, 403, 404):
        raise PermissionError("This session cannot access the requested organization or account.")
    if not 200 <= status < 300:
        raise RuntimeError("Coder could not verify quota request permissions.")
    return data


def check(token, checks):
    data = call(token, "POST", "/authcheck", {"checks": checks})
    if not isinstance(data, dict) or any(data.get(key) is not True for key in checks):
        raise PermissionError("Your session does not permit this quota request action.")


def org_object(oid):
    # Organization resource IDs are not supported by Coder authcheck; the exact
    # organization is checked through its API and constrained by organization_id.
    return {"resource_type": "organization", "organization_id": oid}


def deployment_owner(user):
    return "owner" in (user.get("roles") or [])


def notify(record):
    if NOTIFY:
        try:
            NOTIFY(record)
        except Exception as error:
            LOG(event="quota-notification-failed", request=record["id"], error=str(error)[:200])


def create(token, user, oid, body):
    rid = identifier(body.get("request_id"))
    uid = identifier(user["id"])
    amount = resources(body.get("resources"))
    explanation = reason(body.get("reason"), required=True)
    call(token, "GET", "/organizations/" + oid + "/members/" + uid)
    check(token, {"create": {"action": "create", "object": {
        "resource_type": "workspace", "organization_id": oid, "owner_id": uid}}})
    with state(write=True) as records:
        existing = records.get(rid)
        if existing:
            if existing["user_id"] != uid or existing["organization_id"] != oid:
                raise Conflict("This request identifier is already in use.")
            if existing["resources"] != amount or existing["reason"] != explanation:
                raise Conflict("This request identifier already refers to different additions.")
            return existing
        if len(records) >= 10000:
            raise Conflict("The quota request history is full. Contact a deployment owner.")
        if sum(r["user_id"] == uid and r["status"] == "pending" for r in records.values()) >= 20:
            raise Conflict("You already have twenty pending quota requests.")
        record = {"id": rid, "organization_id": oid, "user_id": uid, "username": user["username"],
                  "resources": amount, "reason": explanation, "status": "pending", "created_at": time.time()}
        records[rid] = record
    notify(record)
    LOG(event="quota-addition-requested", request=rid, organization=oid, user=uid, resources=amount)
    return record


def review(token, user, oid, rid, action, body):
    if not deployment_owner(user):
        raise PermissionError("Only deployment owners can approve, deny, or revoke global quota additions.")
    explanation = reason(body.get("reason", ""))
    with state() as records:
        snapshot = records.get(rid)
        if not snapshot or snapshot["organization_id"] != oid:
            raise LookupError("Quota request not found in this organization.")
    account = call(token, "GET", "/users/" + snapshot["user_id"])
    if action == "approve" and account.get("status") != "active":
        raise ValueError("Only active accounts can receive a quota addition.")
    call(token, "GET", "/organizations/" + oid)
    check(token, {"organization": {"action": "update", "object": org_object(oid)},
                  "user": {"action": "update", "object": {
                      "resource_type": "user", "resource_id": snapshot["user_id"]}}})
    wanted = {"approve": "approved", "deny": "denied", "revoke": "revoked"}[action]
    expected = "approved" if action == "revoke" else "pending"
    with state(write=True) as records:
        record = records.get(rid)
        if not record or any(record[k] != snapshot[k] for k in ("organization_id", "user_id", "resources")):
            raise Conflict("Quota request changed. Refresh and try again.")
        if record["status"] == wanted:
            return record
        if record["status"] != expected:
            raise Conflict("This quota request can no longer be %s." % action)
        record.update(status=wanted, reviewed_at=time.time(), reviewed_by=user["id"], review_reason=explanation)
    notify(record)
    LOG(event="quota-addition-reviewed", request=rid, organization=oid, by=user["id"], action=action)
    return record


def listing(token, user, oid=None, mine=False):
    admin = deployment_owner(user)
    if not mine and oid is None and not admin:
        raise PermissionError("Only deployment owners can list every account's quota requests.")
    with state() as records:
        candidates = [r for r in records.values() if (oid is None or r["organization_id"] == oid)
                      and ((not mine and admin) or r["user_id"] == user["id"])]
    allowed_orgs, allowed_users = {}, {}
    visible = []
    for record in candidates:
        roid, uid = record["organization_id"], record["user_id"]
        if roid not in allowed_orgs:
            try:
                call(token, "GET", "/organizations/" + roid)
                check(token, {"read": {"action": "read", "object": org_object(roid)}})
                allowed_orgs[roid] = True
            except PermissionError:
                allowed_orgs[roid] = False
        if uid not in allowed_users:
            try:
                call(token, "GET", "/users/" + uid)
                allowed_users[uid] = True
            except PermissionError:
                allowed_users[uid] = False
        if allowed_orgs[roid] and allowed_users[uid]:
            visible.append(record)
    return sorted(visible, key=lambda r: r["created_at"], reverse=True)


def totals():
    """Approved global additions keyed by immutable user UUID, never username."""
    result = {}
    if not os.path.isfile(FILE):
        return result
    with state() as records:
        for record in records.values():
            if record["status"] != "approved":
                continue
            total = result.setdefault(record["user_id"], {"bonus": dict.fromkeys(KEYS, 0), "activeGrantCount": 0})
            for key in KEYS:
                total["bonus"][key] += record["resources"].get(key, 0)
            total["activeGrantCount"] += 1
    return result


def limits(base, user_id, additions=None):
    addition = (totals() if additions is None else additions).get(user_id, {})
    bonus = addition.get("bonus", dict.fromkeys(KEYS, 0))
    effective = {key: None if base.get(key) is None else base[key] + bonus.get(key, 0) for key in KEYS}
    return {"baseLimits": base, "bonus": bonus, "effectiveLimits": effective, "limits": effective,
            "bonusScope": "global", "activeGrantCount": addition.get("activeGrantCount", 0)}


def handle(h, method, path, query=""):
    match = ROUTE.fullmatch(path)
    index = path in (BASE + "/quota/requests", BASE + "/quota/requests/me")
    if not match and not index:
        return False
    try:
        if method == "POST" and not h.csrf_ok():
            raise PermissionError("Request rejected (cross-site protection).")
        user, err = h.user()
        if err:
            return True
        if method == "GET":
            h.send_json(200, {"requests": listing(h.token(), user,
                oid=identifier(match.group(1)) if match else None, mine=path.endswith("/me"))})
        elif method == "POST" and match:
            length = int(h.headers.get("Content-Length", "0"))
            if not 0 <= length <= 16384:
                raise ValueError("Request body is too large.")
            body = json.loads(h.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object.")
            oid, rid, action = match.groups()
            record = review(h.token(), user, identifier(oid), identifier(rid), action, body) if action else create(
                h.token(), user, identifier(oid), body)
            h.send_json(200, {"request": record})
        else:
            h.send_json(405, {"error": "Method not allowed."})
    except PermissionError as error:
        h.send_json(403, {"error": str(error)})
    except LookupError as error:
        h.send_json(404, {"error": str(error)})
    except Conflict as error:
        h.send_json(409, {"error": str(error)})
    except (ValueError, TypeError) as error:
        h.send_json(400, {"error": str(error)})
    except Exception:
        h.send_json(503, {"error": "Quota additions could not be verified or persisted."})
    return True
