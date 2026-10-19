import { DurationField } from "#/components/DurationField/DurationField";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	ClockGlyph,
	PlayGlyph,
	StopGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	InputHitArea,
	SettingsCard,
	ToggleRow,
} from "#/modules/platform/settingsPage/settingsParts";
import { getFormHelpers } from "#/utils/formUtils";
import type { TemplateAutostartRequirementDaysValue } from "#/utils/schedule";
import {
	AutostopRequirementDaysHelperText,
	AutostopRequirementWeeksHelperText,
} from "../TemplateSchedulePage/AutostopRequirementHelperText";
import { ScheduleDialog } from "../TemplateSchedulePage/ScheduleDialog";
import { AutostartHelperText } from "../TemplateSchedulePage/TemplateScheduleAutostart";
import {
	ActivityBumpHelperText,
	AutostopReminderHelperText,
	DefaultTTLHelperText,
	DormancyAutoDeletionTTLHelperText,
	DormancyTTLHelperText,
	FailureTTLHelperText,
} from "../TemplateSchedulePage/TTLHelperText";
import type { TemplateScheduleForm } from "../TemplateSchedulePage/useTemplateScheduleForm";

const DAYS: { value: TemplateAutostartRequirementDaysValue; label: string }[] =
	[
		{ value: "monday", label: "Mon" },
		{ value: "tuesday", label: "Tue" },
		{ value: "wednesday", label: "Wed" },
		{ value: "thursday", label: "Thu" },
		{ value: "friday", label: "Fri" },
		{ value: "saturday", label: "Sat" },
		{ value: "sunday", label: "Sun" },
	];

/** A number field of the schedule: its label above, its helper (or error) below. */
const NumberField: React.FC<{
	id: string;
	label: string;
	value: number | undefined;
	onChange: (value: number | "") => void;
	onBlur: () => void;
	disabled: boolean;
	min: number;
	max?: number;
	error: boolean;
	helper: React.ReactNode;
}> = ({
	id,
	label,
	value,
	onChange,
	onBlur,
	disabled,
	min,
	max,
	error,
	helper,
}) => (
	<div className="min-w-0">
		<label htmlFor={id} className="ws-small-label">
			{label}
		</label>
		<InputHitArea className="mt-1.5">
			<input
				id={id}
				type="number"
				min={min}
				max={max}
				step={1}
				className="ws-input ws-input-sm"
				value={value ?? ""}
				disabled={disabled}
				aria-invalid={error}
				aria-describedby={`${id}-help`}
				onChange={(e) =>
					onChange(e.target.value === "" ? "" : Number(e.target.value))
				}
				onBlur={onBlur}
			/>
		</InputHitArea>
		<p id={`${id}-help`} className={error ? "ws-error" : "ws-help"}>
			{helper}
		</p>
	</div>
);

/**
 * Schedule: autostop, autostart and dormancy for the template's workspaces (the former Schedule page's settings).
 * A changed dormancy or deletion threshold that affects workspaces within a week is confirmed when saved.
 */
export const TemplateScheduleCard: React.FC<{
	schedule: TemplateScheduleForm;
	error: unknown;
	disabled: boolean;
	allowAdvancedScheduling: boolean;
}> = ({ schedule, error, disabled, allowAdvancedScheduling }) => {
	const { form, toggle, dialog } = schedule;
	const v = form.values;
	const field = getFormHelpers(form, error);
	const number = (
		name:
			| "default_ttl_ms"
			| "activity_bump_ms"
			| "time_til_autostop_notify_ms"
			| "autostop_requirement_weeks",
	) => ({
		value: v[name],
		onChange: (value: number | "") => void form.setFieldValue(name, value),
		onBlur: () => void form.setFieldTouched(name, true),
		error: field(name).error,
	});
	const weekly = ["saturday", "sunday"].includes(
		v.autostop_requirement_days_of_week || "",
	);
	const dormant = field("time_til_dormant_ms", {
		helperText: <DormancyTTLHelperText ttl={v.time_til_dormant_ms} />,
	});
	const deletion = field("time_til_dormant_autodelete_ms", {
		helperText: (
			<DormancyAutoDeletionTTLHelperText
				ttl={v.time_til_dormant_autodelete_ms}
			/>
		),
	});
	const failure = field("failure_ttl_ms", {
		helperText: <FailureTTLHelperText ttl={v.failure_ttl_ms} />,
	});

	return (
		<SettingsCard
			id="schedule"
			title="Schedule"
			description="When workspaces from this template start, stop and go dormant"
			icon={<ClockGlyph size={18} />}
		>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4 p-6">
				<div className="ws-subcard" data-testid="template-autostop">
					<div className="flex items-center gap-2 font-semibold">
						<StopGlyph className="text-(--ws-warn)" />
						Autostop
					</div>
					<p className="ws-desc -mt-3">
						When workspaces created from this template are stopped.
					</p>
					<NumberField
						id="default_ttl_ms"
						label="Default autostop (hours)"
						min={0}
						disabled={disabled}
						helper={
							field("default_ttl_ms").error ? (
								field("default_ttl_ms").helperText
							) : (
								<DefaultTTLHelperText ttl={v.default_ttl_ms} />
							)
						}
						{...number("default_ttl_ms")}
					/>
					<NumberField
						id="activity_bump_ms"
						label="Activity bump (hours)"
						min={0}
						disabled={disabled || (!v.default_ttl_ms && !v.allow_user_autostop)}
						helper={
							field("activity_bump_ms").error ? (
								field("activity_bump_ms").helperText
							) : (
								<ActivityBumpHelperText
									bump={v.activity_bump_ms}
									defaultTTL={v.default_ttl_ms}
									allowUserAutostop={v.allow_user_autostop}
								/>
							)
						}
						{...number("activity_bump_ms")}
					/>
					<NumberField
						id="time_til_autostop_notify_ms"
						label="Autostop reminder (hours)"
						min={0}
						disabled={disabled}
						helper={
							field("time_til_autostop_notify_ms").error ? (
								field("time_til_autostop_notify_ms").helperText
							) : (
								<AutostopReminderHelperText
									lead={v.time_til_autostop_notify_ms}
									defaultTTL={v.default_ttl_ms}
									autostopRequirementDaysOfWeek={
										v.autostop_requirement_days_of_week
									}
									allowUserAutostop={v.allow_user_autostop}
								/>
							)
						}
						{...number("time_til_autostop_notify_ms")}
					/>
					<div className="grid grid-cols-2 items-start gap-2.5">
						<div className="min-w-0">
							<label htmlFor="autostop_days" className="ws-small-label">
								Days with required stop
							</label>
							<Select
								value={v.autostop_requirement_days_of_week}
								onValueChange={(value) =>
									void form.setFieldValue(
										"autostop_requirement_days_of_week",
										value,
									)
								}
								disabled={disabled}
							>
								<SelectTrigger
									id="autostop_days"
									className="ws-input ws-input-sm ws-select ws-hit mt-1.5"
									aria-describedby="autostop_days-help"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="off">Off</SelectItem>
									<SelectItem value="daily">Daily</SelectItem>
									<SelectItem value="saturday">Saturday</SelectItem>
									<SelectItem value="sunday">Sunday</SelectItem>
								</SelectContent>
							</Select>
							<p id="autostop_days-help" className="ws-help">
								<AutostopRequirementDaysHelperText
									days={v.autostop_requirement_days_of_week}
								/>
							</p>
						</div>
						<NumberField
							id="autostop_requirement_weeks"
							label="Weeks between required stops"
							min={1}
							max={16}
							disabled={disabled || !weekly}
							helper={
								field("autostop_requirement_weeks").error ? (
									field("autostop_requirement_weeks").helperText
								) : (
									<AutostopRequirementWeeksHelperText
										days={v.autostop_requirement_days_of_week}
										weeks={v.autostop_requirement_weeks}
									/>
								)
							}
							{...number("autostop_requirement_weeks")}
						/>
					</div>
					<ToggleRow
						id="allow-user-autostop"
						label="Allow users to customize autostop duration for workspaces."
						description="By default, workspaces inherit the template's autostop timer. On, users may set their own, or turn it off."
						pressed={Boolean(v.allow_user_autostop)}
						onChange={(pressed) =>
							void form.setFieldValue("allow_user_autostop", pressed)
						}
						disabled={disabled || !allowAdvancedScheduling}
					/>
				</div>

				<div className="flex flex-col gap-4">
					<div className="ws-subcard" data-testid="template-autostart">
						<div className="flex items-center gap-2 font-semibold">
							<PlayGlyph className="text-(--ws-go)" />
							Autostart
						</div>
						<ToggleRow
							id="allow_user_autostart"
							label="Allow users to automatically start workspaces on a schedule."
							pressed={Boolean(v.allow_user_autostart)}
							onChange={(pressed) =>
								void form.setFieldValue("allow_user_autostart", pressed)
							}
							disabled={disabled || !allowAdvancedScheduling}
						/>
						{allowAdvancedScheduling && (
							<fieldset className="m-0 min-w-0 border-0 p-0">
								<legend className="ws-small-label mb-1.5 p-0">
									Days workspaces may start
								</legend>
								<div className="grid grid-cols-7 gap-1.5">
									{DAYS.map((day) => {
										const on = v.autostart_requirement_days_of_week.includes(
											day.value,
										);
										return (
											<button
												key={day.value}
												type="button"
												className="ws-day ws-hit"
												aria-pressed={on}
												aria-label={day.label}
												disabled={disabled || !v.allow_user_autostart}
												onClick={() =>
													void form.setFieldValue(
														"autostart_requirement_days_of_week",
														on
															? v.autostart_requirement_days_of_week.filter(
																	(d) => d !== day.value,
																)
															: v.autostart_requirement_days_of_week.concat(
																	day.value,
																),
													)
												}
											>
												{day.label}
											</button>
										);
									})}
								</div>
								<p className="ws-help">
									<AutostartHelperText
										allowed={Boolean(v.allow_user_autostart)}
										days={v.autostart_requirement_days_of_week}
									/>
								</p>
							</fieldset>
						)}
					</div>

					{allowAdvancedScheduling && (
						<div className="ws-subcard" data-testid="template-dormancy">
							<div className="font-semibold">Dormancy</div>
							<p className="ws-desc -mt-3">
								Workspaces without connections for a while go dormant; dormant
								ones can be deleted after a further while.
							</p>
							<ToggleRow
								id="dormancyThreshold"
								label="Enable Dormancy Threshold"
								pressed={Boolean(v.inactivity_cleanup_enabled)}
								onChange={(pressed) => void toggle.inactivityCleanup(pressed)}
								disabled={disabled}
							/>
							<DurationField
								label="Time until dormant"
								valueMs={v.time_til_dormant_ms ?? 0}
								onChange={(ms) =>
									void form.setFieldValue("time_til_dormant_ms", ms)
								}
								disabled={disabled || !v.inactivity_cleanup_enabled}
								id={dormant.id}
								name={dormant.name}
								onBlur={dormant.onBlur}
								error={dormant.error}
								helperText={dormant.helperText}
							/>
							<ToggleRow
								id="dormancyAutoDeletion"
								label="Enable Dormancy Auto-Deletion"
								description="Coder permanently deletes dormant workspaces after a while. Once a workspace is deleted it cannot be recovered."
								pressed={Boolean(v.dormant_autodeletion_cleanup_enabled)}
								onChange={(pressed) => void toggle.dormantAutoDeletion(pressed)}
								disabled={disabled}
							/>
							<DurationField
								label="Time until deletion"
								valueMs={v.time_til_dormant_autodelete_ms ?? 0}
								onChange={(ms) =>
									void form.setFieldValue("time_til_dormant_autodelete_ms", ms)
								}
								disabled={disabled || !v.dormant_autodeletion_cleanup_enabled}
								id={deletion.id}
								name={deletion.name}
								onBlur={deletion.onBlur}
								error={deletion.error}
								helperText={deletion.helperText}
							/>
							<ToggleRow
								id="failureCleanupEnabled"
								label="Enable Failure Cleanup"
								description="Coder tries to stop workspaces that are in a failed state after a while."
								pressed={Boolean(v.failure_cleanup_enabled)}
								onChange={(pressed) => void toggle.failureCleanup(pressed)}
								disabled={disabled}
							/>
							<DurationField
								label="Time until cleanup"
								valueMs={v.failure_ttl_ms ?? 0}
								onChange={(ms) => void form.setFieldValue("failure_ttl_ms", ms)}
								disabled={disabled || !v.failure_cleanup_enabled}
								id={failure.id}
								name={failure.name}
								onBlur={failure.onBlur}
								error={failure.error}
								helperText={failure.helperText}
							/>
						</div>
					)}
				</div>
			</div>

			<ScheduleDialog
				open={dialog.open}
				onConfirm={() => void dialog.confirm()}
				onClose={dialog.close}
				title="Workspace Scheduling"
				{...dialog.counts}
				updateDormantWorkspaces={(update) =>
					void form.setFieldValue("update_workspace_dormant_at", update)
				}
				updateInactiveWorkspaces={(update) =>
					void form.setFieldValue("update_workspace_last_used_at", update)
				}
				dormantWorkspacesChecked={v.update_workspace_dormant_at ?? false}
				inactiveWorkspacesChecked={v.update_workspace_last_used_at ?? false}
				dormantValueChanged={
					form.initialValues.time_til_dormant_ms !== v.time_til_dormant_ms
				}
				deletionValueChanged={
					form.initialValues.time_til_dormant_autodelete_ms !==
					v.time_til_dormant_autodelete_ms
				}
			/>
		</SettingsCard>
	);
};
