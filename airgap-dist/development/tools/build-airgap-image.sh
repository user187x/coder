#!/usr/bin/env bash
# Builds docker.io/mrshll187/coder-platform:<release version> (RELEASE_VERSION; the fork's image + Terraform provider
# mirror) and saves it into the delivery bundle (helm-chart/images/custom/), replacing the previous one. Update its
# digest in images.txt.
#   ./build-airgap-image.sh [BASE]          BASE: the fork's image without the mirror (scripts/build_docker.sh --target),
#                                           default coder-platform-base:<release> (local docker, or the private backup)
#   ./build-airgap-image.sh --upstream BASE the rollback image instead: docker.io/mrshll187/coder-upstream:<release>, pure
#                                           upstream Coder at the fork's base commit on BASE, e.g.
#                                           ghcr.io/coder/coder:v2.38.0 (development/coder-fork/ROLLBACK.md)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"; top="$(dirname "$dev")"
release="$(cat "$(dirname "$top")/RELEASE_VERSION")"
repo=coder-platform
if [[ "${1:-}" == --upstream ]]; then repo=coder-upstream; shift; [[ -n "${1:-}" ]] || { echo "usage: $0 --upstream BASE" >&2; exit 2; }; fi
base="${1:-coder-platform-base:${release}}"; img="docker.io/mrshll187/${repo}:${release}"
ctx="${dev}/airgap-image"
# The base image: local docker, else the registry, else the backup in ~/coder-airgapped-private/images/
docker image inspect "$base" >/dev/null 2>&1 || docker pull "$base" 2>/dev/null ||
	docker load -i "${HOME}/coder-airgapped-private/images/$(basename "${base//:/-}").tar.gz"
rm -rf "${ctx}/template"; mkdir -p "${ctx}/template"
cp "${top}"/helm-chart/coder-airgapped/charts/coder-workspace/files/*.tf "${ctx}/template/"
# Terraform: built from source in the image (../airgap-image/Dockerfile), the newest 1.16 (Coder's provisioner accepts
# up to 1.16.9), with a current Go
tf=1.16.6
docker build --build-arg BASE="$base" --build-arg TERRAFORM_VERSION="$tf" -t "$img" "$ctx"
# its archive in the bundle, in its section's folder of images.txt (replacing the previous tag's)
"${top}/helm-chart/mirror-images.sh" store "$img"
echo "built $img (terraform $tf)"
docker run --rm --entrypoint sh "$img" -c 'find /opt/terraform/plugins -maxdepth 4 -mindepth 3 -type d | sed "s|/opt/terraform/plugins/||"'
