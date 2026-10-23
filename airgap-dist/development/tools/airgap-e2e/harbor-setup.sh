#!/usr/bin/env bash
# A real Harbor (the official chart) with a private CA in the kind cluster "airgap-test", for testing ./make
# --push-images and ./make --argocd the way they run against a customer's Harbor. Run after ./setup.sh; idempotent.
#   - Harbor 2.15 (chart 1.19.2) at https://harbor.airgap.test, behind the Gateway (Traefik), with the test CA's
#     wildcard certificate; Traefik gets hostPort 443, so harbor.airgap.test:443 is the same everywhere: the node
#     (its /etc/hosts), pods (CoreDNS rewrites *.airgap.test to Traefik) and the installing machine below
#   - the node trusts the CA for pulls (containerd: /etc/containerd/certs.d/harbor.airgap.test/)
#   - the admin password in harbor/admin-password; a system robot "robot$argocd" (pull rights) in harbor/argocd.env
#   - the installing machine: container harbor-installer, a docker-in-docker on the kind network with no images and
#     its own docker and helm logins (/etc/docker/certs.d, via sudo, as on a real machine), helm and kubectl from this
#     machine, a copy of the bundle at /bundle (BUNDLE=<folder>, default ../../../helm-chart; without its .deploy;
#     images/ mounted read-only),
#     pki/ at /pki, harbor.airgap.test and coder.airgap.test resolving to the node.
# Harbor's images come from the internet: the air gap is lifted while it installs and put back after.
# Then, e.g.:
#   docker exec --env-file harbor/push.env -e HARBOR_USER=admin -e HARBOR_CA=/pki/ca.crt -e DOCKERHUB_LOGIN=n \
#     -w /bundle harbor-installer ./make --push-images https://harbor.airgap.test/coder-test --yes
# (docker exec --env-file keeps "robot$argocd" as it is; a shell would expand $argocd.)
# Clean up: docker rm -f -v harbor-installer (and kind delete cluster --name airgap-test; docker rm -f airgap-registry).
set -euo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$W/../../.." && pwd)"; BUNDLE="${BUNDLE:-$R/helm-chart}"
export KUBECONFIG=$W/kubeconfig HELM_REPOSITORY_CONFIG=$W/helm/repositories.yaml HELM_REPOSITORY_CACHE=$W/helm/cache
N=airgap-test-control-plane; H=$W/harbor; mkdir -p "$H"; chmod 700 "$H"
say() { printf '\n=== %s\n' "$*"; }
NIP=$(docker inspect $N -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}')

say "air gap lifted while Harbor installs"
docker exec $N sh -c 'for t in iptables ip6tables; do for c in OUTPUT FORWARD; do $t -F AIRGAP-$c 2>/dev/null || true; done; done'
trap '"$W/airgap-on.sh" >/dev/null && echo "air gap back"' EXIT

say "Traefik: hostPort 443"
helm upgrade traefik "$BUNDLE/prereqs/traefik-41.4.0.tgz" -n traefik \
	-f <(sed 's/grey-marshall-tls/airgap-tls/' "$BUNDLE/prereqs/traefik-41.4.0.reference-values.yaml") \
	--set service.type=ClusterIP --set ports.websecure.hostPort=443 --wait >/dev/null

say "Harbor 2.15 (chart 1.19.2)"
[[ -s $H/admin-password ]] || (umask 077; openssl rand -hex 16 >"$H/admin-password")
(umask 077; cat >"$H/values.yaml" <<EOF
expose: {type: clusterIP, tls: {enabled: false}, clusterIP: {name: harbor}}
externalURL: https://harbor.airgap.test
harborAdminPassword: "$(cat "$H/admin-password")"
trivy: {enabled: false}
persistence: {persistentVolumeClaim: {registry: {size: 40Gi}}}
EOF
)
helm repo add harbor https://helm.goharbor.io >/dev/null 2>&1 || true
helm repo update harbor >/dev/null
helm upgrade --install harbor harbor/harbor --version 1.19.2 -n harbor --create-namespace -f "$H/values.yaml" --wait --timeout 15m >/dev/null
kubectl apply -f - >/dev/null <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: harbor, namespace: harbor}
spec:
  hostnames: [harbor.airgap.test]
  parentRefs: [{name: traefik-gateway, namespace: traefik}]
  rules: [{backendRefs: [{name: harbor, port: 80}]}]
EOF

say "the node: harbor.airgap.test -> $NIP, and containerd trusts the CA"
# (through stdin: the node's /tmp is a tmpfs, which hides what docker cp writes there)
docker exec -i $N sh -c 'mkdir -p /etc/containerd/certs.d/harbor.airgap.test && cat >/etc/containerd/certs.d/harbor.airgap.test/ca.crt' <"$W/pki/ca.crt"
docker exec $N sh -c "grep -q ' harbor.airgap.test' /etc/hosts || echo '$NIP harbor.airgap.test' >>/etc/hosts
printf 'server = \"https://harbor.airgap.test\"\n[host.\"https://harbor.airgap.test\"]\n  capabilities = [\"pull\", \"resolve\"]\n  ca = \"/etc/containerd/certs.d/harbor.airgap.test/ca.crt\"\n' >/etc/containerd/certs.d/harbor.airgap.test/hosts.toml
curl -fs --cacert /etc/containerd/certs.d/harbor.airgap.test/ca.crt https://harbor.airgap.test/api/v2.0/ping >/dev/null" && echo "the node reaches Harbor"

say "robot\$argocd (system robot, pull rights)"
(umask 077; printf 'user = "admin:%s"\n' "$(cat "$H/admin-password")" >"$H/curl-admin.cfg"
	printf 'HARBOR_PASSWORD=%s\n' "$(cat "$H/admin-password")" >"$H/push.env")
api() { curl -fsS --cacert "$W/pki/ca.crt" --resolve "harbor.airgap.test:443:$NIP" -K "$H/curl-admin.cfg" -H 'Content-Type: application/json' "$@"; }
if [[ ! -s $H/argocd.env ]]; then
	api -X POST https://harbor.airgap.test/api/v2.0/robots -d '{"name":"argocd","level":"system","duration":-1,
		"description":"coder-airgapped tests: Argo CD chart pulls",
		"permissions":[{"kind":"project","namespace":"*","access":[{"resource":"repository","action":"pull"}]}]}' |
		python3 -c 'import json,sys,os; r=json.load(sys.stdin); f=sys.argv[1]; open(f,"w").write("ARGOCD_USER=%s\nARGOCD_PASSWORD=%s\n" % (r["name"], r["secret"])); os.chmod(f, 0o600)' "$H/argocd.env"
fi
grep -o '^ARGOCD_USER=.*' "$H/argocd.env"

say "the installing machine: harbor-installer (docker-in-docker, no images)"
if ! docker inspect harbor-installer >/dev/null 2>&1; then
	# a copy of the bundle without its .deploy (the installer writes its own there; never the repo's own answers)
	rm -rf "$H/bundle"; mkdir -p "$H/bundle/images"
	(cd "$BUNDLE" && tar -cf - --exclude=./.deploy --exclude=./images --exclude=__pycache__ .) | tar -xf - -C "$H/bundle"
	docker run -d --privileged --network kind --name harbor-installer \
		--add-host "harbor.airgap.test:$NIP" --add-host "coder.airgap.test:$NIP" --add-host "keycloak.airgap.test:$NIP" \
		-v "$H/bundle:/bundle" -v "$BUNDLE/images:/bundle/images:ro" -v "$W/pki:/pki:ro" \
		-v "$(command -v helm):/usr/local/bin/helm:ro" -v "$(command -v kubectl):/usr/local/bin/kubectl:ro" \
		docker:29-dind dockerd --host=unix:///var/run/docker.sock >/dev/null
	until docker exec harbor-installer docker info >/dev/null 2>&1; do sleep 1; done
	docker exec harbor-installer apk add -q bash coreutils grep curl openssl python3 sudo findutils >/dev/null
	kind get kubeconfig --name airgap-test --internal | docker exec -i harbor-installer sh -c 'mkdir -p /root/.kube && cat >/root/.kube/config'
fi
docker exec harbor-installer sh -c 'curl -fs --cacert /pki/ca.crt https://harbor.airgap.test/api/v2.0/ping && echo " (Harbor, from the installing machine)"; kubectl get nodes --no-headers | cut -c1-40'
echo "ready: Harbor https://harbor.airgap.test (admin / harbor/admin-password), installing machine harbor-installer"
