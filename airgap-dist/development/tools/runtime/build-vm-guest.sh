#!/usr/bin/env bash
# Bake a standalone immutable gold root from an independently verified Ubuntu24 image.
# Usage: build-vm-guest.sh BASE_IMAGE VERIFIED_BASE_SHA256 OUTPUT_QCOW2
set -Eeuo pipefail
umask 077
base=$(realpath "${1:?verified Ubuntu24 base image required}")
expected=${2:?verified base SHA256 required}
output=$(realpath -m "${3:?new output QCOW2 path required}")
[[ ! -e $output ]] || { echo 'Refusing to overwrite output.' >&2; exit 1; }
printf '%s  %s\n' "$expected" "$base" | sha256sum --check --status
for tool in qemu-system-x86_64 qemu-img ssh scp ssh-keygen xorriso python3; do command -v "$tool" >/dev/null; done
[[ -r /dev/kvm && -w /dev/kvm ]] || { echo 'KVM acceleration required; no emulation fallback.' >&2; exit 1; }
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
source_dir=$repo/airgap-dist/helm-chart/coder-airgapped/files/vmguest
profile=$repo/airgap-dist/helm-chart/coder-airgapped/files/ui-updates/vmprofile.py
work=$(mktemp -d "${TMPDIR:-/tmp}/coder-guest-bake.XXXXXX")
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$work/workspace-tunnel" "$repo/cmd/workspace-tunnel"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$work/launch-gate" "$repo/cmd/workspace-vm-launch-gate"
python3 - "$work/launch-gate" <<'ELF'
import pathlib, struct, sys
binary = pathlib.Path(sys.argv[1]).read_bytes()
assert binary[:6] == b'\x7fELF\x02\x01', 'gate must be a Linux amd64 static executable'
offset = struct.unpack_from('<Q', binary, 32)[0]
size, count = struct.unpack_from('<HH', binary, 54)
assert all(struct.unpack_from('<I', binary, offset + index * size)[0] != 3 for index in range(count)), 'gate must not load an image interpreter'
ELF
pid=''
cleanup() {
  if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid"; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -C coder-gold-bake -f "$work/key"
port=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); print(sock.getsockname()[1])
PY
)
python3 - "$work" <<'PY'
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
config = {'hostname': 'coder-guest-bake', 'ssh_pwauth': False, 'disable_root': True,
          'users': [{'name': 'builder', 'sudo': 'ALL=(ALL) NOPASSWD:ALL', 'shell': '/bin/bash',
                     'ssh_authorized_keys': [work.joinpath('key.pub').read_text().strip()]}]}
work.joinpath('user-data').write_text('#cloud-config\n' + json.dumps(config))
work.joinpath('meta-data').write_text('instance-id: coder-guest-bake\nlocal-hostname: coder-guest-bake\n')
PY
xorriso -as mkisofs -quiet -output "$work/seed.iso" -volid cidata -joliet -rock "$work/user-data" "$work/meta-data"
qemu-img create -q -f qcow2 -F qcow2 -b "$base" "$work/root.qcow2" 16G
qemu-system-x86_64 -accel kvm -machine q35 -cpu Haswell-noTSX -smp 2 -m 3072 -display none -no-reboot \
  -drive "file=$work/root.qcow2,format=qcow2,if=virtio,discard=unmap,detect-zeroes=unmap" -drive "file=$work/seed.iso,format=raw,media=cdrom,readonly=on" \
  -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$port-:22" -device virtio-net-pci,netdev=n0 \
  -serial "file:$work/serial.log" > "$work/qemu.log" 2>&1 &
pid=$!
ssh_args=(-i "$work/key" -o "UserKnownHostsFile=$work/known_hosts" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 -p "$port")
for attempt in $(seq 1 90); do
  kill -0 "$pid" 2>/dev/null || { cat "$work/qemu.log" >&2; exit 1; }
  if ssh "${ssh_args[@]}" builder@127.0.0.1 true 2>/dev/null; then break; fi
  [[ $attempt != 90 ]] || { echo 'Guest boot timed out.' >&2; exit 1; }
  sleep 2
done
ssh "${ssh_args[@]}" builder@127.0.0.1 'cloud-init status --wait >/dev/null; mkdir -p /tmp/coder-vm-source'
scp -q -i "$work/key" -o "UserKnownHostsFile=$work/known_hosts" -P "$port" "$source_dir"/runner.py "$source_dir"/coder-workspace.service "$source_dir"/install-guest.sh "$source_dir"/seal-guest.sh "$source_dir"/private_config.py "$source_dir"/user_command.py "$source_dir"/user-command-wrapper.py "$repo/airgap-dist/helm-chart/coder-airgapped/files/ui-updates/clouddrive_cli.py" "$source_dir"/source-wrapper.py "$source_dir"/launch-user.sh "$source_dir"/registry-relay.py "$source_dir"/coder-vm-registry.service "$repo/airgap-dist/helm-chart/coder-airgapped/files/ui-updates/drivesource.py" "$work/workspace-tunnel" "$work/launch-gate" "$profile" builder@127.0.0.1:/tmp/coder-vm-source/
ssh "${ssh_args[@]}" builder@127.0.0.1 'sudo bash /tmp/coder-vm-source/install-guest.sh'
# The supervisor/validator source digests are recorded outside the image, with no credentials.
sha256sum "$source_dir"/*.py "$source_dir"/*.sh "$source_dir"/*.service "$work/workspace-tunnel" "$work/launch-gate" "$profile" \
  "$repo/airgap-dist/helm-chart/coder-airgapped/files/ui-updates/clouddrive_cli.py" \
  "$repo/airgap-dist/helm-chart/coder-airgapped/files/ui-updates/drivesource.py" > "$output.sources.sha256"
ssh "${ssh_args[@]}" builder@127.0.0.1 'sudo bash /tmp/coder-vm-source/seal-guest.sh' || true
for attempt in $(seq 1 90); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  [[ $attempt != 90 ]] || { echo 'Guest sealing did not power off; no image will be published.' >&2; exit 1; }
  sleep 2
done
wait "$pid"
pid=''
qemu-img check "$work/root.qcow2"
qemu-img convert -O qcow2 -c "$work/root.qcow2" "$output"
sha256sum "$output" > "$output.sha256"
echo "Gold root baked: $output. Package it as an immutable containerDisk and qualify a real KubeVirt guest before allowing its digest."
