#!/usr/bin/env bash
# Package a sealed QCOW2 as a KubeVirt containerDisk; publish only to the supplied registry.
# Usage: package-vm-guest.sh ROOT_QCOW2 REGISTRY_REPOSITORY:TAG
set -Eeuo pipefail
umask 077
root_image=$(realpath "${1:?sealed guest QCOW2 required}")
reference=${2:?target registry reference required}
[[ $reference =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$ ]] || { echo 'Invalid image reference.' >&2; exit 1; }
[[ -f $root_image.sha256 && -f $root_image.sources.sha256 ]] || { echo 'Baked artifact verification sidecars required.' >&2; exit 1; }
sha256sum --check "$root_image.sha256"
work=$(mktemp -d "${TMPDIR:-/tmp}/coder-guest-containerdisk.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp --reflink=auto "$root_image" "$work/root.qcow2"
printf '%s\n' 'FROM scratch' 'ADD --chown=107:107 root.qcow2 /disk/root.qcow2' > "$work/Dockerfile"
docker build --network=none -t "$reference" "$work"
docker push "$reference"
docker image inspect --format '{{json .RepoDigests}}' "$reference"
