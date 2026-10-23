#!/usr/bin/env bash
# The public images the chart runs (PUBLIC-IMAGES.txt next to it; INSTALL.md step 1), saved into this release folder
# on a CONNECTED machine - so the far side's ./push-images.sh REGISTRY pushes them with ours: pull here, push there.
# (The release itself carries only our images: their CVEs are ours to fix, the public ones' their projects'.)
#   ./pull-public-images.sh [--dry-run] [NAME...]
# Each is pulled by its tested digest (linux/amd64), saved as public/<name>_<tag>.tar.gz (docker save | gzip) and
# listed in IMAGES-public.txt (IMAGES.txt's format) and SHA256SUMS.public, which push-images.sh reads. Run it again
# to add images or replace an interrupted save; an image already saved is kept. Needs docker, gzip and the internet
# (or a registry mirror docker pulls through). NAME...: only these images, by name (e.g. postgresql traefik).
#   --dry-run   print what it would pull and save
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '2,/^set /p' "$0" | sed '$d' >&2; exit 2; }
dry=0 names=()
while (($#)); do
	case "$1" in
	--dry-run) dry=1 ;;
	-h | --help) usage ;;
	-*) echo "unknown option: $1" >&2; usage ;;
	*) names+=("$1") ;;
	esac
	shift
done
list="${here}/PUBLIC-IMAGES.txt"
[[ -f "$list" ]] || { echo "ERROR: PUBLIC-IMAGES.txt is missing next to $0" >&2; exit 1; }
((dry)) || command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
name_of() { local p="${1##*/}"; echo "${p%%[:@]*}"; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
human() { awk -v b="$1" 'BEGIN { split("B KiB MiB GiB", u); i = 1; while (b >= 1024 && i < 4) { b /= 1024; i++ } printf "%.1f%s", b, u[i] }'; }

# what is saved already (IMAGES-public.txt: image  file  size  config  manifest)
declare -A saved=()
if [[ -f "${here}/IMAGES-public.txt" ]]; then
	while read -r img file rest; do
		if [[ -n "$img" && "$img" != \#* && -s "${here}/${file}" ]]; then saved[$img]="${img} ${file} ${rest}"; fi
	done <"${here}/IMAGES-public.txt"
fi

mkdir -p "${here}/public"
lines=() failed=0 n=0
# PUBLIC-IMAGES.txt: its path under the registry  the public image by digest
while read -r path src _; do
	[[ -z "$path" || "$path" == \#* ]] && continue
	img="${src%@*}" digest="${src#*@}"
	if ((${#names[@]})) && [[ " ${names[*]} " != *" $(name_of "$img") "* ]]; then
		[[ -z "${saved[$img]:-}" ]] || lines+=("${saved[$img]}")
		continue
	fi
	n=$((n + 1))
	tag="${img##*:}"
	file="public/$(name_of "$img")_${tag}.tar.gz"
	if [[ -n "${saved[$img]:-}" ]]; then
		echo "[${n}] ${img}: saved already (${file})"
		lines+=("${saved[$img]}"); continue
	fi
	echo "[${n}] ${src} -> ${file}"
	if ((dry)); then continue; fi
	if ! docker pull -q --platform linux/amd64 "$src" >/dev/null; then
		echo "  ERROR: docker pull failed" >&2; failed=$((failed + 1)); continue
	fi
	docker tag "$src" "$img"
	if ! docker save "$img" | gzip -1 >"${here}/${file}.part"; then
		rm -f "${here}/${file}.part"; echo "  ERROR: docker save failed" >&2; failed=$((failed + 1)); continue
	fi
	mv "${here}/${file}.part" "${here}/${file}"
	cfg=$(docker image inspect --format '{{.Id}}' "$img")
	lines+=("${img} ${file} $(human "$(stat -c %s "${here}/${file}" 2>/dev/null || stat -f %z "${here}/${file}")") ${cfg} ${digest}")
	echo "  saved ($(human "$(stat -c %s "${here}/${file}" 2>/dev/null || stat -f %z "${here}/${file}")"))"
done <"$list"
((dry)) && { echo "dry run: nothing pulled"; exit 0; }

{
	echo "# The public images the chart runs, saved by pull-public-images.sh: image  file  size  config-digest  manifest-digest"
	printf '%s\n' "${lines[@]}"
} >"${here}/IMAGES-public.txt"
mapfile -t saved_files < <(awk '!/^#/ && NF {print $2}' "${here}/IMAGES-public.txt")
if ((${#saved_files[@]})); then (cd "$here" && sha "${saved_files[@]}" >SHA256SUMS.public); fi
echo "$(grep -vc '^#' "${here}/IMAGES-public.txt") public images in IMAGES-public.txt; carry this folder across and run ./push-images.sh REGISTRY"
((failed == 0)) || { echo "${failed} images FAILED (above): run it again" >&2; exit 1; }
