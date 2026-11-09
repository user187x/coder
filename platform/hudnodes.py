"""The HUD's node strip: one entry per Kubernetes node with its health, addresses, metadata, resources and pods."""

# Long annotation values (k3s and flannel store JSON there) are cut so the HUD response stays small.
VALUE_LIMIT = 200
# The pods listed per node (the count is always whole).
POD_LIMIT = 300


def health(node):
    """down: not Ready; warning: Ready but under a pressure condition or cordoned; ok otherwise."""
    status = node.get("status") or {}
    conditions = status.get("conditions") or []
    if not any(c.get("type") == "Ready" and c.get("status") == "True" for c in conditions):
        return "down"
    if pressure(conditions) or (node.get("spec") or {}).get("unschedulable"):
        return "warning"
    return "ok"


def pressure(conditions):
    return [c.get("type") for c in conditions if c.get("type") != "Ready" and c.get("status") == "True"]


def _cut(values):
    return {key: str(value)[:VALUE_LIMIT] for key, value in sorted((values or {}).items())}


def _requests(pod, resource, quantity):
    total = 0
    for container in (pod.get("spec") or {}).get("containers") or []:
        value = ((container.get("resources") or {}).get("requests") or {}).get(resource)
        total += (quantity(value) or 0) if value is not None else 0
    return total


def summarize(nodes, pods=None, usage=None, quantity=None):
    """[{name, uid, resourceVersion, health, ip, internalIP, externalIP, roles, pressure, unschedulable, taints, kubelet,
    created, labels, annotations, resources, podCount, pods}] sorted by name. resources (with quantity): cpu in cores,
    memory in bytes, each {allocatable, allocated (the pods' requests), used (live, None without metrics-server)}."""
    by_node = {}
    for pod in pods or []:
        node_name = (pod.get("spec") or {}).get("nodeName")
        if node_name:
            by_node.setdefault(node_name, []).append(pod)
    out = []
    for node in nodes or []:
        meta = node.get("metadata") or {}
        status = node.get("status") or {}
        labels = meta.get("labels") or {}
        addresses = {}
        for address in status.get("addresses") or []:
            addresses.setdefault(address.get("type"), address.get("address"))
        name = meta.get("name") or ""
        on_node = by_node.get(name, [])
        resources = None
        if quantity is not None:
            allocatable = status.get("allocatable") or {}
            live = (usage or {}).get(name) if usage is not None else None
            resources = {resource: {
                "allocatable": quantity(allocatable.get(resource)) or 0,
                "allocated": sum(_requests(p, resource, quantity) for p in on_node),
                "used": (quantity(live.get(resource)) or 0) if live else None,
            } for resource in ("cpu", "memory")}
        out.append({
            "name": name,
            "uid": meta.get("uid"),
            "resourceVersion": meta.get("resourceVersion"),
            "health": health(node),
            "ip": addresses.get("InternalIP") or addresses.get("ExternalIP"),
            "internalIP": addresses.get("InternalIP"),
            "externalIP": addresses.get("ExternalIP"),
            "taints": [{k: t.get(k) for k in ("key", "value", "effect") if t.get(k) is not None}
                       for t in (node.get("spec") or {}).get("taints") or []],
            "resources": resources,
            "podCount": len(on_node),
            "pods": sorted(({"namespace": (p.get("metadata") or {}).get("namespace"),
                             "name": (p.get("metadata") or {}).get("name"),
                             "phase": (p.get("status") or {}).get("phase")} for p in on_node),
                           key=lambda p: (p["namespace"] or "", p["name"] or ""))[:POD_LIMIT],
            "roles": sorted(key.split("/", 1)[1] for key in labels
                            if key.startswith("node-role.kubernetes.io/") and key.split("/", 1)[1]) or ["worker"],
            "pressure": pressure(status.get("conditions") or []),
            "unschedulable": bool((node.get("spec") or {}).get("unschedulable")),
            "kubelet": (status.get("nodeInfo") or {}).get("kubeletVersion"),
            "created": meta.get("creationTimestamp"),
            "labels": _cut(labels),
            "annotations": _cut(meta.get("annotations")),
        })
    return sorted(out, key=lambda entry: entry["name"])
