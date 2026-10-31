#!/usr/bin/env bash
# Build the agent downloads from the same source/version as the server before
# scripts/build_go.sh embeds site/out. Defaults to x86-64 client targets.
# Usage: build-agent-archive.sh VERSION [os/arch ...]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../../.." && pwd)
version=${1:?Usage: build-agent-archive.sh VERSION [os/arch ...]}
shift
platforms=("$@")
if ((${#platforms[@]} == 0)); then
  platforms=(linux/amd64 darwin/amd64 windows/amd64)
fi
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
names=()
for platform in "${platforms[@]}"; do
  case "$platform" in
    linux/amd64|linux/arm64|linux/armv7|darwin/amd64|darwin/arm64|windows/amd64|windows/arm64) ;;
    *) echo "Unsupported agent platform: $platform" >&2; exit 1 ;;
  esac
  os=${platform%/*}
  arch=${platform#*/}
  name="coder-$os-$arch"
  [[ "$os" != windows ]] || name+=.exe
  names+=("$name")
  "$root/scripts/build_go.sh" --version "$version" --os "$os" --arch "$arch" --slim --agpl --output "$stage/$name"
done
(cd "$stage" && sha1sum -b "${names[@]}" > coder.sha1)
bin="$root/site/out/bin"
mkdir -p "$bin"
tar -C "$stage" -cf - coder.sha1 "${names[@]}" | zstd -T2 -6 -q > "$bin/coder.tar.zst.partial"
mv "$bin/coder.tar.zst.partial" "$bin/coder.tar.zst"
cp "$stage/coder.sha1" "$bin/coder.sha1"
python3 - "$root" "$version" "${platforms[@]}" <<'PY'
import json, pathlib, subprocess, sys
root, version, *platforms = sys.argv[1:]
revision_file = pathlib.Path(root, "RELEASE-COMMIT")
revision = revision_file.read_text().strip() if revision_file.exists() else subprocess.check_output(["git", "-C", root, "rev-parse", "HEAD"], text=True).strip()
pathlib.Path(root, "site/out/bin/agent-build.json").write_text(json.dumps({"version": version, "revision": revision, "platforms": platforms}, indent=2) + "\n")
PY
echo "Built agent archive $version (${#names[@]} targets)"
