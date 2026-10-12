import { render } from "@testing-library/react";
import { setBackground } from "#/contexts/platformBoot";
import { backgroundStyle, PlatformBackground } from "./PlatformBackground";

describe("backgroundStyle", () => {
	it("fills, fits or tiles, faintly", () => {
		expect(
			backgroundStyle({ url: "/x.png", opacity: 0.06, fit: "cover" }),
		).toMatchObject({
			backgroundImage: 'url("/x.png")',
			backgroundSize: "cover",
			backgroundRepeat: "no-repeat",
			opacity: 0.06,
		});
		expect(
			backgroundStyle({ url: "/x.png", opacity: 0.1, fit: "tile" }),
		).toMatchObject({ backgroundRepeat: "repeat", backgroundSize: "auto" });
	});
});

describe("PlatformBackground", () => {
	afterEach(() => setBackground("dashboard", null));

	it("draws a click-through layer behind the page, or nothing", () => {
		const { rerender } = render(<PlatformBackground slot="dashboard" />);
		expect(
			document.querySelector("[data-testid=platform-background]"),
		).toBeNull();
		setBackground("dashboard", {
			url: "/__coder-ui/background/dashboard?v=1",
			opacity: 0.06,
			fit: "cover",
			layer: "under",
		});
		rerender(<PlatformBackground slot="dashboard" />);
		const layer = document.querySelector<HTMLElement>(
			"[data-testid=platform-background]",
		);
		expect(layer?.parentElement).toBe(document.body);
		expect(layer?.style.zIndex).toBe("-1");
		expect(layer?.className).toContain("pointer-events-none");
	});
});
