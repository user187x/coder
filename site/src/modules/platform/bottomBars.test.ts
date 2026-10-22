import { bottomBarsHeight } from "./bottomBars";

/** A bar of the page, at `top` and `height` px in a window 800 px tall. */
const bar = (attrs: string, top: number, height: number) => {
	const el = document.createElement("div");
	el.className = attrs;
	el.getBoundingClientRect = () =>
		({ top, bottom: top + height, height, width: 1000 }) as DOMRect;
	document.body.append(el);
	return el;
};

describe("bottomBarsHeight", () => {
	beforeEach(() => {
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
	});
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("adds up the bars stacked on the window's bottom edge", () => {
		expect(bottomBarsHeight()).toBe(0);
		const classification = bar("fixed bottom-0", 776, 24);
		expect(bottomBarsHeight()).toBe(24);
		// the deployment's bar, resting on the classification bar
		bar("sticky bottom-0", 740, 36);
		expect(bottomBarsHeight()).toBe(60);
		// one floating clear of the bottom is not resting on anything: left out
		bar("fixed bottom-0", 500, 20);
		expect(bottomBarsHeight()).toBe(60);
		// one inside the element measuring (its own) is left out
		expect(bottomBarsHeight(document.body)).toBe(0);
		classification.remove();
	});
});
