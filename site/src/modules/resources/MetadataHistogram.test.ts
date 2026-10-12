import {
	LEVELS,
	levelColor,
	metadataNumber,
	toBars,
} from "./MetadataHistogram";

describe("metadataNumber", () => {
	it("prefers a value's percentage", () => {
		expect(metadataNumber("0.455/2 cores (23%)")).toEqual({
			value: 23,
			percent: true,
		});
		expect(metadataNumber("3/9 GiB (33.5%)")).toEqual({
			value: 33.5,
			percent: true,
		});
	});
	it("else takes its first number", () => {
		expect(metadataNumber("0.12")).toEqual({ value: 0.12, percent: false });
		expect(metadataNumber("load 1.5 2.0")).toEqual({
			value: 1.5,
			percent: false,
		});
	});
	it("gives nothing for text without a number", () => {
		expect(metadataNumber("running")).toBeNull();
	});
});

describe("levelColor", () => {
	const color = (from: number) => LEVELS.find((l) => l.from === from)?.color;
	it("goes green, yellow-green, yellow, orange, red", () => {
		expect(levelColor(10)).toBe(color(Number.NEGATIVE_INFINITY));
		expect(levelColor(49.9)).toBe(color(Number.NEGATIVE_INFINITY));
		expect(levelColor(50)).toBe(color(50));
		expect(levelColor(64)).toBe(color(50));
		expect(levelColor(65)).toBe(color(65));
		expect(levelColor(74)).toBe(color(65));
		expect(levelColor(75)).toBe(color(75));
		expect(levelColor(89)).toBe(color(75));
		expect(levelColor(90)).toBe(color(90));
		expect(levelColor(null)).toBe(color(Number.NEGATIVE_INFINITY));
	});
});

describe("toBars", () => {
	it("keeps the highest reading of each period", () => {
		const now = Date.now();
		const at = (ago: number, value: number) => ({
			at: new Date(now - ago * 1000).toISOString(),
			t: now - ago * 1000,
			value,
			text: String(value),
		});
		const bars = toBars([at(5, 10), at(3, 80), at(1, 20)], 300);
		const filled = bars.filter(Boolean);
		expect(filled.length).toBeGreaterThanOrEqual(1);
		expect(Math.max(...filled.map((b) => b?.value ?? 0))).toBe(80);
		expect(bars.length).toBe(40);
	});
});
