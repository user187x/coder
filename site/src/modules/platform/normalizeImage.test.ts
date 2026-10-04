import {
	AVATAR_TARGET,
	fitImage,
	frameDelay,
	LOGO_TARGET,
	sniffImageType,
} from "./normalizeImage";

const bytes = (...parts: (string | number[])[]) =>
	new Uint8Array(
		parts.flatMap((part) =>
			typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
		),
	);

describe("fitImage", () => {
	it("fits a logo inside 512 × 256, keeping its shape", () => {
		expect(fitImage(520, 390, LOGO_TARGET)).toEqual({
			source: { x: 0, y: 0, width: 520, height: 390 },
			width: 341,
			height: 256,
		});
	});

	it("crops an avatar to its centred square at 256 px", () => {
		expect(fitImage(800, 600, AVATAR_TARGET)).toEqual({
			source: { x: 100, y: 0, width: 600, height: 600 },
			width: 256,
			height: 256,
		});
	});

	it("never enlarges a small picture", () => {
		expect(fitImage(208, 208, AVATAR_TARGET).width).toBe(208);
		expect(fitImage(120, 40, LOGO_TARGET)).toMatchObject({
			width: 120,
			height: 40,
		});
	});
});

describe("sniffImageType", () => {
	it.each([
		["image/png", bytes([0x89], "PNG\r\n")],
		["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
		["image/gif", bytes("GIF89a")],
		["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X")],
		["image/avif", bytes([0, 0, 0, 0x1c], "ftypavis")],
		["image/svg+xml", bytes('<svg xmlns="http://www.w3.org/2000/svg">')],
		[null, bytes("not an image")],
	])("recognises %s from the file's first bytes", (type, data) => {
		expect(sniffImageType(data)).toBe(type);
	});
});

describe("frameDelay", () => {
	it("converts a frame's duration to milliseconds, at least 20", () => {
		expect(frameDelay(80_000)).toBe(80);
		expect(frameDelay(0)).toBe(20);
		expect(frameDelay(null)).toBe(100);
	});
});
