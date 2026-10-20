import { formatActivity, formatLatency, lastDays } from "./userInsights";

describe("userInsights", () => {
	it("formats the time connected short", () => {
		expect(formatActivity(42)).toBe("42s");
		expect(formatActivity(12 * 60 + 30)).toBe("12m");
		expect(formatActivity(3 * 3600 + 5 * 60)).toBe("3h 05m");
		expect(formatActivity(30 * 3600)).toBe("30h");
	});

	it("formats a latency: one decimal under 10 ms", () => {
		expect(formatLatency(0.34)).toBe("0.3 ms");
		expect(formatLatency(42.4)).toBe("42 ms");
	});

	it("asks for the last seven days, today included, every template", () => {
		const params = lastDays(new Date(2026, 9, 19, 14, 25));
		expect(params.start_time.startsWith("2026-10-13T00:00:00")).toBe(true);
		expect(params.end_time.startsWith("2026-10-19T15:00:00")).toBe(true);
		expect(params.template_ids).toBe("");
	});
});
