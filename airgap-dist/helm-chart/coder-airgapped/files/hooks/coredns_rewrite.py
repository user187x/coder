"""global.inClusterDNS (templates/in-cluster-dns.yaml): on a cluster with no DNS for the platform's names (minikube,
kind, bare metal), pods resolve Coder's host and the wildcard host to the Gateway through rewrite rules in the
cluster's CoreDNS - workspace agents and Coder itself reach https://coder.<domain> like a browser does.

  apply   (a Job of the release) puts this release's rules (RULES, one per line) into the Corefile's ".:53" block,
          replacing its earlier ones, and restarts CoreDNS when they changed
  remove  (helm uninstall's pre-delete hook) takes them out again

Each rule carries the marker "# coder-airgapped <namespace>/<release>", so other rules are never touched.
"""
import datetime
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

MARKER = "# coder-airgapped %s/%s" % (os.environ["NAMESPACE"], os.environ["RELEASE"])
RULES = [r.strip() for r in os.environ.get("RULES", "").splitlines() if r.strip()]
DNS_NS = os.environ.get("COREDNS_NAMESPACE", "kube-system")
CONFIGMAP = os.environ.get("COREDNS_CONFIGMAP", "coredns")
DEPLOYMENT = os.environ.get("COREDNS_DEPLOYMENT", "coredns")
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


def edit(corefile, rules):
    """The Corefile with this release's rules (and only them) at the top of the ".:53" block."""
    lines = [l for l in corefile.split("\n") if not l.rstrip().endswith(MARKER)]
    if not rules:
        return "\n".join(lines)
    out, done = [], False
    for l in lines:
        out.append(l)
        if not done and l.strip().startswith(".:53") and l.rstrip().endswith("{"):
            out.extend("    %s %s" % (r, MARKER) for r in rules)
            done = True
    if not done:
        raise RuntimeError('the Corefile has no ".:53 {" block')
    return "\n".join(out)


def main(mode, sleep=time.sleep):
    path = "/api/v1/namespaces/%s/configmaps/%s" % (DNS_NS, CONFIGMAP)
    for attempt in range(5):
        status, cm = call("GET", path)
        if status != 200:
            log(event="no CoreDNS ConfigMap", status=status)
            return 0 if mode == "remove" else 1
        old = (cm.get("data") or {}).get("Corefile", "")
        new = edit(old, RULES if mode == "apply" else [])
        if new == old:
            log(event="the rules are as they should be", rules=len(RULES) if mode == "apply" else 0)
            return 0
        cm["data"]["Corefile"] = new
        status, _ = call("PUT", path, cm)  # carries resourceVersion: a concurrent change makes this 409, then retry
        if status == 200:
            break
        log(event="update conflict, retrying", status=status)
        sleep(1 + attempt)
    else:
        return 1 if mode == "apply" else 0
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    status, _ = call("PATCH", "/apis/apps/v1/namespaces/%s/deployments/%s" % (DNS_NS, DEPLOYMENT),
                     {"spec": {"template": {"metadata": {"annotations": {"kubectl.kubernetes.io/restartedAt": stamp}}}}},
                     "application/merge-patch+json")
    log(event="rules %s; CoreDNS restarted" % ("set" if mode == "apply" else "removed"), restart=status, rules=RULES)
    return 0


if __name__ == "__main__":
    mode = sys.argv[1]
    try:
        sys.exit(main(mode))
    except Exception as e:  # never hold up an uninstall
        log(event="failed", mode=mode, error=repr(e))
        sys.exit(0 if mode == "remove" else 1)
