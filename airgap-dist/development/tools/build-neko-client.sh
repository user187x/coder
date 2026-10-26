#!/usr/bin/env bash
# Build only the pinned upstream browser client; never use workspace-served HTML.
set -euo pipefail
umask 022
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
commit=65fba485de2987998c7028b04240b21669d674e0
if [[ $# != 2 ]]; then
    echo 'usage: build-neko-client.sh source-repository new-output-directory' >&2
    exit 2
fi
source_repo="$(realpath "$1")"
output="$(realpath -m "$2")"
case "$output" in "$source_repo"|"$source_repo"/*) echo 'Output must be outside the source checkout.' >&2; exit 1 ;; esac
[[ ! -e "$output" && ! -L "$output" ]] || { echo 'Output directory must not exist.' >&2; exit 1; }
[[ "$(git --no-replace-objects -c core.attributesFile=/dev/null -C "$source_repo" rev-parse "${commit}^{commit}")" == "$commit" ]] || exit 1
node_version="$(node --version)"
case "$node_version" in v22.*|v24.*) ;; *) echo 'Node.js 22 or 24 is required.' >&2; exit 1 ;; esac
npm_version="$(npm --version)"
work="$(mktemp -d "${TMPDIR:-/mnt/data}/coder-neko-client.XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/source" "$work/home"
git --no-replace-objects -c core.attributesFile=/dev/null -C "$source_repo" archive "$commit" | tar -xf - -C "$work/source"
git -C "$work/source" apply --check "$here/neko/relay-only.patch"
git -C "$work/source" apply "$here/neko/relay-only.patch"
epoch="$(git --no-replace-objects -c core.attributesFile=/dev/null -C "$source_repo" show -s --format=%ct "$commit")"
clean_env=(env -i "PATH=$PATH" "HOME=$work/home" "TMPDIR=$work" 'LANG=C.UTF-8' 'TZ=UTC' 'CI=true' "SOURCE_DATE_EPOCH=$epoch" "npm_config_cache=$work/npm-cache")
(
    cd "$work/source/client"
    "${clean_env[@]}" npm ci --ignore-scripts --no-audit --no-fund
    "${clean_env[@]}" npm run build -- --dest "$work/assets"
)
"${clean_env[@]}" node "$here/neko/verify-relay.cjs" "$work/source/client" "$work/assets"
cp "$work/source/LICENSE" "$work/assets/LICENSE-neko.txt"
python3 - "$work" "$commit" "$node_version" "$npm_version" "$here/neko/relay-only.patch" <<'PY'
import hashlib, json, os, pathlib, shutil, sys
work = pathlib.Path(sys.argv[1])
client = work / 'source/client'
assets = work / 'assets'
licenses = assets / 'licenses'
packages = []
for directory, children, names in os.walk(client / 'node_modules', followlinks=False):
    children[:] = sorted(name for name in children if not (pathlib.Path(directory) / name).is_symlink())
    folder = pathlib.Path(directory)
    if 'package.json' not in names or not (folder.parent.name == 'node_modules' or (folder.parent.name.startswith('@') and folder.parent.parent.name == 'node_modules')):
        continue
    package = json.loads((folder / 'package.json').read_text())
    relative = folder.relative_to(client / 'node_modules')
    packages.append({'path': str(relative), 'name': package.get('name'), 'version': package.get('version'), 'license': package.get('license')})
    for name in sorted(names):
        source = folder / name
        if name.lower().startswith(('license', 'licence', 'notice', 'copying')) and source.is_file() and not source.is_symlink():
            destination = licenses / relative / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
(assets / 'dependency-licenses.json').write_text(json.dumps(packages, sort_keys=True, separators=(',', ':')) + '\n')
provenance = {'upstream_commit': sys.argv[2], 'node': sys.argv[3], 'npm': sys.argv[4],
              'lock_sha256': hashlib.sha256((client / 'package-lock.json').read_bytes()).hexdigest(),
              'patch_sha256': hashlib.sha256(pathlib.Path(sys.argv[5]).read_bytes()).hexdigest(),
              'filename_normalization': 'sha256-16'}
(assets / 'coder-neko-build.json').write_text(json.dumps(provenance, sort_keys=True, separators=(',', ':')) + '\n')
PY
python3 "$here/neko/manifest.py" "$work/assets"
mkdir -p "$(dirname "$output")"
# The destination is new; do not merge assets with an earlier build.
mv -T -n "$work/assets" "$output"
[[ ! -d "$work/assets" ]] || { echo 'Output appeared during the build; refusing replacement.' >&2; exit 1; }
echo "trusted_client=$output"
