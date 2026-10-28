import { LAVA_PICTURE_DEFAULT, randomBlob } from "./lava";
import { readLavaSettings, withLavaSettings } from "./lavaPng";

/** A PNG's chunks in order (their checksums are not read here). */
const png = (...types: string[]) => {
	const parts = [
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	];
	for (const type of types) {
		const length = type === "IHDR" ? 13 : 4;
		const chunk = new Uint8Array(12 + length);
		new DataView(chunk.buffer).setUint32(0, length);
		chunk.set(new TextEncoder().encode(type), 4);
		parts.push(chunk);
	}
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

describe("a lava picture's settings", () => {
	it("travel in its PNG, before the image data, and read back as given", () => {
		const settings = {
			...LAVA_PICTURE_DEFAULT,
			primary: "#00ff00",
			vary: false,
			blobs: [randomBlob(), randomBlob()],
		};
		const carried = withLavaSettings(png("IHDR", "IDAT", "IEND"), settings);
		expect(readLavaSettings(carried)).toEqual(settings);
		// The start of the file is enough, as the dashboard reads it.
		expect(readLavaSettings(carried.subarray(0, 2048))).toEqual(settings);
	});

	it("are not found in any other picture", () => {
		expect(readLavaSettings(png("IHDR", "IDAT", "IEND"))).toBeNull();
		expect(readLavaSettings(new TextEncoder().encode("GIF89a"))).toBeNull();
	});
});
