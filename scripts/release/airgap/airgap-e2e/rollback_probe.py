import json, ssl, sys, time, urllib.request, urllib.error
ctx = ssl.create_default_context(cafile="/ca/ca.crt"); B = "https://coder.airgap.test"
def call(p, body=None, t=None):
    h = {"Content-Type": "application/json"}
    if t: h["Coder-Session-Token"] = t
    r = urllib.request.Request(B + p, data=json.dumps(body).encode() if body else None, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30, context=ctx) as x: return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, None
deadline = time.time() + 600
while True:
    s, l = call("/api/v2/users/login", {"email": "admin@admin.com", "password": "admin"})
    if s == 201: break
    if time.time() > deadline: print(json.dumps({"login": s})); sys.exit(1)
    time.sleep(10)
t = l["session_token"]; v = call("/api/v2/buildinfo")[1]["version"]
for _ in range(60):
    ws = {w["name"]: w for w in call("/api/v2/workspaces", t=t)[1]["workspaces"]}
    w = ws.get("e2e"); agents = [a for r in (w or {}).get("latest_build", {}).get("resources", []) for a in r.get("agents") or []]
    a = agents[0] if agents else {}
    apps = {x["slug"]: x.get("health") for x in a.get("apps") or []}
    if a.get("status") == "connected" and apps and all(h in ("healthy", "disabled") for h in apps.values()): break
    time.sleep(10)
print(json.dumps({"login": s, "version": v, "workspaces": sorted(ws), "agent": a.get("status"), "apps": apps}))
