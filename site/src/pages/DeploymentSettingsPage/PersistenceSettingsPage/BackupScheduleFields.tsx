import { cn } from "cn";
import { ClockIcon } from "lucide-react";
import { useId, useState } from "react";
import type { BackupRecurrence, PersistenceSettings } from "#/api/platform";
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
import { Switch } from "#/components/Switch/Switch";
import { WEEKDAYS } from "#/modules/platform/scheduler/schedule";
import {
	backupScheduleLabel,
	calendarFromCron,
	ORDINALS,
	pad,
} from "./backupRecurrence";

const FREQUENCIES = [
	["daily", "Daily"],
	["weekly", "Weekly"],
	["monthly", "Monthly"],
	["yearly", "Yearly"],
] as const;

type Props = {
	settings: PersistenceSettings;
	startDate: string;
	readOnly: boolean;
	onChange: (patch: Partial<PersistenceSettings>) => void;
};

export function BackupScheduleFields({
	settings,
	startDate,
	readOnly,
	onChange,
}: Props) {
	const id = useId();
	const rule =
		settings.backupRecurrence ??
		calendarFromCron(settings.backupSchedule, startDate);
	const [twelveHours, setTwelveHours] = useState(false);
	const [legacy, setLegacy] = useState(false);
	const display = rule ?? {
		time: "02:00",
		frequency: "daily",
		interval: 1,
		startDate,
	};
	const update = (patch: Partial<BackupRecurrence>) =>
		onChange({ backupRecurrence: { ...display, ...patch } });
	const [hour, minute] = display.time.split(":").map(Number);
	const date = new Date(`${display.startDate || startDate}T00:00:00Z`);
	const weekdays =
		display.frequency === "daily"
			? WEEKDAYS.map(({ day }) => day)
			: (display.weekdays ?? [date.getUTCDay()]);
	const useWeekdays =
		display.frequency === "daily" ||
		display.frequency === "weekly" ||
		(display.frequency === "monthly" && display.monthMode === "weekday");
	const end =
		display.endDate !== undefined
			? "date"
			: display.count !== undefined
				? "count"
				: "never";
	const setFrequency = (frequency: BackupRecurrence["frequency"]) => {
		update({
			frequency,
			weekdays: display.frequency === "daily" ? [date.getUTCDay()] : weekdays,
			monthMode: display.monthMode ?? "date",
			monthDay: display.monthDay ?? date.getUTCDate(),
			ordinal: display.ordinal ?? Math.ceil(date.getUTCDate() / 7),
		});
	};

	return (
		<fieldset
			className="m-0 min-w-0 rounded-xl border border-solid border-border p-4"
			disabled={readOnly}
		>
			<legend className="px-1 text-sm font-medium">Backup schedule</legend>
			{readOnly && (
				<p className="mt-0 text-xs text-content-secondary">
					This schedule is managed outside Coder.
				</p>
			)}
			{legacy || !rule ? (
				<div className="flex flex-wrap items-end gap-3">
					<div className="grid grow gap-2">
						<Label htmlFor={`${id}-cron`}>Cron schedule</Label>
						<Input
							id={`${id}-cron`}
							value={settings.backupSchedule}
							required
							pattern={String.raw`\S+( \S+){5}`}
							onChange={(event) =>
								onChange({
									backupSchedule: event.target.value,
									backupRecurrence: undefined,
								})
							}
						/>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							update({});
							setLegacy(false);
						}}
					>
						Use calendar schedule
					</Button>
				</div>
			) : (
				<div className="grid gap-4">
					<div className="flex flex-wrap items-start gap-x-6 gap-y-3">
						<div className="grid gap-2">
							<div className="flex items-center gap-2 text-sm font-medium">
								<ClockIcon
									className="size-4 text-content-secondary"
									aria-hidden
								/>{" "}
								Backup time (UTC)
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<RuleSelect
									label="Hour"
									value={String(twelveHours ? hour % 12 || 12 : hour)}
									onChange={(value) =>
										update({
											time: `${pad(twelveHours ? (Number(value) % 12) + (hour >= 12 ? 12 : 0) : Number(value))}:${pad(minute)}`,
										})
									}
									choices={Array.from(
										{ length: twelveHours ? 12 : 24 },
										(_, index) => {
											const value = index + (twelveHours ? 1 : 0);
											return [
												String(value),
												twelveHours ? String(value) : pad(value),
											];
										},
									)}
								/>
								<span aria-hidden>:</span>
								<RuleSelect
									label="Minute"
									value={String(minute)}
									onChange={(value) =>
										update({ time: `${pad(hour)}:${pad(Number(value))}` })
									}
									choices={Array.from({ length: 60 }, (_, index) => [
										String(index),
										pad(index),
									])}
								/>
								{twelveHours && (
									<RuleSelect
										label="AM or PM"
										value={hour >= 12 ? "PM" : "AM"}
										onChange={(value) =>
											update({
												time: `${pad((hour % 12) + (value === "PM" ? 12 : 0))}:${pad(minute)}`,
											})
										}
										choices={[
											["AM", "AM"],
											["PM", "PM"],
										]}
									/>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Switch
									id={`${id}-12-hour`}
									checked={twelveHours}
									onCheckedChange={setTwelveHours}
								/>
								<Label htmlFor={`${id}-12-hour`}>AM/PM</Label>
							</div>
						</div>
						{useWeekdays && (
							<fieldset className="m-0 flex w-auto min-w-0 flex-wrap gap-1.5 border-0 p-0">
								<legend className="mb-2 text-sm font-medium">
									Days of the week
								</legend>
								{WEEKDAYS.map(({ day, label }) => {
									const pressed = weekdays.includes(day);
									return (
										<Button
											key={day}
											type="button"
											size="sm"
											variant="outline"
											aria-pressed={pressed}
											disabled={pressed && weekdays.length === 1}
											className={cn(
												"min-w-10 px-2",
												pressed &&
													"border-content-link bg-surface-secondary disabled:text-content-primary disabled:opacity-100",
											)}
											onClick={() =>
												update({
													frequency:
														display.frequency === "daily"
															? "weekly"
															: display.frequency,
													interval:
														display.frequency === "daily"
															? 1
															: display.interval,
													weekdays: pressed
														? weekdays.filter((item) => item !== day)
														: [...weekdays, day],
												})
											}
										>
											{label}
										</Button>
									);
								})}
							</fieldset>
						)}
					</div>
					<div className="flex flex-wrap items-end gap-3">
						<div className="grid gap-2">
							<Label htmlFor={`${id}-frequency`}>Repeats</Label>
							<RuleSelect
								id={`${id}-frequency`}
								label="Repeats"
								value={display.frequency}
								choices={FREQUENCIES}
								onChange={(value) => {
									const chosen = FREQUENCIES.find(([key]) => key === value);
									if (chosen) setFrequency(chosen[0]);
								}}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor={`${id}-interval`}>Repeat interval</Label>
							<div className="flex items-center gap-2 text-sm">
								<span aria-hidden>Every</span>
								<Input
									id={`${id}-interval`}
									className="w-20"
									type="number"
									min={1}
									max={99}
									required
									value={display.interval || ""}
									onChange={(event) =>
										update({ interval: Number(event.target.value) })
									}
								/>
								<span>
									{
										{
											daily: "days",
											weekly: "weeks",
											monthly: "months",
											yearly: "years",
										}[display.frequency]
									}
								</span>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor={`${id}-start`}>Starts on</Label>
							<Input
								id={`${id}-start`}
								type="date"
								required
								min="1970-01-01"
								max="9998-12-31"
								value={display.startDate}
								onChange={(event) => update({ startDate: event.target.value })}
							/>
						</div>
					</div>
					{display.frequency === "monthly" && (
						<div className="flex flex-wrap items-end gap-3">
							<div className="grid gap-2">
								<Label htmlFor={`${id}-month-mode`}>Monthly on</Label>
								<RuleSelect
									id={`${id}-month-mode`}
									label="Monthly on"
									value={display.monthMode ?? "date"}
									choices={[
										["date", "Day of the month"],
										["weekday", "Weekday occurrence"],
									]}
									onChange={(value) =>
										update({
											monthMode: value === "weekday" ? "weekday" : "date",
											monthDay: display.monthDay ?? date.getUTCDate(),
											ordinal:
												display.ordinal ?? Math.ceil(date.getUTCDate() / 7),
											weekdays,
										})
									}
								/>
							</div>
							{display.monthMode === "weekday" ? (
								<RuleSelect
									label="Week of the month"
									value={String(display.ordinal ?? 1)}
									choices={ORDINALS}
									onChange={(value) => update({ ordinal: Number(value) })}
								/>
							) : (
								<RuleSelect
									label="Day of the month"
									value={String(display.monthDay ?? date.getUTCDate())}
									choices={Array.from({ length: 31 }, (_, index) => [
										String(index + 1),
										String(index + 1),
									])}
									onChange={(value) => update({ monthDay: Number(value) })}
								/>
							)}
						</div>
					)}
					<div className="flex flex-wrap items-end gap-3">
						<div className="grid gap-2">
							<Label htmlFor={`${id}-ends`}>Ends</Label>
							<RuleSelect
								id={`${id}-ends`}
								label="Ends"
								value={end}
								choices={[
									["never", "Never"],
									["date", "On a date"],
									["count", "After occurrences"],
								]}
								onChange={(value) =>
									update({
										count: value === "count" ? 10 : undefined,
										endDate: value === "date" ? display.startDate : undefined,
									})
								}
							/>
						</div>
						{end === "date" && (
							<Input
								aria-label="End date"
								type="date"
								required
								min={display.startDate}
								max="9998-12-31"
								value={display.endDate}
								onChange={(event) => update({ endDate: event.target.value })}
							/>
						)}
						{end === "count" && (
							<Input
								aria-label="Number of occurrences"
								className="w-24"
								type="number"
								min={1}
								max={999}
								required
								value={display.count || ""}
								onChange={(event) =>
									update({ count: Number(event.target.value) })
								}
							/>
						)}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p
							className="m-0 text-xs text-content-secondary"
							aria-live="polite"
						>
							{backupScheduleLabel(
								{ ...settings, backupRecurrence: display },
								twelveHours,
							)}
						</p>
						<Button
							type="button"
							size="sm"
							variant="subtle"
							onClick={() => setLegacy(true)}
						>
							Use cron instead
						</Button>
					</div>
				</div>
			)}
		</fieldset>
	);
}

function RuleSelect({
	id,
	label,
	value,
	choices,
	onChange,
}: {
	id?: string;
	label: string;
	value: string;
	choices: readonly (readonly [string, string])[];
	onChange: (value: string) => void;
}) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger id={id} aria-label={label} className="w-auto min-w-16">
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="max-h-64">
				{choices.map(([value, label]) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
