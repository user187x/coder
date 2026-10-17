import type { Workspace } from "#/api/typesGenerated";

/**
 * When a running workspace came on: its latest build, a start, finished then
 * (the job's completion; its start, or the build's creation, if that is all
 * there is). Null unless the workspace is running.
 */
export const workspaceStartedAt = (workspace: Workspace): Date | null => {
	const build = workspace.latest_build;
	if (build.transition !== "start" || build.status !== "running") {
		return null;
	}
	const at = build.job.completed_at ?? build.job.started_at ?? build.created_at;
	const date = new Date(at);
	return Number.isNaN(date.getTime()) ? null : date;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * How long, read at a glance: minutes and seconds under an hour, hours and
 * minutes under a day, then days and hours.
 */
export const formatUptime = (ms: number): string => {
	const s = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(s / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${pad(minutes)}m`;
	}
	return `${minutes}m ${pad(s % 60)}s`;
};

/** The same in words, for the tooltip and screen readers: "2 days, 4 hours, 12 minutes". */
export const uptimeInWords = (ms: number): string => {
	const s = Math.max(0, Math.floor(ms / 1000));
	const parts = (
		[
			[Math.floor(s / 86400), "day"],
			[Math.floor((s % 86400) / 3600), "hour"],
			[Math.floor((s % 3600) / 60), "minute"],
		] as const
	).filter(([n]) => n > 0);
	return parts.length
		? parts.map(([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`).join(", ")
		: "less than a minute";
};

/** When it started, as the tooltips say it: "Oct 17, 2026, 1:02:15 AM". */
export const formatStarted = (date: Date): string =>
	date.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "medium",
	});
