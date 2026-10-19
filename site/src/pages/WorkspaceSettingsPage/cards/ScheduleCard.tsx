import type { Template, Workspace } from "#/api/typesGenerated";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	ClockGlyph,
	InfoGlyph,
	PlayGlyph,
	StopGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	InputHitArea,
	PressSwitch,
	SettingsCard,
} from "#/modules/platform/settingsPage/settingsParts";
import { humanDuration } from "#/utils/time";
import { timeZones } from "#/utils/timeZones";
import type { WorkspaceSettingsForm } from "../useWorkspaceSettingsForm";
import {
	defaultSchedule,
	emptySchedule,
} from "../WorkspaceSchedulePage/schedule";
import type { WorkspaceScheduleFormValues } from "../WorkspaceSchedulePage/scheduleForm";

type Day = keyof Pick<
	WorkspaceScheduleFormValues,
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday"
>;

const DAYS: { day: Day; label: string }[] = [
	{ day: "monday", label: "Mon" },
	{ day: "tuesday", label: "Tue" },
	{ day: "wednesday", label: "Wed" },
	{ day: "thursday", label: "Thu" },
	{ day: "friday", label: "Fri" },
	{ day: "saturday", label: "Sat" },
	{ day: "sunday", label: "Sun" },
];
const WEEKDAYS: Day[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
];

/** Autostart: when the workspace starts by itself (time, timezone, days). */
const Autostart: React.FC<{
	settings: WorkspaceSettingsForm;
	template: Template;
	locked: boolean;
}> = ({ settings, template, locked }) => {
	const { schedule, scheduleField } = settings;
	const values = schedule.values;
	const allowed = template.allow_user_autostart && !locked;
	const off = !allowed || !values.autostartEnabled;
	// Off, the fields show what turning it on starts with.
	const shown = values.autostartEnabled ? values : defaultSchedule();
	const dayAllowed = (day: Day) =>
		template.autostart_requirement.days_of_week.includes(day);
	const setDays = (days: Day[]) => {
		void schedule.setValues({
			...values,
			...Object.fromEntries(
				DAYS.map(({ day }) => [day, days.includes(day) && dayAllowed(day)]),
			),
		});
		void schedule.setFieldTouched("monday", true, false);
	};
	const startTimeError = scheduleField("startTime");
	const timezoneError = scheduleField("timezone");
	const daysError =
		schedule.touched.monday && typeof schedule.errors.monday === "string"
			? schedule.errors.monday
			: undefined;

	return (
		<div className="ws-subcard" data-testid="autostart">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 font-semibold">
						<PlayGlyph className="text-(--ws-go)" />
						Autostart
					</div>
					<p className="ws-desc">
						{template.allow_user_autostart
							? "Start at a set time on chosen days."
							: "The template for this workspace does not allow modification of autostart."}
					</p>
				</div>
				<PressSwitch
					label="Autostart"
					pressed={values.autostartEnabled}
					disabled={!allowed}
					onChange={(pressed) =>
						void schedule.setValues({
							...values,
							autostartEnabled: pressed,
							...(pressed ? defaultSchedule() : emptySchedule),
						})
					}
				/>
			</div>

			<div
				className="flex flex-col gap-3.5"
				style={{ opacity: values.autostartEnabled ? 1 : 0.45 }}
			>
				<div className="grid grid-cols-2 gap-2.5">
					<div className="min-w-0">
						<label htmlFor="as-time" className="ws-small-label">
							Start time
						</label>
						<InputHitArea className="mt-1.5">
							<input
								id="as-time"
								type="time"
								className="ws-input ws-input-sm [color-scheme:light] dark:[color-scheme:dark]"
								value={shown.startTime}
								disabled={off}
								aria-invalid={Boolean(startTimeError)}
								onChange={(event) =>
									void schedule.setFieldValue("startTime", event.target.value)
								}
								onBlur={() => void schedule.setFieldTouched("startTime", true)}
							/>
						</InputHitArea>
						{startTimeError && <p className="ws-error">{startTimeError}</p>}
					</div>
					<div className="min-w-0">
						<label htmlFor="as-tz" className="ws-small-label">
							Timezone
						</label>
						<Select
							value={shown.timezone}
							onValueChange={(zone) =>
								void schedule.setFieldValue("timezone", zone)
							}
							disabled={off}
						>
							<SelectTrigger
								id="as-tz"
								className="ws-input ws-input-sm ws-select ws-hit mt-1.5"
								aria-invalid={Boolean(timezoneError)}
							>
								<SelectValue placeholder="Timezone" />
							</SelectTrigger>
							<SelectContent>
								{timeZones.map((zone) => (
									<SelectItem key={zone} value={zone}>
										{zone}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{timezoneError && <p className="ws-error">{timezoneError}</p>}
					</div>
				</div>
				<fieldset className="m-0 min-w-0 border-0 p-0">
					<legend className="ws-small-label mb-1.5 p-0">Days of week</legend>
					<div className="grid grid-cols-7 gap-1.5">
						{DAYS.map(({ day, label }) => (
							<button
								key={day}
								type="button"
								className="ws-day ws-hit"
								aria-pressed={values[day]}
								aria-label={label}
								disabled={off || !dayAllowed(day)}
								onClick={() =>
									setDays(
										DAYS.map((d) => d.day).filter((d) =>
											d === day ? !values[d] : values[d],
										),
									)
								}
							>
								{label}
							</button>
						))}
					</div>
					<div className="mt-2 flex gap-1.5">
						<button
							type="button"
							className="ws-link-btn ws-hit"
							disabled={off}
							onClick={() => setDays(WEEKDAYS)}
						>
							Weekdays
						</button>
						<button
							type="button"
							className="ws-link-btn ws-hit"
							disabled={off}
							onClick={() => setDays(DAYS.map((d) => d.day))}
						>
							Every day
						</button>
						<button
							type="button"
							className="ws-link-btn ws-link-btn-quiet ws-hit"
							disabled={off}
							onClick={() => setDays([])}
						>
							Clear
						</button>
					</div>
					{daysError && <p className="ws-error">{daysError}</p>}
				</fieldset>
			</div>
		</div>
	);
};

/** Autostop: how long after a start the workspace stops (extended by activity). */
const Autostop: React.FC<{
	settings: WorkspaceSettingsForm;
	template: Template;
	locked: boolean;
}> = ({ settings, template, locked }) => {
	const { schedule, scheduleField } = settings;
	const values = schedule.values;
	const allowed = template.allow_user_autostop && !locked;
	const off = !allowed || !values.autostopEnabled;
	const defaultTTL = template.default_ttl_ms / (60 * 60 * 1000);
	const ttlError = scheduleField("ttl");
	const bump = template.activity_bump_ms;

	return (
		<div className="ws-subcard" data-testid="autostop">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 font-semibold">
						<StopGlyph className="text-(--ws-warn)" />
						Autostop
					</div>
					<p className="ws-desc">
						{template.allow_user_autostop
							? "Shut down after a period of time running."
							: "The template for this workspace does not allow modification of autostop."}
					</p>
				</div>
				<PressSwitch
					label="Autostop"
					pressed={values.autostopEnabled}
					disabled={!allowed}
					onChange={(pressed) =>
						void schedule.setValues({
							...values,
							autostopEnabled: pressed,
							ttl: pressed ? defaultTTL : 0,
						})
					}
				/>
			</div>

			<div
				className="flex flex-col gap-3.5"
				style={{ opacity: values.autostopEnabled ? 1 : 0.45 }}
			>
				<div>
					<label htmlFor="as-hours" className="ws-small-label">
						Time until shutdown
					</label>
					<div className="mt-1.5 flex items-center gap-2">
						<InputHitArea>
							<input
								id="as-hours"
								type="number"
								min={0}
								step="any"
								className="ws-input ws-input-sm ws-input-hours"
								value={values.ttl}
								disabled={off}
								aria-invalid={Boolean(ttlError)}
								onChange={(event) =>
									void schedule.setFieldValue(
										"ttl",
										event.target.value === "" ? 0 : Number(event.target.value),
									)
								}
								onBlur={() => void schedule.setFieldTouched("ttl", true)}
							/>
						</InputHitArea>
						<span className="text-(--ws-muted)">hours</span>
					</div>
					{ttlError && <p className="ws-error">{ttlError}</p>}
				</div>
				<div className="flex gap-2.5 rounded-(--ws-r-md) border border-solid border-(--ws-line-soft) bg-(--ws-card) p-3">
					<InfoGlyph className="mt-0.5 shrink-0 text-(--ws-soft)" />
					<p className="m-0 text-[12.5px] text-(--ws-text-3)">
						{bump > 0
							? `Extended by ${humanDuration(bump)} after any activity is detected.`
							: "Activity does not extend it."}{" "}
						Turned off, the workspace never stops on its own.
					</p>
				</div>
			</div>
		</div>
	);
};

/** Schedule: autostart and autostop, as the template allows them. */
export const ScheduleCard: React.FC<{
	workspace: Workspace;
	settings: WorkspaceSettingsForm;
	canUpdate: boolean;
}> = ({ workspace, settings, canUpdate }) => {
	const { template } = settings;
	return (
		<SettingsCard
			id="schedule"
			title="Schedule"
			description="Start and stop this workspace automatically"
			icon={<ClockGlyph size={18} />}
		>
			{!template ? (
				<CardLoader />
			) : workspace.is_prebuild ? (
				<p className="m-0 p-6 text-[13px] text-(--ws-muted)">
					Prebuilt workspaces ignore workspace-level scheduling until they are
					claimed.
				</p>
			) : (
				<>
					{!canUpdate && (
						<p className="m-0 px-6 pt-6 text-[13px] text-content-destructive">
							You don't have permissions to update the schedule for this
							workspace.
						</p>
					)}
					<div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4 p-6">
						<Autostart
							settings={settings}
							template={template}
							locked={!canUpdate || settings.saving}
						/>
						<Autostop
							settings={settings}
							template={template}
							locked={!canUpdate || settings.saving}
						/>
					</div>
				</>
			)}
		</SettingsCard>
	);
};
