import { act, render } from "@testing-library/react";
import { BannerText } from "./BannerText";

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
