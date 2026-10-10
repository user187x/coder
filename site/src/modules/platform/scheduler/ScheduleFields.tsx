import { cn } from "cn";
import { useId } from "react";
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
	type DailySchedule,
	durationMs,
	formatHours,
	timezones,
	WEEKDAYS,
} from "./schedule";

type ScheduleFieldsProps = {
	value: DailySchedule;
	onChange: (next: DailySchedule) => void;
	disabled?: boolean;
	/** Shown under the fields, e.g. why the schedule is not accepted. */
	problem?: string;
	/** Prefix for the inputs' ids, so several sets can be on one page. */
	idPrefix?: string;
};

/** Start and stop times, weekdays and time zone of a daily workspace schedule. */
export const ScheduleFields: React.FC<ScheduleFieldsProps> = ({
	value,
	onChange,
	disabled,
	problem,
	idPrefix,
}) => {
	const generated = useId();
	const id = idPrefix ?? generated;
	const hours = durationMs(value.start, value.stop) / 3_600_000;
	const toggleDay = (day: number) =>
		onChange({
			...value,
			days: value.days.includes(day)
				? value.days.filter((d) => d !== day)
				: [...value.days, day],
		});

	return (
		<div className="flex flex-col gap-3 text-sm">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_auto_1fr]">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-start`}>Start time</Label>
					<Input
						id={`${id}-start`}
						type="time"
						value={value.start}
						disabled={disabled}
						onChange={(e) => onChange({ ...value, start: e.target.value })}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${id}-stop`}>Stop time</Label>
					<Input
						id={`${id}-stop`}
						type="time"
						value={value.stop}
						disabled={disabled}
						onChange={(e) => onChange({ ...value, stop: e.target.value })}
					/>
				</div>
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor={`${id}-tz`}>Time zone</Label>
					<Select
						value={value.timezone}
						disabled={disabled}
						onValueChange={(timezone) => onChange({ ...value, timezone })}
					>
						<SelectTrigger id={`${id}-tz`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="max-h-72">
							{timezones().map((tz) => (
								<SelectItem key={tz} value={tz}>
									{tz}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<fieldset
				className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0"
				disabled={disabled}
			>
				<legend className="mb-1.5 font-medium">Days</legend>
				{WEEKDAYS.map(({ day, label }) => {
					const on = value.days.includes(day);
					return (
						<button
							key={day}
							type="button"
							aria-pressed={on}
							onClick={() => toggleDay(day)}
							className={cn(
								"h-8 min-w-11 cursor-pointer rounded-md border border-solid px-2 text-xs font-medium transition-colors",
								on
									? "border-content-link bg-surface-secondary text-content-primary"
									: "border-border bg-transparent text-content-secondary hover:text-content-primary",
								"disabled:cursor-not-allowed disabled:opacity-50",
							)}
						>
							{label}
						</button>
					);
				})}
				<span className="ml-2 text-content-secondary">
					Up {formatHours(Math.round(hours * 10) / 10)} each day it starts
				</span>
			</fieldset>
			{problem && (
				<p role="alert" className="m-0 text-content-destructive">
					{problem}
				</p>
			)}
		</div>
	);
};
