"""Reviewed organization-scoped workspace stop operations, preserving all storage.

Coder owns graceful lifecycle. Force termination additionally fences supported
Kubernetes Deployments until the captured build and its stop build converge.
"""
import concurrent.futures
import fcntl
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
import uuid

BASE = "/__coder-ui/api"
FILE = os.environ.get("WORKSPACE_POWER_FILE", "/data/workspace-power.json")
NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
ROUTE = re.compile(r"^" + BASE + r"/organizations/([0-9a-f-]{36})/workspace-power(?:/operation/([0-9a-f-]{36}))?$")
MAX_TARGETS = 100
TIMEOUT = 180
TERMINAL = {"stopped", "skipped", "unsupported", "error"}
HTTP_JSON = WORKSPACE_INFO = KUBE = LOG = None
CODER_URL = ""
ADMIN_ROLES = set()
_LOCK = threading.Lock()


class Unsupported(RuntimeError):
    pass


class Conflict(RuntimeError):
    pass


class CoderError(RuntimeError):
    def __init__(self, status, method, path):
        super().__init__("Coder rejected %s %s (HTTP %s)." % (method, path, status))
        self.status = status


def setup(http_json, workspace_info, kube, coder_url, admin_roles, log):
    global HTTP_JSON, WORKSPACE_INFO, KUBE, CODER_URL, ADMIN_ROLES, LOG
    HTTP_JSON, WORKSPACE_INFO, KUBE = http_json, workspace_info, kube
    CODER_URL, ADMIN_ROLES, LOG = coder_url.rstrip("/"), set(admin_roles), log
    def interrupted(data):
        for operation in data.values():
            if operation["status"] == "running":
                operation.update(status="interrupted", finished_at=time.time())
                for result in operation["workspaces"]:
                    if result["status"] not in TERMINAL:
                        result.update(status="error", error="Service restarted. Review current workspace state before retrying.")
    store(interrupted)


def store(change):
    """Run a short state-only transaction; never keep bearer tokens on disk."""
    os.makedirs(os.path.dirname(FILE) or ".", exist_ok=True)
    with _LOCK, open(FILE + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(FILE) as source:
                data = json.load(source)
        except FileNotFoundError:
            data = {}
        result = change(data)
        finished = sorted((op for op in data.values() if op["status"] != "running"),
                          key=lambda op: op["created_at"], reverse=True)
        # Keep the most recent twenty completed operations for each organization.
        counts = {}
        for operation in finished:
            oid = operation["organization_id"]
            counts[oid] = counts.get(oid, 0) + 1
            if counts[oid] > 20:
                data.pop(operation["id"], None)
        fd, temporary = tempfile.mkstemp(dir=os.path.dirname(FILE) or ".")
        try:
            with os.fdopen(fd, "w") as destination:
                json.dump(data, destination)
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
        return result


def identifier(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Expected a workspace or organization UUID.") from None


def coder(token, method, path, body=None):
    status, result = HTTP_JSON(CODER_URL + "/api/v2" + path, method=method, body=body,
                              headers={"Coder-Session-Token": token}, timeout=5)
    if not 200 <= status < 300:
        raise CoderError(status, method, path)
    return result


def permissions(token, workspaces, action):
    for offset in range(0, len(workspaces), 10):
        checks = {w["id"]: {"action": action, "object": {"resource_type": "workspace", "resource_id": w["id"],
                  "owner_id": w["owner_id"], "organization_id": w["organization_id"]}}
                  for w in workspaces[offset:offset + 10]}
        result = coder(token, "POST", "/authcheck", {"checks": checks})
        if not isinstance(result, dict) or any(result.get(key) is not True for key in checks):
            raise PermissionError("Your session cannot %s every reviewed workspace." % action)


def public(operation):
    result = {k: operation[k] for k in ("id", "organization_id", "action", "status", "created_at", "workspaces")}
    result["workspaces"] = [{k: value for k, value in w.items() if k not in (
        "owner_id", "organization_id", "captured_build_id", "template_version_id", "stop_build_id"
    )} for w in operation["workspaces"]]
    result.update(total=len(operation["workspaces"]),
                  completed=sum(w["status"] in TERMINAL for w in operation["workspaces"]))
    if operation.get("finished_at") is not None:
        result["finished_at"] = operation["finished_at"]
    return result


def read_operation(oid, operation_id):
    def read(data):
        operation = data.get(operation_id)
        if not operation or operation["organization_id"] != oid:
            raise LookupError("Workspace operation not found.")
        return operation
    return store(read)


def update(operation_id, workspace_id=None, **fields):
    def apply(data):
        operation = data[operation_id]
        target = operation if workspace_id is None else next(w for w in operation["workspaces"] if w["id"] == workspace_id)
        target.update(fields)
    store(apply)


def start(token, user, oid, body):
    action = body.get("action")
    if action not in ("shutdown", "terminate") or body.get("confirmation") != action:
        raise ValueError("Confirm the exact shutdown or terminate action.")
    ids = body.get("workspace_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_TARGETS:
        raise ValueError("Review between 1 and 100 workspace IDs per organization.")
    ids = [identifier(wid) for wid in ids]
    if len(set(ids)) != len(ids):
        raise ValueError("Workspace IDs must be unique.")
    targets = []
    for wid in ids:
        ws = WORKSPACE_INFO(token, wid)
        if not ws or ws.get("organization_id") != oid or ws.get("is_prebuild"):
            raise LookupError("A reviewed workspace is unavailable in this organization.")
        build = ws["latest_build"]
        if build.get("transition") == "delete" or build.get("status") in ("deleting", "deleted"):
            raise ValueError("A reviewed workspace is being deleted. Refresh the list.")
        targets.append({"id": wid, "name": ws["name"], "owner_name": ws["owner_name"],
                        "owner_id": ws["owner_id"], "organization_id": oid,
                        "captured_build_id": build["id"], "template_version_id": build["template_version_id"],
                        "status": "pending", "coder_status": build["status"], "physical_verified": None,
                        "force_requested": False, "runtime_objects_removed": None})
    permissions(token, targets, "update")
    operation = {"id": str(uuid.uuid4()), "organization_id": oid, "action": action, "status": "running",
                 "created_at": time.time(), "created_by": user["id"], "workspaces": targets}
    def insert(data):
        if any(op["organization_id"] == oid and op["status"] == "running" for op in data.values()):
            raise Conflict("Another workspace stop operation is running in this organization.")
        if sum(op["status"] == "running" for op in data.values()) >= 4:
            raise Conflict("Four workspace operations are already running. Try again after they finish.")
        data[operation["id"]] = operation
    store(insert)
    LOG(event="workspace-power-started", operation=operation["id"], organization=oid, action=action,
        workspaces=len(targets), by=user["id"])
    threading.Thread(target=run, args=(token, operation), daemon=True, name="workspace-power").start()
    return public(operation)


def resources(wid):
    selector = urllib.parse.quote("com.coder.workspace.id=" + wid)
    objects = []
    for group in ("/apis/apps/v1/namespaces/%s/deployments", "/api/v1/namespaces/%s/pods"):
        status, result = KUBE.call("GET", (group % NAMESPACE) + "?labelSelector=" + selector)
        if status != 200 or not isinstance(result, dict):
            raise RuntimeError("Could not inspect workspace runtime (Kubernetes HTTP %s)." % status)
        objects.append(result.get("items", []))
    return objects


def force_runtime(wid):
    """Fence only UUID-labeled Deployments and their verified ReplicaSet pods."""
    deployments, pods = resources(wid)
    if not deployments and pods:
        raise Unsupported("Force termination supports labeled Kubernetes Deployments only.")
    if not deployments and not pods:
        return None
    uids = {deployment["metadata"]["uid"] for deployment in deployments}
    nodes = set()
    for pod in pods:
        owners = pod["metadata"].get("ownerReferences", [])
        owner = next((o for o in owners if o.get("controller")), None)
        if not owner or owner.get("kind") != "ReplicaSet":
            raise Unsupported("Workspace pod has an unsupported runtime controller.")
        status, replica = KUBE.call("GET", "/apis/apps/v1/namespaces/%s/replicasets/%s" % (NAMESPACE, owner["name"]))
        if status != 200 or replica.get("metadata", {}).get("uid") != owner["uid"] or not any(
            o.get("kind") == "Deployment" and o.get("uid") in uids and o.get("controller")
            for o in replica.get("metadata", {}).get("ownerReferences", [])
        ):
            raise Unsupported("Workspace pod does not belong to a reviewed Deployment.")
        if pod.get("spec", {}).get("nodeName"):
            nodes.add(pod["spec"]["nodeName"])
    reachable = True
    for node in nodes:
        status, result = KUBE.call("GET", "/api/v1/nodes/" + urllib.parse.quote(node, safe=""))
        if status != 200 or not any(c.get("type") == "Ready" and c.get("status") == "True"
                                    for c in result.get("status", {}).get("conditions", [])):
            reachable = False
    for deployment in deployments:
        metadata = deployment["metadata"]
        if deployment.get("spec", {}).get("replicas", 1) == 0:
            continue
        patch = [{"op": "test", "path": "/metadata/uid", "value": metadata["uid"]},
                 {"op": "test", "path": "/metadata/resourceVersion", "value": metadata["resourceVersion"]},
                 {"op": "add", "path": "/spec/replicas", "value": 0}]
        status, _ = KUBE.call("PATCH", "/apis/apps/v1/namespaces/%s/deployments/%s" % (NAMESPACE, metadata["name"]),
                              patch, "application/json-patch+json")
        if status != 200:
            raise RuntimeError("Deployment changed or refused force termination (Kubernetes HTTP %s)." % status)
    for pod in pods:
        metadata = pod["metadata"]
        status, _ = KUBE.call("DELETE", "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, metadata["name"]),
                              {"apiVersion": "v1", "kind": "DeleteOptions", "gracePeriodSeconds": 0,
                               "preconditions": {"uid": metadata["uid"]}})
        if status not in (200, 202, 404):
            raise RuntimeError("Workspace pod refused force termination (Kubernetes HTTP %s)." % status)
    _, remaining = resources(wid)
    return not remaining, reachable


def stop_one(token, operation, target):
    wid, oid, action = target["id"], operation["organization_id"], operation["action"]
    deadline = time.monotonic() + TIMEOUT
    stop_id = None
    canceled = False
    physical = None
    unreachable = False
    removed = None
    try:
        while time.monotonic() < deadline:
            ws = coder(token, "GET", "/workspaces/" + wid)
            if ws.get("organization_id") != oid:
                raise RuntimeError("Workspace organization changed; no further action taken.")
            build = ws["latest_build"]
            if build["id"] not in (target["captured_build_id"], stop_id):
                raise RuntimeError("Another workspace build started; no further action taken.")
            permissions(token, [target], "update")
            update(operation["id"], wid, coder_status=build["status"], status="stopping")
            if action == "terminate":
                outcome = force_runtime(wid)
                if outcome is None and build["status"] != "stopped" and physical is None:
                    raise Unsupported("No supported Kubernetes Deployment runtime was found for force termination.")
                if outcome is None and physical is not None:
                    removed = True
                    update(operation["id"], wid, runtime_objects_removed=True)
                if outcome is not None:
                    removed, reachable = outcome
                    unreachable = unreachable or not reachable
                    physical = False
                    update(operation["id"], wid, force_requested=True, runtime_objects_removed=removed,
                           physical_verified=False)
            if build["status"] == "stopped":
                status = "skipped" if stop_id is None and physical is None else "stopped"
                if action == "terminate" and (unreachable or removed is False):
                    raise RuntimeError("Coder stopped, but Kubernetes runtime removal or node reachability is unverified.")
                update(operation["id"], wid, status=status, coder_status="stopped", physical_verified=physical)
                return
            if build["status"] in ("pending", "starting", "stopping", "canceling"):
                if build["transition"] == "stop":
                    stop_id = build["id"]
                elif not canceled and build["status"] != "canceling":
                    job_status = "pending" if build["status"] == "pending" else "running"
                    try:
                        coder(token, "PATCH", "/workspacebuilds/%s/cancel?expect_status=%s" % (build["id"], job_status))
                        canceled = True
                    except CoderError as error:
                        if error.status != 412:
                            raise
            elif stop_id is not None:
                raise RuntimeError("Coder stop build finished with status %s." % build["status"])
            else:
                params = coder(token, "GET", "/workspacebuilds/%s/parameters" % target["captured_build_id"])
                stopped = coder(token, "POST", "/workspaces/%s/builds" % wid,
                    {"transition": "stop", "template_version_id": target["template_version_id"],
                     "rich_parameter_values": [{"name": p["name"], "value": p["value"]} for p in params]})
                stop_id = stopped["id"]
                update(operation["id"], wid, stop_build_id=stop_id)
            time.sleep(1)
        raise RuntimeError("Stop did not converge within three minutes. Review current workspace state.")
    except Unsupported as error:
        update(operation["id"], wid, status="unsupported", error=str(error), physical_verified=False)
    except Exception as error:
        update(operation["id"], wid, status="error", error=str(error)[:500], physical_verified=physical)


def run(token, operation):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda target: stop_one(token, operation, target), operation["workspaces"]))
    current = read_operation(operation["organization_id"], operation["id"])
    success = all(result["status"] in ("stopped", "skipped") for result in current["workspaces"])
    update(operation["id"], status="completed" if success else "partial", finished_at=time.time())
    LOG(event="workspace-power-completed", operation=operation["id"], organization=operation["organization_id"],
        action=operation["action"], status="completed" if success else "partial")


def handle(h, method, path, query=""):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    try:
        if method == "POST" and not h.csrf_ok():
            raise PermissionError("Request rejected (cross-site protection).")
        user, err = h.user(admin=True)
        if err:
            return True
        oid, operation_id = identifier(match.group(1)), match.group(2)
        if method == "POST" and operation_id is None:
            length = int(h.headers.get("Content-Length", "0"))
            if not 0 <= length <= 16384:
                raise ValueError("Request body is too large.")
            body = json.loads(h.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object.")
            h.send_json(202, start(h.token(), user, oid, body))
        elif method == "GET":
            operations = [read_operation(oid, identifier(operation_id))] if operation_id else store(
                lambda data: [op for op in data.values() if op["organization_id"] == oid])
            visible = []
            for operation in operations:
                try:
                    for target in operation["workspaces"]:
                        ws = WORKSPACE_INFO(h.token(), target["id"])
                        if not ws or ws.get("organization_id") != oid:
                            raise PermissionError("Your session cannot read every workspace in this operation.")
                    permissions(h.token(), operation["workspaces"], "read")
                    visible.append(operation)
                except PermissionError:
                    if operation_id:
                        raise
            operations = visible
            operations = sorted(operations, key=lambda op: op["created_at"], reverse=True)
            h.send_json(200, public(operations[0]) if operation_id else {"operations": [public(op) for op in operations]})
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
        h.send_json(503, {"error": "Workspace power operation could not be verified or persisted."})
    return True
