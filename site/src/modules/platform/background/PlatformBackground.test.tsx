import { render } from "@testing-library/react";
import { setBackground } from "#/contexts/platformBoot";
import {
	backgroundStyle,
	PlatformBackground,
	parseRGB,
	underlayLayers,
} from "./PlatformBackground";

const URL = "/__coder-ui/background/dashboard?v=1";

describe("backgroundStyle", () => {
	it.each([
		["stretch", "100% 100%"],
		["center", "auto"],
		["span", "100% auto"],
	] as const)("maps %s in both rendering layers", (fit, size) => {
		expect(
			backgroundStyle({ url: "/x.png", opacity: 0.1, fit }).backgroundSize,
		).toBe(size);
		expect(
			underlayLayers({ url: "/x.png", opacity: 0.1, fit }, [0, 0, 0])
				.backgroundSize,
		).toBe(`auto, ${size}`);
	});
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

describe("underlayLayers", () => {
	it("veils the picture with the page's colour, (1 - strength) opaque", () => {
		const layers = underlayLayers(
			{ url: "/x.png", opacity: 0.06, fit: "cover" },
			[9, 9, 11],
		);
		expect(layers.backgroundImage).toBe(
			'linear-gradient(rgba(9, 9, 11, 0.94), rgba(9, 9, 11, 0.94)), url("/x.png")',
		);
		expect(layers.backgroundAttachment).toBe("fixed, fixed");
		expect(parseRGB("rgb(9, 9, 11)")).toEqual([9, 9, 11, 1]);
		expect(parseRGB("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
	});
});

describe("PlatformBackground", () => {
	afterEach(() => {
		setBackground("dashboard", null);
		document.body.style.backgroundImage = "";
	});

	it("under: lays it beneath the page's own background, and takes it away again", () => {
		document.body.style.backgroundColor = "rgb(9, 9, 11)";
		const { rerender, unmount } = render(
			<PlatformBackground slot="dashboard" />,
		);
		expect(document.body.style.backgroundImage).toBe("");
		setBackground("dashboard", {
			url: URL,
			opacity: 0.06,
			fit: "cover",
			layer: "under",
		});
		rerender(<PlatformBackground slot="dashboard" />);
		expect(document.body.style.backgroundImage).toContain(URL);
		expect(document.body.style.backgroundColor).toBe("rgb(9, 9, 11)");
		expect(
			document.querySelector("[data-testid=platform-background]"),
		).toBeNull();
		unmount();
		expect(document.body.style.backgroundImage).toBe("");
	});

	it("over: a click-through watermark layer", () => {
		setBackground("dashboard", {
			url: URL,
			opacity: 0.06,
			fit: "cover",
			layer: "over",
		});
		render(<PlatformBackground slot="dashboard" />);
		const layer = document.querySelector<HTMLElement>(
			"[data-testid=platform-background]",
		);
		expect(layer?.parentElement).toBe(document.body);
		expect(layer?.className).toContain("pointer-events-none");
	});
});

describe("PlatformBackground: an animated GIF", () => {
	afterEach(async () => {
		const { setAnimationPart } = await import("../animations/animations");
		setAnimationPart("background", true);
		setAnimationPart("gifs", true);
		setBackground("dashboard", null);
		vi.restoreAllMocks();
	});

	it("stands still on its first frame while Moving background or Animated GIFs is off", async () => {
		const freezer = await import("../animations/gifFreezer");
		const still = vi
			.spyOn(freezer, "stillFrame")
			.mockResolvedValue("data:image/png;base64,STILL");
		const { setAnimationPart } = await import("../animations/animations");
		const { act, screen, waitFor } = await import("@testing-library/react");
		render(<PlatformBackground slot="dashboard" />);
		act(() =>
			setBackground("dashboard", {
				url: "/__coder-ui/background/dashboard?v=2",
				opacity: 0.5,
				fit: "cover",
				layer: "over",
			}),
		);
		const layer = () =>
			(screen.getByTestId("platform-background") as HTMLElement).style
				.backgroundImage;
		expect(layer()).toContain("/__coder-ui/background/dashboard?v=2");
		for (const part of ["gifs", "background"] as const) {
			act(() => setAnimationPart(part, false));
			await waitFor(() => expect(layer()).toContain("STILL"));
			act(() => setAnimationPart(part, true));
			await waitFor(() =>
				expect(layer()).toContain("/__coder-ui/background/dashboard?v=2"),
			);
		}
		expect(still).toHaveBeenCalledWith("/__coder-ui/background/dashboard?v=2");
	});
});
