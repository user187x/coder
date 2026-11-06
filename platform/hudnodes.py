"""The HUD's node strip: one entry per Kubernetes node with its health, address and metadata."""

# Long annotation values (k3s and flannel store JSON there) are cut so the HUD response stays small.
VALUE_LIMIT = 200


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


def summarize(nodes):
    """[{name, health, ip, roles, pressure, unschedulable, kubelet, created, labels, annotations}] sorted by name."""
    out = []
    for node in nodes or []:
        meta = node.get("metadata") or {}
        status = node.get("status") or {}
        labels = meta.get("labels") or {}
        addresses = {}
        for address in status.get("addresses") or []:
            addresses.setdefault(address.get("type"), address.get("address"))
        out.append({
            "name": meta.get("name") or "",
            "health": health(node),
            "ip": addresses.get("InternalIP") or addresses.get("ExternalIP"),
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
