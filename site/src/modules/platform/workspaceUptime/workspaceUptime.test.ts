import { MockWorkspace } from "#/testHelpers/entities";
import {
	formatUptime,
	uptimeInWords,
	workspaceStartedAt,
} from "./workspaceUptime";

describe("workspaceStartedAt", () => {
	const at = (
		transition: "start" | "stop",
		status: "running" | "stopped",
		completed?: string,
	) => ({
		...MockWorkspace,
		latest_build: {
			...MockWorkspace.latest_build,
			transition,
			status,
			created_at: "2026-10-17T01:00:00Z",
			job: {
				...MockWorkspace.latest_build.job,
				started_at: "2026-10-17T01:00:02Z",
				completed_at: completed,
			},
		},
	});

	it("is when the latest start build finished", () => {
		expect(
			workspaceStartedAt(
				at("start", "running", "2026-10-17T01:00:30Z"),
			)?.toISOString(),
		).toBe("2026-10-17T01:00:30.000Z");
	});

	it("falls back to the job's start", () => {
		expect(workspaceStartedAt(at("start", "running"))?.toISOString()).toBe(
			"2026-10-17T01:00:02.000Z",
		);
	});

	it("is nothing for a workspace that is not running", () => {
		expect(
			workspaceStartedAt(at("stop", "stopped", "2026-10-17T01:00:30Z")),
		).toBeNull();
	});
});

describe("formatUptime", () => {
	it("shows seconds in the first hour, then hours and minutes, then days", () => {
		expect(formatUptime(-5_000)).toBe("0m 00s");
		expect(formatUptime(65_000)).toBe("1m 05s");
		expect(formatUptime(3_600_000 + 9 * 60_000)).toBe("1h 09m");
		expect(formatUptime(2 * 86_400_000 + 4 * 3_600_000 + 1)).toBe("2d 4h");
	});
});

describe("uptimeInWords", () => {
	it("names the units", () => {
		expect(uptimeInWords(30_000)).toBe("less than a minute");
		expect(uptimeInWords(86_400_000 + 60_000)).toBe("1 day, 1 minute");
		expect(uptimeInWords(2 * 3_600_000 + 12 * 60_000)).toBe(
			"2 hours, 12 minutes",
		);
	});
});
