import { LAVA_PICTURE_DEFAULT, type LavaSettings, lavaSettings } from "./lava";

/**
 * A lava picture is a still PNG (what shows where the dashboard cannot draw it,
 * such as another application) carrying its settings in a tEXt chunk under
 * this keyword, which the dashboard reads to draw every copy live (LiveLava).
 */
const KEYWORD = "coder-lava";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return c >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
	let c = 0xffffffff;
	for (const b of bytes) {
		c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
};

const isPng = (bytes: Uint8Array) => SIGNATURE.every((b, i) => bytes[i] === b);

/** The PNG with the settings in a tEXt chunk right after its header (IHDR), before the image data. */
export const withLavaSettings = (
	png: Uint8Array,
	settings: LavaSettings,
): Uint8Array => {
	if (!isPng(png)) {
		throw new Error("Not a PNG.");
	}
	const text = new TextEncoder().encode(
		`${KEYWORD}\0${JSON.stringify(settings)}`,
	);
	const chunk = new Uint8Array(12 + text.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, text.length);
	chunk.set(new TextEncoder().encode("tEXt"), 4);
	chunk.set(text, 8);
	view.setUint32(8 + text.length, crc32(chunk.subarray(4, 8 + text.length)));
	// The signature (8 bytes) and IHDR (always 25 bytes) come first.
	const at = 8 + 25;
	const out = new Uint8Array(png.length + chunk.length);
	out.set(png.subarray(0, at));
	out.set(chunk, at);
	out.set(png.subarray(at), at + chunk.length);
	return out;
};

/**
 * The settings a lava picture carries, read from the start of its PNG (up to
 * its image data); null for any other picture, or one cut short before them.
 */
export const readLavaSettings = (bytes: Uint8Array): LavaSettings | null => {
	if (bytes.length < 8 || !isPng(bytes)) {
		return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (from: number, to: number) =>
		String.fromCharCode(...bytes.subarray(from, to));
	let at = 8;
	while (at + 8 <= bytes.length) {
		const length = view.getUint32(at);
		const type = ascii(at + 4, at + 8);
		if (type === "IDAT" || type === "IEND") {
			return null;
		}
		if (at + 12 + length > bytes.length) {
			return null;
		}
		if (type === "tEXt") {
			const data = bytes.subarray(at + 8, at + 8 + length);
			const nul = data.indexOf(0);
			if (nul > 0 && ascii(at + 8, at + 8 + nul) === KEYWORD) {
				try {
					return lavaSettings(
						JSON.parse(new TextDecoder().decode(data.subarray(nul + 1))),
						LAVA_PICTURE_DEFAULT,
					);
				} catch {
					return null;
				}
			}
		}
		at += 12 + length;
	}
	return null;
};
