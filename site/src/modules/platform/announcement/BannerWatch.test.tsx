import { act, render, screen } from "@testing-library/react";
import { BannerWatch } from "./BannerWatch";

/** The digits the watch shows, read from their lit segments. */
const LIT_TO_DIGIT: Record<string, string> = {
	abcdef: "0",
	bc: "1",
	abdeg: "2",
	abcdg: "3",
	bcfg: "4",
	acdfg: "5",
	acdefg: "6",
	abc: "7",
	abcdefg: "8",
	abcdfg: "9",
};
const shown = (root: HTMLElement) =>
	[...root.querySelectorAll("svg")]
		.map((svg) => {
			const lit = [...svg.querySelectorAll("polygon")]
				.map((p, i) => (p.hasAttribute("data-lit") ? "abcdefg"[i] : ""))
				.join("");
			return LIT_TO_DIGIT[lit] ?? "?";
		})
		.join("");

describe("BannerWatch", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows days, hours and minutes, then the seconds, ticking", () => {
		render(<BannerWatch to="2026-10-17T12:30:05Z" />);
		const watch = screen.getByTestId("announcement-countdown");
		// 2 days, 02:30, 05 seconds.
		expect(shown(watch)).toBe("2023005");
		expect(watch).toHaveAttribute(
			"aria-label",
			"Countdown: 2 days, 2 hours left",
		);
		act(() => vi.advanceTimersByTime(6000));
		expect(shown(watch)).toBe("2022959");
	});

	it("blinks zero when the moment has come", () => {
		render(<BannerWatch to="2026-10-15T09:00:00Z" />);
		const watch = screen.getByTestId("announcement-countdown");
		expect(shown(watch)).toBe("000000");
		expect(watch).toHaveAttribute("data-done");
		expect(watch).toHaveAttribute("aria-label", "Countdown finished");
	});
});
