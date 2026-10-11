import type { CoderSchedule } from "#/api/platform";

/** A daily schedule as people think of it: start and stop times on some weekdays, in a time zone. */
export type DailySchedule = {
	/** HH:MM, 24-hour. */
	start: string;
	/** HH:MM, 24-hour; earlier than start means the next day. */
	stop: string;
	/** Cron weekdays: 0 = Sunday ... 6 = Saturday. */
	days: number[];
	/** IANA time zone, e.g. "Europe/Berlin". */
	timezone: string;
};

export const WEEKDAYS = [
	{ day: 1, label: "Mon" },
	{ day: 2, label: "Tue" },
	{ day: 3, label: "Wed" },
	{ day: 4, label: "Thu" },
	{ day: 5, label: "Fri" },
	{ day: 6, label: "Sat" },
	{ day: 0, label: "Sun" },
] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOf = (hhmm: string) => {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
};

/** How long the workspace stays up, in ms (a stop before the start is on the next day). */
export const durationMs = (start: string, stop: string): number => {
	const minutes = minutesOf(stop) - minutesOf(start);
	return (minutes > 0 ? minutes : minutes + 24 * 60) * 60_000;
};

/** The schedule as Coder stores it: autostart cron (CRON_TZ=<tz> M H * * <days>) and time-to-stop. */
export const toCoderSchedule = (s: DailySchedule): CoderSchedule => {
	const [h, m] = s.start.split(":").map(Number);
	const days =
		s.days.length === 7 ? "*" : [...s.days].sort((a, b) => a - b).join(",");
	return {
		autostart_schedule: `CRON_TZ=${s.timezone} ${m} ${h} * * ${days}`,
		ttl_ms: durationMs(s.start, s.stop),
	};
};

const expandDays = (field: string): number[] | undefined => {
	if (field === "*") {
		return [0, 1, 2, 3, 4, 5, 6];
	}
	const days = new Set<number>();
	for (const part of field.split(",")) {
		const range = part.match(/^(\d)-(\d)$/);
		if (range) {
			for (let d = Number(range[1]); d <= Number(range[2]); d++) {
				days.add(d % 7);
			}
		} else if (/^\d$/.test(part)) {
			days.add(Number(part) % 7);
		} else {
			return undefined;
		}
	}
	return [...days].sort((a, b) => a - b);
};

/** The other way round, for schedules this form understands (daily at a fixed time); else undefined. */
export const fromCoderSchedule = (
	autostart: string | null | undefined,
	ttlMs: number | null | undefined,
	fallbackTimezone: string,
): DailySchedule | undefined => {
	const match = autostart?.match(
		/^(?:CRON_TZ=(\S+)\s+)?(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\S+)$/,
	);
	if (!match) {
		return undefined;
	}
	const [, tz, minute, hour, dayField] = match;
	const days = expandDays(dayField);
	if (!days || Number(hour) > 23 || Number(minute) > 59) {
		return undefined;
	}
	const startMinutes = Number(hour) * 60 + Number(minute);
	const stopMinutes =
		(startMinutes +
			Math.round((ttlMs && ttlMs > 0 ? ttlMs : 8 * 3_600_000) / 60_000)) %
		(24 * 60);
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		start: `${pad(Math.floor(startMinutes / 60))}:${pad(startMinutes % 60)}`,
		stop: `${pad(Math.floor(stopMinutes / 60))}:${pad(stopMinutes % 60)}`,
		days,
		timezone: tz ?? fallbackTimezone,
	};
};

/** Why this schedule breaks the rules, or "" (mirrors the platform service's check). */
export const scheduleProblem = (
	s: DailySchedule,
	maxActiveHours: number | null,
): string => {
	if (!HHMM.test(s.start) || !HHMM.test(s.stop)) {
		return "Set a start and a stop time.";
	}
	if (s.start === s.stop) {
		return "The stop time must differ from the start time.";
	}
	if (s.days.length === 0) {
		return "Pick at least one day.";
	}
	const hours = durationMs(s.start, s.stop) / 3_600_000;
	if (maxActiveHours && hours > maxActiveHours) {
		return `That is ${formatHours(hours)} up; at most ${formatHours(maxActiveHours)} are allowed.`;
	}
	return "";
};

export const formatHours = (hours: number) =>
	hours % 1 === 0 ? `${hours} h` : `${hours.toFixed(1).replace(/\.0$/, "")} h`;

const describeDays = (days: number[]): string => {
	if (days.length === 7) {
		return "every day";
	}
	if ([1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5) {
		return "Mon–Fri";
	}
	return WEEKDAYS.filter((w) => days.includes(w.day))
		.map((w) => w.label)
		.join(", ");
};

export const describeSchedule = (s: DailySchedule) =>
	`${s.start}–${s.stop}, ${describeDays(s.days)} (${s.timezone})`;

export const browserTimezone = (): string => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
};

export const timezones = (): string[] => {
	try {
		return Intl.supportedValuesOf("timeZone");
	} catch {
		return ["UTC"];
	}
};
