#!/usr/bin/env bash
# Export the qualified amd64 KubeVirt image digests to an offline OCI bundle.
# Usage: bundle-kubevirt-images.sh NEW_OUTPUT_DIRECTORY
set -Eeuo pipefail
umask 077
output=${1:?new output directory required}
[[ ! -e $output ]]
command -v skopeo >/dev/null || { echo 'Install skopeo on the packaging machine.' >&2; exit 1; }
root=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
cp "$root/kubevirt-v1.8.4-images.json" "$output/image-lock.json"
while IFS='|' read -r component source; do
  skopeo copy --preserve-digests "docker://$source" "oci:$output/$component:v1.8.4"
done < <(python3 - "$root/kubevirt-v1.8.4-images.json" <<'PY'
import json,sys
for name, record in json.load(open(sys.argv[1]))['images'].items():
    print(name+'|'+record['source'])
PY
)
sums=$(mktemp)
trap 'rm -f "$sums"' EXIT
(cd "$output" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$sums"
mv "$sums" "$output/SHA256SUMS"
echo 'Verify SHA256SUMS after transfer; preserve image digests when importing into the private registry.'
