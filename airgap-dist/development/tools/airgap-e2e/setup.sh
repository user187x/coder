#!/usr/bin/env bash
# One-time setup of the air-gapped kind cluster "airgap-test" (README.md's steps, scripted). Needs internet (it pulls
# kind's node image, Traefik, Argo CD and Keycloak before the air gap is turned on) and docker, kind, kubectl, helm,
# openssl. Idempotent: an existing cluster is kept. Then: ./e2e.sh <bundle.tar.gz> && ./step8.sh
set -euo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; B="$(cd "$W/../../../helm-chart" && pwd)"
export KUBECONFIG=$W/kubeconfig
# Helm repositories of its own (not the user's ~/.config/helm and ~/.cache/helm)
export HELM_REPOSITORY_CONFIG=$W/helm/repositories.yaml HELM_REPOSITORY_CACHE=$W/helm/cache HELM_REGISTRY_CONFIG=$W/helm-registry.json
mkdir -p "$W/helm/cache"
say() { printf '\n=== %s\n' "$*"; }

say "kind cluster"
kind get clusters 2>/dev/null | grep -qx airgap-test || kind create cluster --config "$W/kind.yaml" --kubeconfig "$KUBECONFIG"
docker inspect airgap-registry >/dev/null 2>&1 || docker run -d --restart=no --name airgap-registry --tmpfs /var/lib/registry:size=24g -p 127.0.0.1:5001:5000 registry:2 >/dev/null
docker network connect kind airgap-registry 2>/dev/null || true
docker exec airgap-test-control-plane sh -c 'for h in localhost:5001 airgap-registry:5000; do mkdir -p /etc/containerd/certs.d/$h; printf "[host.\"http://airgap-registry:5000\"]\n" > /etc/containerd/certs.d/$h/hosts.toml; done'

say "test PKI (pki/): CA, *.airgap.test, OIDC client secret"
P=$W/pki; mkdir -p "$P"
if [[ ! -s $P/ca.crt ]]; then
	openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=airgap-test CA" -keyout "$P/ca.key" -out "$P/ca.crt" \
		-addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
	openssl req -newkey rsa:2048 -nodes -subj "/CN=*.airgap.test" -keyout "$P/wildcard.key" -out "$P/wildcard.csr" 2>/dev/null
	openssl x509 -req -in "$P/wildcard.csr" -CA "$P/ca.crt" -CAkey "$P/ca.key" -CAcreateserial -days 825 -out "$P/wildcard.crt" \
		-extfile <(printf 'subjectAltName=DNS:*.airgap.test,DNS:airgap.test\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n') 2>/dev/null
	openssl rand -hex 24 >"$P/oidc-client-secret.txt"
fi

say "Gateway API, Traefik (prereqs/), TLS"
kubectl apply --server-side -f "$B/prereqs/gateway-api-v1.6.0-standard-install.yaml" >/dev/null
kubectl create ns traefik --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n traefik create secret tls airgap-tls --cert="$P/wildcard.crt" --key="$P/wildcard.key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
helm upgrade --install traefik "$B/prereqs/traefik-41.4.0.tgz" -n traefik \
	-f <(sed 's/grey-marshall-tls/airgap-tls/' "$B/prereqs/traefik-41.4.0.reference-values.yaml") --set service.type=ClusterIP --wait >/dev/null

say "Argo CD"
helm upgrade --install argocd argo-cd --repo https://argoproj.github.io/argo-helm --version 10.8.1 -n argocd \
	--create-namespace --set dex.enabled=false --wait --timeout 10m >/dev/null

say "Keycloak (development, client coder + user tester)"
kubectl apply -f "$W/keycloak.yaml" >/dev/null
kubectl -n keycloak rollout status deploy/keycloak --timeout=600s >/dev/null
"$W/keycloak-setup.sh"

say "CoreDNS: *.airgap.test -> Traefik"
if ! kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}' | grep -q airgap; then
	kubectl -n kube-system get cm coredns -o json | python3 -c '
import json, sys
cm = json.load(sys.stdin)
cm["data"]["Corefile"] = cm["data"]["Corefile"].replace("    kubernetes ",
    "    rewrite name regex ^(.+)\\.airgap\\.test\\.?$ traefik.traefik.svc.cluster.local answer auto\n    kubernetes ", 1)
print(json.dumps(cm))' | kubectl apply -f - >/dev/null
	kubectl -n kube-system rollout restart deploy/coredns >/dev/null
	kubectl -n kube-system rollout status deploy/coredns --timeout=120s >/dev/null
fi

say "Service default/airgap-registry (Argo CD reaches the charts through it)"
RIP=$(docker inspect airgap-registry -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}')
kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Service
metadata: {name: airgap-registry, namespace: default}
spec: {ports: [{name: http, port: 5000, targetPort: 5000}]}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: airgap-registry-1
  namespace: default
  labels: {kubernetes.io/service-name: airgap-registry}
addressType: IPv4
ports: [{name: http, port: 5000}]
endpoints: [{addresses: ["$RIP"]}]
EOF

say "air gap"
"$W/airgap-on.sh"
echo "ready: ./e2e.sh <coder-airgapped-<version>.tar.gz>, then ./step8.sh"
