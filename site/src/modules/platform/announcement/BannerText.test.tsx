import { act, render } from "@testing-library/react";
import { BannerText } from "./BannerText";
import { pictureFit } from "./bannerTokens";

const banner = {
	title: "",
	message: "Hello",
	linkText: "",
	linkUrl: "",
	effect: "typewriter" as const,
	repeat: true,
};

const visibleLetters = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>("span.inline-block")]
		.filter((s) => s.style.visibility === "visible")
		.map((s) => s.textContent)
		.join("");

describe("BannerText typewriter with repeat", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("types, holds and clears the message without a blinking CSS animation", () => {
		const { container } = render(<BannerText banner={banner} animate />);
		const letters =
			container.querySelectorAll<HTMLElement>("span.inline-block");
		expect(letters).toHaveLength(5);
		for (const letter of letters) {
			expect(letter.style.animation).toBe("");
		}
		act(() => vi.advanceTimersByTime(100));
		const early = visibleLetters(container);
		expect(early.length).toBeGreaterThan(0);
		expect(early.length).toBeLessThan(5);
		act(() => vi.advanceTimersByTime(500));
		expect(visibleLetters(container)).toBe("Hello");
		act(() => vi.advanceTimersByTime(2500));
		expect(visibleLetters(container)).toBe("Hello"); // still held
		act(() => vi.advanceTimersByTime(700));
		expect(visibleLetters(container).length).toBeLessThan(5); // cleared, typing again
	});

	it("still types once with a CSS animation without repeat", () => {
		const { container } = render(
			<BannerText banner={{ ...banner, repeat: false }} animate />,
		);
		const first = container.querySelector<HTMLElement>("span.inline-block");
		expect(first?.style.animation).toContain("announce-appear");
		expect(first?.style.animation).not.toContain("infinite");
	});
});

describe("BannerText stylesheet effects", () => {
	const fx = { ...banner, effect: "pewpew" as const, message: "PEW PEW" };

	it("fires each letter of the pew-pew in as a <b> indexed by --i", () => {
		const { container } = render(<BannerText banner={fx} animate />);
		const text = container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text?.classList.contains("fx-pewpew")).toBe(true);
		expect(text?.hasAttribute("data-fx-once")).toBe(false);
		const letters = [...container.querySelectorAll<HTMLElement>("b")];
		expect(letters.map((b) => b.textContent).join("")).toBe("PEWPEW");
		expect(letters.map((b) => b.style.getPropertyValue("--i"))).toEqual([
			"0",
			"1",
			"2",
			"3",
			"4",
			"5",
		]);
		expect(text?.textContent).toBe("PEW PEW");
		// Each word's letters together: a line breaks only at the spaces.
		const words = [...(text?.querySelectorAll("span.whitespace-nowrap") ?? [])];
		expect(words.map((w) => w.textContent)).toEqual(["PEW", "PEW"]);
	});

	it("brings a long message's letters closer together", () => {
		const { container } = render(
			<BannerText banner={{ ...fx, message: "x".repeat(48) }} animate />,
		);
		const last = [...container.querySelectorAll<HTMLElement>("b")].at(-1);
		// 48 letters indexed over at most 12: the last one waits 11.75 letters' delay.
		expect(last?.style.getPropertyValue("--i")).toBe("11.75");
	});

	it("puts each split-flap letter on its plate, and plays once without repeat", () => {
		const { container } = render(
			<BannerText
				banner={{ ...fx, effect: "flap", message: "DEPART", repeat: false }}
				animate
			/>,
		);
		const text = container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text?.classList.contains("fx-flap")).toBe(true);
		expect(text?.hasAttribute("data-fx-once")).toBe(true);
		expect(container.querySelectorAll("b")).toHaveLength(6);
	});

	it("sweeps the ghostwrite over the whole message, then shows it plain when it played once", () => {
		const { container } = render(
			<BannerText
				banner={{
					...fx,
					effect: "shimmer",
					message: "THINKING",
					repeat: false,
				}}
				animate
			/>,
		);
		const text = () =>
			container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text()?.classList.contains("fx-shimmer")).toBe(true);
		expect(container.querySelectorAll("b")).toHaveLength(0);
		const end = new Event("animationend", { bubbles: true });
		act(() => {
			text()?.dispatchEvent(end);
		});
		expect(text()?.classList.contains("fx-shimmer")).toBe(false);
		expect(text()?.textContent).toBe("THINKING");
	});

	it("runs KITT's scanner behind the plain message, then puts it out when it played once", () => {
		const width = vi
			.spyOn(HTMLElement.prototype, "offsetWidth", "get")
			.mockReturnValue(880);
		try {
			const { container, getByTestId, queryByTestId } = render(
				<BannerText
					banner={{
						...fx,
						effect: "kitt",
						message: "KITT",
						repeat: false,
						speed: "fast" as const,
					}}
					animate
				/>,
			);
			const scanner = getByTestId("announcement-kitt");
			expect(scanner.getAttribute("aria-hidden")).toBe("true");
			expect(scanner.hasAttribute("data-once")).toBe(true);
			expect(scanner.style.getPropertyValue("--kitt-cycle")).toBe("1000ms");
			// A lamp for every 44 px of the screen, each placed on the row's clock.
			const lamps = scanner.querySelectorAll<HTMLElement>("i");
			expect(lamps).toHaveLength(20);
			expect(scanner.style.getPropertyValue("--kitt-n")).toBe("20");
			expect(lamps[19].style.getPropertyValue("--i")).toBe("19");
			const text = () =>
				container.querySelector<HTMLElement>("[data-banner-text]");
			expect(text()?.className).toBe("");
			expect(text()?.textContent).toBe("KITT");
			act(() => {
				scanner.dispatchEvent(new Event("animationend", { bubbles: true }));
			});
			expect(queryByTestId("announcement-kitt")).toBeNull();
			expect(text()?.textContent).toBe("KITT");
		} finally {
			width.mockRestore();
		}
	});

	it("keeps the plain text without animate", () => {
		const { container } = render(<BannerText banner={fx} />);
		const text = container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text?.className).toBe("");
		expect(container.querySelectorAll("b")).toHaveLength(0);
	});
});

describe("BannerText pictures", () => {
	// jsdom loads no images: a stand-in that "loads" at the size its name says.
	class SizedImage {
		naturalWidth = 0;
		naturalHeight = 0;
		onload: (() => void) | null = null;
		set src(value: string) {
			const size = value.includes("flag") ? 600 : 64;
			this.naturalWidth = size;
			this.naturalHeight = Math.round(size * 0.53);
			queueMicrotask(() => this.onload?.());
		}
	}
	beforeEach(() => {
		vi.stubGlobal("Image", SizedImage);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("draws a picture as its fit says, whatever its size", async () => {
		const { findByTestId } = render(
			<BannerText
				banner={{
					...banner,
					effect: "none",
					message: "![stars](/emojis/2b50.png#fit=tile)",
				}}
			/>,
		);
		const picture = await findByTestId("announcement-picture");
		expect(picture.dataset.fit).toBe("tile");
		expect(picture.style.backgroundImage).toBe(
			'url("/emojis/2b50.png#fit=tile")',
		);
	});

	it("draws a plain message as typed, over its background picture, lined up as chosen", async () => {
		const { container, findByTestId } = render(
			<BannerText
				banner={{
					...banner,
					effect: "none",
					markdown: false,
					message: "Save **now** [docs](https://x.example) ![a](/b.png)",
					align: "right",
					picture: "/pictures/usa.gif",
					pictureFit: "stretch",
				}}
			/>,
		);
		const picture = await findByTestId("announcement-picture");
		expect(picture.dataset.fit).toBe("stretch");
		expect(picture.style.backgroundImage).toBe('url("/pictures/usa.gif")');
		const text = container.querySelector<HTMLElement>("[data-banner-text]");
		// No Markdown: the stars, brackets and image stay text.
		expect(text?.textContent).toBe(
			"Save **now** [docs](https://x.example) ![a](/b.png)",
		);
		expect(text?.querySelector("strong, a, img")).toBeNull();
		expect(text?.style.textAlign).toBe("right");
	});

	it("outlines the text when asked, its font and effect as they are", () => {
		const { container, rerender } = render(
			<BannerText
				banner={{ ...banner, effect: "pewpew", repeat: true, font: "serif" }}
				animate
			/>,
		);
		const text = () =>
			container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text()?.hasAttribute("data-outline")).toBe(false);
		rerender(
			<BannerText
				banner={{
					...banner,
					effect: "pewpew",
					repeat: true,
					font: "serif",
					outline: true,
				}}
				animate
			/>,
		);
		expect(text()?.hasAttribute("data-outline")).toBe(true);
		expect(text()).toHaveClass("fx-pewpew");
		expect(text()?.style.fontFamily).toContain("serif");
	});

	it("rolls a spanning background picture", async () => {
		const { findByTestId } = render(
			<BannerText
				banner={{
					...banner,
					effect: "none",
					markdown: false,
					picture: "/pictures/background.gif",
				}}
			/>,
		);
		const roll = await findByTestId("announcement-picture-roll");
		expect(
			[...roll.querySelectorAll("img")].map((i) => i.getAttribute("src")),
		).toEqual(["/pictures/background.gif", "/pictures/background.gif"]);
	});

	it("reads a picture's fit from its address", () => {
		expect(pictureFit("/p.png#fit=stretch")).toBe("stretch");
		expect(pictureFit("/p.png#x=1&fit=center")).toBe("center");
		expect(pictureFit("/p.png#fit=bogus")).toBeNull();
		expect(pictureFit("/p.png")).toBeNull();
	});

	it("rolls a large picture behind the text, keeps a small one (an emoji) in the line", async () => {
		const { container, findByTestId } = render(
			<BannerText
				banner={{
					...banner,
					effect: "none",
					message:
						"Happy holidays ![smile](/emojis/1f600.png) ![US flag](/flag.png)",
				}}
			/>,
		);
		const roll = await findByTestId("announcement-picture-roll");
		expect(roll).toHaveAttribute("aria-label", "US flag");
		// Twice, one copy after the other: the roll goes round without a jump.
		expect(
			[...roll.querySelectorAll("img")].map((i) => i.getAttribute("src")),
		).toEqual(["/flag.png", "/flag.png"]);
		const text = container.querySelector<HTMLElement>("[data-banner-text]");
		expect(text?.hasAttribute("data-over-picture")).toBe(true);
		expect(
			[...(text?.querySelectorAll("img") ?? [])].map((i) =>
				i.getAttribute("src"),
			),
		).toEqual(["/emojis/1f600.png"]);
	});
});

describe("BannerText crawl (starwars)", () => {
	const crawl = { ...banner, effect: "starwars" as const, repeat: false };

	it("keeps the message in its place, invisible, so the banner keeps its size, and runs the crawl over it", () => {
		const { container } = render(
			<div className="banner-lcd">
				<BannerText banner={crawl} animate />
			</div>,
		);
		const sizer = container.querySelector<HTMLElement>(".banner-crawl-sizer");
		expect(sizer?.textContent).toBe("Hello");
		expect(sizer).toHaveAttribute("aria-hidden", "true");
		expect(sizer?.hasAttribute("inert")).toBe(true);
		const view = container.querySelector<HTMLElement>("[data-banner-crawl]");
		expect(view?.textContent).toBe("Hello");
		// out of the flow: the host's size is the sizer's
		expect(view?.closest(".banner-crawl-host")).not.toBeNull();
	});

	it("tilts as far as its convergence says (the opening crawl when unset) and paces by its speed", () => {
		const { container, rerender } = render(
			<BannerText banner={crawl} animate />,
		);
		const view = () =>
			container.querySelector<HTMLElement>("[data-banner-crawl]");
		expect(view()?.style.getPropertyValue("--crawl-tilt")).toBe("1");
		rerender(<BannerText banner={{ ...crawl, crawlTilt: 0 }} animate />);
		expect(view()?.style.getPropertyValue("--crawl-tilt")).toBe("0");
		rerender(<BannerText banner={{ ...crawl, crawlTilt: 40 }} animate />);
		expect(view()?.style.getPropertyValue("--crawl-tilt")).toBe("0.4");
	});
});
