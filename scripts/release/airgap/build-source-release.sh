#!/usr/bin/env bash
# Build the fork images without exporting full image archives. Run while connected.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../../.." && pwd)
registry=${1:?Usage: build-source-release.sh REGISTRY [--dataflow] [--push] [--plan]}
shift
registry=${registry%/}
[[ "$registry" != *://* && "$registry" != *[[:space:]]* && "$registry" != -* ]] || {
	echo 'Use a registry host/path without https:// or spaces.' >&2
	exit 2
}
dataflow=0 push=0 plan=0
for option in "$@"; do
	case "$option" in
	--dataflow) dataflow=1 ;;
	--push) push=1 ;;
	--plan) plan=1 ;;
	*)
		echo "Unknown option: $option" >&2
		exit 2
		;;
	esac
done
chart="$root/airgap-dist/helm-chart/coder-airgapped"
version=$(sed -n 's/^appVersion: "\(.*\)"/\1/p' "$chart/Chart.yaml")
out="$root/build/release-$version"
if ((plan)); then
	printf 'Release: %s\nRegistry: %s\nBuild: Enterprise and AGPL servers, image tools, UI service, DEFAULT workspace, registry, MinIO\nDATAFLOW: %s\nPush: %s\nOutput: %s\n' "$version" "$registry" "$dataflow" "$push" "$out"
	exit 0
fi
for command in docker go pnpm helm python3 curl zstd sha256sum; do
	command -v "$command" >/dev/null || {
		echo "Install $command first. See START-HERE.md." >&2
		exit 1
	}
done
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]] || {
	echo 'Use a Linux x86_64 build machine.' >&2
	exit 1
}
docker info >/dev/null
[[ -s "$root/airgap-dist/filebrowser-quantum" ]] || {
	echo 'Missing FileBrowser payload. Extract the complete build kit.' >&2
	exit 1
}
export CODER_SKIP_IMAGE_ARCHIVES=1
# The source kit has no .git directory. scripts/lib.sh accepts src as its root.
export src="$root"
mkdir -p "$out/platform" "$out/platform-agpl"
cd "$root/site"
pnpm install --frozen-lockfile
pnpm build
cd "$root"
"$here/build-agent-archive.sh" "$version" linux/amd64
"$root/scripts/build_go.sh" --version "$version" --os linux --arch amd64 --output "$out/platform/coder"
"$root/scripts/build_go.sh" --version "$version" --os linux --arch amd64 --agpl --output "$out/platform-agpl/coder"
docker build --platform linux/amd64 -f scripts/Dockerfile.base -t "coder-runtime:$version" scripts
docker build --platform linux/amd64 -f scripts/Dockerfile --build-arg "BASE_IMAGE=coder-runtime:$version" --build-arg "CODER_VERSION=$version" -t "coder-platform-base:$version" "$out/platform"
"$here/build-airgap-image.sh" "coder-platform-base:$version"
docker build --platform linux/amd64 -f scripts/Dockerfile --build-arg "BASE_IMAGE=coder-runtime:$version" --build-arg "CODER_VERSION=$version" -t "coder-platform-agpl-base:$version" "$out/platform-agpl"
"$here/build-airgap-image.sh" --agpl "coder-platform-agpl-base:$version"
ensure_image() {
	local image=$1
	shift
	if ! docker image inspect "$image" >/dev/null 2>&1; then "$@"; fi
}
restore_image() {
	local image=$1 digest
	digest=$(awk -v image="$image" '$1 == image {print $2}' "$root/airgap-dist/helm-chart/images.txt")
	[[ -n "$digest" ]] || {
		echo "No pinned digest for $image" >&2
		return 1
	}
	docker pull --platform linux/amd64 "${image%:*}@$digest"
	docker tag "${image%:*}@$digest" "$image"
}
ensure_image "docker.io/mrshll187/coder-upstream:${version}" restore_image "docker.io/mrshll187/coder-upstream:${version}"
ensure_image "docker.io/mrshll187/coder-image-tools:${version}" "$here/build-image-tools.sh"
ensure_image "docker.io/mrshll187/coder-workspace:${version}" "$here/build-workspace-image.sh"
ensure_image "docker.io/mrshll187/coder-registry:${version}" "$here/build-registry-image.sh"
ensure_image "docker.io/mrshll187/coder-minio:${version}" "$here/build-minio-image.sh"
if ((dataflow)); then
	ensure_image "docker.io/mrshll187/coder-workspace-dataflow:${version}" "$here/build-dataflow-image.sh" --no-store
else
	ensure_image "docker.io/mrshll187/coder-workspace-dataflow:${version}" restore_image "docker.io/mrshll187/coder-workspace-dataflow:${version}"
fi
"$here/build-ui-image.sh"
python3 "$here/pin_images.py" "$root/airgap-dist/helm-chart/images.txt"
python3 "$here/image-contents.py"
# The service serves the inventory of the images built above.
"$here/build-ui-image.sh"
helm lint "$chart"
helm template coder-fork "$chart" --set global.bundled.traefik=true --set global.bundled.cloudnativePG=true --set "coder-workspace.dataflowTemplate.enabled=$([[ $dataflow == 1 ]] && echo true || echo false)" >"$out/rendered.yaml"
helm template coder-fork "$chart" -f "$root/airgap-dist/helm-chart/values-ha.example.yaml" --set global.bundled.traefik=true --set global.bundled.cloudnativePG=true --set "coder-workspace.dataflowTemplate.enabled=$([[ $dataflow == 1 ]] && echo true || echo false)" >>"$out/rendered.yaml"
python3 - "$out" "$root/airgap-dist/helm-chart/images.txt" "$version" <<'PY'
import pathlib,re,sys
out=pathlib.Path(sys.argv[1])
text=out.joinpath('rendered.yaml').read_text()
refs=set()
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
 if line.startswith(('ghcr.io/','docker.io/','cr.yandex/','registry.k8s.io/')):
  ref=line.split()[0]
  if ref in text or ref.startswith('docker.io/mrshll187/'): refs.add(ref)
refs.add('docker.io/mrshll187/coder-platform:'+sys.argv[3])
refs.add('docker.io/mrshll187/coder-platform-agpl:'+sys.argv[3])
refs.add('docker.io/mrshll187/coder-workspace:'+sys.argv[3])
refs={r for r in refs if not r.startswith('docker.io/mrshll187/coder-platform:') or r.endswith(':'+sys.argv[3])}
out.joinpath('FORK-IMAGES.txt').write_text(''.join(r+'\n' for r in sorted(refs) if r.startswith('docker.io/mrshll187/')))
out.joinpath('PUBLIC-IMAGES.txt').write_text(''.join(r+'\n' for r in sorted(refs) if not r.startswith('docker.io/mrshll187/')))
PY
: >"$out/BUILT-IMAGES.txt"
while IFS= read -r image; do
	docker image inspect "$image" >/dev/null
	target="$registry/${image#docker.io/}"
	docker tag "$image" "$target"
	printf '%s\n' "$target" >>"$out/BUILT-IMAGES.txt"
	if ((push)); then docker push "$target"; fi
done <"$out/FORK-IMAGES.txt"
helm package "$chart" --destination "$out"
helm package "$root/helm/coder-platform" --destination "$out"
cp "$root/airgap-dist/helm-chart/images.txt" "$out/images.txt"
cp "$chart/files/ui-updates/image-contents.json" "$out/image-contents.json"
# Preserve generated pins in canonical source when the temporary installer tree is removed.
source_root=${CODER_SOURCE_ROOT:-$root}
cp "$out/images.txt" "$source_root/packaging/airgap/images.txt"
cp "$out/image-contents.json" "$source_root/platform/image-contents.json"
python3 - "$root" "$out" "$registry" "$dataflow" <<'PY'
import pathlib,sys
root,out,registry,dataflow=sys.argv[1:]
s=pathlib.Path(root,'airgap-dist/helm-chart/values.example.yaml').read_text()
s=s.replace('registry.example.com/coder',registry)
if dataflow=='1':
 s+='\ncoder-workspace:\n  dataflowTemplate:\n    enabled: true\n'
pathlib.Path(out,'values.yaml').write_text(s)
PY
printf '\nBuild finished. Files: %s\nEdit values.yaml, then follow START-HERE.md.\n' "$out"
if ((!push)); then echo 'Images are local only. Push every line in BUILT-IMAGES.txt before installing.'; fi
