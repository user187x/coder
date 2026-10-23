#!/usr/bin/env bash
# The one-step install, end to end, on a bare air-gapped cluster: a 2-node kind cluster with all non-private egress
# blocked, a site registry beside it (our coder-registry image) - then exactly what INSTALL.md says: push-images.sh,
# and ONE `helm install` with one values file (values.example.yaml + the site's answers), in a namespace and under a
# release name that are not "coder". No other kubectl touches the cluster before the install.
#
#   ./run.sh RELEASE_DIR [up|install|check|uninstall|down|all]     (default: all = up install check)
#     RELEASE_DIR  a release folder (development/tools/build-release.sh --out ...)
#
# Leaves the cluster up for a look (down removes it and the registry). Kubeconfig: $W/kubeconfig.
set -euo pipefail
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REL="$(cd "${1:?RELEASE_DIR}" && pwd)"
STEP="${2:-all}"
CL=onestep
REG=onestep-registry
PORT=5002                       # the registry, from this machine (push-images.sh)
DOMAIN=onestep.test
NS=coder-fork
RELEASE=coder-fork
export KUBECONFIG="$W/kubeconfig"
say() { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
nodes() { kind get nodes --name "$CL"; }

up() {
	say "kind cluster $CL (2 nodes), registry $REG, egress blocked"
	kind get clusters 2>/dev/null | grep -qx "$CL" || kind create cluster --name "$CL" --config "$W/kind.yaml" --kubeconfig "$KUBECONFIG"
	docker inspect "$REG" >/dev/null 2>&1 ||
		docker run -d --restart=no --name "$REG" --tmpfs /var/lib/registry:size=30g,uid=1000,gid=1000 -p "127.0.0.1:${PORT}:5000" \
			ghcr.io/user187x/coder-registry:3.1.2-1 >/dev/null
	docker network connect kind "$REG" 2>/dev/null || true
	for n in $(nodes); do
		docker exec "$n" sh -c "mkdir -p /etc/containerd/certs.d/${REG}:5000 && printf '[host.\"http://${REG}:5000\"]\n' >/etc/containerd/certs.d/${REG}:5000/hosts.toml"
		docker exec -i "$n" sh -s <<'EOF'
set -e
for t in iptables ip6tables; do
  for c in OUTPUT FORWARD; do $t -N AIRGAP-$c 2>/dev/null || $t -F AIRGAP-$c; $t -C $c -j AIRGAP-$c 2>/dev/null || $t -I $c 1 -j AIRGAP-$c; done
done
for c in OUTPUT FORWARD; do
  for n in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do iptables -A AIRGAP-$c -d $n -j RETURN; done
  iptables -A AIRGAP-$c -j REJECT
  ip6tables -A AIRGAP-$c -d ::1/128 -j RETURN; ip6tables -A AIRGAP-$c -d fe80::/10 -j RETURN; ip6tables -A AIRGAP-$c -d fd00::/8 -j RETURN; ip6tables -A AIRGAP-$c -j REJECT
done
EOF
	done
	if docker exec "$(nodes | head -1)" sh -c 'timeout 5 wget -q -O- https://ghcr.io >/dev/null 2>&1'; then
		echo "ERROR: the nodes still reach the internet" >&2; exit 1
	fi
	echo "  egress blocked on $(nodes | wc -l) nodes"
}

install() {
	say "1. push-images.sh 127.0.0.1:${PORT} (every image)"
	"$REL/push-images.sh" "127.0.0.1:${PORT}" | tail -3
	say "2. values.yaml from values.example.yaml"
	python3 - "$REL/values.example.yaml" "$W/values.yaml" "$DOMAIN" "${REG}:5000" <<'PY'
import sys, re
src, dst, domain, registry = sys.argv[1:]
s = open(src).read()
s = s.replace("domain: example.com ", "domain: %s " % domain, 1)
s = s.replace("registry: registry.example.com/coder ", "registry: %s " % registry, 1)
s = s.replace('    password: ""                            # "" = random', '    password: "admin"                       # "" = random', 1)
s = s.replace("    type: LoadBalancer", "    type: NodePort", 1)
# a cluster with no DNS for the domain, kubelets with self-signed certificates (kind)
s = s.replace("  gateway:\n    name: traefik-gateway", "  inClusterDNS:\n    enabled: true\n  gateway:\n    name: traefik-gateway", 1)
s += "\nmetricsServer:\n  kubeletInsecureTLS: true\n"
open(dst, "w").write(s)
PY
	grep -nE 'domain:|registry:|password:|type: NodePort|inClusterDNS|kubeletInsecureTLS' "$W/values.yaml" | head
	say "3. THE install: helm install ${RELEASE} $(basename "$REL"/coder-airgapped-*.tgz) -n ${NS} --create-namespace -f values.yaml"
	local t0; t0=$(date +%s)
	helm install "$RELEASE" "$REL"/coder-airgapped-*.tgz -n "$NS" --create-namespace -f "$W/values.yaml"
	echo "  helm install returned after $(($(date +%s) - t0)) s"
}

check() { python3 "$W/check.py" "$KUBECONFIG" "$NS" "$DOMAIN" "$RELEASE"; }

uninstall() {
	say "uninstall: helm uninstall, then the namespace"
	local t0; t0=$(date +%s)
	helm uninstall "$RELEASE" -n "$NS" --wait --timeout 10m
	kubectl delete namespace "$NS" --wait=true --timeout=10m
	echo "  gone after $(($(date +%s) - t0)) s"
	kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -c "coder-airgapped" || true
}

down() {
	kind delete cluster --name "$CL" --kubeconfig "$KUBECONFIG" || true
	docker rm -f "$REG" >/dev/null 2>&1 || true
	rm -f "$KUBECONFIG"
}

case "$STEP" in
up) up ;; install) install ;; check) check ;; uninstall) uninstall ;; down) down ;;
all) up; install; check ;;
*) echo "unknown step: $STEP" >&2; exit 2 ;;
esac
