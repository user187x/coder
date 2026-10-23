#!/usr/bin/env bash
# Pushes this release's images into your registry, on the far side of the air gap. Needs bash, docker and coreutils
# (the aws CLI too for ECR=1); no internet. It reads IMAGES.txt and SHA256SUMS next to it, from any directory - and,
# when pull-public-images.sh saved the public images the chart runs into this folder (on a connected machine),
# IMAGES-public.txt and SHA256SUMS.public: those are pushed too.
#   ./push-images.sh REGISTRY [--dry-run] [--rm] [--ours-only] [NAME...]
# REGISTRY: host[:port][/prefix], the chart's global.registry - e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com or
# harbor.example.com/coder. Each image goes to REGISTRY/<its path without the source host>, where the chart pulls it:
#   ghcr.io/user187x/coder-platform:T -> REGISTRY/user187x/coder-platform:T, docker.io/traefik:T -> REGISTRY/traefik:T
# First every file is checked against SHA256SUMS (nothing is pushed if one does not match). Then per image: its
# archive streamed into docker load (the parts of a split one joined with cat on the way, no temporary file), tagged,
# and pushed (3 tries: a registry on slow storage can time out on a large layer; pushed layers are not sent twice).
# Ends with a summary; exits non-zero if any image failed.
#   --dry-run   check the files and print what it would do (no docker command)
#   --rm        after each push remove the loaded image and its new tag (a push host with little disk)
#   --ours-only only the fork's images (ghcr.io/user187x/...), not the public ones pull-public-images.sh saved here:
#               your registry already holds them, at the paths INSTALL.md lists
#   NAME...     only these images, by name (e.g. coder-platform coder-workspace); default: all of IMAGES.txt
#   ECR=1 ./push-images.sh ...   create missing ECR repositories first (region from REGISTRY)
# Log in first: docker login REGISTRY
#   (ECR: aws ecr get-login-password | docker login --username AWS --password-stdin REGISTRY)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '2,/^set /p' "$0" | sed '$d' >&2; exit 2; }
reg="" dry=0 rm_after=0 ours_only=0 names=()
while (($#)); do
	case "$1" in
	--dry-run) dry=1 ;;
	--rm) rm_after=1 ;;
	--ours-only) ours_only=1 ;;
	-h | --help) usage ;;
	-*) echo "unknown option: $1" >&2; usage ;;
	*) if [[ -z "$reg" ]]; then reg="$1"; else names+=("$1"); fi ;;
	esac
	shift
done
[[ -n "$reg" ]] || usage
reg="${reg%/}"
[[ "$reg" != *://* ]] || { echo "ERROR: REGISTRY is host[:port][/prefix], without a scheme: ${reg}" >&2; exit 2; }
[[ -f "${here}/IMAGES.txt" && -f "${here}/SHA256SUMS" ]] ||
	{ echo "ERROR: IMAGES.txt or SHA256SUMS is missing next to $0" >&2; exit 1; }

target() { # the reference without its source registry host, under REGISTRY (as mirror-images.sh)
	local ref="$1" first="${1%%/*}"
	if [[ "$first" == *.* || "$first" == *:* ]]; then ref="${ref#*/}"; fi
	echo "${reg}/${ref}"
}
name_of() { local p="${1##*/}"; echo "${p%%[:@]*}"; }
sumcheck() { # SHA256SUMS lines on stdin, checked from this folder
	if command -v sha256sum >/dev/null; then (cd "$here" && sha256sum -c --quiet -)
	else (cd "$here" && shasum -a 256 -c --quiet -); fi
}

# IMAGES.txt: image  files(,-separated, in order)  size  config-digest  manifest-digest
# (IMAGES-public.txt, when pull-public-images.sh made it: the same, for the public images)
lists=("${here}/IMAGES.txt") sums=("${here}/SHA256SUMS")
if ((!ours_only)) && [[ -f "${here}/IMAGES-public.txt" ]]; then
	[[ -f "${here}/SHA256SUMS.public" ]] || { echo "ERROR: IMAGES-public.txt without SHA256SUMS.public: run pull-public-images.sh again" >&2; exit 1; }
	lists+=("${here}/IMAGES-public.txt") sums+=("${here}/SHA256SUMS.public")
fi
imgs=() files=() sizes=() configs=() manifests=()
while read -r img fs size cfg man _; do
	[[ -z "$img" || "$img" == \#* ]] && continue
	if ((${#names[@]})) && [[ " ${names[*]} " != *" $(name_of "$img") "* ]]; then continue; fi
	if ((ours_only)) && [[ "$img" != ghcr.io/user187x/* ]]; then continue; fi
	imgs+=("$img") files+=("$fs") sizes+=("$size") configs+=("$cfg") manifests+=("$man")
done < <(cat "${lists[@]}")
for n in "${names[@]}"; do
	found=0; for img in "${imgs[@]}"; do [[ "$(name_of "$img")" != "$n" ]] || found=1; done
	((found)) || { echo "ERROR: no image named $n in IMAGES.txt" >&2; exit 2; }
done
((${#imgs[@]})) || { echo "ERROR: IMAGES.txt lists no image" >&2; exit 1; }

# Check the files first: all of SHA256SUMS, or with NAMEs only their images' files
echo "checking the files against SHA256SUMS ..."
if ((${#names[@]})); then
	want=" $(printf '%s ' "${files[@]}" | tr ',' ' ')"
	lines=$(cat "${sums[@]}" | awk -v want="$want" 'index(want, " " $2 " ")')
	[[ $(grep -c . <<<"$lines") -eq $(wc -w <<<"$want") ]] ||
		{ echo "ERROR: SHA256SUMS does not list every file of these images" >&2; exit 1; }
	sumcheck <<<"$lines" || { echo "ERROR: checksum mismatch (above): nothing pushed" >&2; exit 1; }
else
	cat "${sums[@]}" | sumcheck || { echo "ERROR: checksum mismatch (above): nothing pushed" >&2; exit 1; }
fi
echo "ok: the files match SHA256SUMS"

((dry)) || command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
if [[ "${ECR:-0}" == 1 ]]; then
	command -v aws >/dev/null || ((dry)) || { echo "ERROR: ECR=1 needs the aws CLI" >&2; exit 1; }
	region=$(sed -n 's/^[0-9]*\.dkr\.ecr\.\([a-z0-9-]*\)\.amazonaws\.com.*/\1/p' <<<"$reg")
	region_args=(); [[ -z "$region" ]] || region_args=(--region "$region")
fi
ecr_repo() { # REPOSITORY: created when missing
	if aws ecr describe-repositories "${region_args[@]}" --repository-names "$1" >/dev/null 2>&1; then return; fi
	if ((dry)); then echo "  would create the ECR repository $1"; return; fi
	echo "  creating the ECR repository $1"
	aws ecr create-repository "${region_args[@]}" --repository-name "$1" >/dev/null
}

results=() failed=0 log="${TMPDIR:-/tmp}/push-images.$$.log"
trap 'rm -f "$log"' EXIT
for i in "${!imgs[@]}"; do
	img=${imgs[$i]} dst=$(target "${imgs[$i]}")
	IFS=, read -r -a parts <<<"${files[$i]}"
	paths=(); for p in "${parts[@]}"; do paths+=("${here}/${p}"); done
	echo "[$((i + 1))/${#imgs[@]}] ${img} (${sizes[$i]}${parts[1]:+, ${#parts[@]} parts}) -> ${dst}"
	if [[ "${ECR:-0}" == 1 ]]; then
		repo="${dst#*/}"; repo="${repo%:*}"
		if command -v aws >/dev/null; then ecr_repo "$repo"; else echo "  would create the ECR repository $repo if missing"; fi
	fi
	if ((dry)); then
		echo "  would run: cat ${parts[*]} | docker load; docker tag ${img} ${dst}; docker push ${dst}"
		results+=("dry-run  ${img} -> ${dst}"); continue
	fi
	# load: the parts joined on the way (cat), straight into docker
	if ! cat "${paths[@]}" | docker load -q >"$log" 2>&1; then
		sed 's/^/  /' "$log" >&2; echo "  ERROR: docker load failed" >&2
		results+=("FAILED   ${img} (docker load)"); failed=$((failed + 1)); continue
	fi
	loaded=$(sed -n 's/^Loaded image: //p' "$log" | grep -xF "$img" || true)
	[[ -n "$loaded" ]] || loaded=$(sed -n 's/^Loaded image: //p; s/^Loaded image ID: //p' "$log" | head -n1)
	[[ -n "$loaded" ]] || { cat "$log" >&2; results+=("FAILED   ${img} (no image loaded)"); failed=$((failed + 1)); continue; }
	[[ "$loaded" == "$img" ]] || echo "  note: the archive loaded as ${loaded}"
	# its ID: the config digest (docker's classic store) or the manifest digest (containerd image store)
	id=$(docker image inspect --format '{{.Id}}' "$loaded")
	[[ "$id" == "${configs[$i]}" || "$id" == "${manifests[$i]}" ]] ||
		echo "  note: loaded as ${id}, IMAGES.txt has config ${configs[$i]} / manifest ${manifests[$i]}"
	docker tag "$loaded" "$dst"
	ok=0
	for try in 1 2 3; do
		if docker push -q "$dst" >"$log" 2>&1; then ok=1; break; fi
		sed 's/^/  /' "$log" >&2
		((try < 3)) && { echo "  push failed, retrying ($try/3)"; sleep 10; }
	done
	if ((!ok)); then results+=("FAILED   ${img} -> ${dst} (push)"); failed=$((failed + 1)); continue; fi
	digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$dst" |
		awk -v repo="${dst%:*}@" 'index($0, repo) == 1 {print substr($0, length(repo) + 1); exit}')
	echo "  pushed ${dst}${digest:+@${digest}}"
	results+=("pushed   ${dst}${digest:+  ${digest}}")
	if ((rm_after)); then docker rmi "$dst" "$loaded" >/dev/null 2>&1 || true; fi
done

echo
echo "summary (${reg}):"
printf '  %s\n' "${results[@]}"
if ((failed)); then echo "${failed} of ${#imgs[@]} images FAILED" >&2; exit 1; fi
if ((dry)); then echo "dry run: ${#imgs[@]} images checked, nothing pushed"; else echo "${#imgs[@]} images pushed"; fi
