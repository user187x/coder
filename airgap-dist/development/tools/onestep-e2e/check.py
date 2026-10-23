#!/usr/bin/env python3
"""The one-step install's checks (run.sh check): the platform up after ONE helm install on a bare air-gapped cluster.

  python3 check.py KUBECONFIG NAMESPACE DOMAIN RELEASE

Waits (up to 25 min) for the database and Coder, then checks: every pod up with no restart and every image from the
site registry; the database made by its Job; CoreDNS's rules (pods resolve Coder's host to the Gateway); Coder over
HTTPS through Traefik's NodePort with the chart's own CA trusted; the first owner signs in; both templates pushed; a
DEFAULT workspace builds and its agent connects (it reached Coder by its URL, in-cluster DNS and the CA included).
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import base64

KUBECONFIG, NS, DOMAIN, RELEASE = sys.argv[1:5]
CODER = "coder." + DOMAIN
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print("%s %s%s" % ("PASS" if ok else "FAIL", name, (" - %s" % str(detail)[:300]) if detail != "" else ""), flush=True)


def kubectl(*args, check_rc=True):
    r = subprocess.run(["kubectl", "--kubeconfig", KUBECONFIG] + list(args), capture_output=True, text=True)
    if check_rc and r.returncode:
        raise RuntimeError("kubectl %s: %s" % (" ".join(args), r.stderr.strip()[:300]))
    return r.stdout


def kjson(*args):
    return json.loads(kubectl(*(list(args) + ["-o", "json"])))


def wait(what, fn, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = fn()
            if v:
                return v, int(time.time() - t0)
        except Exception:
            pass
        time.sleep(10)
    return None, int(time.time() - t0)


# 1. the platform comes up by itself
db, t = wait("database", lambda: (kjson("-n", NS, "get", "clusters.postgresql.cnpg.io", "coder-db").get("status", {})
                                  .get("phase") == "Cluster in healthy state"), 1200)
check("the database is up, made by its Job once CloudNativePG answered (%d s)" % t, db)
jobs = [j for j in kjson("-n", NS, "get", "jobs")["items"] if j["metadata"]["name"].startswith("coder-db-apply-")]
check("its Job succeeded", jobs and all(j.get("status", {}).get("succeeded") for j in jobs),
      [(j["metadata"]["name"], j.get("status")) for j in jobs])
coder, t = wait("coder", lambda: (kjson("-n", NS, "get", "deploy", "coder").get("status", {}).get("availableReplicas") or 0) >= 1, 900)
check("Coder is available (%d s more)" % t, coder)


def settled():
    pods = kjson("-n", NS, "get", "pods")["items"]
    busy = [p["metadata"]["name"] for p in pods if p["status"].get("phase") not in ("Running", "Succeeded")]
    return pods if not busy else None


pods, t = wait("pods", settled, 600)
pods = pods or kjson("-n", NS, "get", "pods")["items"]
check("every pod Running or Succeeded (%d s more)" % t, settled() is not None,
      [(p["metadata"]["name"], p["status"].get("phase")) for p in pods if p["status"].get("phase") not in ("Running", "Succeeded")])
restarts = {p["metadata"]["name"]: sum(c.get("restartCount", 0) for c in p["status"].get("containerStatuses") or [])
            for p in pods}
check("no container restarted", not any(restarts.values()), {k: v for k, v in restarts.items() if v})
images = sorted({c["image"] for p in kjson("get", "pods", "-A")["items"] if p["metadata"]["namespace"] == NS
                 for c in p["spec"].get("containers", []) + p["spec"].get("initContainers", [])})
check("every image from the site registry (onestep-registry:5000)", images and all(i.startswith("onestep-registry:5000/") for i in images),
      [i for i in images if not i.startswith("onestep-registry:5000/")])
events = kubectl("get", "events", "-A", "--field-selector", "reason=Failed", "-o", "json")
pulls = [e["message"] for e in json.loads(events)["items"] if "pull" in e.get("message", "").lower()]
check("no image pull failed", not pulls, pulls[:3])

# 2. in-cluster DNS
core = kubectl("-n", "kube-system", "get", "configmap", "coredns", "-o", "jsonpath={.data.Corefile}")
check("CoreDNS carries this release's rules", core.count("# coder-airgapped %s/%s" % (NS, RELEASE)) == 2, "")
traefik_ip = kubectl("-n", NS, "get", "svc", "%s-traefik" % RELEASE, "-o", "jsonpath={.spec.clusterIP}")
resolved = kubectl("-n", NS, "exec", "deploy/coder-ui-updates", "--", "python3", "-c",
                   "import socket; print(socket.gethostbyname('%s'), socket.gethostbyname('app--ws.%s'))" % (CODER, DOMAIN), check_rc=False).split()
check("pods resolve Coder's host and the wildcard host to the Gateway (%s)" % traefik_ip, resolved == [traefik_ip, traefik_ip], resolved)

# 3. HTTPS through Traefik's NodePort, with the chart's own CA
ca = base64.b64decode(kjson("-n", NS, "get", "secret", "tls-ca")["data"]["ca.crt"])
caf = tempfile.NamedTemporaryFile(delete=False, suffix=".crt")
caf.write(ca)
caf.close()
svc = kjson("-n", NS, "get", "svc", "%s-traefik" % RELEASE)
nodeport = next(p["nodePort"] for p in svc["spec"]["ports"] if p["port"] == 443)
node_ip = kjson("get", "nodes")["items"][0]["status"]["addresses"][0]["address"]


def curl(path, *extra):
    r = subprocess.run(["curl", "-s", "--max-time", "20", "--cacert", caf.name, "--connect-to",
                        "%s:443:%s:%d" % (CODER, node_ip, nodeport), "https://%s%s" % (CODER, path)] + list(extra),
                       capture_output=True, text=True)
    return r.returncode, r.stdout


rc, out = curl("/healthz")
check("https://%s answers through Traefik (NodePort %d), its certificate trusted by the chart's CA" % (CODER, nodeport),
      rc == 0 and out.strip() == "OK", (rc, out[:100]))
rc, out = curl("/api/v2/users/login", "-H", "Content-Type: application/json", "-d",
               json.dumps({"email": "admin@admin.com", "password": "admin"}))
token = json.loads(out or "{}").get("session_token", "") if rc == 0 else ""
check("the first owner signs in", token, out[:120])
H = ["-H", "Coder-Session-Token: " + token, "-H", "Content-Type: application/json"]
rc, out = curl("/api/v2/templates", *H)
names = sorted(t["name"] for t in json.loads(out or "[]")) if rc == 0 else []
check("the workspace templates are pushed", "default" in names, names)

# 4. a workspace: builds in this namespace, its agent connects
tpl = next((t for t in json.loads(out or "[]") if t["name"] == "default"), None) if rc == 0 else None
ws = None
if tpl:
    rc, out = curl("/api/v2/users/me/workspaces", *H, "-d", json.dumps({"template_id": tpl["id"], "name": "onestep"}))
    ws = json.loads(out or "{}").get("id")


def agent_connected():
    rc, out = curl("/api/v2/workspaces/%s" % ws, *H)
    w = json.loads(out)
    st = w["latest_build"]["status"]
    if st == "failed":
        return "failed"
    agents = [a for r in w["latest_build"]["resources"] for a in r.get("agents") or []]
    return "connected" if agents and all(a["status"] == "connected" for a in agents) else None


state, t = wait("agent", agent_connected, 900) if ws else (None, 0)
check("a DEFAULT workspace builds and its agent connects (%d s)" % t, state == "connected", state)
wpods = [p["metadata"]["name"] for p in kjson("-n", NS, "get", "pods")["items"] if (p["metadata"].get("labels") or {}).get("com.coder.workspace.id")]
check("the workspace runs in the release's namespace", wpods, wpods)

os.unlink(caf.name)
print("%d/%d passed" % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
