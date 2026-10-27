"""Assigned workspace limits for readers; physical infrastructure metrics for owners.

Placement is derived from current workspace-labeled pods, never a caller-supplied
node name. Kubelet filesystem summaries use the existing nodes/stats permission.
"""
import concurrent.futures
from datetime import datetime, timezone
import ipaddress
import json
import math
import os
import re
import ssl
import threading
import time
import urllib.request
import urllib.parse
import uuid

import vmprofile

ROUTE = re.compile(r"^/__coder-ui/api/organizations/([0-9a-f-]{36})/workspaces/([0-9a-f-]{36})/node-metrics$")
WORKSPACE_INFO = SNAPSHOT = QUANTITY = KUBE = INFRASTRUCTURE_ACCESS = None
INSECURE_TLS = False
_CACHE = {}
_LOCK = threading.Lock()
MAX_AGE = 90


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep service-account credentials on the verified kubelet endpoint."""

    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def setup(workspace_info, snapshot, quantity, kube, insecure_tls=False, infrastructure_access=None):
    global WORKSPACE_INFO, SNAPSHOT, QUANTITY, KUBE, INSECURE_TLS, INFRASTRUCTURE_ACCESS
    WORKSPACE_INFO, SNAPSHOT, QUANTITY, KUBE = workspace_info, snapshot, quantity, kube
    INSECURE_TLS = insecure_tls
    INFRASTRUCTURE_ACCESS = infrastructure_access


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return value


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or not -5 <= time.time() - parsed.timestamp() <= MAX_AGE:
            return None
        return value
    except (AttributeError, TypeError, ValueError):
        return None


def metric(unit, used=None, total=None, collected=None, error=None):
    return {"used": number(used), "total": number(total), "unit": unit,
            "collectedAt": collected, "error": error}


def unavailable(message):
    return {key: metric(unit, error=message) for key, unit in (
        ("cpu", "cores"), ("memory", "bytes"), ("disk", "bytes"), ("load", "load"))}


def summary(node):
    """Read a bounded, authenticated kubelet summary without exposing its contents."""
    metadata = node.get("metadata") or {}
    key = (metadata.get("name"), metadata.get("uid"))
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < 5:
            return cached[1]
    result = None
    try:
        if not KUBE.ok:
            raise RuntimeError("Kubernetes service account unavailable")
        status = node.get("status") or {}
        address = next(a["address"] for a in status.get("addresses", []) if a.get("type") == "InternalIP")
        address = ipaddress.ip_address(address)
        port = ((status.get("daemonEndpoints") or {}).get("kubeletEndpoint") or {}).get("Port", 10250)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("Invalid kubelet port")
        with open(KUBE.SA + "/token") as source:
            bearer = source.read().strip()
        context = KUBE.ctx
        if INSECURE_TLS:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        host = "[%s]" % address if address.version == 6 else str(address)
        request = urllib.request.Request("https://%s:%s/stats/summary" % (host, port),
                                         headers={"Authorization": "Bearer " + bearer})
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect())
        with opener.open(request, timeout=2) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("Kubelet summary exceeds bounded response size")
            payload = json.loads(raw)
            result = payload.get("node") if isinstance(payload, dict) else None
            if not isinstance(result, dict):
                result = None
    except Exception:
        result = None
    with _LOCK:
        _CACHE[key] = (time.monotonic(), result)
        if len(_CACHE) > 256:
            for old_key in sorted(_CACHE, key=lambda k: _CACHE[k][0])[:len(_CACHE) - 256]:
                del _CACHE[old_key]
    return result


def ready(node):
    return any(c.get("type") == "Ready" and c.get("status") == "True"
               for c in (node.get("status") or {}).get("conditions", []))


def node_metrics(node, snapshot, stats):
    name = node["metadata"]["name"]
    allocatable = (node.get("status") or {}).get("allocatable") or {}
    usage = (snapshot.get("usage") or {}).get(name) or {}
    at = timestamp((snapshot.get("usageTimes") or {}).get(name))
    result = {}
    for key, unit in (("cpu", "cores"), ("memory", "bytes")):
        total = number(QUANTITY(allocatable.get(key)))
        used = number(QUANTITY(usage.get(key))) if at else None
        collected = at if used is not None else None
        if used is None and stats:
            sample = stats.get(key) or {}
            collected = timestamp(sample.get("time"))
            raw = sample.get("usageNanoCores") if key == "cpu" else sample.get("workingSetBytes")
            raw = number(raw)
            used = (raw / 1e9 if key == "cpu" else raw) if collected and raw is not None else None
        error = None if used is not None and total is not None and total > 0 else "Node %s metrics are unavailable or stale." % key
        result[key] = metric(unit, used=used, total=total, collected=collected, error=error)
    filesystem = (stats or {}).get("fs") or {}
    at = timestamp(filesystem.get("time"))
    used, total = number(filesystem.get("usedBytes")), number(filesystem.get("capacityBytes"))
    result["disk"] = metric("bytes", used=used if at else None, total=total if at else None, collected=at,
        error=None if at and used is not None and total is not None and total > 0 else "Node filesystem metrics are unavailable or stale.")
    load, collected = None, None
    try:
        raw = node["metadata"].get("annotations", {}).get("platform.coder/node-load", "")
        observed = json.loads(raw) if len(raw) <= 1024 else {}
        if observed.get("nodeUID") == node["metadata"].get("uid"):
            collected = timestamp(observed.get("collectedAt"))
            load = number(observed.get("load1")) if collected else None
    except (ValueError, TypeError, AttributeError):
        pass
    result["load"] = metric("load", used=load, total=result["cpu"]["total"], collected=collected,
        error=None if load is not None else "Node load average is unavailable or stale.")
    if not ready(node):
        for key in ("cpu", "memory", "disk", "load"):
            result[key].update(used=None, collectedAt=None, error="The assigned node is not Ready.")
    return result


def aggregate(nodes):
    if not nodes:
        return unavailable("No Ready cluster nodes are available.")
    result = {}
    for key, unit in (("cpu", "cores"), ("memory", "bytes"), ("disk", "bytes"), ("load", "load")):
        values = [n[key] for n in nodes]
        total = sum(m["total"] for m in values) if all(m["total"] is not None for m in values) else None
        complete = all(m["error"] is None and m["used"] is not None and m["collectedAt"] for m in values)
        result[key] = metric(unit, total=total, used=sum(m["used"] for m in values) if complete else None,
            collected=min((m["collectedAt"] for m in values),
                key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()) if complete else None,
            error=None if complete else "Cluster %s metrics are incomplete or stale (%d nodes)." % (key, len(nodes)))
    if result["load"]["error"]:
        result["load"]["error"] = "Cluster load average is incomplete or stale (%d nodes)." % len(nodes)
    return result


def allocation(pods, wid):
    """Assigned main-container limits and owned home claim capacity, not host df."""
    result = {"cpu": None, "memory": None, "disk": None, "diskEnforced": None,
              "source": {"cpu": "unknown", "memory": "unknown", "disk": "unknown"}}
    if len(pods) != 1:
        return result
    pod = pods[0]
    container = next((c for c in pod.get("spec", {}).get("containers", []) if c.get("name") == "dev"), None)
    if container is None:
        return result
    limits = container.get("resources", {}).get("limits", {})
    for key in ("cpu", "memory"):
        value = number(QUANTITY(limits.get(key)))
        if value is not None and value > 0:
            result[key] = value
            result["source"][key] = "container-limit"
    mount = next((m for m in container.get("volumeMounts", []) if m.get("name") == "home"), None)
    volume = next((v for v in pod.get("spec", {}).get("volumes", []) if mount and v.get("name") == mount["name"]), None)
    claim_name = (volume or {}).get("persistentVolumeClaim", {}).get("claimName")
    namespace = pod.get("metadata", {}).get("namespace")
    if not claim_name or not namespace:
        return result
    path = "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (
        urllib.parse.quote(namespace, safe=""), urllib.parse.quote(claim_name, safe=""))
    try:
        status, claim = KUBE.call("GET", path)
    except Exception:
        return result
    if status != 200 or not isinstance(claim, dict) or claim.get("metadata", {}).get("labels", {}).get("com.coder.workspace.id") != wid:
        return result
    capacity = number(QUANTITY(claim.get("status", {}).get("capacity", {}).get("storage")))
    if capacity is None or capacity <= 0:
        return result
    result.update(disk=capacity)
    result["source"]["disk"] = "pvc-capacity"
    bound = claim.get("spec", {}).get("volumeName")
    if bound:
        try:
            status, volume = KUBE.call("GET", "/api/v1/persistentvolumes/" + urllib.parse.quote(bound, safe=""))
        except Exception:
            return result
        if status == 200 and isinstance(volume, dict) and volume.get("spec", {}).get("claimRef", {}).get("uid") == claim.get("metadata", {}).get("uid"):
            if volume.get("spec", {}).get("hostPath") is not None or volume.get("spec", {}).get("local") is not None:
                result["diskEnforced"] = False
    return result


def workspace_pods(items, wid, workspace):
    if (workspace.get("latest_build") or {}).get("status") in ("stopped", "deleted"):
        return []
    return [pod for pod in items if isinstance(pod, dict)
            and pod.get("metadata", {}).get("labels", {}).get("com.coder.workspace.id") == wid
            and not pod.get("metadata", {}).get("deletionTimestamp")
            and pod.get("status", {}).get("phase") not in ("Succeeded", "Failed")]


def restricted_allocation(workspace, wid):
    """Read only this workspace's pod allocation without a physical-node snapshot."""
    try:
        path = "/api/v1/pods?labelSelector=" + urllib.parse.quote("com.coder.workspace.id=" + wid, safe="")
        status, listed = KUBE.call("GET", path)
        pods = workspace_pods(listed.get("items", []), wid, workspace) if status == 200 and isinstance(listed, dict) else []
    except Exception:
        pods = []
    return allocation(pods, wid)


def vm_context(workspace, wid):
    """Resolve current guest hardware from its owned VMI and sealed boot profile."""
    unknown = {"allocation": allocation([], wid), "nodeName": None,
               "error": "Current workspace VM allocation is unavailable."}
    try:
        status, discovery = KUBE.call("GET", "/apis/kubevirt.io/v1")
        if status == 404:
            return None
        if status != 200 or not isinstance(discovery, dict):
            return unknown
        namespace = os.environ.get("WORKSPACE_NAMESPACE", os.environ.get("CODER_NAMESPACE", "coder"))
        vm_path = "/apis/kubevirt.io/v1/namespaces/" + urllib.parse.quote(namespace, safe="") + "/virtualmachines/coder-vm-" + wid
        status, vm = KUBE.call("GET", vm_path)
        if status == 404:
            return None
        if status != 200 or not isinstance(vm, dict):
            return unknown
        metadata = vm.get("metadata") or {}
        expected = {"com.coder.workspace.id": wid,
                    "com.coder.organization.id": workspace.get("organization_id"),
                    "com.coder.user.id": workspace.get("owner_id")}
        if not all(expected.values()) or any(metadata.get("labels", {}).get(k) != v for k, v in expected.items()):
            return unknown
        if metadata.get("name") != "coder-vm-" + wid or not metadata.get("uid") or metadata.get("deletionTimestamp"):
            return unknown
        if metadata.get("namespace") != namespace:
            return unknown
        base = "/apis/kubevirt.io/v1/namespaces/" + urllib.parse.quote(namespace, safe="")
        status, vmi = KUBE.call("GET", base + "/virtualmachineinstances/" + metadata["name"])
        if status != 200 or not isinstance(vmi, dict):
            return unknown
        current = vmi.get("metadata") or {}
        if any(current.get("labels", {}).get(k) != v for k, v in expected.items()):
            return unknown
        owners = current.get("ownerReferences", [])
        if not any(o.get("kind") == "VirtualMachine" and o.get("uid") == metadata["uid"] and o.get("controller") is True for o in owners):
            return unknown
        state = vmi.get("status") or {}
        migration = state.get("migrationState") or {}
        if current.get("deletionTimestamp") or state.get("phase") != "Running" or (migration and not migration.get("completed")):
            return unknown
        active_nodes = set((state.get("activePods") or {}).values())
        if len(active_nodes) > 1 or (active_nodes and active_nodes != {state.get("nodeName")}):
            return unknown
        volumes = vmi.get("spec", {}).get("volumes", [])
        boot = [v.get("cloudInitNoCloud", {}).get("secretRef", {}).get("name") for v in volumes if v.get("name") == "cloudinit"]
        if len(boot) != 1 or not isinstance(boot[0], str) or not boot[0].startswith("coder-vm-" + wid + "-boot-"):
            return unknown
        status, secret = KUBE.call("GET", "/api/v1/namespaces/" + urllib.parse.quote(namespace, safe="") + "/secrets/" + urllib.parse.quote(boot[0], safe=""))
        if status != 200 or not isinstance(secret, dict):
            return unknown
        profile = vmprofile.boot_profile(secret)
        if any(profile.get(field) != expected[label] for label, field in (("com.coder.workspace.id", "workspace_id"), ("com.coder.organization.id", "organization_id"), ("com.coder.user.id", "workspace_owner_id"))):
            return unknown
        topology = state.get("currentCPUTopology") or {}
        parts = [topology.get(k) for k in ("cores", "sockets", "threads")]
        cpu = math.prod(parts) if all(type(n) is int and n > 0 for n in parts) else None
        memory = number(QUANTITY(state.get("memory", {}).get("guestCurrent")))
        if cpu != profile["cpu"] or memory != profile["memory_bytes"]:
            return unknown
        result = allocation([], wid)
        result.update(cpu=cpu, memory=memory, memoryReserved=profile["reserved_memory_bytes"],
                      memoryUsable=memory-profile["reserved_memory_bytes"])
        result["source"].update(cpu="vm-topology", memory="vm-memory")
        home = [v.get("persistentVolumeClaim", {}).get("claimName") for v in volumes if v.get("name") == "home"]
        if len(home) == 1 and isinstance(home[0], str) and re.fullmatch(r"[a-z0-9][-a-z0-9.]*", home[0]):
            status, claim = KUBE.call("GET", "/api/v1/namespaces/" + urllib.parse.quote(namespace, safe="") + "/persistentvolumeclaims/" + home[0])
            claim_meta = claim.get("metadata", {}) if status == 200 and isinstance(claim, dict) else {}
            annotations = claim_meta.get("annotations", {})
            valid_home = (not claim_meta.get("deletionTimestamp") and
                          annotations.get("platform.coder/retained-vm-home") == "true" and
                          annotations.get("platform.coder/home-disk-bytes") == str(profile["home_bytes"]) and
                          all(claim_meta.get("labels", {}).get(k) == v for k, v in expected.items()))
            if valid_home:
                result.update(disk=profile["home_bytes"], diskEnforced=True)
                result["source"]["disk"] = "guest-block-capacity"
        return {"allocation": result, "nodeName": state.get("nodeName"), "error": None}
    except Exception:
        return unknown


def infrastructure_allowed(token):
    """Check the actual session scope before accessing deployment-wide metrics."""
    if INFRASTRUCTURE_ACCESS is None:
        return False
    try:
        status, checks = INFRASTRUCTURE_ACCESS(token)
        return status == 200 and isinstance(checks, dict) and checks.get("deployment_stats") is True
    except Exception:
        return False


def report(token, oid, wid, owner=False):
    workspace = WORKSPACE_INFO(token, wid)
    if not workspace or workspace.get("organization_id") != oid:
        raise LookupError("Workspace not found in this organization.")
    guest = vm_context(workspace, wid)
    if not owner or not infrastructure_allowed(token):
        return {"workspaceId": wid, "workspaceName": workspace.get("name", ""),
                "allocation": guest["allocation"] if guest is not None else restricted_allocation(workspace, wid),
                "infrastructureRestricted": True, "nodeName": None, "node": None, "cluster": None,
                "nodeCount": None, "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    snapshot = SNAPSHOT()
    pods = workspace_pods(snapshot.get("pods", []), wid, workspace)
    placement = {p.get("spec", {}).get("nodeName") for p in pods if p.get("spec", {}).get("nodeName")}
    if (workspace.get("latest_build") or {}).get("status") in ("stopped", "deleted"):
        placement = set()
        pods = []
    node_name = guest["nodeName"] if guest is not None else next(iter(placement)) if len(placement) == 1 else None
    nodes = {n["metadata"]["name"]: n for n in snapshot.get("nodes", [])}
    wanted = [n for name, n in nodes.items() if ready(n) or name == node_name]
    # CPU/RAM remain available for large clusters; disk collection stays bounded.
    summaries = {}
    collected_nodes = wanted if len(wanted) <= 32 else [nodes[node_name]] if node_name in nodes else []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for node, stats in zip(collected_nodes, pool.map(summary, collected_nodes)):
            summaries[node["metadata"]["name"]] = stats
    readings = {name: node_metrics(node, snapshot, summaries.get(name)) for name, node in nodes.items()
                if ready(node) or name == node_name}
    reason = "Workspace pod has not been assigned to a node."
    if len(placement) > 1:
        reason = "Workspace pods are assigned to multiple nodes; a single node scope is unavailable."
    elif node_name and node_name not in readings:
        reason = "The assigned node's metrics are unavailable."
    elif snapshot.get("podsAvailable") is False:
        reason = "Workspace pod placement is unavailable."
    return {"workspaceId": wid, "workspaceName": workspace.get("name", ""), "nodeName": node_name,
            "allocation": guest["allocation"] if guest is not None else allocation(pods, wid), "infrastructureRestricted": False,
            "node": readings.get(node_name, unavailable(reason)),
            "cluster": aggregate([readings[name] for name, node in nodes.items() if ready(node)]),
            "nodeCount": sum(ready(n) for n in nodes.values()),
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


def handle(h, method, path, query=""):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    if method != "GET":
        h.send_json(405, {"error": "Method not allowed."})
        return True
    user, err = h.user()
    if err:
        return True
    try:
        oid, wid = (str(uuid.UUID(value)) for value in match.groups())
        h.send_json(200, report(h.token(), oid, wid, owner="owner" in user.get("roles", [])))
    except LookupError as error:
        h.send_json(404, {"error": str(error)})
    except ValueError:
        h.send_json(400, {"error": "Expected organization and workspace UUIDs."})
    except Exception:
        h.send_json(503, {"error": "Workspace node and cluster metrics are unavailable."})
    return True
