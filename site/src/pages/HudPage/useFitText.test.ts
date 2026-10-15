import { fitFontSize } from "./useFitText";

describe("fitFontSize", () => {
	it("keeps the largest size when the line fits", () => {
		expect(fitFontSize(14, 900, 1000, 14, 8)).toBe(14);
	});
	it("shrinks in proportion, in quarter pixels", () => {
		// 1500 px of content in 1000 px: 14 * 2/3 = 9.33 -> 9.25.
		expect(fitFontSize(14, 1500, 1000, 14, 8)).toBe(9.25);
	});
	it("never goes below the smallest size", () => {
		expect(fitFontSize(14, 5000, 1000, 14, 8)).toBe(8);
	});
	it("does not grow past the largest size", () => {
		expect(fitFontSize(10, 500, 1000, 14, 8)).toBe(14);
	});
	it("leaves an unmeasured line alone", () => {
		expect(fitFontSize(14, 0, 0, 14, 8)).toBe(14);
	});
});
