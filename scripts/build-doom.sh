#!/usr/bin/env bash
# Builds the offline DOOM the announcement terminal runs (site/static/doom/, see its README.md): the Chocolate Doom
# WebAssembly engine from a pinned commit of cloudflare/doom-wasm, compiled in a pinned Emscripten image, and
# Freedoom Phase 1's game data from its pinned release. Every download is checked against its SHA-256.
#
#   scripts/build-doom.sh
set -euo pipefail

ENGINE_COMMIT=65e0d3ae2ffa604155eebd96ed40da6567bd08f4
ENGINE_SHA256=9be6e02bb1f4f4b00f73d21b0c1ba4f2b8087e3c6cb1f477435baa390b3aa482
EMSDK_IMAGE=emscripten/emsdk:3.1.64
FREEDOOM_VERSION=0.13.0
FREEDOOM_SHA256=3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/site/static/doom"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch() { # url sha256 destination
	curl -fsSL "$1" -o "$3"
	echo "$2  $3" | sha256sum --check --quiet
}

fetch "https://github.com/cloudflare/doom-wasm/archive/$ENGINE_COMMIT.tar.gz" "$ENGINE_SHA256" "$work/engine.tar.gz"
mkdir "$work/engine"
tar -xzf "$work/engine.tar.gz" -C "$work/engine" --strip-components=1
docker run --rm -v "$work/engine:/src" -w /src "$EMSDK_IMAGE" bash -c \
	'apt-get update -qq && apt-get install -y -qq automake autoconf libtool pkg-config >/dev/null && bash scripts/build.sh'
install -m 0644 "$work/engine/src/websockets-doom.js" "$work/engine/src/websockets-doom.wasm" "$out/"
install -m 0644 "$work/engine/COPYING.md" "$out/ENGINE-COPYING.md"

fetch "https://github.com/freedoom/freedoom/releases/download/v$FREEDOOM_VERSION/freedoom-$FREEDOOM_VERSION.zip" \
	"$FREEDOOM_SHA256" "$work/freedoom.zip"
unzip -q -o -j "$work/freedoom.zip" "freedoom-$FREEDOOM_VERSION/freedoom1.wad" "freedoom-$FREEDOOM_VERSION/COPYING.txt" -d "$work/freedoom"
install -m 0644 "$work/freedoom/freedoom1.wad" "$out/freedoom1.wad"
install -m 0644 "$work/freedoom/COPYING.txt" "$out/FREEDOOM-COPYING.txt"
(cd "$out" && sha256sum websockets-doom.js websockets-doom.wasm freedoom1.wad >SHA256SUMS)
echo "Built offline DOOM into $out"
