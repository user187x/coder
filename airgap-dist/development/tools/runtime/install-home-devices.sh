#!/usr/bin/env bash
# Run on the qualified worker with the fixed files copied into a private bundle.
# Usage: sudo install-home-devices.sh BUNDLE_DIR
# Bundle: vmhome.py, vmfs.py, vmprofile.py, vmgpu.py, workspace_runtime.py, vmhome-devices.py,
# 10-coder-vm-home.rules, node-identity.json, and node-api-ca.crt.
set -Eeuo pipefail
[[ $EUID == 0 ]]
bundle=${1:?private source bundle required}
for file in vmhome.py vmfs.py vmprofile.py vmgpu.py workspace_runtime.py vmhome-devices.py 10-coder-vm-home.rules node-identity.json node-api-ca.crt; do [[ -f $bundle/$file && ! -L $bundle/$file ]]; done
# Ubuntu's persistent-storage rule must honor the early opt-out before blkid.
grep -Fq 'ENV{UDEV_DISABLE_PERSISTENT_STORAGE_RULES_FLAG}=="1", GOTO="persistent_storage_end"' /usr/lib/udev/rules.d/60-persistent-storage.rules
install -m 0644 "$bundle/10-coder-vm-home.rules" /etc/udev/rules.d/10-coder-vm-home.rules
udevadm verify /etc/udev/rules.d/10-coder-vm-home.rules
udevadm control --reload-rules
install -d -m 0700 /var/lib/coder-vm-homes
install -d -m 0755 /usr/local/lib/coder-vm
install -d -m 0700 /etc/coder-vm
install -m 0600 "$bundle/node-identity.json" /etc/coder-vm/node-identity.json
install -m 0644 "$bundle/node-api-ca.crt" /etc/coder-vm/node-api-ca.crt
install -m 0644 "$bundle/vmhome.py" "$bundle/vmfs.py" "$bundle/vmprofile.py" "$bundle/vmgpu.py" "$bundle/workspace_runtime.py" /usr/local/lib/coder-vm/
install -m 0755 "$bundle/vmhome-devices.py" /usr/local/sbin/coder-vm-home-devices
PYTHONPATH=/usr/local/lib/coder-vm python3 - <<'PYVERIFY'
import subprocess
import vmhome
vmhome.require_probe_guard()
identity = vmhome.WorkerIdentityClient()
node = vmhome.get(identity, '/api/v1/nodes/' + identity.node_name)
vmhome.identifier(node['metadata']['uid'])
subprocess.run(vmhome.host_loop_args('--version'), check=True, stdout=subprocess.DEVNULL, env=vmhome.LOOP_ENV)
PYVERIFY
cat > /etc/systemd/system/coder-vm-home-devices.service <<'UNIT'
[Unit]
Description=Restore verified workspace HOME block devices
Wants=network-online.target
After=local-fs.target network-online.target
Before=kubelet.service
RequiresMountsFor=/var/lib/coder-vm-homes

[Service]
Type=oneshot
TimeoutStartSec=300
RemainAfterExit=yes
ExecStart=/usr/local/sbin/coder-vm-home-devices
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
mkdir -p /etc/systemd/system/kubelet.service.d
printf '%s\n' '[Unit]' 'Requires=coder-vm-home-devices.service' 'After=coder-vm-home-devices.service' > /etc/systemd/system/kubelet.service.d/coder-vm-home-devices.conf
systemctl daemon-reload
systemctl enable coder-vm-home-devices.service
# Existing HOME records missing node_uid require reviewed cold enrollment before reboot.
# Do not restart kubelet or reconfigure running HOME devices during installation.
