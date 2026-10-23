"""The workspace pods' admission webhook (ADR-0002): what the platform adds to a workspace's pod, added as Kubernetes
creates it - not spliced into the template's Terraform. Any template's pod gets it, Coder's own Kubernetes example too.

A JSON patch per pod, CREATE only, for the pods of the workspace namespace labelled app.kubernetes.io/name=
coder-workspace with com.coder.workspace.id (the MutatingWebhookConfiguration selects them). Into the agent's
container (the one with CODER_AGENT_TOKEN, else "dev", else the first):
  - Lock Down: the init container "lockdown" (the agent's image, root with NET_ADMIN + NET_RAW, lockdown.sh against the
    workspace's entry of the ConfigMap coder-lockdown, none: nothing locked), that ConfigMap at /etc/coder-lockdown
  - the cluster's CA trusted: the init container "trust-local-ca" appends tls-ca's ca.crt to the image's bundle
  - the Cloud Drive (USER_STORAGE): the owner's volume, what is shared with them, the ISO library and the downward-API
    files /etc/platform/cloud-drive (connected or not, kept current by the platform service) and
    /etc/platform/cloud-drive-mounts (what this pod mounts: JSON, read by cloud-drive.sh) - from the ConfigMap
    coder-cloud-drive the platform service keeps (safe.py)
  - code-server HA, for a pod annotated platform.coder/code-server-ha=on by its template: the relay sidecar
  - CODER_HOME_DISK_SIZE (the size of the claim mounted at /home/coder, for the Disk metric)
Each piece is left out when the pod already has one of its name: a template that brings its own, or a pod of a
template the decorator still decorated.

Its own Deployment (coder-platform-webhook, two replicas): failurePolicy Fail, so no workspace pod starts without Lock
Down while no replica answers - the Deployment retries. Serves HTTPS on PORT from WEBHOOK_TLS_DIR (tls.crt, tls.key).

  python3 /app/webhook.py
"""
import copy
import hashlib
import http.server
import json
import os
import ssl
import sys
import threading
import time
import urllib.parse

APP = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8443"))
TLS_DIR = os.environ.get("WEBHOOK_TLS_DIR", "/etc/webhook-tls")
NAMESPACE = os.environ.get("WORKSPACE_NAMESPACE", "coder")
USER_STORAGE = os.environ.get("USER_STORAGE", "") in ("1", "true")
STORAGE_PATH = os.environ.get("SAFE_MOUNT_PATH", "/home/coder/cloud-drive")
CODER_HOST = urllib.parse.urlparse(os.environ.get("CODER_ACCESS_URL", "")).hostname or ""
TLS_CA_SECRET = os.environ.get("TLS_CA_SECRET", "tls-ca")
CSHA_IMAGE = os.environ.get("CODE_SERVER_HA_IMAGE", "")
CSHA_DB_CA_SECRET = os.environ.get("CODE_SERVER_HA_DB_CA_SECRET", "")
STATE_TTL = 2.0

CLOUD_DRIVE_MOUNT = "/mnt/cloud-drive"
ANNOTATION = "platform.coder/cloud-drive"
MOUNTS_ANNOTATION = "platform.coder/cloud-drive-mounts"
CSHA_ANNOTATION = "platform.coder/code-server-ha"


def log(**kw):
    print(json.dumps(dict(kw, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))), flush=True)


def lockdown_script():
    with open(os.path.join(APP, "lockdown.sh")) as f:
        return f.read()


# ------------------------------------------------------------------------------------------------- the Cloud Drive
def cloud_drive(state, workspace_id, owner_id):
    """What the pod mounts of the Cloud Drive, as the template's locals worked it out: its mode ("" off, "shared": a
    workspace shared with others has none, "source": the owner's source workspace serves a folder of itself,
    "mount", "offline": the source is down until the next start), the owner's claim, what is shared with them."""
    shared = workspace_id in (state.get("shared") or [])
    source = (state.get("sources") or {}).get(owner_id)
    is_source = bool(source) and source.get("workspace") == workspace_id
    if shared:
        mode = "shared"
    elif is_source:
        mode = "source"
    elif source is None or source.get("running"):
        mode = "mount"
    else:
        mode = "offline"
    claim = "" if mode != "mount" else ("coder-safe-%s" % owner_id if source is None else "coder-drive-src-%s" % owner_id)
    peers = [] if shared else [dict({"id": "", "kind": "drive", "path": "", "item": ""}, **p)
                               for p in (state.get("peers") or {}).get(owner_id) or []]
    return {
        "mode": mode, "claim": claim, "peers": peers,
        "annotation": "source:%s" % (source or {}).get("path", "") if is_source else "on",
    }


def peer_volume(claim):
    return "peer-" + hashlib.md5(claim.encode()).hexdigest()[:16]


# ------------------------------------------------------------------------------------------------------- the patch
def agent_container(pod):
    """The index of the agent's container: the one given CODER_AGENT_TOKEN, else "dev", else the first."""
    containers = pod["spec"].get("containers") or []
    for i, c in enumerate(containers):
        if any(e.get("name") == "CODER_AGENT_TOKEN" for e in c.get("env") or []):
            return i
    for i, c in enumerate(containers):
        if c.get("name") == "dev":
            return i
    return 0


def home_claim(pod):
    """The claim mounted at /home/coder in the agent's container, if any."""
    spec = pod.get("spec") or {}
    agent = (spec.get("containers") or [{}])[agent_container(pod)] if spec.get("containers") else {}
    for m in agent.get("volumeMounts") or []:
        if m.get("mountPath") == "/home/coder":
            v = next((v for v in spec.get("volumes") or [] if v.get("name") == m.get("name")), {})
            return (v.get("persistentVolumeClaim") or {}).get("claimName", "")
    return ""


def _named(items, name):
    return any(x.get("name") == name for x in items or [])


def mutated(pod, state, lockdown_sh):
    """The pod as the platform runs it (a copy; the patch is the difference)."""
    pod = copy.deepcopy(pod)
    meta = pod.setdefault("metadata", {})
    labels = meta.get("labels") or {}
    annotations = meta.setdefault("annotations", {})
    spec = pod["spec"]
    workspace_id = labels.get("com.coder.workspace.id", "")
    owner_id = labels.get("com.coder.user.id", "")
    agent = spec["containers"][agent_container(pod)]
    image = agent.get("image", "")
    inits = spec.setdefault("initContainers", [])
    volumes = spec.setdefault("volumes", [])
    mounts = agent.setdefault("volumeMounts", [])
    env = agent.setdefault("env", [])

    def volume(v):
        if not _named(volumes, v["name"]):
            volumes.append(v)

    def mount(m):
        if not any(x.get("mountPath") == m["mountPath"] for x in mounts):
            mounts.append(m)

    def setenv(name, value):
        if not _named(env, name):
            env.append({"name": name, "value": value})

    # the cluster's CA, beside the image's own roots (the agent reaches https://coder.<domain> on the private CA)
    if not _named(inits, "trust-local-ca") and not any(
            m.get("mountPath") == "/etc/ssl/certs/ca-certificates.crt" for m in mounts):
        inits.insert(0, {
            "name": "trust-local-ca", "image": image, "imagePullPolicy": "IfNotPresent",
            "command": ["sh", "-c",
                        "cat /etc/ssl/certs/ca-certificates.crt /local-ca/ca.crt > /ca-bundle/ca-certificates.crt"],
            "volumeMounts": [{"name": "local-ca", "mountPath": "/local-ca", "readOnly": True},
                             {"name": "ca-bundle", "mountPath": "/ca-bundle"}],
        })
        volume({"name": "local-ca", "secret": {"secretName": TLS_CA_SECRET,
                                                "items": [{"key": "ca.crt", "path": "ca.crt"}], "optional": True}})
        volume({"name": "ca-bundle", "emptyDir": {}})
        mount({"name": "ca-bundle", "mountPath": "/etc/ssl/certs/ca-certificates.crt",
               "subPath": "ca-certificates.crt", "readOnly": True})

    # Lock Down: before anything of the workspace runs, in the pod's network namespace (the workspace's container
    # shares it and cannot change it: no NET_ADMIN)
    if not _named(inits, "lockdown"):
        at = next((i + 1 for i, c in enumerate(inits) if c.get("name") == "trust-local-ca"), 0)
        inits.insert(at, {
            "name": "lockdown", "image": image, "imagePullPolicy": "IfNotPresent",
            "command": ["sh", "-c", lockdown_sh, "lockdown", "file:/etc/coder-lockdown/%s" % workspace_id, CODER_HOST, ""],
            "securityContext": {"runAsUser": 0, "runAsNonRoot": False,
                                "capabilities": {"add": ["NET_ADMIN", "NET_RAW"]}},
            "volumeMounts": [{"name": "lockdown", "mountPath": "/etc/coder-lockdown", "readOnly": True}],
        })
        volume({"name": "lockdown", "configMap": {"name": "coder-lockdown", "optional": True}})
        mount({"name": "lockdown", "mountPath": "/etc/coder-lockdown", "readOnly": True})

    # the home claim's size as Kubernetes has it (it can grow after creation), for the Disk metric
    if state.get("homeSize"):
        setenv("CODER_HOME_DISK_SIZE", state["homeSize"])

    # the Cloud Drive
    if USER_STORAGE and workspace_id and owner_id and not _named(volumes, "platform-info"):
        cd = cloud_drive(state.get("cloudDrive") or {}, workspace_id, owner_id)
        annotations.setdefault(ANNOTATION, cd["annotation"])
        items = [{"id": p["id"], "owner": p.get("owner", ""), "item": p.get("item", "")}
                 for p in cd["peers"] if p.get("kind") != "drive"]
        annotations[MOUNTS_ANNOTATION] = json.dumps({
            "mode": cd["mode"], "link": STORAGE_PATH, "mount": CLOUD_DRIVE_MOUNT if cd["claim"] else "", "items": items,
        }, separators=(",", ":"))
        if cd["claim"]:
            volume({"name": "safe", "persistentVolumeClaim": {"claimName": cd["claim"]}})
            mount({"name": "safe", "mountPath": CLOUD_DRIVE_MOUNT})
        by_claim = {}
        for p in cd["peers"]:
            by_claim.setdefault(p["claim"], []).append(p)
        for claim, ps in by_claim.items():
            volume({"name": peer_volume(claim), "persistentVolumeClaim": {
                "claimName": claim, "readOnly": all(p.get("readOnly") for p in ps)}})
        for p in cd["peers"]:
            mount({"name": peer_volume(p["claim"]), "readOnly": bool(p.get("readOnly")), "subPath": p.get("path", ""),
                   "mountPath": ("/mnt/cloud-drive-peers/%s" % p.get("name", "") if p.get("kind") == "drive"
                                 else "/mnt/cloud-drive-items/%s" % p["id"])})
        volume({"name": "platform-info", "downwardAPI": {"items": [
            {"path": "cloud-drive", "fieldRef": {"fieldPath": "metadata.annotations['%s']" % ANNOTATION}},
            {"path": "cloud-drive-mounts", "fieldRef": {"fieldPath": "metadata.annotations['%s']" % MOUNTS_ANNOTATION}},
        ]}})
        mount({"name": "platform-info", "mountPath": "/etc/platform", "readOnly": True})
        volume({"name": "isos", "persistentVolumeClaim": {"claimName": "coder-isos", "readOnly": True}})
        mount({"name": "isos", "mountPath": "/home/coder/isos", "readOnly": True})

    # code-server HA: the relay where code-server would listen; the template asks for it with the annotation
    if annotations.get(CSHA_ANNOTATION) == "on" and CSHA_IMAGE and not _named(spec["containers"], "code-server-relay"):
        token = next((e for e in env if e.get("name") == "CODER_AGENT_TOKEN"), None)
        if token:
            relay_token = {"name": "CSHA_AGENT_TOKEN"}
            relay_token.update({k: v for k, v in token.items() if k in ("value", "valueFrom")})
            setenv("CODER_CODE_SERVER_HA", "1")
            spec["containers"].append({
                "name": "code-server-relay", "image": CSHA_IMAGE, "imagePullPolicy": "IfNotPresent",
                "command": ["python3", "/app/csha.py", "front"],
                "securityContext": {"runAsUser": 1000, "allowPrivilegeEscalation": False,
                                    "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
                "env": [
                    {"name": "CSHA_WORKSPACE", "value": workspace_id}, relay_token,
                    {"name": "CSHA_NAMESPACE", "value": NAMESPACE}, {"name": "CSHA_IMAGE", "value": image},
                    {"name": "CSHA_NODE", "valueFrom": {"fieldRef": {"fieldPath": "spec.nodeName"}}},
                    {"name": "CSHA_CLUSTER", "valueFrom": {"configMapKeyRef": {
                        "name": "coder-code-server-ha", "key": "cluster", "optional": True}}},
                    {"name": "CSHA_DB", "valueFrom": {"secretKeyRef": {"name": "coder-code-server-ha-relay", "key": "uri"}}},
                    {"name": "CSHA_DB_CA", "value": "/etc/coder-db-ca/ca.crt"},
                ],
                "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"memory": "128Mi"}},
                "volumeMounts": [{"name": "coder-db-ca", "mountPath": "/etc/coder-db-ca", "readOnly": True}],
            })
            volume({"name": "coder-db-ca", "secret": {"secretName": CSHA_DB_CA_SECRET,
                                                     "items": [{"key": "ca.crt", "path": "ca.crt"}]}})
    return pod


def patch(pod, state, lockdown_sh):
    """The JSON patch from the pod to the platform's: whole top-level fields replaced (metadata's annotations and the
    spec's lists), which keeps it short and exact."""
    after = mutated(pod, state, lockdown_sh)
    ops = []
    before_meta = pod.get("metadata") or {}
    if after["metadata"].get("annotations") != before_meta.get("annotations"):
        ops.append({"op": "add" if "annotations" not in before_meta else "replace",
                    "path": "/metadata/annotations", "value": after["metadata"]["annotations"]})
    for field in ("initContainers", "containers", "volumes"):
        if after["spec"].get(field) != pod["spec"].get(field):
            ops.append({"op": "add" if field not in pod["spec"] else "replace",
                        "path": "/spec/" + field, "value": after["spec"][field]})
    return ops


# -------------------------------------------------------------------------------------------- what the pod needs
class Kube:
    """The in-cluster API (the pod's service account): the Cloud Drive's state (cached STATE_TTL seconds) and a claim's
    size."""

    def __init__(self):
        sa = "/var/run/secrets/kubernetes.io/serviceaccount"
        self.host = os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
        self.port = int(os.environ.get("KUBERNETES_SERVICE_PORT", "443"))
        self.token_file = sa + "/token"
        self.ctx = ssl.create_default_context(cafile=sa + "/ca.crt") if os.path.exists(sa + "/ca.crt") else None
        self.lock = threading.Lock()
        self.cached = (0.0, {})

    def get(self, path):
        import http.client
        with open(self.token_file) as f:
            token = f.read().strip()
        conn = http.client.HTTPSConnection(self.host, self.port, context=self.ctx, timeout=3)
        try:
            conn.request("GET", path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
            r = conn.getresponse()
            body = r.read()
            return r.status, json.loads(body) if body else None
        finally:
            conn.close()

    def cloud_drive(self):
        """The Cloud Drive's state (ConfigMap coder-cloud-drive; none yet: {})."""
        if not USER_STORAGE:
            return {}
        with self.lock:
            at, value = self.cached
            if time.monotonic() - at < STATE_TTL:
                return value
        status, cm = self.get("/api/v1/namespaces/%s/configmaps/coder-cloud-drive" % NAMESPACE)
        if status == 200:
            value = json.loads(((cm or {}).get("data") or {}).get("state") or "{}")
        elif status == 404:
            value = {}
        else:
            # unknown: refuse the pod (the Deployment retries) rather than start it without its drive
            raise RuntimeError("the Cloud Drive's state: HTTP %s" % status)
        with self.lock:
            self.cached = (time.monotonic(), value)
        return value

    def claim_size(self, name):
        if not name:
            return ""
        status, pvc = self.get("/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (NAMESPACE, name))
        if status != 200:
            return ""
        return (((pvc or {}).get("spec") or {}).get("resources") or {}).get("requests", {}).get("storage", "")

    def state(self, pod):
        return {"cloudDrive": self.cloud_drive(), "homeSize": self.claim_size(home_claim(pod))}


def review(body, state_of, lockdown_sh):
    """An AdmissionReview answered: allowed, with the patch."""
    request = body.get("request") or {}
    response = {"uid": request.get("uid", ""), "allowed": True}
    pod = request.get("object") or {}
    if request.get("operation") == "CREATE" and request.get("kind", {}).get("kind") == "Pod" and pod.get("spec"):
        ops = patch(pod, state_of(pod), lockdown_sh)
        if ops:
            import base64
            response["patchType"] = "JSONPatch"
            response["patch"] = base64.b64encode(json.dumps(ops).encode()).decode()
        labels = (pod.get("metadata") or {}).get("labels") or {}
        log(event="workspace-pod", workspace=labels.get("com.coder.workspace.id", ""),
            pieces=[o["path"] for o in ops])
    return {"apiVersion": body.get("apiVersion", "admission.k8s.io/v1"), "kind": "AdmissionReview",
            "response": response}


def server(state_of, lockdown_sh, port=PORT, tls_dir=TLS_DIR):
    """The HTTPS server: POST /mutate (the API server adds ?timeout=...), GET /healthz. tls_dir None: plain HTTP (tests)."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def route(self):
            return urllib.parse.urlsplit(self.path).path

        def do_GET(self):
            # readiness: serving
            self.send_response(200 if self.route() == "/healthz" else 404)
            self.end_headers()

        def do_POST(self):
            if self.route() != "/mutate":
                self.send_response(404)
                self.end_headers()
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                out = review(body, state_of, lockdown_sh)
            except Exception as e:  # refused: failurePolicy Fail keeps the pod out, the Deployment retries
                log(event="webhook-error", error=str(e)[:300])
                self.send_response(500)
                self.end_headers()
                return
            data = json.dumps(out).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = http.server.ThreadingHTTPServer(("", port), Handler)
    if tls_dir:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(os.path.join(tls_dir, "tls.crt"), os.path.join(tls_dir, "tls.key"))
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    return srv


def main():
    kube = Kube()
    srv = server(kube.state, lockdown_script())
    log(event="webhook-start", port=PORT, namespace=NAMESPACE, userStorage=USER_STORAGE)
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
