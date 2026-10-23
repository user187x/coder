#!/usr/bin/env bash
# Fresh end-to-end run of DEPLOY.md steps 1-7 on the air-gapped kind cluster "airgap-test".
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig HELM_REGISTRY_CONFIG=$W/helm-registry.json
TARBALL=$1; P=$W/pki; REGISTRY=localhost:5001; RC=airgap-registry.default.svc.cluster.local:5000/charts
say() { printf '\n=== %s\n' "$*"; }
say "teardown"
kubectl -n argocd delete application coder --ignore-not-found --wait=true >/dev/null
kubectl -n argocd delete secret coder-airgapped-charts --ignore-not-found >/dev/null
for j in $(kubectl -n coder get jobs -o name 2>/dev/null); do kubectl -n coder patch $j --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null; done
kubectl delete ns coder --ignore-not-found --wait=false >/dev/null   # operator still running: finalizers clear
# The chart's metrics API (cluster-wide) outlives its Service: namespaces cannot finish terminating while it is stale.
kubectl get apiservice v1beta1.metrics.k8s.io -o jsonpath='{.metadata.labels.app\.kubernetes\.io/name}' 2>/dev/null | grep -q metrics-server &&
	kubectl delete apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1
kubectl wait ns/coder --for=delete --timeout=300s >/dev/null 2>&1
helm -n cnpg-system uninstall cnpg >/dev/null 2>&1; kubectl delete ns cnpg-system --ignore-not-found --wait=true --timeout=120s >/dev/null
for n in coder cnpg-system; do for _ in $(seq 120); do kubectl get ns $n >/dev/null 2>&1 || break; sleep 5; done; done   # gone, not terminating
kubectl delete clusterrole,clusterrolebinding coder-ui-updates-coder --ignore-not-found >/dev/null
kubectl -n argocd delete role,rolebinding coder-ui-updates --ignore-not-found >/dev/null
docker rm -f airgap-registry >/dev/null; docker run -d --restart=no --name airgap-registry --tmpfs /var/lib/registry:size=24g -p 127.0.0.1:5001:5000 registry:2 >/dev/null
docker network connect kind airgap-registry
RIP=$(docker inspect airgap-registry -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}')
kubectl -n default patch endpointslice airgap-registry-1 --type=json -p "[{\"op\":\"replace\",\"path\":\"/endpoints/0/addresses/0\",\"value\":\"$RIP\"}]" >/dev/null
docker exec airgap-test-control-plane sh -c "crictl images | awk '/^localhost:5001/{print \$1\":\"\$2}' | xargs -r crictl rmi" >/dev/null 2>&1
for d in deploy/argocd-redis deploy/argocd-repo-server statefulset/argocd-application-controller; do kubectl -n argocd rollout restart $d >/dev/null; kubectl -n argocd rollout status $d --timeout=180s >/dev/null; done  # clear Argo CD caches (same chart version re-pushed)
echo "registry empty: $(curl -s http://127.0.0.1:5001/v2/_catalog); node mirror images: $(docker exec airgap-test-control-plane crictl images | grep -c localhost:5001)"
"$W/airgap-on.sh" >/dev/null; "$W/keycloak-setup.sh" >/dev/null   # both are lost when the node restarts
docker exec airgap-test-control-plane timeout 30 crictl pull docker.io/library/alpine:3.20 >/dev/null 2>&1 && { echo "AIR GAP BROKEN"; exit 1; } || echo "air gap in force"
rm -rf $W/connected $W/airgap; mkdir -p $W/connected $W/airgap; tar -xzf "$TARBALL" -C $W/connected; B=$(ls -d $W/connected/coder-airgapped-*)
say "Step 1"; (cd $B && ./mirror-images.sh verify && ./mirror-images.sh list) > $W/s1.log 2>&1 || { echo FAILED; tail $W/s1.log; exit 1; }
tail -n 15 $W/s1.log; grep -q ' absent ' $W/s1.log && { echo "FAILED: images missing from the bundle"; exit 1; }
say "Step 2"; cp -r $B $W/airgap/; A=$W/airgap/$(basename $B)
say "Step 3"   # in a docker with no images at all: everything must come from images/
docker rm -f e2e-dind >/dev/null 2>&1; while docker inspect e2e-dind >/dev/null 2>&1; do sleep 1; done   # removal can lag
# Own network namespace on the kind network (never --network host: its dockerd would take over the host's docker0).
docker run -d --privileged --network kind --name e2e-dind -v $A:/bundle:ro docker:29-dind \
  dockerd --host=unix:///var/run/docker.sock --insecure-registry=airgap-registry:5000 >/dev/null
until docker exec e2e-dind docker info >/dev/null 2>&1; do sleep 1; done
docker exec e2e-dind apk add -q bash coreutils grep >/dev/null
echo "images in the empty docker before: $(docker exec e2e-dind docker images -q | wc -l)"
docker exec -w /bundle e2e-dind ./mirror-images.sh push airgap-registry:5000 > $W/s3.log 2>&1 || { echo FAILED; tail $W/s3.log; exit 1; }   # same registry as localhost:5001
grep -E '^(loading|using|pulling)' $W/s3.log | awk '{print $1}' | sort | uniq -c
grep -qE '^(using|pulling)' $W/s3.log && { echo "FAILED: an image did not come from the bundle"; exit 1; }
docker rm -f e2e-dind >/dev/null; curl -s http://127.0.0.1:5001/v2/_catalog; echo
say "Step 4"; (cd $A && PLAIN_HTTP=1 ./mirror-images.sh chart $REGISTRY/charts 2>&1 | grep -E 'Pushed|Error') 
say "Step 5"; (cd $A && CNPG_IMAGE=$REGISTRY/cloudnative-pg/cloudnative-pg:1.30.0 ./install.sh --prepare-only --cnpg --ca $P/ca.crt --tls-crt $P/wildcard.crt --tls-key $P/wildcard.key --oidc-ca $P/ca.crt --oidc-secret-file $P/oidc-client-secret.txt > $W/s5.log 2>&1) || { echo FAILED; tail $W/s5.log; exit 1; }; sed -n '/==> Secrets/,$p' $W/s5.log
say "Step 6"; python3 -I - $A/argocd/coder-airgapped-application.yaml $RC <<'PY'
import sys, yaml
p, rc = sys.argv[1], sys.argv[2]; sec, app = [d for d in yaml.safe_load_all(open(p)) if d]
sec["stringData"] = {"name": "coder-airgapped-charts", "type": "helm", "enableOCI": "true", "url": rc, "insecureOCIForceHttp": "true"}
app["spec"]["source"]["repoURL"] = rc
v = app["spec"]["source"]["helm"]["valuesObject"]; g = v["global"]
g["domain"] = "airgap.test"; g["registry"] = "localhost:5001"; g["oidc"]["issuerUrl"] = "https://keycloak.airgap.test/realms/master"
v["database"]["storage"]["storageClass"] = "standard"; v["uiUpdates"]["persistence"]["storageClass"] = "standard"
for k in ("registry", "files"):
    v.setdefault("imageBuilder", {}).setdefault(k, {})["storageClass"] = "standard"
v.setdefault("coder-workspace", {})["storageClass"] = "standard"
v.setdefault("metricsServer", {})["kubeletInsecureTLS"] = True   # kind's kubelets: self-signed serving certificates
yaml.safe_dump_all([sec, app], open(p, "w"), sort_keys=False); print("filled in, chart", app["spec"]["source"]["targetRevision"])
PY
say "Step 7"; kubectl apply -f $A/argocd/coder-airgapped-application.yaml; START=$(date +%s)
while :; do
  S=$(kubectl -n argocd get application coder -o jsonpath='{.status.sync.status}/{.status.health.status}/{.status.operationState.phase}' 2>/dev/null)
  [[ "$S" == Synced/Healthy/Succeeded ]] && break
  (( $(date +%s) - START > 1200 )) && break
  kubectl -n argocd wait application/coder --for=jsonpath='{.status.operationState.phase}'=Succeeded --timeout=15s >/dev/null 2>&1
done
echo "Argo CD: $S after $(( $(date +%s) - START ))s"; kubectl -n argocd get application coder -o jsonpath='{.status.operationState.message}{"\n"}'
say "Step 7b: the image builder's base (mirror-images.sh seed-builder, as after an Argo CD install)"
(cd $A && ./mirror-images.sh seed-builder coder) 2>&1 | tail -3
