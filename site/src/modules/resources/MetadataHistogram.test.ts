import { metadataNumber } from "./MetadataHistogram";

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
