#!/usr/bin/env bash
# Build the pinned Neko addon without changing template versions or bundle pins.
set -Eeuo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source_dir=${NEKO_SOURCE_DIR:?exact upstream checkout required}
context_dir=${1:?new private build context directory required}
image=${2:-docker.io/mrshll187/coder-workspace-dataflow:1.2.0-neko.1}
commit=65fba485de2987998c7028b04240b21669d674e0
[[ $(git -C "$source_dir" rev-parse HEAD) == "$commit" ]]
[[ ! -e $context_dir ]]
mkdir -m 0700 -p "$context_dir/upstream"
git -C "$source_dir" archive "$commit" server utils/xorg-deps runtime/xorg.conf LICENSE | tar -xf - -C "$context_dir/upstream"
find "$here/../workspace-image-dataflow/neko" -maxdepth 1 -type f ! -name 'test_*' -exec cp {} "$context_dir/" \;
python3 - "$context_dir" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
record = {'neko_commit': '65fba485de2987998c7028b04240b21669d674e0',
          'base': 'sha256:8f9b632921c6b4ff85fcd522fa9226bc45807d18908e1c99710cad6e5aa484f1',
          'sdk': 'sha256:1896654cfc5c2b5ad74c07f29cb36f5d2d1cbed42e3054070fbfe444e521e83c',
          'ubuntu_snapshot': '20261024T000000Z', 'dtls': 'v3.1.4',
          'advisory': 'https://github.com/pion/dtls/security/advisories/GHSA-wg4g-wm44-ch5j',
          'security_patch_sha256': hashlib.sha256((root / 'security.patch').read_bytes()).hexdigest(),
          'build_files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.iterdir()) if p.is_file()}}
(root / 'provenance.json').write_text(json.dumps(record, sort_keys=True, indent=2) + '\n')
PY
docker build --platform linux/amd64 --pull=false -t "$image" "$context_dir"
docker image inspect "$image" --format '{{.Id}}'
