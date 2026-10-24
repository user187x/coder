"""Organization-scoped WireGuard policy and acknowledged workspace peer revocation.

Only workspace owners and deployment admins may connect endpoints they control.
Helpers authenticate with Coder agent tokens; private keys never leave a workspace.
"""
import base64
import contextlib
import fcntl
import ipaddress
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
import uuid

BASE = "/__coder-ui/api"
STATE_FILE = os.environ.get("WORKSPACE_TUNNELS_FILE", "/data/workspace-tunnels.json")
NETWORK = ipaddress.ip_network(os.environ.get("WORKSPACE_TUNNELS_CIDR", "10.253.0.0/16"))
LEASE_SECONDS = 15
NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
WORKSPACE_INFO = HTTP_JSON = KUBE = LIVE_WORKSPACES = None
CODER_URL = ""
ADMIN_ROLES = set()
_LOCK = threading.Lock()
ROUTE = re.compile(r"^" + BASE + r"/organizations/([0-9a-f-]{36})/workspace-tunnels(?:/([0-9a-f-]{36}))?$")


def setup(workspace_info, http_json, kube, coder_url, admin_roles, live_workspaces=None):
    global WORKSPACE_INFO, HTTP_JSON, KUBE, CODER_URL, ADMIN_ROLES, LIVE_WORKSPACES
    WORKSPACE_INFO, HTTP_JSON, KUBE = workspace_info, http_json, kube
    CODER_URL, ADMIN_ROLES = coder_url.rstrip("/"), set(admin_roles)
    LIVE_WORKSPACES = live_workspaces


@contextlib.contextmanager
def state(write=True):
    """Serialize atomic policy writes across service threads and processes."""
    os.makedirs(os.path.dirname(STATE_FILE) or ".", exist_ok=True)
    with _LOCK, open(STATE_FILE + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(STATE_FILE) as source:
                data = json.load(source)
        except FileNotFoundError:
            data = {"revision": 0, "workspaces": {}, "tunnels": {}}
        yield data
        if not write:
            return
        fd, temporary = tempfile.mkstemp(dir=os.path.dirname(STATE_FILE) or ".")
        try:
            with os.fdopen(fd, "w") as dest:
                json.dump(data, dest)
                dest.flush()
                os.fsync(dest.fileno())
            os.replace(temporary, STATE_FILE)
            directory = os.open(os.path.dirname(STATE_FILE) or ".", os.O_RDONLY | os.O_DIRECTORY)
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
        raise ValueError("Expected a workspace or organization UUID.") from None


def authorize(token, user, organization_id, workspace_id, update=True):
    ws = WORKSPACE_INFO(token, identifier(workspace_id))
    if not ws or ws.get("organization_id") != organization_id:
        raise LookupError("Workspace not found in this organization.")
    if ws.get("owner_id") != user["id"] and not (set(user.get("roles") or []) & ADMIN_ROLES):
        raise PermissionError("Only the workspace owner and admins can change its tunnels.")
    if update:
        status, permission = HTTP_JSON(CODER_URL + "/api/v2/authcheck", method="POST",
            body={"checks": {"update": {"action": "update", "object": {
                "resource_type": "workspace", "resource_id": workspace_id,
                "owner_id": ws["owner_id"], "organization_id": organization_id}}}},
            headers={"Coder-Session-Token": token}, timeout=5)
        if status != 200 or not isinstance(permission, dict) or permission.get("update") is not True:
            raise PermissionError("Your session cannot update this workspace.")
    return ws


def workspace(data, organization_id, workspace_id):
    current = data["workspaces"].get(workspace_id)
    if current:
        if current["organization_id"] != organization_id:
            raise ValueError("Workspace organization changed.")
        return current
    used = {w["address"] for w in data["workspaces"].values()}
    address = next((str(ip) for ip in NETWORK.hosts() if str(ip) not in used), None)
    if address is None:
        raise ValueError("Workspace tunnel address pool is exhausted.")
    current = {"organization_id": organization_id, "address": address, "ack": -1, "seen": 0}
    data["workspaces"][workspace_id] = current
    return current


def changed(data):
    data["revision"] += 1
    return data["revision"]


def public(data, tunnel):
    a, b = (data["workspaces"][tunnel[k]] for k in ("source_workspace_id", "target_workspace_id"))
    fresh = all(w.get("seen", 0) + LEASE_SECONDS >= time.time() for w in (a, b))
    acknowledged = all(w.get("ack") == data["revision"] for w in (a, b))
    established = (tunnel["target_workspace_id"] in a.get("established_peers", [])
                   and tunnel["source_workspace_id"] in b.get("established_peers", []))
    errors = [w["error"] for w in (a, b) if w.get("error")]
    status = "disconnecting" if tunnel.get("deleted") else "error" if errors else "ready" if fresh and acknowledged and established else "pending"
    result = {k: tunnel[k] for k in ("id", "organization_id", "source_workspace_id", "target_workspace_id")}
    result.update(source_workspace_name=a.get("name", tunnel["source_workspace_id"]),
                  target_workspace_name=b.get("name", tunnel["target_workspace_id"]),
                  source_stats=public_stats(a, tunnel["target_workspace_id"]),
                  target_stats=public_stats(b, tunnel["source_workspace_id"]))
    result.update(status=status, source_address=a["address"], target_address=b["address"],
                  source_side=tunnel.get("source_side", "right"), target_side=tunnel.get("target_side", "left"))
    if errors:
        result["error"] = "; ".join(errors)
    elif not fresh:
        result["error"] = "Waiting for workspace tunnel helpers."
    elif not established and not tunnel.get("deleted"):
        result["error"] = "Waiting for an encrypted peer handshake."
    return result


def public_stats(current, peer_id):
    record = current.get("stats", {}).get(peer_id)
    if record is None:
        return None
    return {"updated_at": record["updated_at"],
            "stale": record["updated_at"] + LEASE_SECONDS < time.time(),
            "series": record["series"], "ports": record["ports"],
            "ports_available": record.get("ports_available", False)}


def peer_stats(body):
    """Validate untrusted helper measurements before considering their scope."""
    stats = body.get("peer_stats", [])
    if stats is None:
        stats = []
    if not isinstance(stats, list) or len(stats) > 64:
        raise ValueError("Expected at most 64 workspace peer measurements.")
    result = {}
    for report in stats:
        if not isinstance(report, dict):
            raise ValueError("Expected a peer measurement object.")
        wid = identifier(report.get("workspace_id"))
        if wid in result:
            raise ValueError("Duplicate workspace peer measurement.")
        counters = {}
        for key in ("rx_bytes", "tx_bytes"):
            value = report.get(key)
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2**63 - 1:
                raise ValueError("Expected nonnegative int64 byte counters.")
            counters[key] = value
        available = report.get("ports_available", False)
        if not isinstance(available, bool):
            raise ValueError("Expected a port observation availability flag.")
        ports = report.get("ports", [])
        if ports is None:
            ports = []
        if not isinstance(ports, list) or len(ports) > 64:
            raise ValueError("Expected at most 64 observed ports per peer.")
        observed = set()
        for port in ports:
            if not isinstance(port, dict) or port.get("protocol") not in ("tcp", "udp"):
                raise ValueError("Expected TCP or UDP observed ports.")
            for key in ("local_port", "remote_port"):
                value = port.get(key)
                if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 65535:
                    raise ValueError("Observed ports must be integers from 1 through 65535.")
            observed.add((port["protocol"], port["local_port"], port["remote_port"]))
        result[wid] = dict(counters, ports_available=available, ports=[{"protocol": proto, "local_port": local, "remote_port": remote}
                                          for proto, local, remote in sorted(observed)])
    return result


def record_stats(current, reports, allowed):
    """Keep only this workspace's authorized peers and a bounded rate history."""
    records = current.setdefault("stats", {})
    for wid in list(records):
        if wid not in allowed:
            del records[wid]
    now = time.time()
    for wid, report in reports.items():
        if wid not in allowed:
            continue
        previous = records.get(wid)
        series = previous["series"] if previous else []
        if previous and now > previous["updated_at"]:
            elapsed = now - previous["updated_at"]
            reset = any(report[key] < previous[key] for key in ("rx_bytes", "tx_bytes"))
            series = [*series, {"timestamp": now,
                "rx_bytes_per_second": 0 if reset else (report["rx_bytes"] - previous["rx_bytes"]) / elapsed,
                "tx_bytes_per_second": 0 if reset else (report["tx_bytes"] - previous["tx_bytes"]) / elapsed}][-60:]
        records[wid] = dict(report, updated_at=now, series=series)


def prune(data):
    for key, tunnel in list(data["tunnels"].items()):
        if tunnel.get("deleted") and all(
            data["workspaces"][tunnel[side]].get("ack", -1) >= tunnel["revision"]
            for side in ("source_workspace_id", "target_workspace_id")
        ):
            del data["tunnels"][key]


def invalidate(data):
    """Revoke links when workspaces or their owners cease to be active."""
    if LIVE_WORKSPACES is None:
        return
    valid = set(LIVE_WORKSPACES())
    invalid = [t for t in data["tunnels"].values() if not t.get("deleted") and any(
        t[side] not in valid for side in ("source_workspace_id", "target_workspace_id")
    )]
    if invalid:
        revision = changed(data)
        for tunnel in invalid:
            tunnel.update(deleted=True, revision=revision)


def create(token, user, organization_id, body):
    source, target = (identifier(body.get(k)) for k in ("source_workspace_id", "target_workspace_id"))
    source_side, target_side = body.get("source_side", "right"), body.get("target_side", "left")
    if source_side not in ("left", "right") or target_side not in ("left", "right"):
        raise ValueError("Workspace ports must be left or right.")
    if source == target:
        raise ValueError("Choose two different workspaces.")
    known = {wid: authorize(token, user, organization_id, wid) for wid in (source, target)}
    with state() as data:
        for wid, ws in known.items():
            workspace(data, organization_id, wid)["name"] = ws.get("name", wid)
        for tunnel in data["tunnels"].values():
            if tunnel["organization_id"] == organization_id and {source, target} == {
                tunnel["source_workspace_id"], tunnel["target_workspace_id"]
            }:
                if tunnel.get("deleted"):
                    raise ValueError("Wait for this connection to finish disconnecting.")
                return public(data, tunnel)
        for wid in (source, target):
            workspace(data, organization_id, wid)
        tid = str(uuid.uuid4())
        tunnel = {"id": tid, "organization_id": organization_id,
                  "source_workspace_id": source, "target_workspace_id": target,
                  "revision": changed(data), "created_by": user["id"],
                  "source_side": source_side, "target_side": target_side}
        data["tunnels"][tid] = tunnel
        return public(data, tunnel)


def remove(token, user, organization_id, tunnel_id):
    with state(write=False) as data:
        snapshot = data["tunnels"].get(tunnel_id)
        if not snapshot or snapshot["organization_id"] != organization_id:
            raise LookupError("Workspace tunnel not found.")
    endpoints = (snapshot["source_workspace_id"], snapshot["target_workspace_id"])
    known = {wid: authorize(token, user, organization_id, wid) for wid in endpoints}
    with state() as data:
        tunnel = data["tunnels"].get(tunnel_id)
        if not tunnel or any(tunnel.get(key) != snapshot[key] for key in (
            "organization_id", "source_workspace_id", "target_workspace_id"
        )):
            raise LookupError("Workspace tunnel changed. Refresh and try again.")
        for wid, ws in known.items():
            data["workspaces"][wid]["name"] = ws.get("name", wid)
        if not tunnel.get("deleted"):
            tunnel.update(deleted=True, revision=changed(data))
        return public(data, tunnel)


def listing(token, user, organization_id):
    with state(write=False) as data:
        snapshots = {tid: tunnel for tid, tunnel in data["tunnels"].items()
                     if tunnel["organization_id"] == organization_id}
    known = {}
    for snapshot in snapshots.values():
        for side in ("source_workspace_id", "target_workspace_id"):
            wid = snapshot[side]
            if wid not in known:
                try:
                    known[wid] = authorize(token, user, organization_id, wid, update=False)
                except (LookupError, PermissionError):
                    known[wid] = None
    with state() as data:
        invalidate(data)
        prune(data)
        visible = []
        for tid, snapshot in snapshots.items():
            tunnel = data["tunnels"].get(tid)
            if not tunnel or any(tunnel.get(key) != snapshot[key] for key in (
                "organization_id", "source_workspace_id", "target_workspace_id"
            )):
                continue
            endpoints = (tunnel["source_workspace_id"], tunnel["target_workspace_id"])
            if any(known[wid] is None for wid in endpoints):
                continue
            for wid in endpoints:
                data["workspaces"][wid]["name"] = known[wid].get("name", wid)
            visible.append(public(data, tunnel))
        return visible


def agent_identity(token, endpoint):
    if not token:
        raise PermissionError("Agent authentication required.")
    status, identity = HTTP_JSON(CODER_URL + "/api/v2/workspaceagents/me/tunnel-identity",
                                 headers={"Coder-Session-Token": token}, timeout=5)
    if status != 200 or not isinstance(identity, dict):
        raise PermissionError("Current workspace agent authentication required.")
    wid, oid = identifier(identity.get("workspace_id")), identifier(identity.get("organization_id"))
    aid = identifier(identity.get("agent_id"))
    host, separator, port = endpoint.rpartition(":") if isinstance(endpoint, str) else ("", "", "")
    if not separator or port != "51871":
        raise ValueError("Expected the workspace pod IPv4 address and port 51871.")
    try:
        ip = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        raise ValueError("Expected a workspace pod IPv4 address.") from None
    if ip in NETWORK:
        raise ValueError("Tunnel address pool overlaps the workspace pod network.")
    selector = urllib.parse.quote("com.coder.workspace.id=" + wid)
    status, result = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (NAMESPACE, selector))
    if status != 200:
        raise RuntimeError("Could not verify the workspace pod identity.")
    pods = [p for p in result.get("items", []) if p.get("status", {}).get("podIP") == host
            and p.get("status", {}).get("phase") == "Running"
            and not p.get("metadata", {}).get("deletionTimestamp")]
    if not pods:
        raise PermissionError("Endpoint does not belong to this running workspace.")
    return wid, oid, aid


def sync(token, body):
    key = body.get("public_key")
    try:
        decoded = base64.b64decode(key, validate=True)
    except (ValueError, TypeError):
        raise ValueError("Expected a WireGuard public key.") from None
    if len(decoded) != 32 or not any(decoded):
        raise ValueError("Expected a WireGuard public key.")
    wid, oid, aid = agent_identity(token, body.get("endpoint"))
    ack = body.get("applied_revision", -1)
    if isinstance(ack, bool) or not isinstance(ack, int):
        raise ValueError("Expected an applied policy revision.")
    error = body.get("error")
    if error is not None and not isinstance(error, str):
        raise ValueError("Expected a helper error string.")
    measurements = peer_stats(body)
    established = body.get("established_peers", [])
    if not isinstance(established, list) or len(established) > 4096:
        raise ValueError("Expected established workspace peer IDs.")
    established = [identifier(peer) for peer in established]
    with state() as data:
        invalidate(data)
        current = workspace(data, oid, wid)
        if any(w.get("public_key") == key for other, w in data["workspaces"].items() if other != wid):
            raise ValueError("WireGuard public key already belongs to another workspace.")
        if any(current.get(k) != value for k, value in (
            ("public_key", key), ("endpoint", body["endpoint"]), ("agent_id", aid)
        )):
            current.update(public_key=key, endpoint=body["endpoint"], agent_id=aid, ack=-1, established_peers=[], stats={})
            for other in data["workspaces"].values():
                other.get("stats", {}).pop(wid, None)
            changed(data)
        elif ack == data["revision"]:
            current["ack"] = ack if not error else -1
        current.update(seen=time.time(), error=(error or "")[:500], established_peers=established)
        peers = []
        for tunnel in data["tunnels"].values():
            if tunnel["organization_id"] != oid or tunnel.get("deleted"):
                continue
            ends = (tunnel["source_workspace_id"], tunnel["target_workspace_id"])
            if wid not in ends:
                continue
            other = ends[1] if ends[0] == wid else ends[0]
            peer = data["workspaces"][other]
            if peer.get("public_key") and peer.get("endpoint"):
                peers.append({"workspace_id": other, "public_key": peer["public_key"],
                              "endpoint": peer["endpoint"], "allowed_ip": peer["address"] + "/32"})
        epoch = {"public_key": key, "peers": sorted(peers, key=lambda p: p["workspace_id"])}
        if current.get("stats_policy") != epoch:
            current.update(stats={}, stats_policy=epoch)
        # A request carries measurements from the policy installed before this response.
        observed = measurements if ack == data["revision"] and not error else {}
        record_stats(current, observed, {p["workspace_id"] for p in peers})
        prune(data)
        return {"revision": data["revision"], "address": current["address"] + "/32",
                "peers": sorted(peers, key=lambda p: p["workspace_id"]), "lease_seconds": LEASE_SECONDS}


def read_json(h, limit=16384):
    length = int(h.headers.get("Content-Length", "0"))
    if length < 0 or length > limit:
        raise ValueError("Request body is too large.")
    body = json.loads(h.rfile.read(length) or b"{}")
    if not isinstance(body, dict):
        raise ValueError("Expected a JSON object.")
    return body


def handle(h, method, path, query=""):
    agent = path == BASE + "/workspace-tunnels/agent/sync"
    match = ROUTE.fullmatch(path)
    if not (agent or match):
        return False
    try:
        if agent:
            if method != "POST":
                h.send_json(405, {"error": "Method not allowed."})
            else:
                h.send_json(200, sync(h.headers.get("Coder-Session-Token"), read_json(h, 512 * 1024)))
            return True
        if method != "GET" and not h.csrf_ok():
            raise PermissionError("Request rejected (cross-site protection).")
        user, err = h.user()
        if err:
            return True
        oid = identifier(match.group(1))
        tid = match.group(2)
        if method == "GET" and not tid:
            h.send_json(200, {"tunnels": listing(h.token(), user, oid)})
        elif method == "POST" and not tid:
            h.send_json(200, {"tunnel": create(h.token(), user, oid, read_json(h))})
        elif method == "DELETE" and tid:
            h.send_json(200, {"tunnel": remove(h.token(), user, oid, identifier(tid))})
        else:
            h.send_json(405, {"error": "Method not allowed."})
    except PermissionError as error:
        h.send_json(403, {"error": str(error)})
    except LookupError as error:
        h.send_json(404, {"error": str(error)})
    except (ValueError, TypeError) as error:
        h.send_json(400, {"error": str(error)})
    except Exception:
        h.send_json(503, {"error": "Workspace tunnel policy could not be verified or persisted."})
    return True
