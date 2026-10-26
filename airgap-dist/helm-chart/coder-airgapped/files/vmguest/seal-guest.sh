#!/usr/bin/env bash
# Run as root immediately before powering off the disposable image builder.
set -Eeuo pipefail
systemctl stop docker docker.socket || true
systemctl disable ssh.service ssh.socket || true
systemctl mask ssh.service ssh.socket
cloud-init clean --logs --machine-id
rm -rf /var/lib/cloud/instances /var/lib/cloud/instance /var/lib/cloud/seed /tmp/coder-vm-source /tmp/coder-sysbox.deb
rm -f /etc/ssh/ssh_host_* /root/.ssh/authorized_keys
find /home /root -name authorized_keys -type f -delete
userdel -f -r builder 2>/dev/null || true
userdel -f -r ubuntu 2>/dev/null || true
printf '%s\n' coder-workspace > /etc/hostname
printf '%s\n' '127.0.0.1 localhost' '127.0.1.1 coder-workspace' > /etc/hosts
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -s /etc/machine-id /var/lib/dbus/machine-id
apt-get clean
rm -rf /var/lib/docker /var/lib/systemd/random-seed /var/lib/dhcp/*
rm -f /etc/netplan/50-cloud-init.yaml /etc/udev/rules.d/70-persistent-net.rules
find /var/log -type f -delete
find /tmp /var/tmp -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
# Zero released blocks so builder credentials/log contents are not retained in free space.
dd if=/dev/zero of=/zero-free-space bs=16M status=none || true
rm -f /zero-free-space
mkdir -p /var/lib/coder-workspace
printf '%s\n' sealed-v1 > /var/lib/coder-workspace/gold-image-sealed
sync
echo CODER_GOLD_SEALED
systemctl poweroff
