#!/usr/bin/env bash
# QUALIFIED TARGET: fresh Ubuntu 24.04 amd64 worker ONLY. Never run on the host or current Minikube node.
# No Docker daemon, cluster initialization, join token, or kubeadm join command is included.
# Phase 1: sudo bash sysbox-worker-bootstrap.sh install
# Root separately joins the worker using its private workflow, cordons/drains it, then:
# Phase 2: sudo ACK_WORKER_DRAINED=yes bash sysbox-worker-bootstrap.sh after-join RESERVED_CPUSET
# Do not label platform.coder/runtime-ready=true until real Sysbox/LXCFS/cpuset/btop/parent/ephemeral proofs pass.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run as root on the fresh worker.' >&2; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || { echo 'Requires qualified Ubuntu24.04 amd64 worker.' >&2; exit 1; }
[[ $(stat -f -c %T /sys/fs/cgroup) == cgroup2fs ]] || { echo 'Requires unified cgroup v2.' >&2; exit 1; }
phase=${1:-}
state_dir=/var/lib/coder-sysbox-bootstrap

if [[ $phase == install ]]; then
  [[ ! -e /etc/kubernetes/kubelet.conf && ! -e $state_dir/installed ]] || { echo 'Install phase is fresh-worker-only.' >&2; exit 1; }
  if systemctl is-active --quiet docker; then echo 'Docker daemon must not be running.' >&2; exit 1; fi
  mkdir -p "$state_dir" /etc/apt/keyrings
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg python3 python3-yaml jq uidmap rsync iptables fuse3=3.14.0-5build1
  download_dir=$(mktemp -d /var/tmp/coder-sysbox-packages.XXXXXX)
  trap 'rm -rf "$download_dir"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://pkgs.k8s.io/core:/stable:/v1.35/deb/Release.key -o "$download_dir/kubernetes.asc"
  fingerprint=$(gpg --show-keys --with-colons "$download_dir/kubernetes.asc" 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')
  [[ $fingerprint == DE15B14486CD377B9E876E1A234654DA9A296436 ]] || { echo 'Unexpected Kubernetes signing key.' >&2; exit 1; }
  gpg --dearmor --yes --output /etc/apt/keyrings/kubernetes-apt-keyring.gpg "$download_dir/kubernetes.asc"
  chmod 0644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg
  printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.35/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
  # Ubuntu dependencies use the signed Noble archive configured by the verified cloud image.
  # Core binaries below also have explicit hashes taken from the successful proof's signed APT metadata.
  while IFS='|' read -r url algorithm digest filename; do
    [[ -n $url ]] || continue
    curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$url" -o "$download_dir/$filename"
    printf '%s  %s\n' "$digest" "$download_dir/$filename" | "${algorithm}sum" --check --status
  done <<'ASSETS'
https://archive.ubuntu.com/ubuntu/pool/main/c/containerd-app/containerd_2.2.1-0ubuntu1%7e24.04.4_amd64.deb|sha512|b6c991f82584b8748e8a66408c52cb6a90498213359b9427a3a30080527372fbb73065825d522bfd920c4b9ce1411744d4590cc4877f7a4424f68f34042d3865|containerd.deb
https://archive.ubuntu.com/ubuntu/pool/main/r/runc-app/runc_1.3.4-0ubuntu1%7e24.04.1_amd64.deb|sha512|8e188685ad1b49aa08638019106bbd103c9ab4751b23090593b898152179651da7e0118a525dbafc24e86ee576777d9c364936eaac2d8b2b6a5ebc6ba7b10ec7|runc.deb
https://archive.ubuntu.com/ubuntu/pool/universe/l/lxcfs/lxcfs_5.0.4-1_amd64.deb|sha512|4560194feff60b712fac0793e6fc70b8ca202a76d68024873c2d08a4f742c0b3e2b1b4a82cc5b5117397d0833608a9b919e5af030d5c41c2ac3dea3cf80defd3|lxcfs.deb
https://pkgs.k8s.io/core:/stable:/v1.35/deb/amd64/kubeadm_1.35.9-1.1_amd64.deb|sha256|c2917c63b33f10302a9a087bf4ae5591864439a88ae9acf5cd2f2eea8d4233be|kubeadm.deb
https://pkgs.k8s.io/core:/stable:/v1.35/deb/amd64/kubectl_1.35.9-1.1_amd64.deb|sha256|59e5d923d69ab77df6eac0891a4878de209f79d10d94af1e0e3efd9fd841e1ce|kubectl.deb
https://pkgs.k8s.io/core:/stable:/v1.35/deb/amd64/kubelet_1.35.9-1.1_amd64.deb|sha256|fc2e167155114421f4ca31f222c556756a2718f73d5dff947f0065d5b7b88d1a|kubelet.deb
https://github.com/nestybox/sysbox/releases/download/v0.7.1/sysbox-ce_0.7.1.linux_amd64.deb|sha256|9d6d5484f980d0a17f86c492c1262015c2afb66280bdb97215b79fde6a0261c5|sysbox.deb
ASSETS
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y kubernetes-cni=1.8.0-1.1 "$download_dir"/*.deb
  apt-mark hold containerd runc lxcfs sysbox-ce kubelet kubeadm kubectl kubernetes-cni
  # Package installation must not have introduced a Docker daemon.
  docker_packages=$(dpkg-query -W -f='${Status}\n' docker.io docker-ce 2>/dev/null || true)
  if grep -q 'install ok installed' <<<"$docker_packages"; then
    echo 'Unexpected Docker package installed; stop and investigate.' >&2; exit 1
  fi
  mkdir -p /etc/modules-load.d /etc/sysctl.d /etc/containerd
  printf '%s\n' overlay br_netfilter > /etc/modules-load.d/coder-worker.conf
  modprobe overlay
  modprobe br_netfilter
  printf '%s\n' 'net.ipv4.ip_forward=1' 'net.bridge.bridge-nf-call-iptables=1' 'net.bridge.bridge-nf-call-ip6tables=1' > /etc/sysctl.d/99-coder-worker.conf
  sysctl --system >/dev/null
  swapoff -a
  # Fresh configuration only. Do not use an installer snippet for the obsolete v2 CRI plugin path.
  [[ ! -s /etc/containerd/config.toml ]] || cp -a /etc/containerd/config.toml "$state_dir/containerd.before.toml"
  containerd config default | sed 's/SystemdCgroup = false/SystemdCgroup = true/' > /etc/containerd/config.toml
  python3 - <<'PY'
import pathlib, tomllib
path = pathlib.Path('/etc/containerd/config.toml')
config = tomllib.loads(path.read_text())
assert config['version'] == 3, 'qualified containerd requires config v3'
runtimes = config['plugins']['io.containerd.cri.v1.runtime']['containerd']['runtimes']
assert 'sysbox-runc' not in runtimes, 'refuse duplicate Sysbox table'
with path.open('a') as out:
    out.write('\n[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc]\n  runtime_type = "io.containerd.runc.v2"\n  [plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc.options]\n    BinaryName = "/usr/bin/sysbox-runc"\n    SystemdCgroup = true\n')
PY
  # Official native K8s installation disables Docker-dependent inner image preload.
  mkdir -p /etc/systemd/system/sysbox-mgr.service.d
  printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/usr/bin/sysbox-mgr --disable-inner-image-preload' > /etc/systemd/system/sysbox-mgr.service.d/native-containerd.conf
  mkdir -p /etc/systemd/system/lxcfs.service.d
  printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/usr/bin/lxcfs --enable-cfs /var/lib/lxcfs' > /etc/systemd/system/lxcfs.service.d/cpu-quota.conf
  systemctl daemon-reload
  systemctl enable --now containerd sysbox-fs sysbox-mgr lxcfs kubelet
  systemctl restart containerd lxcfs sysbox-mgr sysbox-fs
  containerd --version
  dpkg-query -W containerd runc sysbox-ce lxcfs kubelet kubeadm kubectl kubernetes-cni
  touch "$state_dir/installed"
  echo 'Installed only. Root must join privately, cordon/drain, then run after-join. Worker is NOT runtime-ready.'
elif [[ $phase == after-join ]]; then
  [[ -e $state_dir/installed && -e /etc/kubernetes/kubelet.conf && -e /var/lib/kubelet/config.yaml ]] || { echo 'Requires this fresh worker to be joined first.' >&2; exit 1; }
  [[ ${ACK_WORKER_DRAINED:-} == yes ]] || { echo 'Cordon/drain worker, then set ACK_WORKER_DRAINED=yes.' >&2; exit 1; }
  reserved=${2:-}
  [[ $reserved =~ ^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$ ]] || { echo 'Supply explicit reserved CPU set, e.g. 0.' >&2; exit 1; }
  [[ ! -e $state_dir/after-join-applied ]] || { echo 'After-join already applied; inspect configuration instead of repeating.' >&2; exit 1; }
  python3 - "$reserved" <<'PYVALIDATE'
import os, sys
reserved = set()
for item in sys.argv[1].split(','):
    parts = list(map(int, item.split('-')))
    if len(parts) == 2 and parts[1] < parts[0]:
        raise SystemExit('Reserved CPU range is reversed')
    reserved.update(range(parts[0], parts[-1] + 1))
allowed = os.sched_getaffinity(0)
if not reserved or not reserved < allowed:
    raise SystemExit('Reserved CPUs must be a nonempty proper subset of worker CPUs')
PYVALIDATE
  systemctl stop kubelet
  cp -a /var/lib/kubelet/config.yaml "$state_dir/kubelet.before.yaml"
  [[ ! -e /var/lib/kubelet/cpu_manager_state ]] || cp -a /var/lib/kubelet/cpu_manager_state "$state_dir/cpu_manager_state.before"
  python3 - "$reserved" <<'PY'
import pathlib, sys, yaml
path = pathlib.Path('/var/lib/kubelet/config.yaml')
config = yaml.safe_load(path.read_text())
config['cpuManagerPolicy'] = 'static'
config['reservedSystemCPUs'] = sys.argv[1]
config['cpuCFSQuota'] = True
config['cgroupsPerQOS'] = True
config.setdefault('featureGates', {})['DisableCPUQuotaWithExclusiveCPUs'] = False
path.write_text(yaml.safe_dump(config, sort_keys=False))
PY
  # Supported checkpoint reset only after the explicitly acknowledged drain and stopped kubelet.
  rm -f /var/lib/kubelet/cpu_manager_state
  systemctl start kubelet
  touch "$state_dir/after-join-applied"
  echo 'Static policy configured. Run preflight and real Pod/btop/finite-parent/ephemeral probes before any readiness label.'
else
  echo 'Usage: sysbox-worker-bootstrap.sh install | after-join RESERVED_CPUSET' >&2
  exit 1
fi
