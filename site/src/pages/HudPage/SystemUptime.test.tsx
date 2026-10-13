import { act, screen } from "@testing-library/react";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { formatUptime, SystemUptime } from "./SystemUptime";

describe("formatUptime", () => {
	it.each([
		[0, "0s"],
		[45_000, "45s"],
		[12 * 60_000 + 59_000, "12m"],
		[(4 * 60 + 12) * 60_000, "4h 12m"],
		[((2 * 24 + 4) * 60 + 12) * 60_000, "2d 4h 12m"],
		[-5_000, "0s"],
	])("%d ms is %s", (ms, text) => {
		expect(formatUptime(ms)).toBe(text);
	});
});

describe("SystemUptime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-13T14:00:00Z"));
	});
	afterEach(() => vi.useRealTimers());

	it("says how long Coder has been up, and counts on", () => {
		renderComponent(
			<SystemUptime uptime={{ since: "2026-10-13T12:02:30Z", replicas: 1 }} />,
		);
		const pill = screen.getByTestId("hud-uptime");
		expect(pill.textContent).toBe("System Uptime1h 57m");
		act(() => vi.advanceTimersByTime(60_000));
		expect(pill.textContent).toBe("System Uptime1h 58m");
	});

	it("says so when no replica is ready", () => {
		renderComponent(<SystemUptime uptime={{ since: null, replicas: 0 }} />);
		expect(screen.getByTestId("hud-uptime").textContent).toBe(
			"System Uptimedown",
		);
	});
});
