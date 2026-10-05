#!/usr/bin/env bash

# Builds the container image the coder-platform Helm chart (helm/coder-platform)
# deploys: this repository's Coder, dashboard included, on Coder's base image
# (Alpine with Terraform). Builds linux/amd64 and linux/arm64 by default; with
# --push, both are pushed under one multi-architecture tag.
#
# Usage: ./scripts/build_platform_image.sh [--image REPO] [--tag TAG] [--arch amd64,arm64] [--build-base] [--push]
#
#   --image       image repository (default: the chart's image.repository)
#   --tag         image tag, also the version Coder reports (default: the
#                 chart's appVersion, which the chart deploys when image.tag
#                 is empty)
#   --arch        comma-separated architectures: amd64, arm64 (default: both)
#   --build-base  build Coder's base image from scripts/Dockerfile.base instead
#                 of pulling ghcr.io/coder/coder-base:latest
#   --push        push the images and the multi-architecture tag
#
# Each binary is the "fat" one: it embeds the dashboard and the agent binaries
# workspaces download from Coder, so the image needs nothing else at runtime.

set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cdroot

chart=helm/coder-platform
image=""
tag=""
if [[ -f "$chart/values.yaml" ]]; then
	image="$(sed -n '/^image:/,/^[^ ]/s/^  repository:[[:space:]]*\([^ #]*\).*/\1/p' "$chart/values.yaml" | head -n1)"
fi
if [[ -f "$chart/Chart.yaml" ]]; then
	tag="$(sed -n 's/^appVersion:[[:space:]]*"\{0,1\}\([^"#]*\)"\{0,1\}.*/\1/p' "$chart/Chart.yaml" | head -n1 | xargs)"
fi
arches=amd64,arm64
build_base=0
push=0

args="$(getopt -o "" -l image:,tag:,arch:,build-base,push -- "$@")"
eval set -- "$args"
while true; do
	case "$1" in
	--image)
		image="$2"
		shift 2
		;;
	--tag)
		tag="$2"
		shift 2
		;;
	--arch)
		arches="$2"
		shift 2
		;;
	--build-base)
		build_base=1
		shift
		;;
	--push)
		push=1
		shift
		;;
	--)
		shift
		break
		;;
	*)
		error "Unrecognized option: $1"
		;;
	esac
done

if [[ "$image" == "" || "$tag" == "" ]]; then
	error "Set --image and --tag (the chart's image.repository and appVersion are empty)"
fi
IFS=, read -r -a arch_list <<<"$arches"
for arch in "${arch_list[@]}"; do
	case "$arch" in
	amd64 | arm64) ;;
	*) error "--arch takes amd64 and/or arm64, not $arch" ;;
	esac
done

dependencies docker make
# Coder reports the image tag as its version, and the build artifacts are named after it.
export CODER_FORCE_VERSION="$tag"
version="$(./scripts/version.sh)"

arch_images=()
for arch in "${arch_list[@]}"; do
	binary="build/coder_${version}_linux_${arch}"
	target="$image:$tag"
	if [[ "${#arch_list[@]}" -gt 1 ]]; then
		target="$image:$tag-$arch"
	fi

	log "--- Building $binary (dashboard and agent binaries embedded)"
	make -j "$binary"

	docker_args=(--arch "$arch" --target "$target" --version "$version")
	if [[ "$build_base" == 1 ]]; then
		docker_args+=(--build-base "coder-platform-base:$version-$arch")
	fi
	if [[ "$push" == 1 ]]; then
		docker_args+=(--push)
	fi
	./scripts/build_docker.sh "${docker_args[@]}" "$binary"
	arch_images+=("$target")
done

if [[ "${#arch_list[@]}" -gt 1 ]]; then
	if [[ "$push" == 1 ]]; then
		log "--- Pushing the multi-architecture tag $image:$tag (${arch_images[*]})"
		docker manifest rm "$image:$tag" >/dev/null 2>&1 || true
		docker manifest create "$image:$tag" "${arch_images[@]}"
		docker manifest push "$image:$tag"
	else
		log "Built ${arch_images[*]}. Run with --push to publish them under the multi-architecture tag $image:$tag."
	fi
fi
