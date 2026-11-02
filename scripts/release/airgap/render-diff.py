#!/usr/bin/env python3
"""Compares two `helm template` outputs object by object, ignoring helm.sh/chart labels and generated passwords.
Usage: render-diff.py A.yaml B.yaml"""
import sys, yaml

def load(p):
    out = {}
    for d in yaml.safe_load_all(open(p)):
        if not d:
            continue
        for meta in (d["metadata"], d.get("spec", {}).get("template", {}).get("metadata", {})):
            (meta.get("labels") or {}).pop("helm.sh/chart", None)
        if d["kind"] == "Secret" and "password" in (d.get("stringData") or {}):
            d["stringData"]["password"] = "<random>"
        out[(d["kind"], d["metadata"].get("namespace"), d["metadata"]["name"])] = d
    return out

a, b = load(sys.argv[1]), load(sys.argv[2])
print("only in A:", sorted(set(a) - set(b), key=str))
print("only in B:", sorted(set(b) - set(a), key=str))
diff = [k for k in sorted(set(a) & set(b), key=str) if a[k] != b[k]]
for k in diff:
    print("DIFFERS:", k)
print(f"{len(a)} objects, {len(diff)} differ")
sys.exit(1 if diff or set(a) ^ set(b) else 0)
