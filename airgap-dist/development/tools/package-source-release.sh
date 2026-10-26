#!/usr/bin/env bash
# Package committed source and the custom FileBrowser payload, never saved images.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../../.." && pwd)
version=$(sed -n 's/^appVersion: "\(.*\)"/\1/p' "$root/airgap-dist/helm-chart/coder-airgapped/Chart.yaml")
out=${1:?Usage: package-source-release.sh OUTPUT-DIRECTORY}
mkdir -p "$out"
out=$(realpath "$out")
built="$root/build/release-$version"
[[ -s "$built/FORK-IMAGES.txt" ]] || { echo 'Run build-source-release.sh first.' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
name="coder-build-kit-$version"
mkdir "$stage/$name"
git -C "$root" archive HEAD | tar -xf - -C "$stage/$name"
cp "$root/airgap-dist/filebrowser-quantum" "$stage/$name/airgap-dist/filebrowser-quantum"
git -C "$root" rev-parse HEAD > "$stage/$name/RELEASE-COMMIT"
cp "$here/release/START-HERE.md" "$stage/$name/START-HERE.md"
cp "$here/release/START-HERE.md" "$out/START-HERE.md"
cp "$built/"*.tgz "$out/"
cp "$built/FORK-IMAGES.txt" "$built/PUBLIC-IMAGES.txt" "$out/"
python3 - "$root" "$out" <<'PY'
import json,pathlib,re,sys
root,out=map(pathlib.Path,sys.argv[1:])
refs=set()
for path in [root/'scripts/Dockerfile.base',*root.glob('airgap-dist/development/*/Dockerfile')]:
 for line in path.read_text().splitlines():
  m=re.match(r'(?:FROM\s+|ARG\s+\w+=)([^\s]+)',line)
  if m and '/' in m[1] and '$' not in m[1] and not m[1].startswith('ghcr.io/user187x/'):
   refs.add(m[1])
for path in root.glob('airgap-dist/development/tools/build-*.sh'):
 for value in re.findall(r'(?:go_image|alpine_image)=([^\s]+)',path.read_text()):
  if '/' in value and '$' not in value:
   refs.add(value.strip('"'))
# MinIO is a public image retag, not a fork source build.
minio=(root/'airgap-dist/development/tools/build-minio-image.sh').read_text()
digest=re.search(r'digest="\$\{1:-(sha256:[a-f0-9]+)\}"',minio)
if digest: refs.add('cgr.dev/chainguard/minio@'+digest[1])
out.joinpath('BUILD-BASE-IMAGES.txt').write_text('\n'.join(sorted(refs))+'\n')
out.joinpath('IMAGE-INVENTORY.json').write_text(json.dumps({
 'format':'source-build-kit',
 'version':re.search(r'appVersion: "([^"]+)"',(root/'airgap-dist/helm-chart/coder-airgapped/Chart.yaml').read_text())[1],
 'fork_images':out.joinpath('FORK-IMAGES.txt').read_text().splitlines(),
 'public_runtime_images':out.joinpath('PUBLIC-IMAGES.txt').read_text().splitlines(),
 'public_build_base_images':sorted(refs),
 'optional_dataflow':'ghcr.io/user187x/coder-workspace-dataflow:1.1.4',
 'build_command':'./airgap-dist/development/tools/build-source-release.sh REGISTRY --push',
 'notes':['Build on a connected Linux x86_64 machine. Base images alone do not supply package/source downloads.','No saved container images are included. DATAFLOW is disabled unless --dataflow is used.']
},indent=2)+'\n')
PY
tar -C "$stage" -cf - "$name" | gzip -6 > "$out/$name.tar.gz"
(cd "$out" && sha256sum -- START-HERE.md *.tgz *.tar.gz *IMAGES.txt IMAGE-INVENTORY.json > SHA256SUMS)
echo "Source release packaged: $out"
