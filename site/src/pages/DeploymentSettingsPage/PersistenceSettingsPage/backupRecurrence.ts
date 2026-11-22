import type { BackupRecurrence, PersistenceSettings } from "#/api/platform";
import {
	fromCoderSchedule,
	WEEKDAYS,
} from "#/modules/platform/scheduler/schedule";

export const ORDINALS = [
	["1", "First"],
	["2", "Second"],
	["3", "Third"],
	["4", "Fourth"],
	["5", "Fifth"],
	["-1", "Last"],
] as const;

export const pad = (value: number) => String(value).padStart(2, "0");

export function calendarFromCron(
	cron: string,
	startDate: string,
): BackupRecurrence | undefined {
	const [seconds, ...fields] = cron.trim().split(/\s+/);
	if (seconds !== "0") return;
	const weekly = fromCoderSchedule(fields.join(" "), null, "UTC");
	if (weekly) {
		return {
			time: weekly.start,
			startDate,
			frequency: weekly.days.length === 7 ? "daily" : "weekly",
			interval: 1,
			weekdays: weekly.days,
		};
	}
	const [minute, hour, day, month, weekday] = fields;
	if (
		fields.length === 5 &&
		month === "*" &&
		weekday === "*" &&
		[minute, hour, day].every((field) => /^\d{1,2}$/.test(field)) &&
		Number(minute) < 60 &&
		Number(hour) < 24 &&
		Number(day) >= 1 &&
		Number(day) <= 31
	) {
		return {
			time: `${pad(Number(hour))}:${pad(Number(minute))}`,
			startDate,
			frequency: "monthly",
			interval: 1,
			monthMode: "date",
			monthDay: Number(day),
		};
	}
}

export const recurrenceValid = (rule: BackupRecurrence | undefined) =>
	!rule ||
	(rule.startDate !== "" &&
		rule.interval >= 1 &&
		rule.interval <= 99 &&
		(rule.endDate === undefined || rule.endDate >= rule.startDate) &&
		(rule.count === undefined || (rule.count >= 1 && rule.count <= 999)));

export function backupScheduleLabel(
	settings: Pick<PersistenceSettings, "backupSchedule" | "backupRecurrence">,
	twelveHours = false,
) {
	const rule = settings.backupRecurrence;
	if (!rule) return settings.backupSchedule;
	const unit = {
		daily: "day",
		weekly: "week",
		monthly: "month",
		yearly: "year",
	}[rule.frequency];
	const every = rule.interval === 1 ? unit : `${rule.interval} ${unit}s`;
	const weekdays = WEEKDAYS.filter(({ day }) => rule.weekdays?.includes(day))
		.map(({ label }) => label)
		.join(", ");
	const month =
		rule.monthMode === "weekday"
			? ` on the ${ORDINALS.find(([value]) => Number(value) === rule.ordinal)?.[1].toLowerCase()} ${weekdays}`
			: ` on day ${rule.monthDay}`;
	const when =
		rule.frequency === "weekly"
			? ` on ${weekdays}`
			: rule.frequency === "monthly"
				? month
				: "";
	const [hour, minute] = rule.time.split(":").map(Number);
	const time = twelveHours
		? `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? "PM" : "AM"}`
		: rule.time;
	const end = rule.endDate
		? `, through ${rule.endDate}`
		: rule.count
			? `, ${rule.count} ${rule.count === 1 ? "occurrence" : "occurrences"}`
			: "";
	return `Every ${every}${when} at ${time} UTC${end}`;
}
