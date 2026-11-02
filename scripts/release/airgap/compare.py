#!/usr/bin/env python3
"""Compare `helm template` output with the exported live objects.
 rendered->live: every rendered field must equal live (live may add server defaults).
 live->rendered: fields live has that the render lacks (should only be server/operator defaults)."""
import os, sys, yaml
rendered, live_root = sys.argv[1], sys.argv[2]
IGN_META = {"labels", "annotations", "ownerReferences", "finalizers"}

def norm(o):
    o = dict(o); m = {k: v for k, v in o.get("metadata", {}).items() if k not in IGN_META}
    o["metadata"] = m
    return o

def key(item):
    if isinstance(item, dict):
        for k in ("mountPath", "name", "key", "containerPort", "port"):
            if k in item: return (k, str(item[k]))
    return None

def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k, v in a.items():
            if k not in b: out.append(("missing", path + "." + str(k), v)); continue
            walk(v, b[k], path + "." + str(k), out)
    elif isinstance(a, list) and isinstance(b, list):
        keyed = all(key(x) for x in a + b) and a and b
        if keyed:
            bm = {key(x): x for x in b}
            for x in a:
                kx = key(x)
                if kx not in bm: out.append(("missing", f"{path}[{kx[1]}]", "")); continue
                walk(x, bm[kx], f"{path}[{kx[1]}]", out)
        else:
            if len(a) != len(b): out.append(("differs", path, f"len {len(a)} vs {len(b)}")); return
            for i, (x, y) in enumerate(zip(a, b)): walk(x, y, f"{path}[{i}]", out)
    else:
        if str(a) != str(b): out.append(("differs", path, f"{str(a)[:90]!r} vs {str(b)[:90]!r}"))

docs = [d for d in yaml.safe_load_all(open(rendered)) if d]
for d in docs:
    ns = d["metadata"].get("namespace", "_cluster"); kind = d["kind"]; name = d["metadata"]["name"]
    sub = "secrets" if kind == "Secret" else "manifests"
    p = os.path.join(live_root, sub, ns, kind, name + ".yaml")
    tag = f"{kind}/{ns}/{name}"
    if not os.path.exists(p):
        print(f"== {tag}: NOT LIVE (new in chart)"); continue
    live = norm(yaml.safe_load(open(p))); ren = norm(d)
    if kind == "Secret":
        print(f"== {tag}: live secret exists (contents not compared)"); continue
    fwd = []; walk(ren, live, "", fwd)
    rev = []; walk(live, ren, "", rev)
    rev = [r for r in rev if r[0] == "missing"]
    print(f"== {tag}: {'IDENTICAL' if not fwd else str(len(fwd)) + ' differences'}; live-only fields: {len(rev)}")
    for f in fwd: print("   R!=L", f[0], f[1], f[2] if f[0] == "differs" else "")
    for r in rev: print("   live-only", r[1], str(r[2])[:80].replace("\n", " "))
