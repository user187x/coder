"""The database, when the chart brings CloudNativePG itself (global.bundled.cloudnativePG;
templates/database-apply.yaml).

  apply   (a Job of the release) server-side applies the database (a CloudNativePG Cluster) and its pooler from
          /manifests/*.json. On a fresh install the operator, installed by the same `helm install`, is not up yet and
          its webhook refuses the Cluster: it retries until the webhook answers (TIMEOUT seconds), so one helm install
          is enough. Later upgrades apply the changed spec the same way (the Job's name follows the manifests).
  delete  (helm uninstall's pre-delete hook) deletes them while the operator still runs, and waits until they are
          gone, so nothing is left with a finalizer only the removed operator could clear.
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

NAMESPACE = os.environ["NAMESPACE"]
MANIFESTS = os.environ.get("MANIFESTS", "/manifests")
TIMEOUT = int(os.environ.get("TIMEOUT", "900"))
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
API = "https://%s:%s" % (os.environ["KUBERNETES_SERVICE_HOST"], os.environ["KUBERNETES_SERVICE_PORT"])
TLS = ssl.create_default_context(cafile=SA + "/ca.crt")
MANAGER = "coder-airgapped-database"


def log(**kv):
    print(json.dumps(kv, sort_keys=True), flush=True)


def call(method, path, body=None, content_type="application/json"):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    req = urllib.request.Request(API + path, method=method, data=data)
    with open(SA + "/token") as f:
        req.add_header("Authorization", "Bearer " + f.read().strip())
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, context=TLS, timeout=30) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except OSError as e:
        return 0, str(e)


def path_of(obj):
    plural = {"Cluster": "clusters", "Pooler": "poolers"}[obj["kind"]]
    return "/apis/postgresql.cnpg.io/v1/namespaces/%s/%s/%s" % (NAMESPACE, plural, obj["metadata"]["name"])


def manifests():
    """The Cluster first, then the pooler (it names the Cluster)."""
    objs = []
    for name in sorted(os.listdir(MANIFESTS)):
        if name.endswith(".json"):
            with open(os.path.join(MANIFESTS, name)) as f:
                objs.append(json.load(f))
    return sorted(objs, key=lambda o: o["kind"] != "Cluster")


def apply(sleep=time.sleep, now=time.time):
    deadline = now() + TIMEOUT
    for obj in manifests():
        delay = 2
        while True:
            status, out = call("PATCH", path_of(obj) + "?fieldManager=%s&force=true" % MANAGER, obj,
                               "application/apply-patch+yaml")
            if 200 <= status < 300:
                log(event="applied", kind=obj["kind"], name=obj["metadata"]["name"])
                break
            # 404: the CRDs not served yet; 500/503 (or a refused connection): the operator's webhook not up yet
            if now() >= deadline:
                log(event="gave up", kind=obj["kind"], status=status, error=out[:300])
                return 1
            log(event="waiting for CloudNativePG", kind=obj["kind"], status=status, error=out[:160])
            sleep(delay)
            delay = min(delay * 2, 15)
    return 0


def delete(sleep=time.sleep, now=time.time):
    deadline = now() + TIMEOUT
    objs = list(reversed(manifests()))  # the pooler first
    for obj in objs:
        status, out = call("DELETE", path_of(obj))
        log(event="delete", kind=obj["kind"], name=obj["metadata"]["name"], status=status)
    while now() < deadline:
        left = [o["metadata"]["name"] for o in objs if call("GET", path_of(o))[0] == 200]
        if not left:
            log(event="the database is gone")
            return 0
        sleep(3)
    log(event="gave up waiting (uninstall goes on)", left=left)
    return 0  # never hold up an uninstall


if __name__ == "__main__":
    sys.exit({"apply": apply, "delete": delete}[sys.argv[1]]())
