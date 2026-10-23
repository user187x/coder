#!/usr/bin/env bash
# Builds ghcr.io/user187x/coder-image-tools:<TAG> (../image-tools): the platform service's image with shellcheck, shfmt,
# trivy (+ its vulnerability database, downloaded now), regctl and copa (Copacetic: the Images view's pit stops patch
# images with it, through BuildKit), and saves it into the delivery bundle
# (helm-chart/images/custom/), replacing the previous one. Needs internet (the binaries, copa's source, the Go modules
# and the database). shfmt, regctl and copa are built from their release tags in the Dockerfile's Go stage.
# Then update its [custom] line (tag, digest) in helm-chart/images.txt and uiUpdates.image in values.yaml.
#   ./build-image-tools.sh [TAG]           default 1.2.0
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"; top="$(dirname "$dev")"
tag="${1:-1.2.0}"; img="ghcr.io/user187x/coder-image-tools:${tag}"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/coder-airgapped/image-tools"; mkdir -p "$cache"
ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"' EXIT
cp "${dev}/image-tools/Dockerfile" "$ctx/"; mkdir -p "$ctx/bin" "$ctx/trivy-cache"

fetch() { # URL SHA256 [NAME] -> path of the verified download (kept in the cache, as NAME or the URL's file name)
	local url="$1" sum="$2" file="${cache}/${3:-$(basename "$1")}"
	if [[ ! -f "$file" ]] || ! echo "${sum}  ${file}" | sha256sum -c --quiet 2>/dev/null; then
		curl -fsSL -o "${file}.part" "$url"
		echo "${sum}  ${file}.part" | sha256sum -c --quiet || { rm -f "${file}.part"; echo "ERROR: checksum mismatch: $url" >&2; exit 1; }
		mv "${file}.part" "$file"
	fi
	echo "$file"
}
gh=https://github.com
f=$(fetch "$gh/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz" \
	8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198)
tar -xJf "$f" -C "$ctx" && mv "$ctx/shellcheck-v0.11.0/shellcheck" "$ctx/bin/" && rm -rf "$ctx/shellcheck-v0.11.0"
# the checksum is the release's trivy_0.76.0_checksums.txt line
f=$(fetch "$gh/aquasecurity/trivy/releases/download/v0.76.0/trivy_0.76.0_Linux-64bit.tar.gz" \
	e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7)
tar -xzf "$f" -C "$ctx/bin" trivy
chmod 0755 "$ctx"/bin/*
# Copacetic: patches an image's OS (and, experimental, Python/Node.js) packages in place through BuildKit (Images > Fix
# image > Pit stop). Its release's source, built in the Dockerfile with newer modules and Go: the release binary
# (copa_0.15.0_linux_amd64.tar.gz) was built with a Go and modules that have had CVEs fixed since. shfmt (v3.14.1) and
# regctl (v0.11.6) are built there too, from their modules.
f=$(fetch "$gh/project-copacetic/copacetic/archive/refs/tags/v0.15.0.tar.gz" \
	603d0882485fc41d27173a52b5d9c50c92223066bc40592cec2423f6da35d142 copacetic-0.15.0-src.tar.gz)
mkdir "$ctx/copacetic" && tar -xzf "$f" -C "$ctx/copacetic" --strip-components=1
# The vulnerability database as of today (its date shows in every security report).
"$ctx/bin/trivy" image --download-db-only --cache-dir "$ctx/trivy-cache" --no-progress >/dev/null
du -sh "$ctx/trivy-cache" | sed 's/^/trivy database: /'

docker build --platform linux/amd64 -t "$img" "$ctx"
docker run --rm --network none --entrypoint sh "$img" -c '
	set -e
	printf "#!/bin/bash\nif [ \$1 ]\nthen\necho hi\nfi\n" > /tmp/t.sh
	shfmt -i 1 /tmp/t.sh | grep -q "^ echo hi$"
	printf "echo \$foo\n" > /tmp/u.sh; ! shellcheck -s bash -f json /tmp/u.sh >/tmp/l.json; grep -q "\"code\":2086" /tmp/l.json
	trivy --version | grep -q "^Version: 0.76.0$" && trivy --version | grep -q "Vulnerability DB"
	copa --version | grep -q "0.15.0"
	regctl version | grep -q "v0.11.6" && test "$(shfmt --version)" = v3.14.1
	echo "image-tools checks passed"'
# its archive in the bundle, where images.txt lists it; it ships inside the platform service's image
# (coder-ui-updates, build-ui-image.sh), which images.txt lists instead
if grep -q '^ghcr.io/user187x/coder-image-tools:' "${top}/helm-chart/images.txt"; then
	"${top}/helm-chart/mirror-images.sh" store "$img"
else
	echo "not stored on its own: build-ui-image.sh builds the platform service's image on it"
fi
echo "built $img; image ID $(docker image inspect --format '{{.Id}}' "$img")"
