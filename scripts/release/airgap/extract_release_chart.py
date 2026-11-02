#!/usr/bin/env python3
"""Rebuild a chart directory from a decoded Helm release record (JSON)."""
import base64, json, os, sys, yaml
rel, out = sys.argv[1], sys.argv[2]
c = json.load(open(rel))["chart"]
os.makedirs(out, exist_ok=True)
md = {k: v for k, v in c["metadata"].items()}
with open(os.path.join(out, "Chart.yaml"), "w") as f:
    yaml.safe_dump(md, f, sort_keys=False)
for group in ("templates", "files"):
    for t in c.get(group) or []:
        p = os.path.join(out, t["name"])
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(base64.b64decode(t["data"]))
with open(os.path.join(out, "values.yaml"), "w") as f:
    yaml.safe_dump(c.get("values") or {}, f, sort_keys=False)
print("rebuilt", out)
