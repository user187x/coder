#!/usr/bin/env bash
# Builds ghcr.io/user187x/coder-minio:<MinIO release> - the safe's object storage (helm-chart values userStorage.minio)
# - and saves it into the delivery bundle (helm-chart/images/custom/), replacing the previous one. Update its tag in
# helm-chart/coder-airgapped/values.yaml (userStorage.minio.image) and its line in images.txt.
#   ./build-minio-image.sh [SOURCE_DIGEST]
# The MinIO project publishes no images (source only since October 2025; its community repository is archived), so
# this is Chainguard's build (cgr.dev/chainguard/minio, rebuilt as fixes land; its free tier is "latest" only), pinned
# by the digest of its linux/amd64 image and tagged with the MinIO release it reports. Nothing else is changed.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; top="$(cd "${here}/../.." && pwd)"
source_repo=cgr.dev/chainguard/minio
digest="${1:-sha256:c93745c56fccdaf0e5dcb88999a96a65a136428beb045ef5d546255a80d747a7}"
docker pull --platform linux/amd64 -q "${source_repo}@${digest}" >/dev/null
release=$(docker run --rm --platform linux/amd64 "${source_repo}@${digest}" --version | awk '/^minio version/ {print $3}')
[[ "$release" =~ ^RELEASE\.[0-9T:-]+Z$ ]] || { echo "unexpected MinIO version: ${release}" >&2; exit 1; }
img="ghcr.io/user187x/coder-minio:${release}"
docker tag "${source_repo}@${digest}" "$img"
# its archive in the bundle, in its section's folder of images.txt (replacing the previous tag's)
"${top}/helm-chart/mirror-images.sh" store "$img"
echo "built ${img} = ${source_repo}@${digest} ($(docker image inspect "$img" --format '{{.Id}}'))"
