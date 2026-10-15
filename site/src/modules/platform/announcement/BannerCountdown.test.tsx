import { act, render, screen } from "@testing-library/react";
import { BannerCountdown } from "./BannerCountdown";

/** What the clock shows: its plates' characters, in order. */
const shown = (root: HTMLElement) =>
	[...root.querySelectorAll("[data-flap]")].map((p) => p.textContent).join("");

describe("BannerCountdown", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows days, hours, minutes and seconds on split-flap plates, ticking", () => {
		render(<BannerCountdown to="2026-10-17T12:30:05Z" />);
		const clock = screen.getByTestId("announcement-countdown");
		// 2 days, 02:30:05.
		expect(shown(clock)).toBe("2D023005");
		expect(clock.querySelectorAll(".banner-flapclock-colon")).toHaveLength(2);
		expect(clock).toHaveAttribute(
			"aria-label",
			"Countdown: 2 days, 2 hours left",
		);
		act(() => vi.advanceTimersByTime(6000));
		expect(shown(clock)).toBe("2D022959");
	});

	it("flips a plate in only when its character changes", () => {
		render(<BannerCountdown to="2026-10-15T10:01:05Z" />);
		const clock = screen.getByTestId("announcement-countdown");
		const chars = () => [...clock.querySelectorAll(".banner-flapclock-char")];
		const before = chars();
		act(() => vi.advanceTimersByTime(1000));
		const after = chars();
		// 00:01:05 -> 00:01:04: only the last plate's character is new.
		expect(after.map((c, i) => c === before[i])).toEqual([
			true,
			true,
			true,
			true,
			true,
			false,
		]);
	});

	it("blinks zero when the moment has come", () => {
		render(<BannerCountdown to="2026-10-15T09:00:00Z" />);
		const clock = screen.getByTestId("announcement-countdown");
		expect(shown(clock)).toBe("000000");
		expect(clock).toHaveAttribute("data-done");
		expect(clock).toHaveAttribute("aria-label", "Countdown finished");
	});
});
