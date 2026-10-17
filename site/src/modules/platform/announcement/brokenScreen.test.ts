import { breakScreen } from "./brokenScreen";

describe("breakScreen", () => {
	it("draws the same screen for the same seed, cracks from the impact to the edges", () => {
		const a = breakScreen(1440, 900, 7);
		expect(breakScreen(1440, 900, 7)).toEqual(a);
		expect(a.impact.x).toBeGreaterThan(1440 * 0.3);
		expect(a.impact.x).toBeLessThan(1440 * 0.7);
		const main = a.cracks.slice(0, 13);
		for (const d of main) {
			expect(d.startsWith(`M${Math.round(a.impact.x * 10) / 10},`)).toBe(true);
			// Each main crack runs off the screen.
			const [x, y] = d.split(" ").pop()?.slice(1).split(",").map(Number) ?? [];
			expect(x < 0 || x > 1440 || y < 0 || y > 900).toBe(true);
		}
		expect(a.rings.length).toBeGreaterThan(5);
		expect(a.lines.length).toBeGreaterThanOrEqual(5);
		expect(a.blots[0]).toMatchObject({ x: a.impact.x, y: a.impact.y });
	});
});
