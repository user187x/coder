"""helm uninstall's pre-delete hook (templates/user-storage-uninstall.yaml): stop every pod that mounts a Cloud Drive
volume (a PersistentVolume of the CSI driver CSI_DRIVER claimed in NAMESPACE) and wait until they are gone, while the
driver's node plugin still runs and can unmount them.

Without it, Helm removes the node plugin (DaemonSet coder-user-storage-csi) while workspaces - which Coder made, not
Helm - still mount its volumes: the kubelet can no longer unmount them, the pods never finish terminating, and deleting
the namespace hangs. Workspaces' Deployments are scaled to 0 (Coder made them; it is being removed too), any other pod
that mounts such a volume is deleted. Best effort: it always ends successfully, so it never holds up an uninstall.
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

NAMESPACE = os.environ["NAMESPACE"]
CSI_DRIVER = os.environ.get("CSI_DRIVER", "ru.yandex.s3.csi")
DEADLINE = time.time() + int(os.environ.get("TIMEOUT", "240"))
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
API = "https://%s:%s" % (os.environ["KUBERNETES_SERVICE_HOST"], os.environ["KUBERNETES_SERVICE_PORT"])
TLS = ssl.create_default_context(cafile=SA + "/ca.crt")


def log(**kv):
    print(json.dumps(kv, sort_keys=True), flush=True)


def call(method, path, body=None, content_type="application/json"):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    with open(SA + "/token") as f:
        req.add_header("Authorization", "Bearer " + f.read().strip())
    if body is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, context=TLS, timeout=20) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except (OSError, ValueError) as e:
        log(event="api error", path=path, error=str(e))
        return 0, None


def items(status, out):
    return (out or {}).get("items") or [] if status == 200 and isinstance(out, dict) else []


def cloud_drive_claims():
    """The claims in NAMESPACE bound to the Cloud Drive's CSI volumes."""
    return {(pv["spec"].get("claimRef") or {}).get("name") for pv in items(*call("GET", "/api/v1/persistentvolumes"))
            if (pv["spec"].get("csi") or {}).get("driver") == CSI_DRIVER
            and (pv["spec"].get("claimRef") or {}).get("namespace") == NAMESPACE} - {None}


def mounts(pod_spec, claims):
    return any((v.get("persistentVolumeClaim") or {}).get("claimName") in claims for v in pod_spec.get("volumes") or [])


def main():
    claims = cloud_drive_claims()
    if not claims:
        log(event="no Cloud Drive volumes")
        return
    for d in items(*call("GET", "/apis/apps/v1/namespaces/%s/deployments" % NAMESPACE)):
        name = d["metadata"]["name"]
        if d["spec"].get("replicas", 1) and mounts(d["spec"]["template"]["spec"], claims):
            status, _ = call("PATCH", "/apis/apps/v1/namespaces/%s/deployments/%s" % (NAMESPACE, name),
                             {"spec": {"replicas": 0}}, "application/merge-patch+json")
            log(event="scaled to 0", deployment=name, status=status)
    left = []
    while time.time() < DEADLINE:
        left = [p for p in items(*call("GET", "/api/v1/namespaces/%s/pods" % NAMESPACE)) if mounts(p["spec"], claims)]
        if not left:
            log(event="no pod mounts a Cloud Drive volume: the CSI driver may go")
            return
        for p in left:
            if not p["metadata"].get("deletionTimestamp"):
                status, _ = call("DELETE", "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, p["metadata"]["name"]))
                log(event="deleted", pod=p["metadata"]["name"], status=status)
        time.sleep(3)
    log(event="gave up waiting (uninstall goes on)", pods=[p["metadata"]["name"] for p in left])


def run():
    """main, never failing: an uninstall must not be held up by its hook."""
    try:
        main()
    except Exception as e:
        log(event="failed (uninstall goes on)", error=repr(e))
    return 0


if __name__ == "__main__":
    sys.exit(run())
