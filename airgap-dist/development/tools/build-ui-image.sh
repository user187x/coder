#!/usr/bin/env bash
# Builds ghcr.io/user187x/coder-ui-updates:code-<hash>: the platform service (coder-ui-updates) - its code,
# helm-chart/coder-airgapped/files/ui-updates/, in /app of the tools image (coder-image-tools: Python and the tools
# the Images view runs), with the image store's baked pictures in /image-store - and pins it: uiUpdates.image in values.yaml, its [ui] line in images.txt (tag, image ID), and
# its archive in the bundle (helm-chart/images/ui/, mirror-images.sh store).
#
# The chart refers to this image instead of carrying the code in a ConfigMap: Helm keeps every release in a Secret of
# at most 1 MiB, and the code - kept there twice, as the chart's files and as the rendered ConfigMap - had nearly
# filled it. The tag is the code's hash: other code never gets an older build's tag (no same-tag rebuilds), and the
# same code builds to the same tag.
#   ./build-ui-image.sh            build (when the tag is not in docker yet), check, pin
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"; top="$(dirname "$dev")"
src="${top}/helm-chart/coder-airgapped/files/ui-updates"
# The image store's baked pictures and their previews (development/image-store, image-store-thumbs.sh): in the image
# at /image-store, a layer of their own under the code's, so a build of new code ships only the code's layer.
store="${dev}/image-store"
# The install's default logo and avatar (helm-chart/defaults/logo.*, avatar.*): in the image at /defaults/<kind>/, the
# platform service's fallback where no ConfigMap gives them (a one-step Helm install has none; the logo is past a
# ConfigMap's 1 MiB anyway).
defaults="${top}/helm-chart/defaults"
base="ghcr.io/user187x/coder-image-tools:1.2.0"
repo="ghcr.io/user187x/coder-ui-updates"

# The code: every file of files/ui-updates but Python's bytecode; and the image store's files (the tag follows both).
mapfile -t files < <(cd "$src" && find . -maxdepth 1 -type f ! -name '*.pyc' -printf '%P\n' | LC_ALL=C sort)
mapfile -t pictures < <(cd "$store" && find pictures thumbs -type f -printf '%p\n' | LC_ALL=C sort)
for p in "${pictures[@]}"; do
	case "$p" in pictures/*) [ -s "${store}/thumbs/${p#pictures/}.webp" ] || { echo "ERROR: no preview for $p: run development/tools/image-store-thumbs.sh" >&2; exit 1; };; esac
done
mapfile -t baked < <(cd "$defaults" && find . -maxdepth 1 -type f \( -name 'logo.*' -o -name 'avatar.*' \) -printf '%P\n' | LC_ALL=C sort)
hash=$({ (cd "$src" && sha256sum "${files[@]}"); (cd "$store" && sha256sum "${pictures[@]}");
	(cd "$defaults" && sha256sum "${baked[@]}"); } | sha256sum | cut -c1-12)
img="${repo}:code-${hash}"

if docker image inspect "$img" >/dev/null 2>&1; then
	echo "$img is built already (the same code)"
else
	docker image inspect "$base" >/dev/null 2>&1 || { echo "ERROR: $base is not in this docker (build-image-tools.sh, or load it from the bundle)" >&2; exit 1; }
	ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"' EXIT
	mkdir "$ctx/app" "$ctx/image-store" "$ctx/defaults"
	for f in "${baked[@]}"; do
		kind="${f%%.*}"; mkdir -p "$ctx/defaults/$kind"; cp -p "$defaults/$f" "$ctx/defaults/$kind/$f"
	done
	(cd "$src" && cp -- "${files[@]}" "$ctx/app/")
	# as they are in the repository, times too: the same pictures make the same layer
	cp -rp -- "${store}/pictures" "${store}/thumbs" "$ctx/image-store/"
	touch -r "$store" "$ctx/image-store"
	chmod -R a+rX,go-w "$ctx/app" "$ctx/image-store" "$ctx/defaults"
	cat >"$ctx/Dockerfile" <<EOF
FROM ${base}
COPY image-store/ /image-store/
COPY defaults/ /defaults/
COPY app/ /app/
LABEL org.opencontainers.image.title="coder-ui-updates" org.opencontainers.image.revision="code-${hash}"
EOF
	docker build --platform linux/amd64 -q -t "$img" "$ctx" >/dev/null
	# It starts (every module imports) and its tools are there.
	docker run --rm --network none --entrypoint sh "$img" -c '
		set -e
		cd /app && python3 -c "import importlib.util, sys
sys.path.insert(0, \"/app\")
for name in (\"pgwire\", \"safe\", \"dr\", \"drivesource\", \"kitcrypto\", \"kexec\", \"provisioners\", \"s3client\", \"lockdown\", \"imagebuilder\"):
    __import__(name)
spec = importlib.util.spec_from_file_location(\"ui_service\", \"/app/ui-service.py\")
spec.loader.exec_module(importlib.util.module_from_spec(spec))
print(\"modules import\")"
		trivy --version | grep -q "Vulnerability DB"
		copa --version >/dev/null
		shellcheck --version >/dev/null && shfmt --version >/dev/null
		test "$(ls /image-store/pictures | wc -l)" -gt 0 && test "$(ls /image-store/thumbs | wc -l)" -gt 0
		test -s /defaults/logo/logo.gif && test -s /defaults/avatar/avatar.gif'
	echo "built $img"
fi

id=$(docker image inspect --format '{{.Id}}' "$img")
python3 - "$top" "$img" "$id" <<'EOF'
import re, sys
top, img, image_id = sys.argv[1:]
repo = img.rsplit(":", 1)[0]
p = top + "/helm-chart/images.txt"
s = open(p).read()
line = "%-57s %s   coder-ui-updates (the platform service) and the Images builder's scans: its code (helm-chart/coder-airgapped/files/ui-updates, development/tools/build-ui-image.sh) on coder-image-tools 1.2.0 - the bundled Python + shellcheck, shfmt, trivy (+ vulnerability DB), regctl, copa (development/image-tools)" % (img, image_id)
pat = re.compile(r"^%s:\S+\s+sha256:\S+.*$" % re.escape(repo), re.M)
if pat.search(s):
    s = pat.sub(line, s, count=1)
else:  # first pin: in place of the tools image's line
    tools = re.compile(r"^ghcr\.io/user187x/coder-image-tools:\S+\s+sha256:\S+.*$", re.M)
    assert tools.search(s), "images.txt: neither coder-ui-updates nor coder-image-tools in [ui]"
    s = tools.sub(line, s, count=1)
open(p, "w").write(s)
p = top + "/helm-chart/coder-airgapped/values.yaml"
s = open(p).read()
s2 = re.sub(r'(uiUpdates:\n(?:.*\n)*?  image: (?:&\w+ )?\'\{\{ include "platform\.image" \(list \. ")[^"]+(" *\) \}\}\')',
            lambda m: m.group(1) + img + m.group(2), s, count=1)
assert s2 != s or img in s, "values.yaml: uiUpdates.image not found"
open(p, "w").write(s2)
print("pinned", img, image_id[:19])
EOF
"${top}/helm-chart/mirror-images.sh" store "$img"
