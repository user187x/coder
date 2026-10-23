#!/usr/bin/env bash
# The image store's previews (development/image-store/thumbs/<picture>.webp): a small animated WebP of each picture in
# development/image-store/pictures/ - its first seconds, 192 px wide - so the pickers that list the store show every
# picture moving without loading the pictures themselves (some are tens of MB). Run after adding a picture; a
# preview that is there already is kept, one without its picture is removed. Needs ffmpeg with libwebp.
#   ./image-store-thumbs.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; store="$(dirname "$here")/image-store"
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg is needed" >&2; exit 1; }
for p in "$store"/pictures/*; do
	[ -f "$p" ] || continue
	t="$store/thumbs/$(basename "$p").webp"
	[ -s "$t" ] && continue
	ffmpeg -v error -y -i "$p" -t 4 -vf "fps=10,scale=192:-2:flags=lanczos" -loop 0 -c:v libwebp_anim \
		-quality 55 -compression_level 6 -an "$t"
	echo "preview: $(basename "$t") ($(stat -c %s "$t") bytes)"
done
for t in "$store"/thumbs/*.webp; do
	[ -f "$t" ] || continue
	[ -f "$store/pictures/$(basename "$t" .webp)" ] || { rm -f -- "$t"; echo "removed $(basename "$t") (no picture)"; }
done
