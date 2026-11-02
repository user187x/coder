#!/usr/bin/env bash
# Optional enclave test artifact. Never called by deployment or release builds.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
version="$(cat "$root/RELEASE_VERSION")"
image="${RESEARCH_IMAGE:-coder-research-sandbox:$version}"
docker build --platform linux/amd64 \
	--build-context "research-source=$root/sandbox_environement" \
	--build-arg "VERSION=$version" --tag "$image" \
	"$root/airgap-dist/development/research-workspace"
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
	--memory 4g --cpus 2 --entrypoint sandbox-guest "$image" \
	/opt/coder-research/smoke.sh --timeout 900
if [[ -n "${RESEARCH_ARCHIVE:-}" ]]; then
	docker save "$image" | gzip >"$RESEARCH_ARCHIVE"
	sha256sum "$RESEARCH_ARCHIVE" >"$RESEARCH_ARCHIVE.sha256"
fi
printf 'Optional research image: %s\n' "$image"
