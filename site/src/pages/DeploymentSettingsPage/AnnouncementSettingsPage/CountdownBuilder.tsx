import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	COUNTDOWN_FORMATS,
	type CountdownFormat,
	countdownToken,
	parseCountdown,
} from "#/modules/platform/announcement/bannerTokens";

const FORMAT_LABELS: Record<CountdownFormat, string> = {
	dhms: "2d 04h 12m 09s",
	clock: "52:12:09",
	words: "2 days, 4 hours",
};

const NUDGES = [
	{ label: "−1h", minutes: -60 },
	{ label: "−15m", minutes: -15 },
	{ label: "+15m", minutes: 15 },
	{ label: "+1h", minutes: 60 },
	{ label: "+1d", minutes: 1440 },
];

const pad = (n: number) => String(n).padStart(2, "0");

const toLocalInput = (iso: string): string => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toISO = (local: string): string | null => {
	const date = new Date(local);
	return Number.isNaN(date.getTime())
		? null
		: date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const nextHour = (): string => {
	const soon = new Date(Date.now() + 3600e3);
	soon.setMinutes(0, 0, 0);
	return soon.toISOString().replace(/\.\d{3}Z$/, "Z");
};

type CountdownBuilderProps = {
	message: string;
	/** Where the cursor was in the message, to insert at. */
	caret: [number, number] | null;
	maxLength: number;
	onChange: (message: string) => void;
	onProblem: (problem: string) => void;
};

/**
 * Builds the {{countdown}} token in the message: the time it counts down to
 * (in this browser's time zone), how it is shown and what it says at zero.
 * The countdown ticks live in the banner.
 */
export const CountdownBuilder: React.FC<CountdownBuilderProps> = ({
	message,
	caret,
	maxLength,
	onChange,
	onProblem,
}) => {
	const id = useId();
	const existing = parseCountdown(message);
	const [to, setTo] = useState(() => existing?.to ?? nextHour());
	const [format, setFormat] = useState<CountdownFormat>(
		existing?.format ?? "dhms",
	);
	const [done, setDone] = useState(existing?.done ?? "now");
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	// A countdown already in the message is edited in place.
	const replace = (next: {
		to: string;
		format: CountdownFormat;
		done: string;
	}) => {
		const current = parseCountdown(message);
		if (!current) {
			return;
		}
		const token = countdownToken({ ...next, done: next.done.trim() || "now" });
		onChange(
			message.slice(0, current.index) +
				token +
				message.slice(current.index + current.length),
		);
	};

	const update = (
		change: Partial<{ to: string; format: CountdownFormat; done: string }>,
	) => {
		const next = { to, format, done, ...change };
		setTo(next.to);
		setFormat(next.format);
		setDone(next.done);
		replace(next);
	};

	const insert = () => {
		const token = countdownToken({ to, format, done: done.trim() || "now" });
		const [start, end] = caret ?? [message.length, message.length];
		const before = message.slice(0, start);
		const after = message.slice(end);
		const spaced =
			(before && !/\s$/.test(before) ? " " : "") +
			token +
			(after && !/^\s/.test(after) ? " " : "");
		const next = before + spaced + after;
		if (next.length > maxLength) {
			onProblem("The message would be too long for a countdown.");
			return;
		}
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-4 rounded-md border border-solid border-border p-4">
			<div className="grid gap-4 md:grid-cols-3">
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-when`}>Counts down to ({zone})</Label>
					<Input
						id={`${id}-when`}
						type="datetime-local"
						step={60}
						value={toLocalInput(to)}
						onChange={(event) => {
							const iso = toISO(event.target.value);
							if (iso) {
								update({ to: iso });
							}
						}}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-format`}>Shown as</Label>
					<Select
						value={format}
						onValueChange={(value) => {
							const match = COUNTDOWN_FORMATS.find((f) => f === value);
							if (match) {
								update({ format: match });
							}
						}}
					>
						<SelectTrigger id={`${id}-format`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{COUNTDOWN_FORMATS.map((f) => (
								<SelectItem key={f} value={f}>
									{FORMAT_LABELS[f]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-done`}>At zero, show</Label>
					<Input
						id={`${id}-done`}
						value={done}
						maxLength={60}
						onChange={(event) => update({ done: event.target.value })}
					/>
				</div>
			</div>
			<div
				role="group"
				aria-label="Adjust the time"
				className="flex flex-wrap gap-2"
			>
				{NUDGES.map((nudge) => (
					<Button
						key={nudge.label}
						size="sm"
						variant="outline"
						onClick={() => {
							const date = new Date(to);
							date.setMinutes(date.getMinutes() + nudge.minutes);
							update({ to: date.toISOString().replace(/\.\d{3}Z$/, "Z") });
						}}
					>
						{nudge.label}
					</Button>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				{existing ? (
					<Button
						variant="outline"
						onClick={() =>
							onChange(
								(
									message.slice(0, existing.index) +
									message.slice(existing.index + existing.length)
								)
									.replace(/\s{2,}/g, " ")
									.trim(),
							)
						}
					>
						Remove countdown
					</Button>
				) : (
					<Button onClick={insert}>Insert at cursor</Button>
				)}
			</div>
			<p className="m-0 text-sm text-content-secondary">
				The timer ticks live in the banner. Adjusting it here updates the
				countdown in the message; publish to send it out.
			</p>
		</div>
	);
};
