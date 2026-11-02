"""What a Coder server sees on a copy of the database (rollback.sh): sign-in, users, templates, workspaces, builds,
audit. Prints one JSON object (the facts), compared between the fork and upstream by rollback.sh.
  python3 rollback_probe.py URL EMAIL PASSWORD"""
import json, sys, urllib.request
B, EMAIL, PASSWORD = sys.argv[1], sys.argv[2], sys.argv[3]
def req(m, p, b=None, t=None):
    h = {"Content-Type": "application/json"}
    if t: h["Coder-Session-Token"] = t
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
s, l = req("POST", "/api/v2/users/login", {"email": EMAIL, "password": PASSWORD})
facts = {"signIn": s}
t = l["session_token"]
facts["version"] = req("GET", "/api/v2/buildinfo")[1]["version"]
facts["users"] = sorted(u["username"] for u in req("GET", "/api/v2/users", t=t)[1]["users"])
tpls = req("GET", "/api/v2/templates", t=t)[1]
facts["templates"] = {x["name"]: len(req("GET", "/api/v2/templates/%s/versions" % x["id"], t=t)[1]) for x in tpls}
facts["workspaces"] = {}
for w in req("GET", "/api/v2/workspaces", t=t)[1]["workspaces"]:
    res = w["latest_build"]["resources"]
    facts["workspaces"]["%s/%s" % (w["owner_name"], w["name"])] = {
        "build": w["latest_build"]["build_number"], "transition": w["latest_build"]["transition"],
        "builds": len(req("GET", "/api/v2/workspaces/%s/builds" % w["id"], t=t)[1]),
        "agents": sorted(a["name"] for r in res for a in r.get("agents") or []),
        "apps": sorted(ap["slug"] for r in res for a in r.get("agents") or [] for ap in a.get("apps") or [])}
facts["sshKey"] = req("GET", "/api/v2/users/me/gitsshkey", t=t)[0]
facts["appearance"] = req("GET", "/api/v2/users/me/appearance", t=t)[0]
print(json.dumps(facts, sort_keys=True))
