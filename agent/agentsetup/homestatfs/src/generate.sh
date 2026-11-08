#!/usr/bin/env bash
# Builds the embedded home-statfs libraries from home-statfs.c for each
# architecture the agent runs on. Needs clang and lld only: the source uses no
# C library headers. Run after editing home-statfs.c and commit the results.
set -euo pipefail
cd "$(dirname "$0")"
out=..
for arch in amd64:x86_64 arm64:aarch64; do
	goarch=${arch%%:*}
	target=${arch##*:}-linux-gnu
	clang --target="$target" -O2 -fPIC -shared -nostdlib -ffreestanding \
		-fno-stack-protector -fvisibility=hidden -fno-asynchronous-unwind-tables \
		-fuse-ld=lld -Wl,--build-id=none -Wl,-soname,home-statfs.so -Wl,-s \
		-Wall -Wextra -Werror \
		-o "$out/home-statfs-$goarch.so" home-statfs.c
done
