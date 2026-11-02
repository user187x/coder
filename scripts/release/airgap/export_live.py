#!/usr/bin/env python3
"""Export the live Coder deployment's objects, cleaned of server-side fields, one file per object."""
import json, os, subprocess, sys

OUT = sys.argv[1]
SKIP_KINDS = {"Pod", "ReplicaSet", "Endpoints", "EndpointSlice", "Event", "ControllerRevision", "Lease"}
STRIP_META = ["uid", "resourceVersion", "creationTimestamp", "generation", "managedFields", "selfLink"]
STRIP_ANN = ["kubectl.kubernetes.io/last-applied-configuration", "deployment.kubernetes.io/revision"]

def kget(args):
    r = subprocess.run(["kubectl", "get", *args, "-o", "json"], capture_output=True, text=True)
    if r.returncode:
        return []
    d = json.loads(r.stdout)
    return d.get("items", [d])

def clean(o):
    m = o["metadata"]
    for k in STRIP_META:
        m.pop(k, None)
    ann = m.get("annotations") or {}
    for k in STRIP_ANN:
        ann.pop(k, None)
    if not ann:
        m.pop("annotations", None)
    o.pop("status", None)
    if o["kind"] == "Service":
        for k in ("clusterIP", "clusterIPs"):
            o["spec"].pop(k, None)
    if o["kind"] == "PersistentVolumeClaim":
        o["spec"].pop("volumeName", None)
    return o

def write(o, sub):
    import yaml
    ns = o["metadata"].get("namespace", "_cluster")
    d = os.path.join(OUT, sub, ns, o["kind"])
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, o["metadata"]["name"] + ".yaml")
    with open(p, "w") as f:
        yaml.safe_dump(o, f, sort_keys=False, width=200)
    if o["kind"] == "Secret":
        os.chmod(p, 0o600)

kinds = [l for l in subprocess.run(["kubectl", "api-resources", "--verbs=list", "--namespaced", "-o", "name"],
         capture_output=True, text=True).stdout.split() if not l.startswith("events")]
n = 0
for k in kinds:
    for o in kget(["-n", "coder", k]):
        if o["kind"] in SKIP_KINDS:
            continue
        if o["kind"] == "Secret" and o.get("type") == "helm.sh/release.v1":
            continue
        if o["kind"] == "ServiceAccount" and o["metadata"]["name"] == "default":
            continue
        if o["kind"] == "ConfigMap" and o["metadata"]["name"] == "kube-root-ca.crt":
            continue
        sub = "secrets" if o["kind"] == "Secret" else "manifests"
        write(clean(o), sub); n += 1

# Coder-related objects outside the namespace
extra = [["clusterrole", "coder-ui-updates-coder"], ["clusterrolebinding", "coder-ui-updates-coder"],
         ["-n", "argocd", "role", "coder-ui-updates"], ["-n", "argocd", "rolebinding", "coder-ui-updates"],
         ["-n", "keycloak", "role", "coder-ui-updates"], ["-n", "keycloak", "rolebinding", "coder-ui-updates"],
         ["-n", "argocd", "application", "coder"], ["-n", "argocd", "application", "coder-banner"],
         ["-n", "traefik", "gateway", "traefik-gateway"]]
for e in extra:
    for o in kget(e):
        write(clean(o), "manifests"); n += 1
print("exported", n, "objects")
