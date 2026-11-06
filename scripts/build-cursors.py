#!/usr/bin/env python3
"""Converts an X11 cursor theme into the browser cursors the dashboard uses (site/static/cursors/).

Browsers cannot load Xcursor files, so each CSS cursor keyword gets the theme's 32 px image as a PNG, a 64 px
copy for high-density screens, and its hotspot in cursors.json, which site/vite.config.mts reads to rewrite every
`cursor:` declaration. Animated cursors keep their first frame, since CSS cursors are still images.

  scripts/build-cursors.py [THEME_DIR]   (default: Borealis-cursors at the repository root)
"""

import json
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site/static/cursors"
IMAGE_CHUNK = 0xFFFD0002
SIZES = {"": 32, "@2x": 64}

# CSS cursor keyword -> Xcursor names to try, first match wins.
KEYWORDS = {
    "default": ["default", "left_ptr"],
    "pointer": ["pointer", "pointing_hand", "hand2"],
    "text": ["text", "xterm", "ibeam"],
    "vertical-text": ["vertical-text"],
    "wait": ["wait", "watch"],
    "progress": ["progress", "left_ptr_watch"],
    "help": ["help", "question_arrow"],
    "crosshair": ["crosshair", "cross"],
    "cell": ["cell", "plus"],
    "move": ["move", "fleur"],
    "all-scroll": ["all-scroll", "fleur"],
    "grab": ["grab", "openhand"],
    "grabbing": ["grabbing", "closedhand"],
    "not-allowed": ["not-allowed", "crossed_circle"],
    "no-drop": ["no-drop", "dnd-no-drop"],
    "copy": ["copy", "dnd-copy"],
    "alias": ["alias", "dnd-link", "link"],
    "context-menu": ["context-menu"],
    "zoom-in": ["zoom-in"],
    "zoom-out": ["zoom-out"],
    "col-resize": ["col-resize", "sb_h_double_arrow"],
    "row-resize": ["row-resize", "sb_v_double_arrow"],
    "ew-resize": ["ew-resize", "sb_h_double_arrow"],
    "ns-resize": ["ns-resize", "sb_v_double_arrow"],
    "nesw-resize": ["nesw-resize", "fd_double_arrow"],
    "nwse-resize": ["nwse-resize", "bd_double_arrow"],
    "n-resize": ["n-resize", "top_side"],
    "s-resize": ["s-resize", "bottom_side"],
    "e-resize": ["e-resize", "right_side"],
    "w-resize": ["w-resize", "left_side"],
    "ne-resize": ["ne-resize", "top_right_corner"],
    "nw-resize": ["nw-resize", "top_left_corner"],
    "se-resize": ["se-resize", "bottom_right_corner"],
    "sw-resize": ["sw-resize", "bottom_left_corner"],
}


def first_frames(data: bytes) -> dict[int, tuple[int, int, int, int, bytes]]:
    """The first image of each nominal size: width, height, hotspot x and y, and premultiplied ARGB pixels."""
    magic, _, _, count = struct.unpack_from("<4sIII", data)
    if magic != b"Xcur":
        raise ValueError("not an Xcursor file")
    frames = {}
    for i in range(count):
        kind, nominal, position = struct.unpack_from("<III", data, 16 + 12 * i)
        if kind != IMAGE_CHUNK or nominal in frames:
            continue
        _, _, _, _, width, height, x, y, _ = struct.unpack_from("<9I", data, position)
        pixels = data[position + 36 : position + 36 + 4 * width * height]
        frames[nominal] = (width, height, x, y, pixels)
    return frames


def png(width: int, height: int, argb: bytes) -> bytes:
    rows = bytearray()
    for row in range(height):
        rows.append(0)
        for b, g, r, a in struct.iter_unpack("<4B", argb[4 * width * row : 4 * width * (row + 1)]):
            # Xcursor pixels are premultiplied; PNG wants straight alpha.
            if a:
                r, g, b = (min(255, c * 255 // a) for c in (r, g, b))
            rows += bytes((r, g, b, a))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")


def main() -> None:
    theme = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "Borealis-cursors"
    source = theme / "cursors"
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    manifest = {}
    for keyword, names in KEYWORDS.items():
        found = next((source / n for n in names if (source / n).exists()), None)
        if found is None:
            print(f"skipped {keyword}: not in {theme.name}")
            continue
        frames = first_frames(found.read_bytes())
        hotspot = None
        for suffix, size in SIZES.items():
            nominal = min(frames, key=lambda n: abs(n - size))
            width, height, x, y, pixels = frames[nominal]
            (OUT / f"{keyword}{suffix}.png").write_bytes(png(width, height, pixels))
            if not suffix:
                hotspot = [x, y]
        manifest[keyword] = hotspot
    lines = ",\n".join(f"\t{json.dumps(k)}: {json.dumps(v)}" for k, v in manifest.items())
    (OUT / "cursors.json").write_text("{\n" + lines + "\n}\n")
    print(f"Wrote {len(manifest)} cursors to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
