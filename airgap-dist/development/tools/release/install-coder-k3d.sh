#!/usr/bin/env bash
# Install the prebuilt release into a new local k3d cluster, without touching Minikube.
set -Eeuo pipefail
version=1.2.0
k3s_image=rancher/k3s:v1.35.5-k3s1
cluster=coder-fresh
registry_name=coder-registry.localhost
registry_port=5500
assets="$HOME/coder-k3d"
data_dir="$HOME/coder-k3d-data"
domain=127.0.0.1.sslip.io
trust_ca=0
plan=0
usage() {
 cat <<'HELP'
Usage: bash install-coder-k3d.sh [options]
  --assets-dir DIR  Existing flat release folder, or where downloads go.
  --cluster NAME    New cluster name (default: coder-fresh).
  --domain DOMAIN   Local test domain (default: 127.0.0.1.sslip.io).
  --data-dir DIR    Persistent storage folder (default: ~/coder-k3d-data).
  --trust-ca        Install this cluster's generated CA into Linux system trust using sudo.
  --plan           Print the plan without changing anything.
  --help           Show this help.
Docker, k3d, kubectl, Helm, Python 3 and coreutils must be installed.
GitHub CLI (gh) is needed only when release files are missing.
Internet access is needed for initial k3d/K3s images and the default test domain's DNS.
Existing clusters are never deleted. Minikube and your current kubectl context are not changed.
HELP
}
while (($#)); do
 case "$1" in
 --assets-dir) assets=${2:?Directory required}; shift ;;
 --cluster) cluster=${2:?Name required}; shift ;;
 --domain) domain=${2:?Domain required}; shift ;;
 --data-dir) data_dir=${2:?Directory required}; shift ;;
 --trust-ca) trust_ca=1 ;;
 --plan) plan=1 ;;
 --help|-h) usage; exit 0 ;;
 *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
 esac
 shift
done
[[ "$cluster" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo 'Use a lowercase cluster name containing letters, numbers and hyphens.' >&2; exit 2; }
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z0-9]+$ ]] || { echo 'Use a domain name without https://, a port or a path.' >&2; exit 2; }
if ((plan)); then
 printf 'Release: %s\nCluster: %s\nFiles: %s\nStorage: %s\nURL: https://coder.%s\nPorts: 127.0.0.1:80, 127.0.0.1:443, 127.0.0.1:%s\nInstall system CA: %s\n' "$version" "$cluster" "$assets" "$data_dir" "$domain" "$registry_port" "$trust_ca"
 exit 0
fi
for tool in docker k3d kubectl helm python3 sha256sum gzip base64; do
 command -v "$tool" >/dev/null || { echo "Missing $tool. Install it, then run this script again." >&2; exit 1; }
done
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]] || { echo 'Run this installer on Linux x86_64.' >&2; exit 1; }
docker info >/dev/null
if ((trust_ca)); then
 command -v update-ca-certificates >/dev/null || { echo '--trust-ca requires update-ca-certificates. Omit the option and import the CA manually on other distributions.' >&2; exit 1; }
 command -v sudo >/dev/null || { echo '--trust-ca requires sudo.' >&2; exit 1; }
fi
mkdir -p "$assets" "$data_dir"
assets=$(cd "$assets" && pwd)
data_dir=$(cd "$data_dir" && pwd)
kubeconfig="$assets/k3d-$cluster.kubeconfig"
marker="$assets/.k3d-$cluster-install.json"
exists=0
if k3d cluster list -o json | python3 -c 'import json,sys;sys.exit(0 if any(c["name"]==sys.argv[1] for c in json.load(sys.stdin)) else 1)' "$cluster"; then
 exists=1
 [[ -f "$marker" ]] || { echo "Cluster $cluster already exists and was not created by this installer. Use --cluster ANOTHER-NAME. Nothing was deleted." >&2; exit 1; }
 python3 - "$marker" "$cluster" "$domain" "$data_dir" <<'PY'
import json,sys
p,cluster,domain,data=sys.argv[1:]
assert json.load(open(p))=={'cluster':cluster,'domain':domain,'data_dir':data}, 'Existing installer settings differ. Use a different cluster name and data directory.'
PY
fi
if ((!exists)); then
 python3 - <<'PY'
import socket
for port in (80,443):
 with socket.socket() as s:
  s.settimeout(1)
  if s.connect_ex(('127.0.0.1',port)) == 0:
   raise SystemExit(f'Port {port} is already in use. Free that port before continuing. Minikube was not changed.')
PY
fi
on_error() {
 local code=$?
 echo >&2
 echo "Installation stopped at line $1. Fix the error above, then run the same command again." >&2
 if [[ -s "$kubeconfig" ]]; then
  kubectl --kubeconfig "$kubeconfig" -n coder-fork get pods >&2 || true
 fi
 exit "$code"
}
trap 'on_error "$LINENO"' ERR
printf '\n[1/7] Checking release files in %s\n' "$assets"
if [[ ! -s "$assets/OFFLINE-SHA256SUMS" ]]; then
 need_download=1
else
 need_download=$(python3 - "$assets" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); names=[l.split(None,1)[1].strip().lstrip('*') for l in (p/'OFFLINE-SHA256SUMS').read_text().splitlines() if l.strip()]
print(int(any(not (p/n).is_file() for n in names)))
PY
)
fi
if [[ "$need_download" == 1 ]]; then
 command -v gh >/dev/null || { echo "Release files are missing. Install GitHub CLI (gh), or copy all offline release files into $assets." >&2; exit 1; }
 gh release download "$version" --repo user187x/coder --dir "$assets" --skip-existing \
  --pattern '*_*.tar.gz*' --pattern '*.tgz' --pattern 'OFFLINE-*' \
  --pattern load-and-push.sh --pattern offline-values.example.yaml --pattern START-HERE.md
fi
(cd "$assets" && sha256sum -c --quiet OFFLINE-SHA256SUMS)
printf '\n[2/7] Preparing the local registry\n'
if ! k3d registry list -o json | python3 -c 'import json,sys;sys.exit(0 if any(r["name"]==sys.argv[1] for r in json.load(sys.stdin)) else 1)' "k3d-$registry_name"; then
 python3 - "$registry_port" <<'PY'
import socket,sys
s=socket.socket()
try: s.bind(('127.0.0.1',int(sys.argv[1])))
except OSError as e: raise SystemExit(f'Registry port {sys.argv[1]} is unavailable: {e}')
finally: s.close()
PY
 docker load -i "$assets/coder-registry_3.1.2-1.tar.gz"
 k3d registry create "$registry_name" --image docker.io/user187x/coder-registry:3.1.2-1 --port "127.0.0.1:$registry_port"
fi
docker start "k3d-$registry_name" >/dev/null
printf '\n[3/7] Loading and pushing all 16 images. This can take a while.\n'
bash "$assets/load-and-push.sh" "localhost:$registry_port/coder"
printf '\n[4/7] Creating the cluster\n'
if ((!exists)); then
 # Save ownership before creation so an interrupted run can be resumed.
 python3 - "$marker" "$cluster" "$domain" "$data_dir" <<'PY'
import json,sys
p,cluster,domain,data=sys.argv[1:]
with open(p,'w') as f: json.dump({'cluster':cluster,'domain':domain,'data_dir':data},f)
PY
 k3d cluster create "$cluster" --image "$k3s_image" --servers 1 --agents 0 \
  --registry-use "k3d-$registry_name:$registry_port" \
  --port '127.0.0.1:80:80@loadbalancer' --port '127.0.0.1:443:443@loadbalancer' \
  --volume "$data_dir:/var/lib/rancher/k3s/storage@server:0" \
  --k3s-arg '--disable=traefik@server:*' --k3s-arg '--disable=metrics-server@server:*' \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false --wait --timeout 5m
else
 k3d cluster start "$cluster" --wait --timeout 5m
fi
(umask 077; k3d kubeconfig get "$cluster" > "$kubeconfig")
chmod 600 "$kubeconfig"
kubectl --kubeconfig "$kubeconfig" wait --for=condition=Ready nodes --all --timeout=5m
kubectl --kubeconfig "$kubeconfig" get storageclass local-path >/dev/null
printf '\n[5/7] Installing Coder\n'
python3 - "$assets/k3d-values.yaml" "$domain" "$registry_name" "$registry_port" <<'PY'
import sys
path,domain,registry,port=sys.argv[1:]
with open(path,'w') as f:
 f.write(f'''global:
  domain: {domain}
  registry: k3d-{registry}:{port}/coder
  forkRegistry: ""
  inClusterDNS:
    enabled: true
metricsServer:
  enabled: true
  kubeletInsecureTLS: true
coder-workspace:
  dataflowTemplate:
    enabled: false
''')
PY
helm upgrade --install coder-fork "$assets/coder-airgapped-1.48.0.tgz" \
 --kubeconfig "$kubeconfig" --namespace coder-fork --create-namespace \
 --values "$assets/offline-values.example.yaml" --values "$assets/k3d-values.yaml" \
 --wait --timeout 20m
printf '\n[6/7] Checking the server\n'
kubectl --kubeconfig "$kubeconfig" -n coder-fork rollout status deployment/coder --timeout=10m
kubectl --kubeconfig "$kubeconfig" -n coder-fork rollout status deployment/coder-ui-updates --timeout=10m
kubectl --kubeconfig "$kubeconfig" -n coder-fork get pods
kubectl --kubeconfig "$kubeconfig" -n coder-fork get pvc
printf '\n[7/7] Exporting your test CA and sign-in details\n'
ca="$assets/coder-k3d-ca.crt"
kubectl --kubeconfig "$kubeconfig" -n coder-fork get secret tls-ca -o jsonpath='{.data.ca\.crt}' | base64 -d > "$ca"
if ((trust_ca)); then
 sudo install -m 0644 "$ca" "/usr/local/share/ca-certificates/coder-k3d-$cluster.crt"
 sudo update-ca-certificates
fi
printf '\nDONE. Open: https://coder.%s\nUsername: admin\nInitial password: ' "$domain"
kubectl --kubeconfig "$kubeconfig" -n coder-fork get secret coder-init-auth -o jsonpath='{.data.password}' | base64 -d
printf '\n\nChange the initial password, then create a DEFAULT workspace and open Terminal.\n'
printf 'Kubeconfig: %s\nTest CA: %s\n' "$kubeconfig" "$ca"
if ((!trust_ca)); then
 printf 'Import the test CA into your system/browser trust before signing in, or rerun with --trust-ca on Ubuntu/Debian.\n'
else
 printf 'System CA trust installed. If your browser uses its own certificate store, import the test CA there too.\n'
fi
printf 'No Minikube resources were changed. DATAFLOW and Keycloak setup remain optional.\n'
