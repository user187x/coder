#!/usr/bin/env bash
# Build the fixed, offline filesystem appliance and its raw-disk coordinator.
set -Eeuo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
source_dir="$root/helm-chart/coder-airgapped/files/ui-updates"
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT
mkdir "$context/app"
for file in vmhome.py vmprofile.py vmgpu.py workspace_runtime.py vmfs.py vmgrow.py vmbackup.py; do
	cp "$source_dir/$file" "$context/app/"
done
cp "$here/maintenance/Dockerfile" "$context/Dockerfile"
revision="$(cd "$context" && { sha256sum Dockerfile; sha256sum app/*.py; } | sha256sum | cut -c1-16)"
image="docker.io/mrshll187/coder-vm-maintenance:code-$revision"
docker build --platform linux/amd64 -t "$image" "$context"
docker run --rm --network none --entrypoint python3 "$image" -c \
    'import vmhome, vmbackup, vmfs, vmgpu
assert vmgpu.status()["enabled"] is False
try:
    vmbackup.worker(None, {}, "unsupported", "")
except ValueError:
    pass
else:
    raise RuntimeError("unsupported maintenance operation was accepted")
print("maintenance entrypoints import without platform API modules")'
printf '%s\n' "$image"
