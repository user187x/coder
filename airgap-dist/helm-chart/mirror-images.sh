#!/usr/bin/env bash
# Moves the images in images.txt across the air gap with docker.
#
# The bundle carries every image as a docker-save archive, one folder per part of the solution - the [sections] of
# images.txt, each with its SHA256SUMS (images/README.md lists them):
#   images/ui/             the user interface: Coder (the fork), the platform and announcement services, their databases
#   images/workspaces/     the workspace templates' images
#   images/cloud-drive/    the Cloud Drive's storage and CSI driver
#   images/image-builder/  Templates > Images: BuildKit, the registry
#   images/cluster/        metrics-server
#   images/prereqs/        CloudNativePG operator, Traefik (for prereqs/)
#   images/rollback/       plain upstream Coder
#   images/reference/      Argo CD + Keycloak as the reference cluster runs them - reference only
# Ours (ghcr.io/user187x/...) are on no public registry: always keep them. For a smaller bundle delete the archives of
# public images (or a folder): push then takes those images from the local docker or pulls them, and `save` on a
# connected machine writes the archives again.
#
#   ./mirror-images.sh push REGISTRY [GROUP...]
#                                   tag and push each image as REGISTRY/<path>, e.g. ghcr.io/user187x/coder-platform:T
#                                   -> REGISTRY/user187x/coder-platform:T (what the example values use). Source: its
#                                   archive under images/, else the local docker, else docker pull (by digest).
#                                   GROUP: a section of images.txt (ui workspaces cloud-drive image-builder cluster
#                                   prereqs rollback reference), ours (alias custom: our images, whichever section),
#                                   public (the others), all, or default: every section but reference (no GROUP).
#                                   Public images already in REGISTRY?  push REGISTRY ours
#   ./mirror-images.sh save [GROUP...]
#                                   connected side: pull the public images by digest and (re)write their archives
#                                   (default: all; ours are only built, never pulled)
#   ./mirror-images.sh verify       check every archive present against its folder's SHA256SUMS
#   ./mirror-images.sh list [REGISTRY]
#                                   group, image, archive present or not (-> target); changes nothing
#   ./mirror-images.sh images [GROUP...]
#                                   the images those groups select (as push takes them), one per line
#   ./mirror-images.sh path IMAGE   the image's archive (relative to the bundle), whether there or not
#   ./mirror-images.sh store IMAGE  build side: the image in this docker saved as its archive, in the folder of its
#                                   repository's section (a new tag before images.txt names it), replacing the archive
#                                   of another tag, and that folder's SHA256SUMS written again (development/tools/build-*.sh)
#   ./mirror-images.sh chart REPO   helm push the chart to oci://REPO (e.g. <registry>/charts), the repository
#                                   argocd/coder-airgapped-application.yaml pulls from: the bundle's package
#                                   (charts/coder-airgapped-<version>.tgz), else ./coder-airgapped packaged now
#                                   (helm registry login <registry> first; ECR=1 creates the ECR repository)
#   ./mirror-images.sh charts REPO  the same, the decorator install's two charts (below) and the prerequisites' charts
#                                   (prereqs/*.tgz: CloudNativePG, Traefik)
#   ./mirror-images.sh charts-list  name and version of each of those charts
#   ./mirror-images.sh decorator-charts [OUTDIR]
#                                   the Argo CD decorator install's two charts (argocd/coder-decorated-application.yaml),
#                                   packaged from ./coder-airgapped into OUTDIR (default charts/; the bundle ships
#                                   them there, with coder-airgapped-<version>.tgz): coder-airgapped-base-<version>.tgz, a plain Coder (its database,
#                                   its first owner), and coder-airgapped-layer-<version>.tgz, the customization layer
#                                   that decorates it (values.yaml > global.decorator)
#
#   ./mirror-images.sh seed-builder [NAMESPACE]
#                                   the image builder's base: pushes the workspace image into the in-cluster registry
#                                   (coder-image-registry, through kubectl port-forward) as coder-images/base/<name:tag>.
#                                   Any cluster kubectl reaches (EKS, kind...); no-op when it is there already.
#                                   `./make --deploy` runs it; run it yourself after an Argo CD install.
#
#   In a layer bundle (LAYER.json, see layer-support) push takes only the images the layer carries: the others are in
#   the registry since the earlier install (./make --deploy checks that first).
#
#   ECR=1 ./mirror-images.sh push ...    create missing ECR repositories first (needs the aws CLI)
#   PLAIN_HTTP=1 ./mirror-images.sh chart ...   registry without TLS
#   HELM_PUSH_ARGS="--ca-file ca.pem" ./mirror-images.sh chart(s) ...   more helm push options (a private CA)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# images.txt -> parallel arrays; a "[section] folder mode description" line starts a section: its folder under the
# bundle, and push (pushed by default) or reference (only when asked).
groups=() images=() digests=() ALL_GROUPS=() DEFAULT_PUSH=()
declare -A FOLDER=()
g=""
while read -r a b c _; do
	[[ -z "$a" || "$a" == \#* ]] && continue
	if [[ "$a" == \[*\] ]]; then
		g="${a:1:-1}"; ALL_GROUPS+=("$g"); FOLDER[$g]="${b%/}"
		[[ "$c" == reference ]] || DEFAULT_PUSH+=("$g")
		continue
	fi
	groups+=("$g") images+=("$a") digests+=("$b")
done <"${here}/images.txt"

target() { # strip the source registry host
	local ref="$1" first="${1%%/*}"
	if [[ "$first" == *.* || "$first" == *:* ]]; then ref="${ref#*/}"; fi
	echo "$2/${ref}"
}
# Ours: built here, on no public registry (never pulled).
ours() { [[ "${images[$1]}" == ghcr.io/user187x/* ]]; }
dir_of() { echo "${here}/${FOLDER[$1]}"; }
archive() { echo "$(dir_of "${groups[$1]}")/$(echo "${images[$1]}" | tr '/:@' '___').tar.gz"; }
rel() { echo "${1#"${here}"/}"; }
pick() { # pick DEFAULT... -- ARGS...: indexes of the images in the requested groups (sections, ours/custom, public, all)
	local -a want=() def=()
	local all=0 our=0 pub=0 w i
	while [[ "$1" != -- ]]; do def+=("$1"); shift; done; shift
	for w in "$@"; do
		case "$w" in
		all) all=1 ;;
		default) want+=("${DEFAULT_PUSH[@]}") ;;
		ours | custom) our=1 ;;
		public) pub=1 ;;
		*)
			[[ " ${ALL_GROUPS[*]} " == *" $w "* ]] ||
				{ echo "ERROR: unknown group '$w' (${ALL_GROUPS[*]} ours public all)" >&2; exit 2; }
			want+=("$w") ;;
		esac
	done
	((${#want[@]} || all || our || pub)) || want=("${def[@]}")
	for i in "${!images[@]}"; do
		if ((all)) || [[ " ${want[*]} " == *" ${groups[$i]} "* ]] || { ((our)) && ours "$i"; } ||
			{ ((pub)) && ! ours "$i"; }; then
			echo "$i"
		fi
	done
}
index_of() { # IMAGE -> its index in images.txt
	local i
	for i in "${!images[@]}"; do [[ "${images[$i]}" != "$1" ]] || { echo "$i"; return; }; done
	echo "ERROR: $1 is not in images.txt" >&2; exit 1
}
sums() { # DIR: its SHA256SUMS written again from the archives in it
	(cd "$1" && sha256sum ./*.tar.gz 2>/dev/null | sed 's|  \./|  |' >SHA256SUMS)
}
check() { # archive against its folder's SHA256SUMS
	local d n; d=$(dirname "$1"); n=$(basename "$1")
	grep -qF "  ${n}" "$d/SHA256SUMS" 2>/dev/null || { echo "ERROR: $(rel "$1") is not listed in $(rel "$d")/SHA256SUMS" >&2; exit 1; }
	(cd "$d" && grep -F "  ${n}" SHA256SUMS | sha256sum -c --quiet -) || { echo "ERROR: checksum mismatch: $(rel "$1")" >&2; exit 1; }
}
pull() { # index: by digest when images.txt has one
	local img=${images[$1]} dg=${digests[$1]}
	if [[ "$dg" == sha256:* ]]; then
		docker pull --platform linux/amd64 "${img}@${dg}" && docker tag "${img}@${dg}" "$img"
	else
		docker pull --platform linux/amd64 "$img"
	fi
}
ensure() { # index: the image in the local docker - from its archive when the bundle has it
	local img=${images[$1]} f; f=$(archive "$1")
	if [[ -f "$f" ]]; then
		check "$f"; echo "loading $img from $(rel "$f")"; docker load -q -i "$f" >/dev/null
	elif docker image inspect "$img" >/dev/null 2>&1; then
		echo "using $img from the local docker ($(rel "$f") is not in the bundle)"
	elif ours "$1"; then
		echo "ERROR: $img is on no public registry and $(rel "$f") is missing" >&2; exit 1
	else
		echo "pulling $img ($(rel "$f") is not in the bundle)"; pull "$1"
	fi
}

# The decorator install's two charts, packaged from ./coder-airgapped (or CHART_DIR: a copy, build-bundle.sh's) into
# $1: the part (global.decorator.part), the chart's name and description, and without the other
# part's subcharts. Prints the two packages' paths.
decorator_charts() {
	local out="$1" part d tmp; tmp=$(mktemp -d)
	mkdir -p "$out"
	for part in base layer; do
		d="${tmp}/coder-airgapped-${part}"; cp -r "${CHART_DIR:-${here}/coder-airgapped}" "$d"
		find "$d" -name __pycache__ -type d -prune -exec rm -rf {} +
		sed -i "s/^    part: all$/    part: ${part}/" "$d/values.yaml"
		[[ "$part" == layer ]] || sed -i 's/^    layer: true$/    layer: false/' "$d/values.yaml"
		grep -q "^    part: ${part}$" "$d/values.yaml" || { echo "ERROR: values.yaml has no global.decorator.part" >&2; return 1; }
		python3 - "$d/Chart.yaml" "$part" <<'PY' || return 1
import re, sys
path, part = sys.argv[1], sys.argv[2]
# the bundled prerequisites (Traefik, the CloudNativePG operator) go with Coder, in the base
drop = {"base": {"coder-workspace"}, "layer": {"coder", "traefik", "cloudnative-pg"}}[part]
desc = {
    "base": "Plain Coder for air-gapped Kubernetes, the base of the coder-airgapped Argo CD decorator install: the "
            "upstream Coder chart 2.37.3 running upstream Coder (main at the fork's base, with a Terraform provider "
            "mirror), its CloudNativePG database and its first owner. coder-airgapped-layer decorates it (set "
            "global.decorator.layer: true here, and Coder runs the fork's image).",
    "layer": "The coder-airgapped customization layer, decorating coder-airgapped-base in the same Argo CD "
             "Application: the coder-ui-updates platform service, the "
             "DEFAULT workspace template and its icons, the image builder, metrics-server and admins' "
             "cluster access. Remove it (and set the base's global.decorator.layer to false) to go back to plain Coder.",
}[part]
s = open(path).read()
s = re.sub(r"^name: coder-airgapped$", "name: coder-airgapped-" + part, s, count=1, flags=re.M)
s = re.sub(r"^description: >-\n(?:  .*\n)+", "description: >-\n  " + desc + "\n", s, count=1, flags=re.M)
out, pending, skip, deps = [], [], False, False
for line in s.split("\n"):
    if line.startswith("dependencies:"):
        deps = True
        out.append(line)
        continue
    if deps:
        m = re.match(r"  - name: (\S+)", line)
        if line.startswith("  #"):
            pending.append(line)
            continue
        if m:
            skip = m.group(1) in drop
            if not skip:
                out += pending + [line]
            pending = []
            continue
        if line.startswith("    "):
            if not skip:
                out.append(line)
            continue
        out += pending
        pending, deps = [], False
    out.append(line)
open(path, "w").write("\n".join(out))
PY
		if [[ "$part" == base ]]; then rm -rf "$d/charts/coder-workspace"; else rm -rf "$d/charts/coder" "$d/charts/traefik" "$d/charts/cloudnative-pg"; fi
		helm package "$d" -d "$out" | sed -n 's/.*saved it to: //p' || return 1
	done
	rm -rf "$tmp"
}

cmd="${1:-}"; shift || true
case "$cmd" in
save)
	zip=$(command -v pigz || echo gzip)
	mapfile -t idx < <(pick "${ALL_GROUPS[@]}" -- "$@")
	for i in "${idx[@]}"; do
		! ours "$i" || { echo "skipping ${images[$i]}: ours, only built (development/tools/build-*.sh)"; continue; }
		f=$(archive "$i"); mkdir -p "$(dirname "$f")"
		pull "$i"
		echo "saving ${images[$i]} -> $(rel "$f")"
		docker save --platform linux/amd64 "${images[$i]}" | "$zip" -6 >"$f.part"; mv "$f.part" "$f"
		sums "$(dirname "$f")"
	done
	;;
push)
	reg="${1:?usage: push REGISTRY [GROUP...]}"; shift; reg="${reg%/}"
	mapfile -t idx < <(pick "${DEFAULT_PUSH[@]}" -- "$@")
	carried=""; [[ ! -f "${here}/LAYER.json" ]] || carried=$("${here}/layer-support" delivered)
	for i in "${idx[@]}"; do
		img=${images[$i]}
		if [[ -f "${here}/LAYER.json" ]] && ! grep -qxF "$img" <<<"$carried"; then
			echo "in $reg since the earlier install: $img (the layer does not carry it)"; continue
		fi
		ensure "$i"
		dst=$(target "$img" "$reg")
		if [[ "${ECR:-0}" == 1 ]]; then
			repo="${dst#*/}"; repo="${repo%:*}"
			aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 ||
				aws ecr create-repository --repository-name "$repo" >/dev/null
		fi
		echo "$img -> $dst"; docker tag "$img" "$dst"
		# A registry on slow storage can time out on a large layer: try again (pushed layers are not sent twice).
		for try in 1 2 3; do docker push -q "$dst" && break; ((try < 3)) || exit 1; echo "push failed, retrying ($try/3)"; sleep 10; done
	done
	;;
verify)
	n=0
	for i in "${!images[@]}"; do
		f=$(archive "$i")
		if [[ -f "$f" ]]; then check "$f"; echo "ok       $(rel "$f")"; n=$((n + 1)); else echo "absent   $(rel "$f")"; fi
	done
	echo "$n archives verified"
	;;
chart | charts)
	repo="${1:?usage: $cmd REPO}"; repo="${repo#oci://}"; repo="${repo%/}"
	command -v helm >/dev/null || { echo "ERROR: helm not found" >&2; exit 1; }
	tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
	# the bundle's packages (charts/), else packaged now
	version=$(sed -n 's/^version: *//p' "${here}/coder-airgapped/Chart.yaml")
	if [[ -f "${here}/charts/coder-airgapped-${version}.tgz" ]]; then
		pkgs=("${here}/charts/coder-airgapped-${version}.tgz")
	else
		pkgs=("$(helm package "${here}/coder-airgapped" -d "$tmp" | sed -n 's/.*saved it to: //p')")
	fi
	if [[ "$cmd" == charts ]]; then
		# the decorator install's two charts
		if [[ -f "${here}/charts/coder-airgapped-base-${version}.tgz" && -f "${here}/charts/coder-airgapped-layer-${version}.tgz" ]]; then
			pkgs+=("${here}/charts/coder-airgapped-base-${version}.tgz" "${here}/charts/coder-airgapped-layer-${version}.tgz")
		else
			mapfile -t -O "${#pkgs[@]}" pkgs < <(decorator_charts "$tmp/decorator")
		fi
		shopt -s nullglob; pkgs+=("${here}"/prereqs/*.tgz); shopt -u nullglob   # none in a layer bundle (unchanged)
	fi
	read -r -a extra <<<"${HELM_PUSH_ARGS:-}"
	[[ "${PLAIN_HTTP:-0}" == 1 ]] && extra+=(--plain-http)
	for pkg in "${pkgs[@]}"; do
		if [[ "${ECR:-0}" == 1 ]]; then
			name=$(basename "$pkg"); name="${name%-*}"; ecr_repo="${repo#*/}/${name}"
			aws ecr describe-repositories --repository-names "$ecr_repo" >/dev/null 2>&1 ||
				aws ecr create-repository --repository-name "$ecr_repo" >/dev/null
		fi
		echo "$(basename "$pkg") -> oci://${repo}"
		helm push "$pkg" "oci://${repo}" "${extra[@]}" 2>&1 | grep -v '^Pushed:\|^Digest:' || true
		((PIPESTATUS[0] == 0)) || exit 1
	done
	;;
charts-list)
	shopt -s nullglob   # a layer bundle carries no unchanged prerequisite chart
	for c in "${here}/coder-airgapped" "${here}"/prereqs/*.tgz; do
		helm show chart "$c" | awk '/^name:/ {n=$2} /^version:/ {v=$2} END {print n, v}'
	done
	version=$(sed -n 's/^version: *//p' "${here}/coder-airgapped/Chart.yaml")
	echo "coder-airgapped-base ${version}"
	echo "coder-airgapped-layer ${version}"
	;;
decorator-charts)
	command -v helm >/dev/null || { echo "ERROR: helm not found" >&2; exit 1; }
	decorator_charts "${1:-${here}/charts}"
	;;
seed-builder)
	ns="${1:-coder}"
	ws=""; for i in "${!images[@]}"; do [[ "${images[$i]}" == ghcr.io/user187x/coder-workspace:* ]] && { ws=$i; break; }; done
	[[ -n "$ws" ]] || { echo "ERROR: no workspace image in images.txt" >&2; exit 1; }
	name="${images[$ws]##*/}"
	kubectl -n "$ns" rollout status deploy/coder-image-registry --timeout=300s >/dev/null ||
		{ echo "ERROR: deploy/coder-image-registry in namespace $ns is not ready (imageBuilder.enabled?)" >&2; exit 1; }
	port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
	kubectl -n "$ns" port-forward svc/coder-image-registry "${port}:5000" >/dev/null 2>&1 & pf=$!
	trap 'kill "$pf" 2>/dev/null || true' EXIT
	for _ in $(seq 60); do curl -fs -o /dev/null "http://127.0.0.1:${port}/v2/" && break; sleep 1; done
	curl -fs -o /dev/null "http://127.0.0.1:${port}/v2/" || { echo "ERROR: the registry does not answer through port-forward" >&2; exit 1; }
	# (any manifest type: docker pushes from its containerd store as an OCI index)
	if curl -fs -o /dev/null -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
		"http://127.0.0.1:${port}/v2/coder-images/base/${name%%:*}/manifests/${name##*:}"; then
		echo "the image builder's registry has coder-images/base/${name} already"; exit 0
	fi
	ensure "$ws"
	# Docker pushes to a registry on 127.0.0.1 over plain HTTP without any daemon setting.
	dst="127.0.0.1:${port}/coder-images/base/${name}"
	echo "${images[$ws]} -> coder-images/base/${name} (the image builder's registry; a few minutes)"
	docker tag "${images[$ws]}" "$dst" && docker push -q "$dst" >/dev/null && docker rmi "$dst" >/dev/null
	echo "seeded coder-images/base/${name}"
	;;
list)
	reg="${1:-}"
	for i in "${!images[@]}"; do
		f=$(archive "$i"); have=absent; [[ -f "$f" ]] && have=bundled
		printf '%-13s %-8s %-56s %s\n' "${groups[$i]}" "$have" "${images[$i]}" "${reg:+-> $(target "${images[$i]}" "$reg")}"
	done
	;;
images)
	mapfile -t idx < <(pick "${DEFAULT_PUSH[@]}" -- "$@")
	for i in "${idx[@]}"; do echo "${images[$i]}"; done
	;;
path)
	rel "$(archive "$(index_of "${1:?usage: path IMAGE}")")"
	;;
store)
	img="${1:?usage: store IMAGE}"; sec=""
	for i in "${!images[@]}"; do [[ "${images[$i]%:*}" != "${img%:*}" ]] || { sec=${groups[$i]}; break; }; done
	[[ -n "$sec" ]] || { echo "ERROR: no section of images.txt has ${img%:*}: add the image there first" >&2; exit 1; }
	docker image inspect "$img" >/dev/null 2>&1 || { echo "ERROR: $img is not in this docker" >&2; exit 1; }
	d=$(dir_of "$sec"); f="${d}/$(echo "$img" | tr '/:@' '___').tar.gz"; mkdir -p "$d"
	repo_file=$(echo "${img%:*}" | tr '/:@' '___')
	find "$d" -maxdepth 1 -name "${repo_file}_*.tar.gz" ! -name "$(basename "$f")" -print -delete | sed 's|.*/|removed the older |'
	docker save --platform linux/amd64 "$img" | gzip -1 >"$f.part"; mv "$f.part" "$f"
	sums "$d"
	echo "saved $img -> $(rel "$f") ($(du -h "$f" | cut -f1))"
	;;
*) sed -n '2,/^set /p' "$0" | sed '$d'; exit 2 ;;
esac
