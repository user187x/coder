#!/usr/bin/env bash
# Live rollback on the test cluster: the running deployment switched to the rollback image (pure upstream Coder) through
# Argo CD, with the workspaces it has (step 8's "e2e"); they must stay, their agent reconnect and their apps stay
# healthy; then back to the fork. Run after step8.sh. Log: rollback-live.log.
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
exec > >(tee "$W/rollback-live.log") 2>&1
B=$(ls -d "$W"/airgap/coder-airgapped-* | head -1)
UP=$(awk '$1 ~ /^ghcr.io\/user187x\/coder-upstream:/ {print $1; exit}' "$B/images.txt")
FORK_TAG=$(kubectl -n coder get deploy coder -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')
probe() { "$W/inpod.sh" "$W/rollback_probe.py" "$@" 2>&1 | tail -1; }
cat >"$W/rollback_probe.py" <<'PY'
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
PY
fails=0
check() { if [[ "$2" == 0 ]]; then echo "PASS $1${3:+ - $3}"; else echo "FAIL $1${3:+ - $3}"; fails=$((fails + 1)); fi; }
set_image() { # repo tag
	kubectl -n argocd patch application coder --type=merge -p "{\"spec\":{\"source\":{\"helm\":{\"valuesObject\":{\"coder\":{\"coder\":{\"image\":{\"repo\":\"localhost:5001/${1#*/}\",\"tag\":\"$2\"}}}}}}}}" >/dev/null
	for _ in $(seq 60); do [[ "$(kubectl -n coder get deploy coder -o jsonpath='{.spec.template.spec.containers[0].image}')" == *":$2" ]] && break; sleep 10; done
	kubectl -n coder rollout status deploy/coder --timeout=600s >/dev/null 2>&1
}
before=$(probe); echo "fork:     $before"
set_image "${UP%:*}" "${UP##*:}"
up=$(probe); echo "upstream: $up"
[[ "$up" == *'"login": 201'* && "$up" == *v2.38.0-main* ]]; check "rolled back: pure upstream Coder serves, the admin signs in" $?
[[ "$up" == *'"e2e"'* && "$up" == *'"agent": "connected"'* ]]; check "rolled back: the workspace is there and its agent (the fork's) connected to upstream" $?
[[ "$up" != *unhealthy* && "$up" == *'"code-server": "healthy"'* ]]; check "rolled back: the workspace's apps healthy" $?
set_image ghcr.io/user187x/coder-platform "$FORK_TAG"
after=$(probe); echo "fork:     $after"
[[ "$after" == *'"login": 201'* && "$after" == *platform* && "$after" == *'"agent": "connected"'* ]]; check "rolled forward: the fork serves again, the workspace connected" $?
echo; echo "$fails failed"; exit $((fails > 0))
