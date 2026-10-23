"""The Cluster Network view in depth (Settings > Network): beside the map ui-service.py serves (/api/network), what
each of its pods and Services is - its kind, one colour per kind in the dashboard -, one entity's state on demand,
code-server HA and the storage behind the workspaces, and a mesh of the platform's connections with their latency
measured.

  GET  /__coder-ui/api/network/entity?type=pod|service&namespace=&name=   admins: one pod (its containers and their
                                    states, conditions, owner, volumes, the Services that select it, its usage and
                                    recent events) or one Service (its ports, every endpoint and whether it is ready)
  GET  /__coder-ui/api/network/entity?type=node&name=     admins: a node's capacity and allocatable, its conditions
                                    (pressure), what its pods request, the platform's pods on it, its events
  GET  /__coder-ui/api/network/entity?type=link&id=       admins: a connection of the mesh (what it joins, how it is
                                    measured, its last measurements) or, id agent:<workspace id>, that workspace's
                                    agents' connections to Coder
  GET  /__coder-ui/api/network/ha                          admins: code-server HA - the replicators and which one holds
                                    the operator lock, the clusters' heartbeats, each workspace's active instance, its
                                    lease, superseded instances and its relay, the recent hand-offs - and the storage:
                                    the storage classes with the volumes on each, the CSI drivers, the Cloud Drive
  GET  /__coder-ui/api/network/mesh                        admins: the platform's components and the connections
                                    between them, each with a latency measured at most MESH_TTL seconds ago (one
                                    measurement for every viewer), or none and why

Honest numbers only. This service times what it reaches itself - TCP connects to pod IPs and Services, HTTP health
requests, a SQL round trip on Coder's database - and passes on what the components measure themselves: Coder's health
check (its database ping, the DERP round trip through the access URL) and each workspace agent's latency to Coder's
relay, as the agent reported it. A connection seen only inside another pod (the relay in a workspace pod, the
replicator's queries) is drawn without a number, and says why.
"""
import collections
import concurrent.futures
import os
import re
import socket
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "/__coder-ui"
NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
RELEASE = os.environ.get("CODER_RELEASE", os.environ.get("CODER_DEPLOYMENT", "coder"))
CODER_URL = os.environ.get("CODER_URL", "http://coder").rstrip("/")
ACCESS_URL = os.environ.get("CODER_ACCESS_URL", "").rstrip("/")
KEYCLOAK_NAMESPACE = os.environ.get("KEYCLOAK_NAMESPACE", "keycloak")
POD_NAME = os.environ.get("HOSTNAME", "")  # this replica of the platform service: where the mesh is measured from
MESH_TTL = 8  # seconds one measurement of the mesh serves every viewer
MESH_HISTORY = 30  # measurements kept per connection (the link panel's sparkline)
PROBE_TIMEOUT = 2.0  # seconds a TCP connect may take before it counts as failed
HTTP_TIMEOUT = 3.0
HEALTH_TTL = 60  # Coder's health report is Coder's own measurement, refreshed on its side: read at most once a minute
SERVICES_TTL = 5
HEARTBEAT_TTL = 45  # csha.py's: a cluster whose replicator has not written for longer is not answering
NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$")
LINK_RE = re.compile(r"^(agent:[0-9a-f-]{36}|[a-z-]{1,40})$")
CSHA_LABEL = "coder.code-server/workspace"
CSHA_GEN_LABEL = "coder.code-server/generation"
HA_ROLE_LABEL = "coder-airgapped/ha-role"  # Coder's pods in Platform HA activeStandby: active | standby

# What a pod is, for the dashboard's colours: one per kind, the same in the map, the mesh and the nodes view.
KINDS = ("coder", "database", "workspace", "storage", "gateway", "code-server", "platform", "replicator", "other")
# The platform service and what it runs: its admission webhook, its log database, the Images view's registry and jobs.
PLATFORM_NAMES = {"coder-ui-updates", "coder-platform-webhook", "coder-ui-logs-db", "coder-bootstrap"}
STORAGE_NAMES = {"coder-user-storage-minio", "coder-user-storage-csi"}  # the Cloud Drive: MinIO and its CSI node plugin

LOG = KUBE = CODER_GET = SNAPSHOT = DB = SAFE = QUANTITY = TLS = None
_cache = {}
_cache_lock = threading.Lock()


def setup(log, kube, coder_get, snapshot, db, quantity, safe=None, tls=None):
    """coder_get(token, path): Coder's API as the admin; snapshot(): the cluster's nodes, running pods and node metrics
    (ui-service's cluster_snapshot, cached 3 s); db(): a pool on Coder's database as its owner, or None; quantity(text):
    a Kubernetes quantity in base units; safe: the Cloud Drive module; tls: the service's TLS context (its CA)."""
    global LOG, KUBE, CODER_GET, SNAPSHOT, DB, QUANTITY, SAFE, TLS
    LOG, KUBE, CODER_GET, SNAPSHOT, DB, QUANTITY, SAFE, TLS = log, kube, coder_get, snapshot, db, quantity, safe, tls


def now_iso(at=None):
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cached(key, ttl, fn):
    """fn() at most every ttl seconds (a failure is not kept)."""
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _cache_lock:
        _cache[key] = (time.time(), value)
    return value


# ---------------------------------------------------------------------------------------------------- kinds
def component_kind(labels, release=None):
    """What a pod is, from its labels: a workspace, one of code-server HA's pieces, the database, the platform
    service's, the Cloud Drive's storage, the gateway, a Coder server - or other (metrics-server, operators,
    Keycloak)."""
    labels = labels or {}
    name = labels.get("app.kubernetes.io/name")
    if labels.get("com.coder.workspace.id"):
        return "workspace"
    if name == "coder-code-server" or labels.get(CSHA_LABEL):
        return "code-server"
    if name == "coder-code-server-replicator":
        return "replicator"
    if labels.get("cnpg.io/cluster") or labels.get("cnpg.io/poolerName"):
        return "database"
    if name in PLATFORM_NAMES or (name or "").startswith("coder-image-"):
        return "platform"
    if name in STORAGE_NAMES:
        return "storage"
    if name == "traefik":
        return "gateway"
    if name == "coder-provisioner" or (
            name in ("coder", None) and labels.get("app.kubernetes.io/instance") == (release or RELEASE)):
        return "coder"
    return "other"


def on_map(pod):
    """The pods the map shows besides the workspaces: all of Coder's namespace, and the platform's pods elsewhere -
    Traefik (the way in), code-server instances, the CloudNativePG operator, Keycloak."""
    meta = pod.get("metadata") or {}
    labels = meta.get("labels") or {}
    if labels.get("com.coder.workspace.id"):
        return False
    return (meta.get("namespace") == NAMESPACE or meta.get("namespace") == KEYCLOAK_NAMESPACE
            or component_kind(labels) in ("gateway", "code-server")
            or labels.get("app.kubernetes.io/name") == "cloudnative-pg")


def pod_requests(pod):
    """{cpu (cores), memory (bytes)} its containers request."""
    out = {"cpu": 0.0, "memory": 0.0}
    for c in (pod.get("spec") or {}).get("containers") or []:
        req = (c.get("resources") or {}).get("requests") or {}
        out["cpu"] += QUANTITY(req.get("cpu")) or 0
        out["memory"] += QUANTITY(req.get("memory")) or 0
    return out


def map_extras(pod):
    """What the map adds to a pod's brief: its kind, its role where it has one (a Coder server active or standby, a
    database instance primary or replica) and what it requests (the nodes view)."""
    labels = (pod.get("metadata") or {}).get("labels") or {}
    out = {"kind": component_kind(labels), "requests": pod_requests(pod)}
    role = labels.get(HA_ROLE_LABEL) or labels.get("cnpg.io/instanceRole")
    if role:
        out["haRole"] = role
    return out


def selects(selector, labels):
    return bool(selector) and all((labels or {}).get(k) == v for k, v in selector.items())


def kind_by_name(name):
    """A Service's kind when it selects no running pod: from its name."""
    n = name or ""
    for prefix, kind in (("coder-cs-", "code-server"), ("coder-db", "database"), ("coder-ui-", "platform"),
                         ("coder-platform-", "platform"), ("coder-image-", "platform"),
                         ("coder-user-storage", "storage"),
                         ("traefik", "gateway"), ("coder-code-server-replicator", "replicator")):
        if n.startswith(prefix):
            return kind
    return "coder" if n == RELEASE else "other"


# ---------------------------------------------------------------------------------------------------- Services
def _services_of(ns):
    status, svcs = KUBE.call("GET", "/api/v1/namespaces/%s/services" % ns)
    if status != 200 or not isinstance(svcs, dict):
        raise PermissionError("Services in %s: HTTP %s (the service's ClusterRole needs services list)" % (ns, status))
    status, slices = KUBE.call("GET", "/apis/discovery.k8s.io/v1/namespaces/%s/endpointslices" % ns)
    slices = (slices.get("items") or []) if status == 200 and isinstance(slices, dict) else None
    return svcs.get("items") or [], slices


def endpoints_of(slices, svc_name):
    """[{address, ready, serving, terminating, pod, node, zone}] of a Service, from its EndpointSlices."""
    out = []
    for s in slices or []:
        if ((s.get("metadata") or {}).get("labels") or {}).get("kubernetes.io/service-name") != svc_name:
            continue
        for e in s.get("endpoints") or []:
            cond = e.get("conditions") or {}
            for addr in e.get("addresses") or []:
                out.append({"address": addr, "ready": cond.get("ready") is not False,
                            "serving": cond.get("serving") is not False, "terminating": bool(cond.get("terminating")),
                            "pod": (e.get("targetRef") or {}).get("name"), "node": e.get("nodeName"),
                            "zone": e.get("zone")})
    return sorted(out, key=lambda e: (e["pod"] or "", e["address"]))


def service_kind(svc, pods):
    """The kind of what a Service selects (its pods' most common), else from its name."""
    meta, spec = svc.get("metadata") or {}, svc.get("spec") or {}
    kinds = collections.Counter(
        component_kind((p.get("metadata") or {}).get("labels")) for p in pods
        if (p.get("metadata") or {}).get("namespace") == meta.get("namespace")
        and selects(spec.get("selector"), (p.get("metadata") or {}).get("labels")))
    return kinds.most_common(1)[0][0] if kinds else kind_by_name(meta.get("name"))


def port_text(p):
    target = p.get("targetPort")
    return "%s/%s%s" % (p.get("port"), p.get("protocol") or "TCP",
                        " -> %s" % target if target not in (None, p.get("port")) else "")


def services_report(pods):
    """{services, error}: the Services of Coder's namespace and of the namespaces the map's other pods are in
    (Traefik's, Keycloak's), each with its kind, addresses, ports and how many of its endpoints are ready. Cached
    SERVICES_TTL."""
    def read():
        namespaces = sorted({NAMESPACE} | {(p.get("metadata") or {}).get("namespace") for p in pods if on_map(p)})
        out, error = [], None
        for ns in namespaces:
            try:
                svcs, slices = _services_of(ns)
            except PermissionError as e:
                error = str(e)
                continue
            for svc in svcs:
                meta, spec, st = svc.get("metadata") or {}, svc.get("spec") or {}, svc.get("status") or {}
                eps = endpoints_of(slices, meta.get("name"))
                out.append({
                    "name": meta.get("name"), "namespace": ns, "kind": service_kind(svc, pods),
                    "type": spec.get("type") or "ClusterIP", "clusterIP": spec.get("clusterIP"),
                    "external": [i.get("ip") or i.get("hostname") for i in (st.get("loadBalancer") or {}).get(
                        "ingress") or []] + list(spec.get("externalIPs") or []),
                    "ports": [port_text(p) for p in spec.get("ports") or []],
                    "endpoints": len(eps) if slices is not None else None,
                    "ready": sum(1 for e in eps if e["ready"]) if slices is not None else None,
                })
        return {"services": sorted(out, key=lambda s: (KINDS.index(s["kind"]), s["namespace"], s["name"])),
                "error": error}
    return cached("services", SERVICES_TTL, read)


# ---------------------------------------------------------------------------------------------------- one entity
def _get(path, what):
    status, out = KUBE.call("GET", path)
    if status == 404:
        raise LookupError("There is no %s (it may just have been replaced)." % what)
    if status != 200 or not isinstance(out, dict):
        raise RuntimeError("%s: HTTP %s" % (what, status))
    return out


def events_of(namespace, kind, name):
    """The object's last 10 events, newest first; None when the service may not read events (an older chart)."""
    sel = urllib.parse.quote("involvedObject.kind=%s,involvedObject.name=%s" % (kind, name))
    status, out = KUBE.call("GET", "/api/v1/namespaces/%s/events?fieldSelector=%s" % (namespace, sel))
    if status != 200 or not isinstance(out, dict):
        return None
    items = []
    for e in out.get("items") or []:
        at = e.get("lastTimestamp") or e.get("eventTime") or (e.get("metadata") or {}).get("creationTimestamp")
        items.append({"type": e.get("type"), "reason": e.get("reason"), "message": (e.get("message") or "")[:400],
                      "count": e.get("count") or 1, "at": at})
    return sorted(items, key=lambda e: e["at"] or "", reverse=True)[:10]


def container_state(state):
    """A container's state in one line's parts: {state, since?, reason?, message?, exitCode?}."""
    state = state or {}
    if "running" in state:
        return {"state": "running", "since": (state["running"] or {}).get("startedAt")}
    if "waiting" in state:
        w = state["waiting"] or {}
        return {"state": "waiting", "reason": w.get("reason"), "message": (w.get("message") or "")[:300]}
    if "terminated" in state:
        t = state["terminated"] or {}
        return {"state": "terminated", "reason": t.get("reason"), "exitCode": t.get("exitCode"),
                "since": t.get("finishedAt"), "message": (t.get("message") or "")[:300]}
    return None


def owner_of(meta, labels):
    """{kind, name} of what runs the pod: its controller - a ReplicaSet named for its Deployment."""
    ref = next((r for r in meta.get("ownerReferences") or [] if r.get("controller")), None)
    if not ref:
        return None
    hash_ = (labels or {}).get("pod-template-hash")
    if ref.get("kind") == "ReplicaSet" and hash_ and ref.get("name", "").endswith("-" + hash_):
        return {"kind": "Deployment", "name": ref["name"][: -len(hash_) - 1], "via": "ReplicaSet " + ref["name"]}
    return {"kind": ref.get("kind"), "name": ref.get("name")}


def volume_text(v):
    """A pod volume's type and source, never a Secret's contents."""
    for key, kind, field in (("persistentVolumeClaim", "claim", "claimName"), ("configMap", "ConfigMap", "name"),
                             ("secret", "Secret", "secretName"), ("hostPath", "host path", "path"),
                             ("csi", "CSI", "driver")):
        if key in v:
            return {"name": v.get("name"), "type": kind, "source": (v[key] or {}).get(field)}
    for kind in ("emptyDir", "projected", "downwardAPI", "ephemeral"):
        if kind in v:
            return {"name": v.get("name"), "type": kind, "source": None}
    return {"name": v.get("name"), "type": "other", "source": None}


def resources_text(res):
    return {k: str(v) for k, v in (res or {}).items()}


def _containers(spec_list, statuses):
    by_name = {c.get("name"): c for c in statuses or []}
    out = []
    for c in spec_list or []:
        s = by_name.get(c.get("name")) or {}
        out.append({
            "name": c.get("name"), "image": c.get("image"), "ready": bool(s.get("ready")),
            "restarts": s.get("restartCount") or 0, "state": container_state(s.get("state")),
            "lastState": container_state(s.get("lastState")),
            "ports": ["%s/%s%s" % (p.get("containerPort"), p.get("protocol") or "TCP",
                                   " (%s)" % p["name"] if p.get("name") else "") for p in c.get("ports") or []],
            "requests": resources_text((c.get("resources") or {}).get("requests")),
            "limits": resources_text((c.get("resources") or {}).get("limits")),
        })
    return out


def pod_details(namespace, name):
    pod = _get("/api/v1/namespaces/%s/pods/%s" % (namespace, name), "pod %s/%s" % (namespace, name))
    meta, spec, st = pod.get("metadata") or {}, pod.get("spec") or {}, pod.get("status") or {}
    labels = meta.get("labels") or {}
    kind = component_kind(labels)
    statuses = st.get("containerStatuses") or []
    usage = None
    status, m = KUBE.call("GET", "/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods/%s" % (namespace, name))
    if status == 200 and isinstance(m, dict):
        usage = {"cpu": sum(QUANTITY((c.get("usage") or {}).get("cpu")) or 0 for c in m.get("containers") or []),
                 "memory": sum(QUANTITY((c.get("usage") or {}).get("memory")) or 0 for c in m.get("containers") or [])}
    try:
        svcs, _ = _services_of(namespace)
        mine = sorted((s.get("metadata") or {}).get("name") for s in svcs
                      if selects((s.get("spec") or {}).get("selector"), labels))
    except PermissionError:  # an older chart: the pod's own details still
        mine = None
    extra = {}
    if kind == "workspace":
        relay = next((c for c in statuses if c.get("name") == "code-server-relay"), None)
        extra = {"workspace": labels.get("com.coder.workspace.name"), "owner": labels.get("com.coder.user.username"),
                 "workspaceId": labels.get("com.coder.workspace.id"),
                 "codeServerRelay": {"ready": bool(relay.get("ready")), "restarts": relay.get("restartCount") or 0}
                 if relay else None}
    elif kind == "code-server":
        extra = {"workspaceId": labels.get(CSHA_LABEL), "generation": labels.get(CSHA_GEN_LABEL),
                 "owner": (meta.get("annotations") or {}).get("coder.code-server/owner")}
    return {
        "type": "pod", "name": meta.get("name"), "namespace": meta.get("namespace"), "kind": kind,
        "role": labels.get(HA_ROLE_LABEL) or labels.get("cnpg.io/instanceRole"),
        "phase": st.get("phase"), "reason": st.get("reason"), "message": (st.get("message") or "")[:300],
        "ready": bool(statuses) and all(c.get("ready") for c in statuses),
        "restarts": sum(c.get("restartCount") or 0 for c in statuses),
        "conditions": [{"type": c.get("type"), "status": c.get("status"), "reason": c.get("reason"),
                        "message": (c.get("message") or "")[:300], "since": c.get("lastTransitionTime")}
                       for c in st.get("conditions") or []],
        "node": spec.get("nodeName"), "podIP": st.get("podIP"), "podIPs": [i.get("ip") for i in st.get("podIPs") or []],
        "hostIP": st.get("hostIP"), "qosClass": st.get("qosClass"), "created": meta.get("creationTimestamp"),
        "started": st.get("startTime"), "deleting": bool(meta.get("deletionTimestamp")),
        "owner": owner_of(meta, labels), "serviceAccount": spec.get("serviceAccountName"),
        "containers": _containers(spec.get("containers"), statuses),
        "initContainers": _containers(spec.get("initContainers"), st.get("initContainerStatuses")),
        "volumes": [volume_text(v) for v in spec.get("volumes") or []
                    if not ("projected" in v and (v.get("name") or "").startswith("kube-api-access"))],
        "services": mine, "usage": usage, "requests": pod_requests(pod), "labels": labels, "extra": extra,
        "events": events_of(namespace, "Pod", name),
    }


def service_details(namespace, name):
    svc = _get("/api/v1/namespaces/%s/services/%s" % (namespace, name), "Service %s/%s" % (namespace, name))
    meta, spec, st = svc.get("metadata") or {}, svc.get("spec") or {}, svc.get("status") or {}
    status, slices = KUBE.call("GET", "/apis/discovery.k8s.io/v1/namespaces/%s/endpointslices?labelSelector=%s" % (
        namespace, urllib.parse.quote("kubernetes.io/service-name=" + name)))
    slices = (slices.get("items") or []) if status == 200 and isinstance(slices, dict) else None
    pods = SNAPSHOT()["pods"]
    return {
        "type": "service", "name": meta.get("name"), "namespace": namespace, "kind": service_kind(svc, pods),
        "serviceType": spec.get("type") or "ClusterIP", "clusterIPs": spec.get("clusterIPs") or [spec.get("clusterIP")],
        "external": [i.get("ip") or i.get("hostname") for i in (st.get("loadBalancer") or {}).get("ingress") or []]
        + list(spec.get("externalIPs") or []),
        "ports": [{"name": p.get("name"), "port": p.get("port"), "targetPort": p.get("targetPort"),
                   "protocol": p.get("protocol") or "TCP", "nodePort": p.get("nodePort")}
                  for p in spec.get("ports") or []],
        "selector": spec.get("selector") or {}, "sessionAffinity": spec.get("sessionAffinity"),
        "trafficPolicy": spec.get("internalTrafficPolicy"), "created": meta.get("creationTimestamp"),
        "dns": "%s.%s.svc" % (name, namespace),
        "endpoints": endpoints_of(slices, name) if slices is not None else None,
        "events": events_of(namespace, "Service", name),
    }


def node_details(name):
    node = _get("/api/v1/nodes/%s" % name, "node %s" % name)
    meta, spec, st = node.get("metadata") or {}, node.get("spec") or {}, node.get("status") or {}
    hit = SNAPSHOT()
    pods = [p for p in hit["pods"] if (p.get("spec") or {}).get("nodeName") == name]
    req = {"cpu": 0.0, "memory": 0.0}
    lim = {"cpu": 0.0, "memory": 0.0}
    for p in pods:
        for c in (p.get("spec") or {}).get("containers") or []:
            res = c.get("resources") or {}
            for k in req:
                req[k] += QUANTITY((res.get("requests") or {}).get(k)) or 0
                lim[k] += QUANTITY((res.get("limits") or {}).get(k)) or 0
    u = (hit.get("usage") or {}).get(name)
    res = lambda d: {k: str(v) for k, v in (d or {}).items()}  # noqa: E731
    labels = meta.get("labels") or {}
    platform = []
    for p in pods:
        pm = p.get("metadata") or {}
        if on_map(p) or (pm.get("labels") or {}).get("com.coder.workspace.id"):
            cs = (p.get("status") or {}).get("containerStatuses") or []
            platform.append({"name": pm.get("name"), "namespace": pm.get("namespace"),
                             "kind": component_kind(pm.get("labels")),
                             "ready": bool(cs) and all(c.get("ready") for c in cs)})
    return {
        "type": "node", "name": meta.get("name"), "created": meta.get("creationTimestamp"),
        "unschedulable": bool(spec.get("unschedulable")),
        "conditions": [{"type": c.get("type"), "status": c.get("status"), "reason": c.get("reason"),
                        "message": (c.get("message") or "")[:300], "since": c.get("lastTransitionTime"),
                        "heartbeat": c.get("lastHeartbeatTime")} for c in st.get("conditions") or []],
        "capacity": res(st.get("capacity")), "allocatable": res(st.get("allocatable")),
        "allocatableValues": {k: QUANTITY((st.get("allocatable") or {}).get(k)) for k in ("cpu", "memory", "pods")},
        "usage": {"cpu": QUANTITY(u.get("cpu")), "memory": QUANTITY(u.get("memory"))} if u else None,
        "requests": req, "limits": lim, "podCount": len(pods), "pods": sorted(
            platform, key=lambda p: (KINDS.index(p["kind"]), p["name"] or "")),
        "taints": ["%s%s:%s" % (t.get("key"), "=" + t["value"] if t.get("value") else "", t.get("effect"))
                   for t in spec.get("taints") or []],
        "labels": {k: v for k, v in labels.items() if k.startswith(("topology.kubernetes.io/", "kubernetes.io/",
                                                                   "node.kubernetes.io/", "node-role.kubernetes.io/"))},
        "addresses": [{"type": a.get("type"), "address": a.get("address")} for a in st.get("addresses") or []],
        "info": {k: (st.get("nodeInfo") or {}).get(k) for k in ("kubeletVersion", "containerRuntimeVersion",
                                                             "kernelVersion", "osImage", "architecture")},
        "images": len(st.get("images") or []), "volumesInUse": len(st.get("volumesInUse") or []),
        "events": events_of("default", "Node", name),
    }


def agent_link(token, workspace_id):
    """A workspace's agents and their connection to Coder, as Coder's API reports them."""
    status, ws = CODER_GET(token, "/api/v2/workspaces/" + workspace_id)
    if status == 404:
        raise LookupError("There is no such workspace.")
    if status != 200 or not isinstance(ws, dict):
        raise RuntimeError("Coder's API: HTTP %s" % status)
    agents = []
    for r in (ws.get("latest_build") or {}).get("resources") or []:
        for a in r.get("agents") or []:
            agents.append({
                "name": a.get("name"), "status": a.get("status"), "lifecycle": a.get("lifecycle_state"),
                "version": a.get("version"), "apiVersion": a.get("api_version"),
                "os": a.get("operating_system"), "arch": a.get("architecture"),
                "latency": sorted(({"region": k, "ms": (v or {}).get("latency_ms"), "preferred": bool((v or {}).get(
                    "preferred"))} for k, v in (a.get("latency") or {}).items()), key=lambda x: not x["preferred"]),
                "firstConnectedAt": a.get("first_connected_at"), "lastConnectedAt": a.get("last_connected_at"),
                "disconnectedAt": a.get("disconnected_at"), "startedAt": a.get("started_at"),
                "readyAt": a.get("ready_at"), "connectionTimeoutSeconds": a.get("connection_timeout_seconds"),
            })
    return {
        "type": "link", "id": "agent:" + workspace_id, "from": {"id": "coder", "kind": "coder", "label": "Coder"},
        "to": {"id": "workspace", "kind": "workspace", "label": "%s/%s" % (ws.get("owner_name"), ws.get("name"))},
        "method": "the workspace agent's tailnet connection to Coder (its DERP relay); each agent measures its latency "
                  "to the relay and reports it to Coder",
        "agents": agents,
    }


def entity(token, query):
    """One entity's details: ?type=pod|service&namespace=&name=, ?type=node&name=, ?type=link&id=."""
    q = urllib.parse.parse_qs(query or "")
    arg = lambda k: (q.get(k) or [""])[0]  # noqa: E731
    kind = arg("type")
    if kind == "link":
        link = arg("id")
        if not LINK_RE.match(link):
            raise ValueError("id: a connection of the mesh, or agent:<workspace id>.")
        if link.startswith("agent:"):
            return agent_link(token, link[len("agent:"):])
        return MESH.edge(link, token)
    name = arg("name")
    if not NAME_RE.match(name):
        raise ValueError("name: a Kubernetes object's name.")
    if kind == "node":
        return node_details(name)
    namespace = arg("namespace") or NAMESPACE
    if not NAME_RE.match(namespace):
        raise ValueError("namespace: a Kubernetes namespace.")
    if kind == "pod":
        return pod_details(namespace, name)
    if kind == "service":
        return service_details(namespace, name)
    raise ValueError("type: pod, service, node or link.")


# ---------------------------------------------------------------------------------------------------- measuring
DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)")
DURATION_MS = {"ns": 1e-6, "us": 1e-3, "µs": 1e-3, "μs": 1e-3, "ms": 1.0, "s": 1e3, "m": 6e4, "h": 3.6e6}


def go_duration_ms(text):
    """A Go duration ("442.724µs", "1m2.5s") in milliseconds; None if it is not one. Coder's health report rounds its
    *_ms fields to whole milliseconds (0 in a cluster): the duration string keeps the measurement."""
    text = str(text or "").strip()
    parts = DURATION_RE.findall(text)
    if not parts or "".join(n + u for n, u in parts) != text.lstrip("+"):
        return None
    return sum(float(n) * DURATION_MS[u] for n, u in parts)


def tcp_ms(host, port, tries=3, timeout=PROBE_TIMEOUT):
    """(median connect time in ms, error): a TCP handshake to host:port, tries times (the name resolved first, so DNS
    is not timed)."""
    try:
        addr = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)[0]
    except OSError as e:
        return None, "cannot resolve %s: %s" % (host, e)
    times, err = [], None
    for _ in range(tries):
        s = socket.socket(addr[0], socket.SOCK_STREAM)
        s.settimeout(timeout)
        t0 = time.perf_counter()
        try:
            s.connect(addr[4])
            times.append((time.perf_counter() - t0) * 1000)
        except OSError as e:
            err = str(e) or e.__class__.__name__
        finally:
            s.close()
    return (round(statistics.median(times), 3) if times else None), (None if times else err)


_OPENERS = {}


def http_ms(url, timeout=HTTP_TIMEOUT):
    """(ms, error, HTTP status): one GET, timed whole until its (small) answer is read - the name lookup, connect, TLS
    and the request. Any HTTP answer counts (the registry's 401 is an answer); no proxy."""
    https = url.startswith("https")
    opener = _OPENERS.get(https)
    if not opener:
        handlers = [urllib.request.ProxyHandler({})]
        if https:
            handlers.append(urllib.request.HTTPSHandler(context=TLS))
        opener = _OPENERS[https] = urllib.request.build_opener(*handlers)
    t0 = time.perf_counter()
    try:
        with opener.open(urllib.request.Request(url, headers={"User-Agent": "coder-ui-updates mesh"}),
                         timeout=timeout) as r:
            r.read(65536)
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except (OSError, ValueError) as e:
        return None, str(getattr(e, "reason", None) or e)[:200], None
    return round((time.perf_counter() - t0) * 1000, 3), None, status


def sql_ms(pool, tries=3):
    """(median ms, error) of SELECT 1 on Coder's database, through the service's own pool."""
    times = []
    try:
        for _ in range(tries):
            t0 = time.perf_counter()
            pool.query("SELECT 1")
            times.append((time.perf_counter() - t0) * 1000)
    except Exception as e:  # noqa: BLE001 - shown as the connection's error
        return None, str(e)[:200]
    return round(statistics.median(times), 3), None


def pod_port(pod, names, default):
    """The pod's container port with one of these names, else the default."""
    for c in (pod.get("spec") or {}).get("containers") or []:
        for p in c.get("ports") or []:
            if p.get("name") in names:
                return p.get("containerPort")
    return default


def _brief(pod):
    meta, st = pod.get("metadata") or {}, pod.get("status") or {}
    cs = st.get("containerStatuses") or []
    return {"name": meta.get("name"), "namespace": meta.get("namespace"),
            "node": (pod.get("spec") or {}).get("nodeName"),
            "podIP": st.get("podIP"), "ready": bool(cs) and all(c.get("ready") for c in cs),
            "restarts": sum(c.get("restartCount") or 0 for c in cs), "started": st.get("startTime"),
            "phase": st.get("phase"), "deleting": bool(meta.get("deletionTimestamp"))}


def _median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 3) if values else None


class Mesh:
    """The platform's components and the connections between them, measured at most every MESH_TTL seconds (whoever
    asks waits for the one measurement running), each connection's last MESH_HISTORY numbers kept."""

    def __init__(self):
        self.lock = threading.Lock()
        self.last = None  # (time, report)
        self.history = {}  # edge id -> deque of [time, ms]
        self.health = (0.0, None)  # (read at, Coder's health report)

    def report(self, token):
        with self.lock:
            if self.last and time.time() - self.last[0] < MESH_TTL:
                return self.last[1]
            rep = self.measure(token)
            self.last = (time.time(), rep)
            for e in rep["edges"]:
                if e["measuredBy"]:  # one that can be measured: a gap in its line is a failed measurement
                    self.history.setdefault(e["id"], collections.deque(maxlen=MESH_HISTORY)).append(
                        [e["measuredAt"] or rep["generatedAt"], e["ms"]])
            return rep

    def edge(self, edge_id, token):
        """One connection with its recent numbers (the link panel); measured first if nobody has yet."""
        if self.last is None:
            self.report(token)
        with self.lock:
            rep = self.last[1] if self.last else None
            hist = list(self.history.get(edge_id) or [])
        e = next((x for x in (rep or {}).get("edges") or [] if x["id"] == edge_id), None)
        if not e:
            raise LookupError("There is no such connection in this cluster.")
        nodes = {n["id"]: n for n in rep["nodes"]}
        return dict(e, type="link", history=hist, **{
            "from": {"id": e["from"], "kind": nodes[e["from"]]["kind"], "label": nodes[e["from"]]["label"]},
            "to": {"id": e["to"], "kind": nodes[e["to"]]["kind"], "label": nodes[e["to"]]["label"]}})

    def coder_health(self, token):
        """Coder's health report (its own measurements: the database ping, the DERP round trip), at most once a
        minute; None when it cannot be read."""
        at, rep = self.health
        if rep is None or time.time() - at > HEALTH_TTL:
            status, out = CODER_GET(token, "/api/v2/debug/health")
            rep = out if status == 200 and isinstance(out, dict) else {"error": "HTTP %s" % status}
            self.health = (time.time(), rep)
        return rep

    def measure(self, token):
        hit = SNAPSHOT()
        pods = [p for p in hit["pods"] if not (p.get("metadata") or {}).get("deletionTimestamp")]
        labels_of = lambda p: (p.get("metadata") or {}).get("labels") or {}  # noqa: E731
        by_kind = collections.defaultdict(list)
        for p in pods:
            if on_map(p) or labels_of(p).get("com.coder.workspace.id"):
                by_kind[component_kind(labels_of(p))].append(p)
        name_of = lambda p: labels_of(p).get("app.kubernetes.io/name")  # noqa: E731
        role_of = lambda p: labels_of(p).get("cnpg.io/instanceRole")  # noqa: E731
        try:
            svcs = services_report(hit["pods"])["services"]
        except Exception:  # noqa: BLE001 - the pods' own addresses still
            svcs = []
        svc = lambda pred: next((s for s in svcs if pred(s)), None)  # noqa: E731
        groups = {
            "gateway": by_kind["gateway"],
            "coder": by_kind["coder"],
            "workspaces": by_kind["workspace"],
            "code-server": by_kind["code-server"],
            "replicator": by_kind["replicator"],
            "database": [p for p in by_kind["database"] if role_of(p) != "replica"],
            "replicas": [p for p in by_kind["database"] if role_of(p) == "replica"],
            "storage": [p for p in by_kind["storage"] if name_of(p) == "coder-user-storage-minio"],
            "registry": [p for p in by_kind["platform"] if name_of(p) == "coder-image-registry"],
            "platform": [p for p in by_kind["platform"] if name_of(p) == "coder-ui-updates"],
        }
        backend = None
        if SAFE is not None and getattr(SAFE, "ENABLED", False):
            try:
                backend = SAFE.backend()
            except Exception:  # noqa: BLE001 - no storage connection then
                backend = None
        host = urllib.parse.urlsplit(ACCESS_URL).hostname or "the access URL"
        registry = svc(lambda s: s["name"] == "coder-image-registry")
        # id: (label, line under it, kind, the Service a click opens)
        meta = {
            "gateway": ("Traefik" if groups["gateway"] else "Way in", host, "gateway",
                        svc(lambda s: s["kind"] == "gateway")),
            "coder": ("Coder", None, "coder", svc(lambda s: s["name"] == RELEASE and s["kind"] == "coder")),
            "workspaces": ("Workspaces", "agents", "workspace", None),
            "code-server": ("code-server", "HA instances", "code-server", None),
            "replicator": ("Replicator", "code-server HA", "replicator", None),
            "database": ("Database", "primary" if groups["database"] else "external", "database",
                         svc(lambda s: s["kind"] == "database" and s["name"].endswith("-rw"))),
            "replicas": ("Replicas", "streaming", "database",
                         svc(lambda s: s["kind"] == "database" and s["name"].endswith("-ro"))),
            "storage": ("MinIO" if groups["storage"] else "S3", "Cloud Drive", "storage",
                        svc(lambda s: s["name"] == "coder-user-storage-minio")),
            "registry": ("Registry", "images", "platform", registry),
            "platform": ("Platform service", "measures from here", "platform",
                         svc(lambda s: s["name"] == "coder-ui-updates")),
        }
        present = {k for k, v in groups.items() if v} | {"gateway", "coder", "workspaces", "database", "platform"}
        if backend and backend.get("endpoint"):
            present.add("storage")
        nodes = []
        for nid in ("gateway", "coder", "workspaces", "code-server", "replicator", "database", "replicas", "storage",
                    "registry", "platform"):
            if nid not in present:
                continue
            label, sub, kind, service = meta[nid]
            members = [_brief(p) for p in groups[nid]]
            ref = ({"type": "service", "namespace": service["namespace"], "name": service["name"]} if service else
                   {"type": "pod", "namespace": members[0]["namespace"], "name": members[0]["name"]}
                   if len(members) == 1 else None)
            nodes.append({"id": nid, "label": label, "sub": sub, "kind": kind, "pods": members,
                          "ready": sum(1 for m in members if m["ready"]), "entity": ref})

        # Every probe at once, each bounded by its own timeout; a probe that fails is that connection's error.
        jobs, fallback = {}, {}
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=12)

        def submit(key, empty, fn, *args):
            jobs[key], fallback[key] = executor.submit(fn, *args), empty

        submit("health", lambda e: {"error": e}, self.coder_health, token)
        submit("agents", lambda e: ([], e), workspaces_agents, token)
        submit("coder-http", lambda e: (None, e, None), http_ms, CODER_URL + "/healthz")
        if ACCESS_URL:
            submit("access-http", lambda e: (None, e, None), http_ms, ACCESS_URL + "/healthz")
        db = DB() if DB else None
        if db:
            submit("sql", lambda e: (None, e), sql_ms, db)
            if "replicator" in present:
                submit("heartbeats", lambda e: {}, replicator_heartbeats, db)
        tcp_targets = {}
        for nid, names, default in (("coder", ("http",), 8080), ("database", ("postgresql", "pgbouncer"), 5432),
                                    ("replicas", ("postgresql",), 5432), ("code-server", ("station",), 8080)):
            for p in groups.get(nid) or []:
                ip = (p.get("status") or {}).get("podIP")
                if ip:
                    port = pod_port(p, names, default)
                    key = "tcp:%s:%s" % (nid, (p.get("metadata") or {}).get("name"))
                    tcp_targets[key] = (nid, "%s %s:%s" % ((p.get("metadata") or {}).get("name"), ip, port))
                    submit(key, lambda e: (None, e), tcp_ms, ip, port)
        storage_url = (backend or {}).get("endpoint") or ""
        storage_host = urllib.parse.urlsplit(storage_url) if storage_url else None
        if storage_host and storage_host.hostname:
            submit("tcp-storage", lambda e: (None, e), tcp_ms, storage_host.hostname,
                   storage_host.port or (443 if storage_host.scheme == "https" else 80))
        if registry and registry.get("clusterIP") not in (None, "", "None"):
            ip, port = registry["clusterIP"], (registry.get("ports") or ["5000/TCP"])[0].split("/")[0]
            submit("registry-http", lambda e: (None, e, None), http_ms,
                   "http://%s:%s/v2/" % ("[%s]" % ip if ":" in ip else ip, port))
        done = {}
        for key, fut in jobs.items():
            try:
                done[key] = fut.result(timeout=15)
            except Exception as e:  # noqa: BLE001
                done[key] = fallback[key](str(e)[:200] or e.__class__.__name__)
        executor.shutdown(wait=False)
        at = now_iso()

        def samples(nid):
            out = []
            for key, (gid, target) in tcp_targets.items():
                if gid == nid:
                    ms, err = done.get(key, (None, "not measured"))
                    out.append({"target": target, "ms": ms, "error": err, "method": "TCP connect"})
            return out

        def median_of(sm):
            ms = _median([s["ms"] for s in sm])
            return ms, (None if ms is not None else (sm[0]["error"] if sm else "no pod address"))

        edges = []

        def edge(eid, a, b, kind, method, ms=None, error=None, note=None, by=None, measured=None, sample=None):
            edges.append({"id": eid, "from": a, "to": b, "kind": kind, "ms": ms, "error": error, "method": method,
                          "note": note, "measuredBy": by, "measuredAt": measured if ms is not None else None,
                          "samples": sample or []})

        # What the components measure themselves.
        health = done.get("health") or {}
        health_at = health.get("time")
        derp = [go_duration_ms(r.get("round_trip_ping"))
                for reg in ((health.get("derp") or {}).get("regions") or {}).values()
                for r in (reg or {}).get("node_reports") or []]
        derp = [d for d in derp if d is not None]
        edge("gateway-coder", "gateway", "coder", "traffic",
             "Coder's health check: a DERP message round trip through the access URL (%s -> Traefik -> Coder)" % host,
             ms=_median(derp), error=health.get("error"), by="Coder", measured=health_at,
             note=None if derp else "Coder's health report has no DERP round trip.")
        agent_rows, agent_err = done.get("agents") or ([], None)
        edge("coder-workspaces", "coder", "workspaces", "traffic",
             "each workspace agent's latency to Coder's DERP relay, as the agent last reported it (the median of the "
             "connected agents)",
             ms=_median([s["ms"] for s in agent_rows if s["ok"]]), error=agent_err, by="workspace agents", measured=at,
             note=None if agent_rows else "No running workspace agent to report one.",
             sample=[{"target": s["target"], "ms": s["ms"], "error": None if s["ok"] else s["status"],
                      "method": "agent report"} for s in agent_rows])
        dbh = health.get("database") or {}
        edge("coder-database", "coder", "database", "traffic", "Coder's health check: its database ping",
             ms=_median([go_duration_ms(dbh.get("latency"))]), by="Coder", measured=health_at,
             error=health.get("error") or (None if dbh.get("reachable", True) else "Coder reports it unreachable"),
             note=None if dbh.get("latency") else "Coder's health report has no database latency.")
        # What only another pod sees: drawn, not numbered.
        if "code-server" in present:
            edge("workspaces-code-server", "workspaces", "code-server", "traffic",
                 "the relay in each workspace pod (where code-server would listen, 127.0.0.1:13337) pipes every "
                 "connection to the active instance's station (:8080)",
                 note="Not measured: the relay runs inside the workspace pod. The platform service times its own "
                      "connection to each instance's station (platform service -> code-server).")
        if "replicator" in present:
            beats = done.get("heartbeats") or {}
            beat = ", ".join("%s %.0f s ago" % (k, v) for k, v in sorted(beats.items()))
            if "code-server" in present:
                edge("replicator-code-server", "replicator", "code-server", "control",
                     "the replicator starts, replaces and fences the instances through the Kubernetes API",
                     note="Control, not traffic: nothing to time.")
            edge("replicator-database", "replicator", "database", "traffic",
                 "the replicator's heartbeat, leases and operator lock in Coder's database (schema code_server_ha)",
                 note="Not measured: the replicator's queries are timed only inside it." + (
                     " Its last heartbeat: %s." % beat if beat else ""))
        if "replicas" in present:
            edge("database-replicas", "database", "replicas", "traffic",
                 "PostgreSQL streaming replication from the primary",
                 note="Not measured: the replication lag (pg_stat_replication) is shown only to pg_monitor, and the "
                      "platform service signs in as the database's owner.")
        # What the platform service times itself.
        ms, err, code = done.get("access-http") or (None, "no access URL configured", None)
        edge("platform-gateway", "platform", "gateway", "probe",
             "HTTPS GET %s/healthz, the whole request (name lookup, TLS): through the way in (Traefik) to Coder%s" % (
                 ACCESS_URL or "<access URL>", " (HTTP %s)" % code if code else ""),
             ms=ms, error=err, by="platform service", measured=at)
        ms, err, code = done.get("coder-http") or (None, "not measured", None)
        edge("platform-coder", "platform", "coder", "probe",
             "HTTP GET %s/healthz on Coder's Service, the whole request%s; each server's pod: TCP connect" % (
                 CODER_URL, " (HTTP %s)" % code if code else ""),
             ms=ms, error=err, by="platform service", measured=at, sample=samples("coder"))
        ms, err = done.get("sql") or (None, "Coder's database is not reachable from the platform service yet")
        edge("platform-database", "platform", "database", "probe",
             "SQL round trip (SELECT 1) on the service's own connection; each instance: TCP connect",
             ms=ms, error=err, by="platform service", measured=at, sample=samples("database"))
        if "replicas" in present:
            sm = samples("replicas")
            ms, err = median_of(sm)
            edge("platform-replicas", "platform", "replicas", "probe", "TCP connect to each replica (the median)",
                 ms=ms, error=err, by="platform service", measured=at, sample=sm)
        if groups["code-server"]:
            sm = samples("code-server")
            ms, err = median_of(sm)
            edge("platform-code-server", "platform", "code-server", "probe",
                 "TCP connect to each instance's station (:8080; the median)",
                 ms=ms, error=err, by="platform service", measured=at, sample=sm)
        if "storage" in present:
            ms, err = done.get("tcp-storage") or (None, "the Cloud Drive is off" if not backend else "no S3 endpoint")
            st = dict(getattr(SAFE, "_status", None) or {}) if SAFE is not None else {}
            s3 = [{"target": "S3 HeadBucket %s (the Cloud Drive's own check at %s)" % (
                (backend or {}).get("bucket"), now_iso(st["checkedAt"])), "ms": st.get("latencyMs"),
                "error": st.get("error"), "method": "S3 request"}] if st.get("checkedAt") else []
            edge("platform-storage", "platform", "storage", "probe",
                 "TCP connect to the Cloud Drive's S3 endpoint %s" % (storage_url or "-"),
                 ms=ms, error=err, by="platform service", measured=at, sample=s3)
        if "registry" in present:
            ms, err, code = done.get("registry-http") or (None, "the registry has no Service address", None)
            edge("platform-registry", "platform", "registry", "probe",
                 "HTTP GET /v2/ on the image registry's Service, the whole request%s" % (
                     " (HTTP %s)" % code if code else ""),
                 ms=ms, error=err, by="platform service", measured=at)
        ids = {n["id"] for n in nodes}
        return {"generatedAt": at, "ttlSeconds": MESH_TTL, "vantage": POD_NAME or None, "nodes": nodes,
                "edges": [e for e in edges if e["from"] in ids and e["to"] in ids]}


MESH = Mesh()


def workspaces_agents(token):
    """([{target, ms, ok, status}], error) of the running workspaces' agents: each one's preferred DERP latency."""
    status, ws = CODER_GET(token, "/api/v2/workspaces?" + urllib.parse.urlencode(
        {"q": "status:running", "limit": 1000}))
    if status != 200 or not isinstance(ws, dict):
        return [], "Coder's API: HTTP %s" % status
    out = []
    for w in ws.get("workspaces") or []:
        for r in (w.get("latest_build") or {}).get("resources") or []:
            for a in r.get("agents") or []:
                lat = [v.get("latency_ms") for v in (a.get("latency") or {}).values()
                       if isinstance(v, dict) and v.get("preferred")]
                ok = a.get("status") == "connected" and bool(lat)
                out.append({"target": "%s/%s.%s" % (w.get("owner_name"), w.get("name"), a.get("name")),
                            "ms": round(lat[0], 3) if lat else None, "ok": ok, "status": a.get("status")})
    return out, None


def replicator_heartbeats(db):
    """{cluster: seconds since its replicator's last heartbeat} (code_server_ha.clusters), {} without the schema."""
    if db.query("SELECT to_regclass('code_server_ha.clusters')::text")[0][0] is None:
        return {}
    return {r[0]: float(r[1]) for r in db.query(
        "SELECT name, EXTRACT(EPOCH FROM now() - heartbeat_at)::float8 FROM code_server_ha.clusters")}


# ---------------------------------------------------------------------------------------------------- code-server HA
def ha_db(db):
    """code-server HA's state in Postgres: the clusters, the instances, the recent events, which replicator session
    holds each cluster's operator lock and every replicator session. {"schema": False} before the schema exists."""
    if db.query("SELECT to_regclass('code_server_ha.instances')::text")[0][0] is None:
        return {"schema": False}
    clusters = [{"name": r[0], "heartbeatAgo": float(r[1]), "since": r[2], "external": r[3] in ("t", True),
                 "version": r[4], "healthy": float(r[1]) <= HEARTBEAT_TTL, "lockAddress": r[5], "lockSince": r[6]}
                for r in db.query(
        "SELECT c.name, EXTRACT(EPOCH FROM now() - c.heartbeat_at)::float8, to_char(c.since AT TIME ZONE 'UTC', "
        "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), c.external, c.version, host(a.client_addr), "
        "to_char(a.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM code_server_ha.clusters c "
        "LEFT JOIN pg_locks l ON l.locktype = 'advisory' AND l.granted AND l.objsubid = 1 "
        "AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext('code-server-replicator:' || c.name)::bigint "
        "LEFT JOIN pg_stat_activity a ON a.pid = l.pid ORDER BY c.name")]
    cols = ("workspaceId", "owner", "homeCluster", "homeNamespace", "homeNode", "activeCluster", "pod", "generation",
            "state", "leaseLeft", "message", "updatedAgo", "seenAgo", "endpoint", "stateFiles", "stateUpdatedAt")
    instances = []
    for r in db.query(
            "SELECT i.workspace_id::text, i.owner, i.home_cluster, i.home_namespace, i.home_node, i.active_cluster, "
            "i.pod, i.generation::text, i.state, EXTRACT(EPOCH FROM i.lease_expires - now())::float8, i.message, "
            "EXTRACT(EPOCH FROM now() - i.updated_at)::float8, EXTRACT(EPOCH FROM now() - i.seen_at)::float8, "
            "i.endpoint_local, "
            "(SELECT count(*) FROM code_server_ha.state s WHERE s.workspace_id = i.workspace_id)::text, "
            "(SELECT to_char(max(s.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM code_server_ha.state s WHERE s.workspace_id = i.workspace_id) "
            "FROM code_server_ha.instances i ORDER BY i.owner, i.workspace_id"):
        d = dict(zip(cols, r))
        d["generation"] = int(d["generation"] or 0)
        d["stateFiles"] = int(d["stateFiles"] or 0)
        for k in ("leaseLeft", "updatedAgo", "seenAgo"):
            d[k] = float(d[k]) if d[k] is not None else None
        instances.append(d)
    events = [{"at": r[0], "workspaceId": r[1], "cluster": r[2], "event": r[3], "detail": r[4]} for r in db.query(
        "SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), workspace_id::text, cluster, event, "
        "detail FROM code_server_ha.events ORDER BY id DESC LIMIT 25")]
    sessions = [{"address": r[0], "since": r[1], "state": r[2]} for r in db.query(
        "SELECT host(client_addr), to_char(backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), state "
        "FROM pg_stat_activity WHERE application_name = 'code-server-replicator'")]
    return {"schema": True, "clusters": clusters, "instances": instances, "events": events, "sessions": sessions}


def _env(pod, name):
    for c in (pod.get("spec") or {}).get("containers") or []:
        for e in c.get("env") or []:
            if e.get("name") == name and "value" in e:
                return e["value"]
    return None


def ha_report(pods):
    """code-server HA as it is now: the replicators (which one holds this cluster's operator lock, which wait), the
    clusters' heartbeats, and each workspace's active instance with its lease, the instances superseded and not fenced
    yet, and the relay in its workspace pod; the recent hand-offs."""
    labels_of = lambda p: (p.get("metadata") or {}).get("labels") or {}  # noqa: E731
    reps = [p for p in pods if labels_of(p).get("app.kubernetes.io/name") == "coder-code-server-replicator"]
    inst_pods = [p for p in pods if labels_of(p).get(CSHA_LABEL)]
    ws_pods = {labels_of(p).get("com.coder.workspace.id"): p for p in pods
               if labels_of(p).get("com.coder.workspace.id")}
    data, error = {"schema": False}, None
    db = DB() if DB else None
    if db:
        try:
            data = ha_db(db)
        except Exception as e:  # noqa: BLE001 - the Kubernetes half still
            error = "Coder's database: %s" % str(e)[:200]
    else:
        error = "Coder's database is not reachable from the platform service yet."
    cluster = next((_env(p, "CSHA_CLUSTER") for p in reps if _env(p, "CSHA_CLUSTER")), None)
    lease = next((_env(p, "CSHA_LEASE_SECONDS") for p in reps if _env(p, "CSHA_LEASE_SECONDS")), None)
    external = next((_env(p, "CSHA_ENDPOINT_EXTERNAL") for p in reps if _env(p, "CSHA_ENDPOINT_EXTERNAL")), None)
    holder_ip = next((c["lockAddress"] for c in data.get("clusters") or [] if c["name"] == cluster), None)
    session_ips = {s["address"] for s in data.get("sessions") or []}
    replicators = []
    for p in reps:
        b = _brief(p)
        ip = b["podIP"]
        b["lock"] = ("holds" if ip and ip == holder_ip else "waits" if ip in session_ips else
                     "unknown" if not data.get("schema") else "not connected")
        replicators.append(b)
    desired = None
    status, deps = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/deployments?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote("app.kubernetes.io/name=coder-code-server-replicator")))
    if status == 200 and isinstance(deps, dict) and deps.get("items"):
        desired = (deps["items"][0].get("spec") or {}).get("replicas")
    instances = []
    for row in data.get("instances") or []:
        mine = [p for p in inst_pods if labels_of(p).get(CSHA_LABEL) == row["workspaceId"]]
        active, other = None, []
        for p in sorted(mine, key=lambda p: -int(labels_of(p).get(CSHA_GEN_LABEL) or 0)):
            b = dict(_brief(p), generation=int(labels_of(p).get(CSHA_GEN_LABEL) or 0))
            if b["generation"] == row["generation"] and row["activeCluster"] in (cluster, None) and not active:
                active = b
            else:
                other.append(b)
        wp = ws_pods.get(row["workspaceId"])
        relay = None
        if wp:
            rs = next((c for c in (wp.get("status") or {}).get("containerStatuses") or []
                       if c.get("name") == "code-server-relay"), None)
            relay = dict(_brief(wp), relayReady=bool(rs and rs.get("ready")),
                         relayRestarts=(rs or {}).get("restartCount") or 0, relay=bool(rs),
                         workspace=labels_of(wp).get("com.coder.workspace.name"))
        instances.append(dict(row, activePod=active, superseded=other, workspacePod=relay))
    known = {i["workspaceId"] for i in instances}
    orphans = [dict(_brief(p), generation=int(labels_of(p).get(CSHA_GEN_LABEL) or 0),
                    workspaceId=labels_of(p).get(CSHA_LABEL)) for p in inst_pods
               if labels_of(p).get(CSHA_LABEL) not in known]
    return {
        "installed": bool(reps) or bool(data.get("schema")), "cluster": cluster,
        "leaseSeconds": int(lease) if (lease or "").isdigit() else None, "endpointExternal": external or None,
        "replicas": desired, "replicators": replicators, "lockHolder": next(
            (r["name"] for r in replicators if r["lock"] == "holds"), None),
        "lockSince": next((c["lockSince"] for c in data.get("clusters") or [] if c["name"] == cluster), None),
        "clusters": data.get("clusters") or [], "instances": instances, "unregistered": orphans,
        "events": data.get("events") or [], "schema": bool(data.get("schema")), "error": error,
    }


# ---------------------------------------------------------------------------------------------------- storage
def storage_report(pods):
    """The storage classes (provisioner, default, reclaim policy, binding mode) with the volumes on each, the CSI
    drivers, the claims of Coder's namespace still waiting, and the Cloud Drive: its backend, its CSI node plugin and
    MinIO, and every account's volume with its state."""
    status, scs = KUBE.call("GET", "/apis/storage.k8s.io/v1/storageclasses")
    classes_raw = (scs.get("items") or []) if status == 200 and isinstance(scs, dict) else []
    status, pvs = KUBE.call("GET", "/api/v1/persistentvolumes")
    pv_ok = status == 200 and isinstance(pvs, dict)
    pvs = (pvs.get("items") or []) if pv_ok else []
    status, drivers = KUBE.call("GET", "/apis/storage.k8s.io/v1/csidrivers")
    drivers = (drivers.get("items") or []) if status == 200 and isinstance(drivers, dict) else None
    status, pvcs = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims" % NAMESPACE)
    pvcs = (pvcs.get("items") or []) if status == 200 and isinstance(pvcs, dict) else []
    in_use = collections.defaultdict(list)
    for p in pods:
        for v in (p.get("spec") or {}).get("volumes") or []:
            claim = (v.get("persistentVolumeClaim") or {}).get("claimName")
            if claim:
                meta = p.get("metadata") or {}
                in_use[(meta.get("namespace"), claim)].append(meta.get("name"))

    def pv_row(pv):
        meta, spec, st = pv.get("metadata") or {}, pv.get("spec") or {}, pv.get("status") or {}
        ref = spec.get("claimRef") or {}
        users = in_use.get((ref.get("namespace"), ref.get("name"))) or []
        return {"name": meta.get("name"), "claim": "%s/%s" % (ref.get("namespace"), ref.get("name")) if ref else None,
                "phase": st.get("phase"), "capacity": (spec.get("capacity") or {}).get("storage"),
                "capacityBytes": QUANTITY((spec.get("capacity") or {}).get("storage")),
                "accessModes": spec.get("accessModes") or [],
                "reclaimPolicy": spec.get("persistentVolumeReclaimPolicy"),
                "driver": (spec.get("csi") or {}).get("driver"), "usedBy": users,
                "user": (meta.get("annotations") or {}).get("platform.coder/username")}

    by_class = collections.defaultdict(list)
    for pv in pvs:
        by_class[(pv.get("spec") or {}).get("storageClassName") or ""].append(pv_row(pv))
    classes = []
    for sc in classes_raw:
        meta = sc.get("metadata") or {}
        ann = meta.get("annotations") or {}
        rows = by_class.pop(meta.get("name"), [])
        pending = [c for c in pvcs if (c.get("spec") or {}).get("storageClassName") == meta.get("name")
                   and (c.get("status") or {}).get("phase") == "Pending"]
        classes.append({
            "name": meta.get("name"), "provisioner": sc.get("provisioner"),
            "default": "true" in (ann.get("storageclass.kubernetes.io/is-default-class"),
                                  ann.get("storageclass.beta.kubernetes.io/is-default-class")),
            "reclaimPolicy": sc.get("reclaimPolicy") or "Delete",
            "bindingMode": sc.get("volumeBindingMode") or "Immediate",
            "expansion": bool(sc.get("allowVolumeExpansion")), "volumes": len(rows),
            "bound": sum(1 for r in rows if r["phase"] == "Bound"),
            "capacityBytes": sum(r["capacityBytes"] or 0 for r in rows if r["phase"] == "Bound"),
            "claims": sorted((r["claim"] for r in rows if r["claim"] and r["phase"] == "Bound"))[:40],
            "pending": ["%s/%s" % (NAMESPACE, (c.get("metadata") or {}).get("name")) for c in pending],
        })
    static = [r for rows in by_class.values() for r in rows]
    cloud = None
    if SAFE is not None:
        cloud = cloud_drive(pods, [r for r in static if (r["name"] or "").startswith(SAFE.CLAIM_PREFIX)],
                            [r for r in static if r["driver"] == SAFE.CSI_DRIVER], drivers)
    return {
        "classes": sorted(classes, key=lambda c: (not c["default"], c["name"] or "")),
        "static": {"volumes": len(static), "bound": sum(1 for r in static if r["phase"] == "Bound"),
                   "drivers": sorted({r["driver"] for r in static if r["driver"]})},
        "volumesReadable": pv_ok,
        "csiDrivers": None if drivers is None else [{
            "name": (d.get("metadata") or {}).get("name"),
            "attachRequired": (d.get("spec") or {}).get("attachRequired"),
            "podInfoOnMount": (d.get("spec") or {}).get("podInfoOnMount"),
            "modes": (d.get("spec") or {}).get("volumeLifecycleModes") or []} for d in drivers],
        "cloudDrive": cloud,
    }


def cloud_drive(pods, user_volumes, driver_volumes, drivers):
    """The Cloud Drive's pieces: where its files are (never the keys), whether the backend answers, the CSI driver and
    its node plugin on each node, MinIO and its volume, and every account's volume (coder-safe-<user id>)."""
    labels_of = lambda p: (p.get("metadata") or {}).get("labels") or {}  # noqa: E731
    try:
        b = SAFE.backend()
        backend = {k: b.get(k) for k in ("source", "kind", "endpoint", "bucket", "region")}
    except Exception as e:  # noqa: BLE001
        backend = {"error": str(e)[:200]}
    st = dict(getattr(SAFE, "_status", {}) or {})
    try:
        quota = round(SAFE.quota_bytes() / 1024 ** 3, 1)
    except Exception:  # noqa: BLE001
        quota = None
    phases = collections.Counter(r["phase"] or "Unknown" for r in user_volumes)
    libraries = [r for r in driver_volumes if not (r["name"] or "").startswith(SAFE.CLAIM_PREFIX)
                 and not (r["name"] or "").startswith(getattr(SAFE, "SOURCE_PREFIX", "coder-drive-src-"))]
    return {
        "enabled": bool(getattr(SAFE, "ENABLED", False)), "backend": backend,
        "status": {k: st.get(k) for k in ("connected", "error", "latencyMs", "checkedAt")},
        "quotaGiB": quota, "csiDriver": SAFE.CSI_DRIVER,
        "driverInstalled": None if drivers is None else any(
            (d.get("metadata") or {}).get("name") == SAFE.CSI_DRIVER for d in drivers),
        "plugin": [_brief(p) for p in pods if labels_of(p).get("app.kubernetes.io/name") == "coder-user-storage-csi"],
        "minio": [_brief(p) for p in pods if labels_of(p).get("app.kubernetes.io/name") == "coder-user-storage-minio"],
        "volumes": {"total": len(user_volumes), "byPhase": dict(phases),
                    "inUse": sum(1 for r in user_volumes if r["usedBy"]),
                    "items": sorted(user_volumes, key=lambda r: (
                        r["phase"] != "Bound", not r["usedBy"], r["user"] or "", r["name"] or ""))},
        "libraries": libraries,
    }


def ha_and_storage():
    pods = list(SNAPSHOT()["pods"])
    out = {"generatedAt": now_iso(), "codeServerHA": ha_report(pods)}
    try:
        out["storage"] = storage_report(pods)
    except Exception as e:  # noqa: BLE001 - code-server HA still
        out["storage"] = None
        out["storageError"] = str(e)[:300]
    return out


# ---------------------------------------------------------------------------------------------------- HTTP
def handle(h, method, path, query):
    """True when it answered (the paths under /api/network/)."""
    if not path.startswith(BASE + "/api/network/"):
        return False
    if method != "GET":
        h.send_json(405, {"error": "method not allowed"})
        return True
    user, err = h.user(admin=True)
    if err:
        return True
    try:
        if path == BASE + "/api/network/entity":
            return h.send_json(200, entity(h.token(), query)) or True
        if path == BASE + "/api/network/ha":
            return h.send_json(200, ha_and_storage()) or True
        if path == BASE + "/api/network/mesh":
            return h.send_json(200, MESH.report(h.token())) or True
        return h.send_json(404, {"error": "not found"}) or True
    except ValueError as e:
        return h.send_json(400, {"error": str(e)}) or True
    except LookupError as e:
        return h.send_json(404, {"error": str(e)}) or True
    except Exception as e:  # noqa: BLE001
        if LOG:
            LOG(event="cluster-network-failed", path=path, error=str(e)[:300])
        return h.send_json(503, {"error": str(e)[:300]}) or True
