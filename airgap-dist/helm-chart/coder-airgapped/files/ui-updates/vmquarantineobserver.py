"""Observe managed VM process absence without entering a workspace or executing tools."""
from datetime import datetime, timezone
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request

ANNOTATION = "platform.coder/quarantine-host-proof"
TARGETS = "coder-workspace-quarantine-targets"
MAX_TARGET_BYTES = 1024 * 1024
MAX_PROOF_BYTES = 64 * 1024
MAX_PROCESSES = 32768
MAX_SCAN_SECONDS = 3
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
DNS = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\Z")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(UUID, value):
        raise ValueError("Invalid observation identity")
    return value


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate observation field")
        result[key] = value
    return result


def bounded_read(path, limit):
    with open(path, "rb") as source:
        value = source.read(limit + 1)
    if len(value) > limit:
        raise ValueError("Observation read exceeds bound")
    return value


def targets(raw, node_name):
    if len(raw) > MAX_TARGET_BYTES:
        raise ValueError("Quarantine target document exceeds bound")
    value = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(value, dict) or len(value) > 512:
        raise ValueError("Invalid quarantine target document")
    selected = {}
    required = {"revision", "vm_uid", "node_name", "node_uid", "launcher_pod_uids"}
    for workspace, target in value.items():
        identifier(workspace)
        if not isinstance(target, dict) or not required <= target.keys() or target.keys() - required - {"vmi_uid", "firmware_uuid"}:
            raise ValueError("Invalid quarantine target fields")
        for key in ("revision", "vm_uid", "node_uid"):
            identifier(target[key])
        for key in ("vmi_uid", "firmware_uuid"):
            if key in target:
                identifier(target[key])
        if not isinstance(target["node_name"], str) or not DNS.fullmatch(target["node_name"]):
            raise ValueError("Invalid quarantine node identity")
        pods = target["launcher_pod_uids"]
        if not isinstance(pods, list) or len(pods) > 16 or any(not isinstance(pod, str) for pod in pods) or len(set(pods)) != len(pods):
            raise ValueError("Invalid quarantine launcher identities")
        for pod in pods:
            identifier(pod)
        if target["node_name"] == node_name:
            selected[workspace] = target
    if len(selected) > 64:
        raise ValueError("Node quarantine target count exceeds bound")
    return selected


def qemu_identity(argv, namespace):
    args = argv.decode("utf-8", "strict").split("\0")
    names = []
    for index, arg in enumerate(args):
        if arg == "-name" and index + 1 < len(args):
            names.append(args[index + 1])
        elif arg.startswith("-name="):
            names.append(arg[6:])
    if len(names) != 1:
        raise ValueError("QEMU identity unavailable")
    name = names[0].split(",", 1)[0]
    if name.startswith("guest="):
        name = name[6:]
    match = re.fullmatch(re.escape(namespace) + r"_coder-vm-(" + UUID + r")", name)
    if not match:
        raise ValueError("QEMU identity unavailable")
    firmware = [args[index + 1] for index, arg in enumerate(args[:-1]) if arg == "-uuid"]
    if len(firmware) != 1:
        raise ValueError("QEMU firmware identity unavailable")
    return match.group(1), identifier(firmware[0])


def processes(proc, namespace, monotonic=time.monotonic):
    """Return observed identities; any incomplete live-process scan fails closed."""
    # A hidden host PID tree cannot establish absence.
    bounded_read(os.path.join(proc, "1/comm"), 128)
    bounded_read(os.path.join(proc, "1/cgroup"), 64 * 1024)
    deadline = monotonic() + MAX_SCAN_SECONDS
    workspaces, pods, firmwares = set(), set(), set()
    count = 0
    with os.scandir(proc) as entries:
        for entry in entries:
            if not entry.name.isascii() or not entry.name.isdigit():
                continue
            count += 1
            if count > MAX_PROCESSES or monotonic() > deadline:
                raise ValueError("Process observation exceeds bound")
            directory = os.path.join(proc, entry.name)
            try:
                comm = bounded_read(directory + "/comm", 128).decode("utf-8", "strict").strip()
                cgroup = bounded_read(directory + "/cgroup", 64 * 1024).decode("utf-8", "strict")
                for pod in re.findall(r"(?:^|[/.-])pod(" + UUID + r")(?=[/.\n]|$)", cgroup.replace("_", "-")):
                    pods.add(pod.replace("_", "-"))
                if comm in {"qemu", "qemu-kvm", "kvm"} or comm.startswith("qemu-system-"):
                    workspace, firmware = qemu_identity(bounded_read(directory + "/cmdline", 64 * 1024), namespace)
                    workspaces.add(workspace)
                    firmwares.add(firmware)
            except (OSError, ValueError, UnicodeError):
                if os.path.exists(directory):
                    raise ValueError("Live process identity unavailable") from None
    return workspaces, pods, firmwares


def observation(selected, node_uid, boot_id, api_boot_id, namespace, proc="/proc", now=None):
    identifier(node_uid)
    identifier(boot_id)
    verified_scan = boot_id == api_boot_id
    workspaces, pods, firmwares = set(), set(), set()
    if verified_scan and selected:
        try:
            workspaces, pods, firmwares = processes(proc, namespace)
        except (OSError, ValueError):
            verified_scan = False
    proof = {"node_uid": node_uid, "boot_id": boot_id,
             "collected_at": (now or datetime.now(timezone.utc)).isoformat(), "targets": {}}
    for workspace, target in selected.items():
        same_node = target["node_uid"] == node_uid
        qemu_absent = verified_scan and same_node and workspace not in workspaces and target.get("firmware_uuid") not in firmwares
        cgroups_absent = verified_scan and same_node and not (set(target["launcher_pod_uids"]) & pods)
        entry = {key: target[key] for key in ("revision", "vm_uid", "launcher_pod_uids")}
        for key in ("vmi_uid", "firmware_uuid"):
            if key in target:
                entry[key] = target[key]
        entry.update(qemu_absent=qemu_absent, cgroups_absent=cgroups_absent,
                     verified=qemu_absent and cgroups_absent)
        proof["targets"][workspace] = entry
    if len(json.dumps(proof, separators=(",", ":")).encode()) > MAX_PROOF_BYTES:
        raise ValueError("Quarantine proof exceeds bound")
    return proof


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def publish():
    node_name = os.environ["NODE_NAME"]
    runtime_namespace = os.environ["RUNTIME_NAMESPACE"]
    workspace_namespace = os.environ["WORKSPACE_NAMESPACE"]
    if any(not DNS.fullmatch(value) for value in (node_name, runtime_namespace, workspace_namespace)):
        raise ValueError("Invalid observer placement")
    sa = "/var/run/secrets/kubernetes.io/serviceaccount"
    context = ssl.create_default_context(cafile=sa + "/ca.crt")
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect())
    host = os.environ["KUBERNETES_SERVICE_HOST"]
    host = "[%s]" % host if ":" in host else host
    base = "https://%s:%s" % (host, os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443"))
    headers = {"Authorization": "Bearer " + bounded_read(sa + "/token", 16384).decode().strip()}

    def get(path):
        with opener.open(urllib.request.Request(base + path, headers=headers), timeout=5) as response:
            raw = response.read(2 * MAX_TARGET_BYTES + 1)
        if len(raw) > 2 * MAX_TARGET_BYTES:
            raise ValueError("Observation API response exceeds bound")
        return json.loads(raw, object_pairs_hook=unique)

    node_path = "/api/v1/nodes/" + urllib.parse.quote(node_name, safe="")
    node = get(node_path)
    document = get("/api/v1/namespaces/%s/configmaps/%s" % (urllib.parse.quote(runtime_namespace, safe=""), TARGETS))
    selected = targets(document["data"]["targets.json"].encode(), node_name)
    boot_id = bounded_read("/proc/sys/kernel/random/boot_id", 64).decode().strip()
    value = observation(selected, node["metadata"]["uid"], boot_id,
                        node.get("status", {}).get("nodeInfo", {}).get("bootID"), workspace_namespace)
    body = {"metadata": {"uid": node["metadata"]["uid"], "resourceVersion": node["metadata"]["resourceVersion"],
                         "annotations": {ANNOTATION: json.dumps(value, separators=(",", ":"))}}}
    headers["Content-Type"] = "application/merge-patch+json"
    request = urllib.request.Request(base + node_path, data=json.dumps(body).encode(), headers=headers, method="PATCH")
    with opener.open(request, timeout=5) as response:
        response.read(2 * MAX_TARGET_BYTES)


if __name__ == "__main__":
    while True:
        try:
            publish()
        except Exception:
            # Stale or missing proof cannot authorize isolation; never log process/API content.
            print("Quarantine host observation unavailable; retrying.", flush=True)
        time.sleep(2)
