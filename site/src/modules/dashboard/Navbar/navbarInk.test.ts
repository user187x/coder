import { navbarInk } from "./navbarStrip";

describe("navbarInk", () => {
	it("reads white on a dark strip and dark on a light one, whatever the theme", () => {
		expect(navbarInk("#292929", 0)).toBe("light");
		expect(navbarInk("#f4f4f5", 0)).toBe("dark");
	});

	it("leaves the theme's own colours where the strip is the theme's or mostly see-through", () => {
		expect(navbarInk(null, 0)).toBeNull();
		expect(navbarInk("#292929", 80)).toBeNull();
	});
});
