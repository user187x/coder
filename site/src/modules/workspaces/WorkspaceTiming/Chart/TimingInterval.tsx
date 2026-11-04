import type { TimeRange } from "./utils";

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	fractionalSecondDigits: 3,
	hourCycle: "h23",
});
const dateTime = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	fractionalSecondDigits: 3,
	timeZoneName: "short",
});

const valid = (date: Date) =>
	Number.isFinite(date.getTime()) && date.getUTCFullYear() > 1;

/** Shows both recorded endpoints and exposes their full local dates and time zone. */
export function TimingInterval({ range }: { range: TimeRange }) {
	const { startedAt, endedAt } = range;
	const full = (date: Date) =>
		valid(date) ? dateTime.format(date) : "Not recorded";
	const description = `Started ${full(startedAt)} · Finished ${full(endedAt)}`;
	return (
		<span
			className="block text-2xs font-normal tabular-nums text-content-secondary"
			title={description}
		>
			{valid(startedAt) ? clock.format(startedAt) : "Unavailable"} →{" "}
			{valid(endedAt) ? clock.format(endedAt) : "Unavailable"}
		</span>
	);
}
