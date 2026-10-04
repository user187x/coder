#!/usr/bin/env python3
"""A stand-in for the platform services that run next to Coder in a deployment,
for previewing the dashboard locally (scripts/platform-preview.sh):

  /__coder-ui/   the dashboard add-ons service (classification, logo, avatars,
                 announcement receipts, chat, cluster map, monitoring, Keycloak)
  /__banner/     the coder-banner service (the announcement)

Everything is kept in memory and filled with sample data; nothing is checked:
every request is treated as coming from the signed-in admin. The cluster, log
and Keycloak data are made up. Standard library only.

  python3 scripts/platform-mock.py [port]     (default 3099)
"""
import base64
import hashlib
import json
import re
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3099
ME = {"id": "00000000-0000-4000-8000-000000000001", "username": "admin", "name": "Admin", "email": "admin@coder.com"}
PEER = {"id": "00000000-0000-4000-8000-000000000002", "username": "member", "name": "Member", "email": "member@coder.com"}
GiB = 1024 ** 3


def now(offset_seconds=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


lock = threading.Condition()
state = {
    "classification": {"enabled": True, "text": "UNCLASSIFIED", "height": 24, "background": "#007a33",
                       "color": "#ffffff", "updatedBy": "admin", "updatedAt": now(-3600)},
    "logo": None,          # {"type", "data", "sha", "by", "at"}
    "avatars": {},         # username -> {"type", "data", "sha"}
    "receipts": {},        # announcement id -> {username: {"viewedAt", "ackedAt"}}
    "events": {},          # announcement id -> event info (first seen)
    "messages": [],
    "read": {},            # peer id -> last read message id
    "chat_on": True,
    "avail_version": 1,
    "clear_version": 1,
    "cleared": [],         # (version, peer id)
}

BANNER_DEFAULTS = {
    "enabled": True, "level": "warning", "title": "",
    "message": "**Scheduled maintenance:** Coder restarts in "
               '{{countdown to=%s format=dhms done="now"}}. Save your work.' % now(26 * 3600),
    "linkText": "", "linkUrl": "", "dismissible": True, "showOnLoginPage": True,
    "refreshSeconds": 60, "effect": "none", "repeat": False,
}
banner = {"fields": dict(BANNER_DEFAULTS), "revision": 0, "override": False, "by": None, "at": None}


def banner_public():
    f = banner["fields"]
    digest = hashlib.sha256(json.dumps([f, banner["revision"]], sort_keys=True).encode()).hexdigest()[:16]
    return {**f, "id": digest}


def banner_state():
    return {"user": {"username": ME["username"]}, "banner": banner_public(), "overrideActive": banner["override"],
            "revision": banner["revision"], "updatedBy": banner["by"], "updatedAt": banner["at"], "subscribers": 1}


def message(mid, sender, recipient, text, at, image=None):
    return {"id": mid, "from": sender["id"], "fromName": sender["username"], "fromDisplay": sender["name"],
            "to": recipient["id"], "toName": recipient["username"], "toDisplay": recipient["name"], "text": text,
            "at": at, "fromAdmin": sender is ME, "toAdmin": recipient is ME, "image": image, "page": None}


state["messages"].append(message(1, PEER, ME, "Hi, my workspace build keeps failing. Could you take a look?", now(-600)))


def conversations():
    peers = {}
    for m in state["messages"]:
        peer = PEER if ME["id"] in (m["from"], m["to"]) else None
        if peer:
            peers[peer["id"]] = m
    out = []
    for pid, last in peers.items():
        unread = sum(1 for m in state["messages"] if m["from"] == pid and m["id"] > state["read"].get(pid, 0))
        out.append({"peer": {k: PEER[k] for k in ("id", "username", "name")}, "last": last, "unread": unread})
    return out


def availability():
    return {"available": [ME["id"]] if state["chat_on"] else [], "off": [] if state["chat_on"] else [ME["id"]],
            "availVersion": state["avail_version"]}


def boot_js():
    logo = state["logo"]
    avatars = {u: "/__coder-ui/avatar/%s?v=%s" % (u, a["sha"]) for u, a in state["avatars"].items()}
    return "window.__cuiLogo=%s;window.__cuiClassification=%s;window.__cuiAvatars=%s;window.__cuiAvatarDefault=\"\";\n" % (
        json.dumps("/__coder-ui/logo?v=" + logo["sha"] if logo else ""), json.dumps(state["classification"]),
        json.dumps(avatars))


def data_url(value):
    m = re.match(r"^data:(image/[a-z+.-]+);base64,(.+)$", str(value or ""), re.S)
    if not m:
        raise ValueError("Expected an image as a data URL.")
    data = base64.b64decode(m.group(2))
    return m.group(1), data, hashlib.sha256(data).hexdigest()[:12]


def node(name, ip, cpu_used, mem_used):
    return {
        "name": name, "created": now(-40 * 86400), "roles": ["worker"], "zone": "zone-a", "region": "local",
        "instanceType": "dev", "ready": True, "readySince": now(-40 * 86400), "unschedulable": False, "pressure": [],
        "taints": [], "addresses": {"InternalIP": [ip]}, "podCIDRs": ["10.42.%s.0/24" % ip.split(".")[-1]],
        "kubelet": "v1.31.2", "os": "Ubuntu 24.04 LTS", "kernel": "6.8.0", "runtime": "containerd://1.7.22",
        "arch": "amd64", "capacity": {"cpu": 8, "memory": 32 * GiB, "pods": 110, "storage": None},
        "allocatable": {"cpu": 8, "memory": 31 * GiB, "pods": 110, "storage": None},
        "usage": {"cpu": cpu_used, "memory": mem_used}, "requests": {"cpu": 4.5, "memory": 20 * GiB},
        "podCount": 24, "namespaces": {"coder": 6, "kube-system": 12},
    }


def pod(name, node_name, ip):
    return {"name": name, "namespace": "coder", "node": node_name, "podIP": ip, "hostIP": None, "phase": "Running",
            "ready": True, "restarts": 0, "started": now(-86400)}


def network():
    wobble = (time.time() % 30) / 30
    return {
        "generatedAt": now(), "kubernetesVersion": "v1.31.2", "accessUrl": "http://127.0.0.1:3000", "metrics": True,
        "coderNamespace": "coder",
        "nodes": [node("node-a", "10.0.0.11", 2.5 + wobble, 18 * GiB), node("node-b", "10.0.0.12", 5.1, 26 * GiB)],
        "coder": [{**pod("coder-5d9f7c", "node-a", "10.42.11.10"), "role": "coder"},
                  {**pod("coder-db-1", "node-b", "10.42.12.20"), "role": "database"},
                  {**pod("coder-ui-updates-6f8d", "node-a", "10.42.11.30"), "role": "add-on"}],
        "workspaces": [{
            "id": "ws-1", "name": "dev", "owner": PEER["username"], "template": "ubuntu-vnc-desktop", "healthy": True,
            "agents": [{"name": "main", "status": "connected", "lifecycle": "ready", "version": "v2.37.3",
                        "os": "linux", "arch": "amd64", "latencyMs": 12}],
            "pod": pod("coder-member-dev", "node-b", "10.42.12.33")}],
        "unplaced": [], "workspacesApi": True,
    }


def cluster_usage():
    return {"cpu": {"total": 16, "used": 6.4 + (time.time() % 10) / 10, "requested": 9, "free": 7},
            "memory": {"total": 62 * GiB, "used": 44 * GiB, "requested": 40 * GiB, "free": 22 * GiB},
            "nodes": 2, "live": True, "generatedAt": now()}


def monitoring():
    return {"namespace": "coder", "capBytes": 5 * 1024 * 1024, "users": [
        {"user": {k: PEER[k] for k in ("id", "username", "name", "email")}, "instances": [{
            "workspaceId": "00000000-0000-4000-8000-0000000000aa", "name": "dev", "owner": PEER["username"],
            "template": "ubuntu-vnc-desktop", "startedAt": now(-7200),
            "agents": [{"name": "main", "status": "connected", "lifecycle": "ready", "health": True}],
            "healthy": True, "pod": "coder-member-dev", "watching": False}]},
        {"user": {k: ME[k] for k in ("id", "username", "name", "email")}, "instances": []},
    ]}


LOG_START = time.time()


def logs(after):
    newest = int((time.time() - LOG_START) / 2) + 20   # a new line every two seconds
    first = max(after + 1, 1)
    kinds = ["agent: startup script finished", "code-server: GET /healthz 200", "warning: disk usage at 81%",
             "vnc: client connected", "error: git fetch failed (retrying)"]
    lines = [[seq, now(), "%s (line %d)" % (kinds[seq % len(kinds)], seq)] for seq in range(first, newest + 1)]
    return {"pod": "coder-member-dev", "container": "dev", "state": "streaming", "error": None, "lines": lines,
            "stored": {"lines": newest, "bytes": newest * 64, "capBytes": 5 * 1024 * 1024}}


KEYCLOAK = {
    "checks": [
        {"id": "kc.reachable", "group": "Connection", "title": "Keycloak answers", "status": "ok",
         "current": "https://keycloak.local", "expected": None, "detail": "", "fix": None},
        {"id": "kc.scopes", "group": "Keycloak", "title": "Client scopes", "status": "warn", "current": "openid",
         "expected": "openid, profile, email", "detail": "Coder needs the profile and email scopes.", "fix": "kc.scopes"},
        {"id": "coder.env", "group": "Coder", "title": "Coder's OIDC settings", "status": "warn", "current": None,
         "expected": None, "detail": "", "fix": "coder.values"},
    ],
    "facts": {"coderUrl": "http://127.0.0.1:3000", "argoApp": None, "canEditCoder": True, "keycloakConnected": True,
              "discoveredKeycloakUrl": "https://keycloak.local",
              "settings": {"keycloakUrl": "https://keycloak.local", "realm": "master", "clientId": "coder", "scopes": "openid"},
              "envDiffs": [{"name": "CODER_OIDC_SCOPES", "current": "openid", "expected": "openid,profile,email"}],
              "undo": None},
}


def acks_report():
    current = banner_public()
    if banner["fields"]["enabled"] and banner["fields"]["message"]:
        state["events"].setdefault(current["id"], {"level": current["level"], "title": current["title"],
                                                   "message": current["message"], "firstSeen": now()})
    events = []
    for eid, info in sorted(state["events"].items(), key=lambda kv: kv[1]["firstSeen"], reverse=True):
        receipts = state["receipts"].get(eid, {})
        events.append({
            "id": eid, **info, "current": eid == current["id"], "viewed": len(receipts),
            "acked": sum(1 for r in receipts.values() if r["ackedAt"]),
            "receipts": [{"username": u, "name": ME["name"] if u == ME["username"] else u, "email": "%s@coder.com" % u, **r}
                         for u, r in receipts.items()],
            "pending": [] if PEER["username"] in receipts else [{k: PEER[k] for k in ("id", "username", "name", "email")}],
        })
    return {"current": current["id"], "totalUsers": 2, "events": events, "generatedAt": now()}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("platform-mock: %s\n" % (fmt % args))

    def send(self, status, body=b"", content_type="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}") if length else {}

    def do_GET(self):
        url = urlsplit(self.path)
        path, q = url.path, parse_qs(url.query)
        arg = lambda name, default="": (q.get(name) or [default])[0]  # noqa: E731
        ui = "/__coder-ui"
        if path == ui + "/boot.js":
            return self.send(200, boot_js(), "text/javascript")
        if path == ui + "/api/classification":
            return self.send(200, state["classification"])
        if path == ui + "/api/logo":
            logo = state["logo"]
            return self.send(200, {"available": True, "set": bool(logo), "url": ui + "/logo?v=" + logo["sha"] if logo else None,
                                   "type": logo and logo["type"], "bytes": logo and len(logo["data"]),
                                   "updatedBy": logo and logo["by"], "updatedAt": logo and logo["at"]})
        if path == ui + "/logo" and state["logo"]:
            return self.send(200, state["logo"]["data"], state["logo"]["type"])
        if path == ui + "/api/avatar":
            mine = state["avatars"].get(ME["username"])
            url_ = "%s/avatar/%s?v=%s" % (ui, ME["username"], mine["sha"]) if mine else None
            return self.send(200, {"available": True, "set": bool(mine), "url": url_, "defaultUrl": None,
                                   "username": ME["username"]})
        if path == ui + "/api/avatar/defaults":
            return self.send(200, {"url": None, "users": []})
        if path.startswith(ui + "/avatar/"):
            hit = state["avatars"].get(path.rsplit("/", 1)[1])
            return self.send(200, hit["data"], hit["type"]) if hit else self.send(404, {"error": "no avatar"})
        if path == ui + "/api/me":
            eid = arg("id")
            receipt = state["receipts"].get(eid, {}).get(ME["username"])
            return self.send(200, {"signedIn": True, "username": ME["username"], "acked": bool(receipt and receipt["ackedAt"])})
        if path == ui + "/api/acks":
            return self.send(200, acks_report())
        if path == ui + "/api/cluster/usage":
            return self.send(200, cluster_usage())
        if path == ui + "/api/network":
            return self.send(200, network())
        if path == ui + "/api/monitoring":
            return self.send(200, monitoring())
        if path == ui + "/api/monitoring/logs":
            return self.send(200, logs(int(arg("after", "0") or 0)))
        if path == ui + "/api/keycloak":
            return self.send(200, KEYCLOAK)
        if path == ui + "/api/chat/state":
            return self.send(200, {"me": {**{k: ME[k] for k in ("id", "username", "name")}, "admin": True,
                                          "chatOn": state["chat_on"]},
                                   "conversations": conversations(), "cursor": max([m["id"] for m in state["messages"]] or [0]),
                                   "typing": [], "clearVersion": state["clear_version"], **availability()})
        if path == ui + "/api/chat/admins":
            return self.send(200, {"admins": []})
        if path == ui + "/api/chat/messages":
            peer = arg("peer")
            msgs = [m for m in state["messages"] if peer in (m["from"], m["to"])]
            return self.send(200, {"messages": msgs, "readUpTo": state["read"].get(peer, 0)})
        if path == ui + "/api/chat/poll":
            after, cleared = int(arg("after", "0") or 0), int(arg("cleared", "0") or 0)
            with lock:
                lock.wait_for(lambda: any(m["id"] > after for m in state["messages"])
                              or state["clear_version"] > cleared, timeout=20)
                return self.send(200, {"messages": [m for m in state["messages"] if m["id"] > after], "typing": [],
                                       "cleared": [p for v, p in state["cleared"] if v > cleared],
                                       "clearVersion": state["clear_version"], **availability()})
        if path == "/__banner/banner.json":
            return self.send(200, banner_public())
        if path == "/__banner/api/state":
            return self.send(200, banner_state())
        self.send(404, {"error": "not found in the platform mock"})

    def do_POST(self):
        path = urlsplit(self.path).path
        payload = self.body()
        ui = "/__coder-ui"
        if path == ui + "/api/classification":
            state["classification"] = {**payload, "updatedBy": ME["username"], "updatedAt": now()}
            return self.send(200, state["classification"])
        if path == ui + "/api/logo":
            try:
                ctype, data, sha = data_url(payload.get("dataUrl"))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            state["logo"] = {"type": ctype, "data": data, "sha": sha, "by": ME["username"], "at": now()}
            return self.send(200, {"ok": True, "set": True, "url": ui + "/logo?v=" + sha})
        if path == ui + "/api/logo/reset":
            state["logo"] = None
            return self.send(200, {"ok": True, "set": False})
        if path == ui + "/api/avatar":
            try:
                ctype, data, sha = data_url(payload.get("dataUrl"))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            state["avatars"][ME["username"]] = {"type": ctype, "data": data, "sha": sha}
            return self.send(200, {"ok": True, "set": True, "url": "%s/avatar/%s?v=%s" % (ui, ME["username"], sha)})
        if path == ui + "/api/avatar/reset":
            state["avatars"].pop(ME["username"], None)
            return self.send(200, {"ok": True, "set": False})
        if path in (ui + "/api/view", ui + "/api/ack"):
            receipt = state["receipts"].setdefault(payload.get("id", ""), {}).setdefault(
                ME["username"], {"viewedAt": now(), "ackedAt": None})
            if path.endswith("/ack"):
                receipt["ackedAt"] = now()
            return self.send(200, {"ok": True})
        if path == ui + "/api/events/delete":
            state["events"].pop(payload.get("id"), None)
            state["receipts"].pop(payload.get("id"), None)
            return self.send(200, {"ok": True, "removed": 1})
        if path.startswith(ui + "/api/keycloak/"):
            return self.send(200, {"ok": True, "done": ["The mock applied nothing"]})
        if path == ui + "/api/chat/send":
            with lock:
                text = str(payload.get("text") or "")
                image = payload.get("image")
                mid = max([m["id"] for m in state["messages"]] or [0]) + 1
                sent = message(mid, ME, PEER, text, now(), image if image else None)
                state["messages"].append(sent)
                lock.notify_all()
            threading.Timer(2.0, auto_reply, args=(text,)).start()
            return self.send(200, {"message": sent})
        if path == ui + "/api/chat/read":
            state["read"][payload.get("to")] = max(state["read"].get(payload.get("to"), 0), int(payload.get("last") or 0))
            return self.send(200, {"ok": True})
        if path == ui + "/api/chat/typing":
            return self.send(200, {"ok": True})
        if path == ui + "/api/chat/delete":
            with lock:
                peer = payload.get("to")
                state["messages"] = [m for m in state["messages"] if peer not in (m["from"], m["to"])]
                state["clear_version"] += 1
                lock.notify_all()
            return self.send(200, {"ok": True, "deleted": 1})
        if path == ui + "/api/chat/availability":
            with lock:
                state["chat_on"] = bool(payload.get("enabled"))
                state["avail_version"] += 1
                lock.notify_all()
            return self.send(200, {"enabled": state["chat_on"], **availability()})
        if path == "/__banner/api/banner":
            banner["fields"] = {**BANNER_DEFAULTS, **{k: v for k, v in payload.items() if k in BANNER_DEFAULTS}}
            banner.update(override=True, by=ME["username"], at=now())
            return self.send(200, {**banner_state(), "delivered": 1})
        if path == "/__banner/api/reappear":
            banner["revision"] += 1
            banner["fields"]["enabled"] = True
            return self.send(200, {**banner_state(), "delivered": 1})
        if path == "/__banner/api/reset":
            banner.update(fields=dict(BANNER_DEFAULTS), override=False, by=None, at=None)
            return self.send(200, {**banner_state(), "delivered": 1})
        self.send(404, {"error": "not found in the platform mock"})


def auto_reply(text):
    """The sample member answers a couple of seconds after each message, so the chat can be tried alone."""
    with lock:
        mid = max([m["id"] for m in state["messages"]] or [0]) + 1
        reply = "Got it, thanks!" if text else "Thanks for the screenshot."
        state["messages"].append(message(mid, PEER, ME, reply, now()))
        lock.notify_all()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    sys.stderr.write("platform-mock: serving /__coder-ui/ and /__banner/ on http://127.0.0.1:%d\n" % PORT)
    server.serve_forever()
