#!/usr/bin/env bash

# Builds the container image the coder-platform Helm chart (helm/coder-platform)
# deploys: this repository's Coder, dashboard included, on Coder's base image
# (Alpine with Terraform).
#
# Usage: ./scripts/build_platform_image.sh [--image REPO] [--tag TAG] [--arch amd64|arm64] [--build-base] [--push]
#
#   --image       image repository (default: the chart's image.repository)
#   --tag         image tag (default: the chart's appVersion, which the chart
#                 deploys when image.tag is empty)
#   --arch        target architecture (default: amd64)
#   --build-base  build Coder's base image from scripts/Dockerfile.base instead
#                 of pulling ghcr.io/coder/coder-base:latest
#   --push        push the image after building it
#
# The binary is the "fat" one: it embeds the dashboard and the agent binaries
# workspaces download from Coder, so the image needs nothing else at runtime.

set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cdroot

chart=helm/coder-platform
chart_value() {
	# A top-level "key: value" line of the chart's Chart.yaml or values.yaml.
	[[ -f "$chart/$1" ]] || return 0
	sed -n "s/^$2:[[:space:]]*\"\{0,1\}\([^\"#]*\)\"\{0,1\}.*/\1/p" "$chart/$1" | head -n1 | xargs
}

image=""
if [[ -f "$chart/values.yaml" ]]; then
	image="$(sed -n '/^image:/,/^[^ ]/s/^  repository:[[:space:]]*\([^ #]*\).*/\1/p' "$chart/values.yaml" | head -n1)"
fi
tag="$(chart_value Chart.yaml appVersion)"
arch=amd64
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
		arch="$2"
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
case "$arch" in
amd64 | arm64) ;;
*) error "--arch must be amd64 or arm64" ;;
esac

dependencies docker make
version="$(./scripts/version.sh)"
binary="build/coder_${version}_linux_${arch}"

log "--- Building $binary (dashboard and agent binaries embedded)"
make -j "$binary"

docker_args=(--arch "$arch" --target "$image:$tag" --version "$version")
if [[ "$build_base" == 1 ]]; then
	docker_args+=(--build-base "coder-platform-base:$version-$arch")
fi
if [[ "$push" == 1 ]]; then
	docker_args+=(--push)
fi
./scripts/build_docker.sh "${docker_args[@]}" "$binary"
