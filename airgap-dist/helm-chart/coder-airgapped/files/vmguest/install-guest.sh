#!/usr/bin/env bash
# Executed only inside a disposable Ubuntu24 guest image builder.
set -Eeuo pipefail
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]]
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl fuse3=3.14.0-5build1 iptables uidmap rsync jq qemu-guest-agent python3 e2fsprogs util-linux docker.io=29.1.3-0ubuntu3~24.04.2 lxcfs=5.0.4-1 rclone=1.60.1+dfsg-3ubuntu0.24.04.6 wireguard-tools=1.0.20210914-1ubuntu4
curl -fsSL --proto '=https' --tlsv1.2 https://github.com/nestybox/sysbox/releases/download/v0.7.1/sysbox-ce_0.7.1.linux_amd64.deb -o /tmp/coder-sysbox.deb
printf '%s\n' '9d6d5484f980d0a17f86c492c1262015c2afb66280bdb97215b79fde6a0261c5  /tmp/coder-sysbox.deb' | sha256sum -c -
apt-get install -y /tmp/coder-sysbox.deb
apt-mark hold docker.io sysbox-ce lxcfs fuse3 rclone wireguard-tools
python3 - <<'PY'
import json, pathlib
path = pathlib.Path('/etc/docker/daemon.json')
config = json.loads(path.read_text()) if path.exists() else {}
config.setdefault('runtimes', {})['sysbox-runc'] = {'path': '/usr/bin/sysbox-runc'}
config['default-runtime'] = 'sysbox-runc'
config['live-restore'] = False
path.write_text(json.dumps(config, indent=2) + '\n')
PY
mkdir -p /etc/systemd/system/lxcfs.service.d /etc/coder-workspace /usr/local/lib/coder-vm /etc/systemd/journald.conf.d
printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/usr/bin/lxcfs --enable-cfs /var/lib/lxcfs' > /etc/systemd/system/lxcfs.service.d/cpu-quota.conf
printf '%s\n' '[Journal]' 'Storage=volatile' > /etc/systemd/journald.conf.d/volatile.conf
install -m 0755 /tmp/coder-vm-source/runner.py /usr/local/sbin/coder-vm-guest
install -m 0644 /tmp/coder-vm-source/vmprofile.py /usr/local/lib/coder-vm/vmprofile.py
install -m 0644 /tmp/coder-vm-source/coder-workspace.service /etc/systemd/system/coder-workspace.service
install -m 0644 /tmp/coder-vm-source/private_config.py /usr/local/lib/coder-vm/private_config.py
install -m 0644 /tmp/coder-vm-source/user_command.py /usr/local/lib/coder-vm/user_command.py
install -m 0644 /tmp/coder-vm-source/clouddrive_cli.py /usr/local/lib/coder-vm/clouddrive_cli.py
install -m 0755 /tmp/coder-vm-source/user-command-wrapper.py /usr/local/sbin/coder-vm-user-command
install -m 0644 /tmp/coder-vm-source/drivesource.py /usr/local/lib/coder-vm/drivesource.py
install -m 0755 /tmp/coder-vm-source/source-wrapper.py /usr/local/sbin/coder-vm-source
install -m 0755 /tmp/coder-vm-source/private_config.py /usr/local/sbin/coder-vm-config-apply
install -m 0755 /tmp/coder-vm-source/registry-relay.py /usr/local/lib/coder-vm/registry-relay.py
install -m 0555 /tmp/coder-vm-source/launch-gate /usr/local/lib/coder-vm/launch-gate
install -m 0555 /tmp/coder-vm-source/launch-user.sh /usr/local/lib/coder-vm/launch-user.sh
install -m 0755 /tmp/coder-vm-source/workspace-tunnel /usr/local/lib/coder-vm/workspace-tunnel
install -m 0644 /tmp/coder-vm-source/coder-vm-registry.service /etc/systemd/system/coder-vm-registry.service
mkdir -p /etc/systemd/system/qemu-guest-agent.service.d /etc/modules-load.d
printf '%s\n' '[Service]' 'UMask=0077' > /etc/systemd/system/qemu-guest-agent.service.d/private.conf
printf '%s\n' wireguard > /etc/modules-load.d/coder-wireguard.conf
modprobe wireguard
chmod 0700 /etc/coder-workspace
swapoff -a
sed -i '/^[^#].*[[:space:]]swap[[:space:]]/s/^/# disabled for workspace VM: /' /etc/fstab
systemctl daemon-reload
systemctl enable docker sysbox-mgr sysbox-fs lxcfs qemu-guest-agent coder-vm-registry coder-workspace
if ! systemctl restart docker lxcfs sysbox-mgr sysbox-fs; then
  # This phase has no workspace profile or credentials; preserve useful evidence.
  journalctl --no-pager -n 80 -u sysbox-mgr -u sysbox-fs >&2
  exit 1
fi
python3 -m py_compile /usr/local/sbin/coder-vm-guest /usr/local/lib/coder-vm/vmprofile.py
command -v fusermount3 >/dev/null
docker info --format '{{.DefaultRuntime}}' | grep -Fx sysbox-runc
docker run --name coder-gold-sysbox-smoke --runtime=sysbox-runc --cpus=1 --memory=128m --memory-swap=128m --user=1000:1000 ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac sh -c 'read inside outside size < /proc/self/uid_map; test "$inside" -eq 0 && test "$outside" -gt 0 && test "$size" -ge 65536'
[[ $(docker inspect --format '{{.HostConfig.Runtime}} {{.HostConfig.Privileged}} {{.HostConfig.Memory}}' coder-gold-sysbox-smoke) == 'sysbox-runc false 134217728' ]]
docker rm coder-gold-sysbox-smoke
# No workspace token, user startup script or tenant image is present in the gold image.
[[ ! -e /etc/coder-workspace/runtime.json ]]
