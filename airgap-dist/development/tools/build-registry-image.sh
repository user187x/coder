#!/usr/bin/env bash
# Builds ghcr.io/user187x/coder-registry:<TAG> (../registry-image): the Images view's registry (coder-image-registry,
# where built images are kept) - distribution's release built from source with the Go release and Go modules that fix
# the vulnerabilities its own binary carries, on Alpine with its fixes, running as a regular user - checks it serves as
# the chart runs it (uid 1000, read-only root), and saves it into the delivery bundle (mirror-images.sh store). Needs
# internet (Docker Hub, GitHub, the Go module proxy).
#   ./build-registry-image.sh TAG     e.g. 3.1.2-1: distribution 3.1.2, the image's first build
# A newer Go or module fix: change go_image / modules below and build the next TAG. Then pin it: images.txt
# ([image-builder]) and imageBuilder.registry.image in values.yaml.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"; top="$(dirname "$dev")"
tag="${1:?usage: build-registry-image.sh TAG}"; version="${tag%%-*}"; img="ghcr.io/user187x/coder-registry:${tag}"
# what it is built from, pinned
go_image=docker.io/library/golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade
alpine_image=docker.io/library/alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
declare -A source_sums=([3.1.2]=2f9b6fc00bec854e62e9b720903a9c9b48018505177f7c7a8ce7b74da2b23e4f)
# the release's modules with known fixes: golang.org/x/net (HTTP/2), x/crypto, OpenTelemetry's trace exporters
modules="golang.org/x/net@v0.61.0 golang.org/x/crypto@v0.58.0 \
go.opentelemetry.io/otel/exporters/otlp/otlptrace@v1.45.0 \
go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc@v1.45.0 \
go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v1.45.0"
sum="${source_sums[$version]:?no source checksum for distribution ${version}: add it to source_sums}"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/coder-airgapped/registry"; mkdir -p "$cache"
ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"; [[ -n "${cid:-}" ]] && docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

src="${cache}/distribution-v${version}.tar.gz"
if [[ ! -f "$src" ]] || ! echo "${sum}  ${src}" | sha256sum -c --quiet 2>/dev/null; then
	curl -fsSL -o "${src}.part" "https://github.com/distribution/distribution/archive/refs/tags/v${version}.tar.gz"
	echo "${sum}  ${src}.part" | sha256sum -c --quiet || { rm -f "${src}.part"; echo "ERROR: checksum mismatch: distribution v${version}" >&2; exit 1; }
	mv "${src}.part" "$src"
fi
cp "${dev}/registry-image/Dockerfile" "${dev}/registry-image/config.yml" "${dev}/registry-image/entrypoint.sh" "$ctx/"
cp "$src" "$ctx/source.tar.gz"
docker build --platform linux/amd64 -t "$img" \
	--build-arg GO_IMAGE="$go_image" --build-arg ALPINE_IMAGE="$alpine_image" --build-arg MODULES="$modules" \
	--build-arg VERSION="$version" --build-arg REVISION="coder-${tag}" "$ctx"

# it serves as the chart runs it: uid 1000, a read-only root, its volume the only place it writes
cid=$(docker run -d --read-only --user 1000:1000 --tmpfs /var/lib/registry:uid=1000,gid=1000 \
	-e REGISTRY_STORAGE_DELETE_ENABLED=true "$img")
for _ in $(seq 30); do
	docker exec "$cid" wget -qO- http://127.0.0.1:5000/v2/ >/dev/null 2>&1 && break
	sleep 1
done
docker exec "$cid" wget -qO- http://127.0.0.1:5000/v2/ | grep -q '^{}$' || { docker logs "$cid" | tail -20; echo "ERROR: it does not answer /v2/" >&2; exit 1; }
[[ "$(docker image inspect "$img" --format '{{.Config.User}}')" == "1000:1000" ]] || { echo "ERROR: not a regular user" >&2; exit 1; }
docker run --rm --entrypoint registry "$img" --version | grep -q " ${version}" || { echo "ERROR: not distribution ${version}" >&2; exit 1; }
docker rm -f "$cid" >/dev/null; cid=

# pinned: its [image-builder] line in images.txt (tag, image ID) and imageBuilder.registry.image in values.yaml
python3 - "$top" "$img" "$(docker image inspect "$img" --format '{{.Id}}')" <<'PY'
import re, sys
top, img, iid = sys.argv[1:]
used = ("Images view: coder-image-registry, where built images are kept - distribution built from source with Go's and "
        "its modules' fixes, as a regular user (development/registry-image)")
p = top + "/helm-chart/images.txt"
s = open(p).read()
pat = re.compile(r"^(?:docker\.io/library/registry|ghcr\.io/user187x/coder-registry):\S+\s+sha256:\S+.*$", re.M)
assert len(pat.findall(s)) == 1, "images.txt: not one registry line"
s = pat.sub(lambda m: "%-57s %s   %s" % (img, iid, used), s)
open(p, "w").write(s)
p = top + "/helm-chart/coder-airgapped/values.yaml"
s = open(p).read()
pat = re.compile(r'(registry:\n(?:    .*\n)*?    image: .\{\{ include "platform\.image" \(list \. ")[^"]+(")')
assert len(pat.findall(s)) == 1, "values.yaml: not one imageBuilder.registry.image"
s = pat.sub(lambda m: m.group(1) + img + m.group(2), s)
open(p, "w").write(s)
print("pinned %s %s" % (img, iid[:19]))
PY
# its archive in the bundle, in its section's folder of images.txt (replacing the previous tag's)
"${top}/helm-chart/mirror-images.sh" store "$img"
echo "built ${img}: distribution ${version} on Alpine $(docker run --rm --entrypoint cat "$img" /etc/alpine-release), ${go_image%%@*}"
