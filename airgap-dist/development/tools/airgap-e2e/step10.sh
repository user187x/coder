#!/usr/bin/env bash
# Coder without Keycloak: Keycloak stopped and Coder's Keycloak Secrets removed, then Coder restarted. It must come
# up, and the admin sign in with the password; with Keycloak back, the Keycloak sign-in redirect works again.
# Everything is put back at the end (Secrets, Keycloak and its test realm). Log: step10.log.
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
exec > >(tee "$W/step10.log") 2>&1
fails=0
check() { if [[ "$2" == 0 ]]; then echo "PASS $1${3:+ - $3}"; else echo "FAIL $1${3:+ - $3}"; fails=$((fails + 1)); fi; }
probe() { # what a browser inside the network gets: password sign-in status, OIDC enabled, the OIDC redirect
	kubectl -n default delete pod step10 --ignore-not-found --wait=true >/dev/null 2>&1
	kubectl -n default run step10 --image=localhost:5001/library/python:3.13-alpine --restart=Never --command -- python3 -c '
import json, ssl, urllib.request, urllib.error
ctx = ssl._create_unverified_context(); B = "https://coder.airgap.test"
def call(p, body=None):
    r = urllib.request.Request(B + p, data=json.dumps(body).encode() if body else None, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=20, context=ctx) as x: return x.status, x.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
s, _ = call("/api/v2/users/login", {"email": "admin@admin.com", "password": "admin"})
_, am = call("/api/v2/users/authmethods")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a): return None
op = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
try: loc = op.open(B + "/api/v2/users/oidc/callback", timeout=20).headers.get("Location", "")
except urllib.error.HTTPError as e: loc = e.headers.get("Location", "")
print(json.dumps({"login": s, "oidc": json.loads(am).get("oidc", {}).get("enabled") if am else None, "redirect": loc[:80]}))' >/dev/null
	kubectl -n default wait pod/step10 --for=jsonpath='{.status.phase}'=Succeeded --timeout=120s >/dev/null 2>&1
	kubectl -n default logs step10 | tail -1
}
ready() { kubectl -n coder rollout status deploy/coder --timeout="${1:-300}s" >/dev/null 2>&1; }

kubectl -n coder get secret keycloaking-coder-oidc keycloaking-coder-ca -o yaml >"$W/step10-secrets.yaml"
echo "=== Keycloak stopped, Coder's Keycloak Secrets removed, Coder restarted"
kubectl -n keycloak scale deploy/keycloak --replicas=0 >/dev/null && kubectl -n keycloak wait pod -l app=keycloak --for=delete --timeout=120s >/dev/null 2>&1
kubectl -n coder delete secret keycloaking-coder-oidc keycloaking-coder-ca >/dev/null
kubectl -n coder rollout restart deploy/coder >/dev/null
ready 420; check "Coder starts without Keycloak and without its Secrets" $? "$(kubectl -n coder get pods -l app.kubernetes.io/name=coder -o jsonpath='{range .items[*]}{.status.phase}/{.status.containerStatuses[0].ready} {end}')"
r=$(probe); echo "probe: $r"
[[ "$r" == *'"login": 201'* ]]; check "the admin signs in with the password while Keycloak is down" $?

echo "=== Secrets back, Keycloak back"
kubectl apply -f "$W/step10-secrets.yaml" >/dev/null 2>&1; rm -f "$W/step10-secrets.yaml"
kubectl -n keycloak scale deploy/keycloak --replicas=1 >/dev/null && kubectl -n keycloak rollout status deploy/keycloak --timeout=600s >/dev/null
"$W/keycloak-setup.sh" >/dev/null   # start-dev keeps the realm in memory: the test client and user again
kubectl -n coder rollout restart deploy/coder >/dev/null; ready 420
r=$(probe); echo "probe: $r"
[[ "$r" == *'"login": 201'* && "$r" == *'"oidc": true'* && "$r" == *keycloak.airgap.test* ]]
check "with Keycloak back: password sign-in, and the Keycloak sign-in redirects to Keycloak" $?
kubectl -n default delete pod step10 --ignore-not-found >/dev/null 2>&1
echo; echo "$fails failed"
exit $((fails > 0))
