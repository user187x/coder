import { useQuery } from "react-query";
import type { InsightsParams } from "#/api/api";
import {
	insightsUserActivity,
	insightsUserLatency,
} from "#/api/queries/insights";
import {
	addTime,
	formatDateTime,
	startOfDay,
	startOfHour,
	subtractTime,
} from "#/utils/time";

/**
 * Each user's connections to their workspaces over the last seven days, across every template (Coder's insights,
 * what a template's Overview showed by template): the median latency and the time connected - the Accounts table's
 * Latency and Activity. Only for those who may read every template's insights (owners, template admins); for others
 * the columns are not shown.
 */

export const INSIGHTS_DAYS = 7;

/** The last seven days, today included (to the next whole hour: the insights take no later end). */
export const lastDays = (
	now = new Date(),
	days = INSIGHTS_DAYS,
): InsightsParams => {
	const start = startOfDay(subtractTime(now, days - 1, "day"));
	const end = addTime(startOfHour(now), 1, "hour");
	// one offset for both ends, so a daylight saving change between them does not shift one
	const offset = end.getTimezoneOffset();
	return {
		start_time: toISOLocal(start, offset),
		end_time: toISOLocal(end, offset),
		template_ids: "",
	};
};

export type UserInsight = {
	/** The median round trip of the user's connections (ms), and the 95th percentile. */
	latency?: { p50: number; p95: number };
	/** Seconds connected (apps, terminal, SSH). */
	seconds?: number;
};

export const useUserInsights = (enabled: boolean) => {
	const params = lastDays();
	const latency = useQuery({
		...insightsUserLatency(params),
		enabled,
		retry: false,
		refetchInterval: 5 * 60_000,
	});
	const activity = useQuery({
		...insightsUserActivity(params),
		enabled,
		retry: false,
		refetchInterval: 5 * 60_000,
	});
	const byUser = new Map<string, UserInsight>();
	for (const u of latency.data?.report.users ?? []) {
		byUser.set(u.user_id, { ...byUser.get(u.user_id), latency: u.latency_ms });
	}
	for (const u of activity.data?.report.users ?? []) {
		byUser.set(u.user_id, { ...byUser.get(u.user_id), seconds: u.seconds });
	}
	const most = Math.max(
		0,
		...(activity.data?.report.users ?? []).map((u) => u.seconds),
	);
	return {
		/** The columns are shown: the insights could be read (not refused). */
		shown: enabled && !latency.isError && !activity.isError,
		loading: latency.isLoading || activity.isLoading,
		byUser,
		/** The most time any user connected: the activity bars' scale. */
		most,
	};
};

/** A latency, short: one decimal under 10 ms (a cluster's own connections are often under one), whole above. */
export const formatLatency = (ms: number): string =>
	`${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;

/** Seconds connected, short: "45s", "12m", "3h 05m", "26h". */
export const formatActivity = (seconds: number): string => {
	if (seconds < 60) {
		return `${Math.round(seconds)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours >= 24) {
		return `${hours}h`;
	}
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};

function toISOLocal(d: Date, offset: number) {
	return formatDateTime(d, `YYYY-MM-DD[T]HH:mm:ss${formatOffset(offset)}`);
}

function formatOffset(offset: number): string {
	// A negative offset means that this is a positive timezone, e.g. GMT+2 = -120.
	const sign = offset <= 0 ? "+" : "-";
	const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
	const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
	return `${sign}${hours}:${minutes}`;
}
