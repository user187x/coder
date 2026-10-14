import {
	LEVELS,
	levelColor,
	metadataNumber,
	oneDecimal,
	splitPercent,
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

describe("toBars, shorter periods than the agent's interval", () => {
	it("holds the last reading, marked, until it is too old", () => {
		const now = Date.now();
		const at = (ago: number, value: number) => ({
			at: new Date(now - ago * 1000).toISOString(),
			t: now - ago * 1000,
			value,
			text: String(value),
		});
		const bars = toBars([at(25, 40), at(12, 60)], 1, 15);
		const real = bars.filter((b) => b && !b.held);
		const held = bars.filter((b) => b?.held);
		expect(real.length).toBe(2);
		expect(held.length).toBeGreaterThan(5);
		expect(held.every((b) => b?.value === 40 || b?.value === 60)).toBe(true);
		// without hold: only the two readings
		expect(toBars([at(25, 40), at(12, 60)], 1).filter(Boolean).length).toBe(2);
	});
});

describe("splitPercent", () => {
	it("takes the percentage out of a reading", () => {
		expect(splitPercent("2.24/24 cores (9%)")).toEqual({
			text: "2.24/24 cores",
			percent: 9,
		});
		expect(splitPercent("1.2 / 8.0 GB (15%)")).toEqual({
			text: "1.2 / 8.0 GB",
			percent: 15,
		});
		expect(splitPercent("42%")).toEqual({ text: "42%", percent: 42 });
		expect(splitPercent("0.90 load")).toEqual({
			text: "0.90 load",
			percent: null,
		});
	});
});

describe("oneDecimal: fractional readings to one decimal place", () => {
	it.each([
		["0.621/6 cores", "0.6/6 cores"],
		["0.45/6.44 GB", "0.5/6.4 GB"],
		["0.13 / 6 cores", "0.1 / 6 cores"],
		["19.54/98.55 GB", "19.5/98.6 GB"],
		["2.10 / 24 cores (9%)", "2.1 / 24 cores (9%)"],
		["918.7/1003.7 GB", "918.7/1003.7 GB"],
		["6 cores", "6 cores"],
		["12%", "12%"],
	])("%s → %s", (reading, shown) => {
		expect(oneDecimal(reading)).toBe(shown);
	});
});
