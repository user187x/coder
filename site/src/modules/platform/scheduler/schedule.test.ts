import {
	durationMs,
	fromCoderSchedule,
	scheduleProblem,
	toCoderSchedule,
} from "./schedule";

describe("toCoderSchedule", () => {
	it("makes Coder's autostart cron and time-to-stop", () => {
		expect(
			toCoderSchedule({
				start: "08:30",
				stop: "17:00",
				days: [5, 1, 2, 3, 4],
				timezone: "America/New_York",
			}),
		).toEqual({
			autostart_schedule: "CRON_TZ=America/New_York 30 8 * * 1,2,3,4,5",
			ttl_ms: 8.5 * 3_600_000,
		});
	});

	it("wraps past midnight and writes every day as *", () => {
		expect(
			toCoderSchedule({
				start: "22:00",
				stop: "06:00",
				days: [0, 1, 2, 3, 4, 5, 6],
				timezone: "UTC",
			}),
		).toEqual({
			autostart_schedule: "CRON_TZ=UTC 0 22 * * *",
			ttl_ms: 8 * 3_600_000,
		});
		expect(durationMs("09:00", "09:30")).toBe(30 * 60_000);
	});
});

describe("fromCoderSchedule", () => {
	it("reads what toCoderSchedule writes", () => {
		const s = {
			start: "07:15",
			stop: "15:45",
			days: [1, 3, 5],
			timezone: "Europe/Berlin",
		};
		const c = toCoderSchedule(s);
		expect(fromCoderSchedule(c.autostart_schedule, c.ttl_ms, "UTC")).toEqual(s);
	});

	it("understands day ranges and schedules without a time zone", () => {
		expect(fromCoderSchedule("0 9 * * 1-5", 3_600_000, "UTC")).toEqual({
			start: "09:00",
			stop: "10:00",
			days: [1, 2, 3, 4, 5],
			timezone: "UTC",
		});
	});

	it("gives up on schedules it cannot show", () => {
		expect(fromCoderSchedule("*/5 * * * *", 0, "UTC")).toBeUndefined();
		expect(fromCoderSchedule(null, null, "UTC")).toBeUndefined();
	});
});

describe("scheduleProblem", () => {
	const ok = {
		start: "09:00",
		stop: "17:00",
		days: [1, 2, 3, 4, 5],
		timezone: "UTC",
	};
	it("accepts a schedule within the maximum", () => {
		expect(scheduleProblem(ok, 10)).toBe("");
		expect(scheduleProblem(ok, null)).toBe("");
	});
	it("refuses one over the maximum, without days, or without a duration", () => {
		expect(scheduleProblem(ok, 4)).toMatch(/at most 4 h/);
		expect(scheduleProblem({ ...ok, days: [] }, null)).toMatch(/day/);
		expect(scheduleProblem({ ...ok, stop: "09:00" }, null)).toMatch(/differ/);
	});
});
