import {
	blobAngle,
	LAVA_BACKGROUND_DEFAULT,
	LAVA_LIMITS,
	LAVA_PICTURE_DEFAULT,
	lavaHTML,
	lavaHue,
	lavaSettings,
	lavaVariation,
	randomBlob,
} from "./lava";

describe("the lava lamp's settings", () => {
	it("reads back stored settings, anything missing or out of bounds as the default", () => {
		expect(lavaSettings(undefined)).toEqual(LAVA_BACKGROUND_DEFAULT);
		const read = lavaSettings({
			primary: "#00FF00",
			accent: "red",
			spin: 99,
			blobs: Array.from({ length: 40 }, () => randomBlob()),
			size: 5,
		});
		expect(read.primary).toBe("#00ff00");
		expect(read.accent).toBe(LAVA_BACKGROUND_DEFAULT.accent);
		expect(read.spin).toBe(LAVA_LIMITS.spin.max);
		expect(read.blobs).toHaveLength(LAVA_LIMITS.blobs.max);
		expect(read.size).toBe(LAVA_LIMITS.size.min);
	});

	it("cycles the colours as lava.html's keyframes do, over three turns", () => {
		const s = { ...LAVA_PICTURE_DEFAULT, spin: 2 };
		expect(lavaHue(s, 0)).toBeCloseTo(0);
		expect(lavaHue(s, 0.6 * 6)).toBeCloseTo(-90);
		expect(lavaHue(s, 0.8 * 6)).toBeCloseTo(-45);
		expect(lavaHue(s, 6)).toBeCloseTo(0);
		expect(lavaHue({ ...s, cycle: false }, 3.6)).toBe(0);
	});

	it("turns each lump from its starting phase, reversed ones the other way", () => {
		const s = { ...LAVA_PICTURE_DEFAULT, spin: 2 };
		const [b1, b2] = s.blobs;
		expect(blobAngle(s, b2, 0)).toBeCloseTo(120);
		expect(blobAngle(s, b1, 0.5)).toBeCloseTo(-90);
	});

	it("draws a background with one lump each, placed by the background's fit", () => {
		const html = lavaHTML({
			...LAVA_BACKGROUND_DEFAULT,
			blobs: [randomBlob(), randomBlob(), randomBlob()],
		});
		expect(html.match(/class="blob"/g)).toHaveLength(3);
		expect(html).toContain('F="contain",S=0.6');
		expect(lavaHTML(LAVA_BACKGROUND_DEFAULT, "cover")).toContain('F="cover"');
		expect(html).toContain("V=true");
		expect(
			lavaHTML({ ...LAVA_BACKGROUND_DEFAULT, vary: false }, "tile"),
		).toContain("V=false");
		expect(html).toContain("background:transparent");
		expect(
			lavaHTML({ ...LAVA_BACKGROUND_DEFAULT, cycle: false }),
		).not.toContain("animation:colorize");
	});

	it("gives each copy its own variation, the same for the same seed", () => {
		const s = LAVA_PICTURE_DEFAULT;
		expect(lavaVariation(s, 7)).toEqual(lavaVariation(s, 7));
		expect(lavaVariation(s, 7)).not.toEqual(lavaVariation(s, 8));
		const v = lavaVariation(s, 7);
		expect(v.phases).toHaveLength(s.blobs.length);
		expect(v.speed).toBeGreaterThanOrEqual(0.85);
		expect(v.speed).toBeLessThanOrEqual(1.15);
	});
});
