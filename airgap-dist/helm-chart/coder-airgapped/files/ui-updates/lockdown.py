"""Lock Down: admins jail a workspace, for instance when an agent in it runs away. Four modes:

  network   the workspace can reach nothing but Coder: its agent stays connected, so admins can still open its
            terminal and apps and see what runs in it; everything else in or out is refused, open connections too
  sudo      nobody in the workspace can use sudo any more (a last sudoers rule denies every command)
  complete  both
  freeze    complete, and every process in the workspace paused where it is (Coder's agent too: nobody can open a
            session in it); its disk is copied as it is at that moment (the snapshot), for the admins to look at.
            Lifting it resumes the processes; the snapshot stays until an admin deletes it (or freezes it again)

It works on a running workspace, without a restart, so its processes keep running for the admins to inspect, and on a
stopped one, from its next start on. It stays until an admin lifts it.

  GET  /__coder-ui/api/lockdown                  admins: every locked workspace {workspace id: state}
  GET  /__coder-ui/api/lockdown/<workspace id>   the workspace's state (its owner and admins; the snapshot: admins)
  POST /__coder-ui/api/lockdown/<workspace id>   admins: {mode: network | sudo | complete | freeze | off}
  POST /__coder-ui/api/lockdown/<workspace id>/snapshot/delete   admins: the workspace's snapshot deleted

The settings are the ConfigMap coder-lockdown (made at the first lock; Helm and Argo CD do not manage it): key
<workspace id> = "network,sudo" (what the workspace template's pod reads at start: its init container sets Network,
a start script that blocks login sets Sudo), key <workspace id>.meta = who set it, when, and the workspace's name.
A running pod gets the setting at once from an ephemeral container: the workspace's own image, root with NET_ADMIN
(the pod's network namespace) and SYS_PTRACE (the workspace container's files, through its processes), running
lockdown.sh. The pod's annotation platform.coder/lockdown says what was applied; a watcher keeps every running
workspace as the ConfigMap says (a workspace from an older template version, a restart, or this service's own), so
a lock comes back with every start until an admin lifts it: a frozen workspace that is started again is frozen again.

The snapshot (Freeze): a VolumeSnapshot of the workspace's home volume where the cluster can make one (the snapshot
API and a VolumeSnapshotClass for the volume's CSI driver, as on EKS with the EBS CSI driver), else a copy of it in a
new volume (PVC coder-freeze-<workspace>-<time>) by a Job on the workspace's node, while its processes are paused.
The processes that were running are kept with it (key <workspace id>.meta: "processes").
"""
import datetime
import json
import os
import re
import threading
import time
import urllib.parse

BASE = "/__coder-ui"
NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
CONFIGMAP = "coder-lockdown"
ANNOTATION = "platform.coder/lockdown"
MODES = {"network": "network", "sudo": "sudo", "complete": "network,sudo", "freeze": "network,sudo,freeze",
         "off": "off"}
SNAPSHOT_LABEL = "coder-lockdown/snapshot"
SNAPSHOT_API = "/apis/snapshot.storage.k8s.io/v1"
MAX_PROCESSES = 300
WATCH_SECONDS = 15
APPLY_TIMEOUT = 120
COPY_IMAGE = os.environ.get("LOCKDOWN_COPY_IMAGE", "")  # a stopped workspace's snapshot (no pod to take it from)
SCRIPT = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lockdown.sh")).read()

LOG = KUBE = WORKSPACE_INFO = None
ADMIN_ROLES = set()
CODER_HOST = ""
LOCKS = {}  # workspace id -> lock (one change at a time per workspace)
LOCKS_GUARD = threading.Lock()


def setup(log, kube, workspace_info, admin_roles, access_url):
    global LOG, KUBE, WORKSPACE_INFO, ADMIN_ROLES, CODER_HOST
    LOG, KUBE, WORKSPACE_INFO, ADMIN_ROLES = log, kube, workspace_info, set(admin_roles)
    CODER_HOST = urllib.parse.urlsplit(access_url).hostname or ""


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def lock_of(wid):
    with LOCKS_GUARD:
        return LOCKS.setdefault(wid, threading.Lock())


# --------------------------------------------------------------------------- the settings (ConfigMap)
def _configmap():
    status, cm = KUBE.call("GET", "/api/v1/namespaces/%s/configmaps/%s" % (NAMESPACE, CONFIGMAP))
    if status == 404:
        return None
    if status != 200 or not isinstance(cm, dict):
        raise RuntimeError("The Lock Down settings could not be read (Kubernetes answered %s)." % status)
    return cm


def settings():
    """{workspace id: {modes, by, at, workspace, owner, snapshot, processes}} of every locked workspace."""
    data = (_configmap() or {}).get("data") or {}
    out = {}
    for key, modes in data.items():
        if "." in key or modes in ("", "off"):
            continue
        try:
            meta = json.loads(data.get(key + ".meta") or "{}")
        except ValueError:
            meta = {}
        out[key] = dict(meta, modes=modes.split(","))
    return out


def snapshot_of(wid):
    """The workspace's snapshot (kept after the lock is lifted): {kind, name, at, claim, processes} or None."""
    try:
        return json.loads(((_configmap() or {}).get("data") or {}).get(wid + ".snapshot") or "null")
    except ValueError:
        return None


def save_snapshot(wid, snap):
    """Keeps (or, None: forgets) the workspace's snapshot record, key <workspace id>.snapshot."""
    for _ in range(5):
        cm = _configmap()
        if cm is None:
            return
        data = dict(cm.get("data") or {})
        data.pop(wid + ".snapshot", None)
        if snap:
            data[wid + ".snapshot"] = json.dumps(snap)
        cm["data"] = data
        status, _ = KUBE.call("PUT", "/api/v1/namespaces/%s/configmaps/%s" % (NAMESPACE, CONFIGMAP), cm)
        if status in (200, 201):
            return
        if status != 409:
            raise RuntimeError("The snapshot record could not be saved (Kubernetes answered %s)." % status)
        time.sleep(0.3)


def save(wid, modes, meta):
    """Sets the workspace's modes ("off": removed), retried when someone else changed the ConfigMap meanwhile."""
    for _ in range(5):
        cm = _configmap()
        if cm is None:
            body = {"apiVersion": "v1", "kind": "ConfigMap",
                    "metadata": {"name": CONFIGMAP, "namespace": NAMESPACE,
                                 "labels": {"app.kubernetes.io/part-of": "coder",
                                            "coder-ui-updates/managed": "lockdown"}},
                    "data": {}}
            if modes != "off":
                body["data"] = {wid: modes, wid + ".meta": json.dumps(meta)}
            status, _ = KUBE.call("POST", "/api/v1/namespaces/%s/configmaps" % NAMESPACE, body)
        else:
            data = dict(cm.get("data") or {})
            data.pop(wid, None)
            data.pop(wid + ".meta", None)
            if modes != "off":
                data[wid] = modes
                data[wid + ".meta"] = json.dumps(meta)
            cm["data"] = data
            status, _ = KUBE.call("PUT", "/api/v1/namespaces/%s/configmaps/%s" % (NAMESPACE, CONFIGMAP), cm)
        if status in (200, 201):
            return
        if status != 409:
            raise RuntimeError("The Lock Down settings could not be saved (Kubernetes answered %s)." % status)
        time.sleep(0.3)
    raise RuntimeError("The Lock Down settings kept changing under this save: try again.")


# --------------------------------------------------------------------------- the running pod
def running_pods(wid=None):
    """Running workspace pods (of one workspace, or all) whose workspace container runs."""
    label = "com.coder.workspace.id" + ("=" + wid if wid else "")
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
        NAMESPACE, urllib.parse.quote(label)))
    out = []
    for p in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        st = p.get("status") or {}
        dev = next((c for c in st.get("containerStatuses") or [] if c.get("name") == "dev"), None)
        if st.get("phase") == "Running" and dev and (dev.get("state") or {}).get("running") \
                and not (p.get("metadata") or {}).get("deletionTimestamp"):
            out.append(p)
    return out


def applied(pod):
    """What the service last set in the pod; None: nothing yet (a new pod, which may be locked from its start)."""
    return ((pod.get("metadata") or {}).get("annotations") or {}).get(ANNOTATION)


def started_with(pod):
    """The modes the pod was locked with at its start ("off" when none): its init container's log says (a template
    version before Lock Down has none: "off")."""
    if not any(c.get("name") == "lockdown" for c in (pod.get("spec") or {}).get("initContainers") or []):
        return "off"
    status, out = KUBE.call("GET", "/api/v1/namespaces/%s/pods/%s/log?container=lockdown&tailLines=20" % (
        NAMESPACE, pod["metadata"]["name"]))
    found = re.findall(r"^lockdown: modes (\S+)$", out if isinstance(out, str) else "", re.M)
    return found[-1] if found else None


def annotate(pod, modes):
    KUBE.call("PATCH", "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, pod["metadata"]["name"]),
              {"metadata": {"annotations": {ANNOTATION: modes}}}, patch_type="application/merge-patch+json")


def apply(pod, modes):
    """Runs lockdown.sh in an ephemeral container of the running pod: (ok, message)."""
    meta = pod["metadata"]
    name = "lockdown-%d" % int(time.time() * 1000)
    image = next((c["image"] for c in pod["spec"]["containers"] if c["name"] == "dev"), None)
    container = {
        "name": name, "image": image, "imagePullPolicy": "IfNotPresent", "targetContainerName": "dev",
        "command": ["sh", "-c", SCRIPT, "lockdown", modes, CODER_HOST, "/proc/1/root"],
        "securityContext": {"runAsUser": 0, "runAsNonRoot": False, "allowPrivilegeEscalation": False,
                            "capabilities": {"add": ["NET_ADMIN", "NET_RAW", "SYS_PTRACE"]}},
        "resources": {},
    }
    path = "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, meta["name"])
    status, res = KUBE.call("PATCH", path + "/ephemeralcontainers",
                            {"spec": {"ephemeralContainers": [container]}},
                            patch_type="application/strategic-merge-patch+json")
    if status != 200:
        return False, "The workspace's pod refused the Lock Down container (%s): %s" % (
            status, str((res or {}).get("message") if isinstance(res, dict) else res)[:300])
    deadline = time.time() + APPLY_TIMEOUT
    code = None
    while time.time() < deadline:
        status, p = KUBE.call("GET", path)
        cs = next((c for c in ((p or {}).get("status") or {}).get("ephemeralContainerStatuses") or []
                   if c.get("name") == name), None) if status == 200 else None
        term = ((cs or {}).get("state") or {}).get("terminated")
        if term:
            code = term.get("exitCode")
            break
        time.sleep(1)
    status, out = KUBE.call("GET", path + "/log?container=%s&tailLines=%d" % (name, MAX_PROCESSES + 20))
    lines = (out if isinstance(out, str) else "").strip().splitlines()
    message = lines[-1] if lines else ""
    pod["frozen"] = [ln[len("lockdown:   "):] for ln in lines if ln.startswith("lockdown:   ")][:MAX_PROCESSES]
    if code != 0:
        return False, "Lock Down did not apply in the running workspace (%s)%s" % (
            "timed out" if code is None else "exit %s" % code, ": " + message if message else "")
    annotate(pod, modes)
    return True, message


def reconcile(wid, modes, pods=None):
    """Every running pod of the workspace as `modes` says: [(pod, ok, message)]. `pods` collects the pods changed."""
    results = []
    with lock_of(wid):
        for pod in running_pods(wid):
            if applied(pod) == modes:
                results.append((pod["metadata"]["name"], True, "already in force"))
                continue
            ok, message = apply(pod, modes)
            results.append((pod["metadata"]["name"], ok, message))
            if ok and pods is not None:
                pods.append(pod)
            if LOG:
                LOG(event="lockdown-applied", workspace=wid, pod=pod["metadata"]["name"], modes=modes, ok=ok,
                    message=message[:200])
    return results


def watch_once():
    """Every running workspace pod as the settings say (a restart's new pod gets its lock back, Freeze included)."""
    wanted = {wid: ",".join(s["modes"]) for wid, s in settings().items()}
    for pod in running_pods():
        wid = ((pod.get("metadata") or {}).get("labels") or {}).get("com.coder.workspace.id")
        if not wid:
            continue
        want = wanted.get(wid, "off")
        if applied(pod) is None and want == "off" and started_with(pod) == "off":
            annotate(pod, "off")   # a new pod that never was locked: nothing to undo, no container needed
            continue
        if applied(pod) != want:
            reconcile(wid, want)


def watch():
    while True:
        try:
            watch_once()
        except Exception as e:  # noqa: BLE001 - tried again on the next round
            if LOG:
                LOG(event="lockdown-watch-failed", error=str(e)[:300])
        time.sleep(WATCH_SECONDS)


def start():
    if KUBE and KUBE.ok:
        threading.Thread(target=watch, daemon=True, name="lockdown").start()


# --------------------------------------------------------------------------- the snapshot (Freeze)
def home_claim(pod):
    """The PVC the workspace container has its home on (the volume mounted under /home)."""
    claims = {v["name"]: v["persistentVolumeClaim"]["claimName"] for v in (pod.get("spec") or {}).get("volumes") or []
              if (v.get("persistentVolumeClaim") or {}).get("claimName")}
    dev = next((c for c in pod["spec"]["containers"] if c["name"] == "dev"), {})
    mounts = sorted(dev.get("volumeMounts") or [], key=lambda m: not m.get("mountPath", "").startswith("/home"))
    return next((claims[m["name"]] for m in mounts if m.get("name") in claims), None)


def snapshot_class(pvc):
    """A VolumeSnapshotClass for the volume's CSI driver (the default one first), or None (no snapshot API here)."""
    status, pv = KUBE.call("GET", "/api/v1/persistentvolumes/%s" % ((pvc.get("spec") or {}).get("volumeName") or "-"))
    driver = ((pv or {}).get("spec") or {}).get("csi", {}).get("driver") if status == 200 else None
    if not driver:
        return None
    status, classes = KUBE.call("GET", SNAPSHOT_API + "/volumesnapshotclasses")
    if status != 200 or not isinstance(classes, dict):
        return None
    fits = [c for c in classes.get("items") or [] if c.get("driver") == driver]
    fits.sort(key=lambda c: ((c.get("metadata") or {}).get("annotations") or {}).get(
        "snapshot.storage.kubernetes.io/is-default-class") != "true")
    return fits[0]["metadata"]["name"] if fits else None


def delete_snapshot(snap):
    """Removes a snapshot (its VolumeSnapshot, or its copy volume and the Job that made it)."""
    if not snap or not snap.get("name"):
        return
    name = snap["name"]
    if snap.get("kind") == "VolumeSnapshot":
        KUBE.call("DELETE", SNAPSHOT_API + "/namespaces/%s/volumesnapshots/%s" % (NAMESPACE, name))
        return
    KUBE.call("DELETE", "/apis/batch/v1/namespaces/%s/jobs/%s?propagationPolicy=Background" % (NAMESPACE, name))
    KUBE.call("DELETE", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name))


def take_snapshot(pod, wid):
    """Starts the snapshot of the frozen pod's home volume (pod None: the stopped workspace's, by the template's
    name for it): {kind, name, at, claim} or {error}."""
    claim = home_claim(pod) if pod else "coder-%s-home" % wid
    if not claim:
        return {"error": "The workspace has no home volume to snapshot.", "at": now()}
    status, pvc = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, claim))
    if status != 200 or not isinstance(pvc, dict):
        return {"error": "Its home volume %s could not be read (%s)." % (claim, status), "at": now()}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = "coder-freeze-%s-%s" % (wid[:8], stamp)
    labels = {"app.kubernetes.io/part-of": "coder", SNAPSHOT_LABEL: wid}
    meta = {"name": name, "namespace": NAMESPACE, "labels": labels,
            "annotations": {"coder-lockdown/source": claim, "coder-lockdown/workspace": wid}}
    vsclass = snapshot_class(pvc)
    if vsclass:
        status, res = KUBE.call("POST", SNAPSHOT_API + "/namespaces/%s/volumesnapshots" % NAMESPACE, {
            "apiVersion": "snapshot.storage.k8s.io/v1", "kind": "VolumeSnapshot", "metadata": meta,
            "spec": {"volumeSnapshotClassName": vsclass, "source": {"persistentVolumeClaimName": claim}}})
        if status in (200, 201):
            return {"kind": "VolumeSnapshot", "name": name, "at": now(), "claim": claim}
    # a copy, by a Job on the workspace's node (the home volume is attached there), while its processes are paused
    spec = pvc.get("spec") or {}
    status, res = KUBE.call("POST", "/api/v1/namespaces/%s/persistentvolumeclaims" % NAMESPACE, {
        "apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": meta,
        "spec": {"accessModes": ["ReadWriteOnce"], "resources": {"requests": dict(
            (spec.get("resources") or {}).get("requests") or {"storage": "10Gi"})},
            **({"storageClassName": spec["storageClassName"]} if spec.get("storageClassName") else {})}})
    if status not in (200, 201):
        return {"error": "The snapshot volume could not be made (%s): %s" % (
            status, str((res or {}).get("message") if isinstance(res, dict) else res)[:200]), "at": now()}
    pod_spec = (pod or {}).get("spec") or {}
    image = next((c["image"] for c in pod_spec.get("containers") or [] if c["name"] == "dev"), None) or COPY_IMAGE
    node = pod_spec.get("nodeName")  # running: where its volume is attached; stopped: wherever the volume can be
    script = ("set -e; cp -a /source/. /snapshot/; mkdir -p /snapshot/.coder-freeze; "
              "printf 'Frozen by Lock Down at %s, a copy of %s (workspace %s).\n' \"$AT\" \"$CLAIM\" \"$WID\" "
              ">/snapshot/.coder-freeze/README; du -sh /snapshot | cut -f1")
    job = {
        "apiVersion": "batch/v1", "kind": "Job", "metadata": meta,
        "spec": {"backoffLimit": 1, "template": {"metadata": {"labels": labels}, "spec": {
            "restartPolicy": "Never",
            "affinity": {"nodeAffinity": {"requiredDuringSchedulingIgnoredDuringExecution": {"nodeSelectorTerms": [
                {"matchExpressions": [{"key": "kubernetes.io/hostname", "operator": "In", "values": [node]}]}]}}}
            if node else {},
            "tolerations": pod_spec.get("tolerations") or [],
            "imagePullSecrets": pod_spec.get("imagePullSecrets") or [],
            "containers": [{
                "name": "copy", "image": image, "imagePullPolicy": "IfNotPresent",
                "command": ["sh", "-c", script],
                "env": [{"name": "AT", "value": now()}, {"name": "CLAIM", "value": claim}, {"name": "WID", "value": wid}],
                "securityContext": {"runAsUser": 0, "runAsNonRoot": False, "allowPrivilegeEscalation": False},
                "volumeMounts": [{"name": "source", "mountPath": "/source", "readOnly": True},
                                 {"name": "snapshot", "mountPath": "/snapshot"}]}],
            "volumes": [{"name": "source", "persistentVolumeClaim": {"claimName": claim, "readOnly": True}},
                        {"name": "snapshot", "persistentVolumeClaim": {"claimName": name}}]}}}}
    status, res = KUBE.call("POST", "/apis/batch/v1/namespaces/%s/jobs" % NAMESPACE, job)
    if status not in (200, 201):
        KUBE.call("DELETE", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name))
        return {"error": "The snapshot copy could not start (%s): %s" % (
            status, str((res or {}).get("message") if isinstance(res, dict) else res)[:200]), "at": now()}
    return {"kind": "PersistentVolumeClaim", "name": name, "at": now(), "claim": claim}


def snapshot_status(snap):
    """"copying", "ready", "failed" or "gone", for the admins' menu."""
    if not snap or not snap.get("name"):
        return None
    if snap.get("kind") == "VolumeSnapshot":
        status, vs = KUBE.call("GET", SNAPSHOT_API + "/namespaces/%s/volumesnapshots/%s" % (NAMESPACE, snap["name"]))
        if status == 404:
            return "gone"
        st = (vs or {}).get("status") or {}
        return "failed" if st.get("error") else "ready" if st.get("readyToUse") else "copying"
    status, pvc = KUBE.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, snap["name"]))
    if status == 404:
        return "gone"
    status, job = KUBE.call("GET", "/apis/batch/v1/namespaces/%s/jobs/%s" % (NAMESPACE, snap["name"]))
    st = (job or {}).get("status") or {} if status == 200 else {}
    if status == 404 or st.get("succeeded"):
        return "ready"
    return "failed" if any(c.get("type") == "Failed" and c.get("status") == "True"
                           for c in st.get("conditions") or []) else "copying"


def freeze_snapshot(wid, frozen_pod):
    """After a freeze set by an admin: the previous snapshot replaced by a new one, with the paused processes
    (frozen_pod None: a stopped workspace, its disk as it was left)."""
    delete_snapshot(snapshot_of(wid))
    snap = dict(take_snapshot(frozen_pod, wid), processes=(frozen_pod or {}).get("frozen") or [])
    save_snapshot(wid, snap)
    if LOG:
        LOG(event="lockdown-snapshot", workspace=wid, snapshot=snap.get("name"), kind=snap.get("kind"),
            error=snap.get("error"), processes=len(snap["processes"]))
    return snap


# --------------------------------------------------------------------------- the API
def read_json(h):
    n = int(h.headers.get("Content-Length") or 0)
    data = json.loads(h.rfile.read(min(n, 65536)) or b"{}") if n else {}
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def state_of(wid, admin=False):
    s = settings().get(wid)
    pods = running_pods(wid)
    out = {"locked": bool(s), "modes": (s or {}).get("modes", []), "by": (s or {}).get("by"),
           "at": (s or {}).get("at"), "running": bool(pods),
           "inForce": all((applied(p) or "off") == ",".join((s or {}).get("modes") or ["off"]) for p in pods)
           if pods else None}
    if admin:
        snap = snapshot_of(wid)
        out["snapshot"] = dict({k: snap.get(k) for k in ("kind", "name", "at", "claim", "error")},
                               processes=len(snap.get("processes") or []),
                               status="failed" if snap.get("error") else snapshot_status(snap)) if snap else None
    return out


def handle(h, method, path, query):
    """True when it answered."""
    if not path.startswith(BASE + "/api/lockdown"):
        return False
    if method == "POST" and not h.csrf_ok():
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user()
    if err:
        return True
    admin = bool(set(user["roles"]) & ADMIN_ROLES)
    try:
        if path == BASE + "/api/lockdown" and method == "GET":
            if not admin:
                raise PermissionError
            return h.send_json(200, {"workspaces": settings()}) or True
        m = re.match(r"^%s/api/lockdown/([0-9a-f-]{36})(/snapshot/delete)?$" % BASE, path)
        if not m:
            return h.send_json(404, {"error": "not found"}) or True
        wid = m.group(1)
        ws = WORKSPACE_INFO(h.token(), wid)
        if not ws:
            raise LookupError("No such workspace.")
        if method == "GET" and not m.group(2):
            if not admin and ws.get("owner_id") != user["id"]:
                raise PermissionError
            return h.send_json(200, dict(state_of(wid, admin), canChange=admin)) or True
        if method != "POST":
            return h.send_json(405, {"error": "method not allowed"}) or True
        if not admin:
            raise PermissionError
        if m.group(2):
            with lock_of(wid):
                snap = snapshot_of(wid)
                delete_snapshot(snap)
                save_snapshot(wid, None)
            if LOG:
                LOG(event="lockdown-snapshot-deleted", workspace=ws.get("name"), id=wid,
                    snapshot=(snap or {}).get("name"), by=user["username"])
            return h.send_json(200, dict(state_of(wid, True), canChange=True)) or True
        mode = str(read_json(h).get("mode") or "")
        if mode not in MODES:
            raise ValueError("A mode: network, sudo, complete, freeze or off.")
        modes = MODES[mode]
        was = (settings().get(wid) or {}).get("modes") or []
        save(wid, modes, {"by": user["username"], "at": now(), "workspace": ws.get("name"),
                          "owner": ws.get("owner_name")})
        if LOG:
            LOG(event="lockdown-set", workspace=ws.get("name"), owner=ws.get("owner_name"), id=wid, mode=mode,
                by=user["username"])
        changed = []
        results = reconcile(wid, modes, changed)
        failed = [msg for _, ok, msg in results if not ok]
        # a new freeze (not one already on): the disk as it is now, while everything in it is paused
        if mode == "freeze" and "freeze" not in was and (changed or not results):
            with lock_of(wid):
                freeze_snapshot(wid, changed[0] if changed else None)
        return h.send_json(200, dict(state_of(wid, True), canChange=True, applied="now" if results else "next start",
                                     error=failed[0] if failed else None)) or True
    except PermissionError:
        h.send_json(403, {"error": "Only admins can lock a workspace down; its owner can see whether it is."})
    except LookupError as e:
        h.send_json(404, {"error": str(e)})
    except ValueError as e:
        h.send_json(400, {"error": str(e)})
    except RuntimeError as e:
        h.send_json(503, {"error": str(e)})
    return True
