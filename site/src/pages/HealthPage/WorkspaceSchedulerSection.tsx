import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { SchedulerSettings } from "#/api/platform";
import { schedulerReport, updateScheduler } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { MultiSelectCombobox } from "#/components/MultiSelectCombobox/MultiSelectCombobox";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Slider } from "#/components/Slider/Slider";
import { Switch } from "#/components/Switch/Switch";
import { ScheduleFields } from "#/modules/platform/scheduler/ScheduleFields";
import {
	durationMs,
	formatHours,
	scheduleProblem,
	WEEKDAYS,
} from "#/modules/platform/scheduler/schedule";
import { EnabledToggle } from "#/pages/UsersPage/EnabledToggle";

/** The slider's range for the maximum active time; 0 is "no limit". */
const MAX_HOURS_SLIDER = 24;

const WEEKDAY_NAMES: Record<number, string> = {
	0: "Sunday",
	1: "Monday",
	2: "Tuesday",
	3: "Wednesday",
	4: "Thursday",
	5: "Friday",
	6: "Saturday",
};

const same = (a: SchedulerSettings, b: SchedulerSettings) =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * Accounts > Global Workspace Scheduler: make every workspace have a
 * start and a stop time (each user's own, or the admin's for everyone), cap how
 * long a workspace may stay up, and leave out admins or named users. Coder
 * enforces it on create and on every schedule change; the dashboard makes
 * users fix their existing workspaces before they go on.
 */
export const WorkspaceSchedulerSection: React.FC = () => {
	const queryClient = useQueryClient();
	const { data: report, error } = useQuery(schedulerReport());
	const save = useMutation(updateScheduler(queryClient));
	const [form, setForm] = useState<{
		draft: SchedulerSettings;
		saved: SchedulerSettings;
	}>();
	useEffect(() => {
		if (!report) {
			return;
		}
		// Follow what is stored until the admin edits something.
		setForm((f) => ({
			saved: report.settings,
			draft: !f || same(f.draft, f.saved) ? report.settings : f.draft,
		}));
	}, [report]);
	const ids = useId();

	if (error) {
		return <ErrorAlert error={error} />;
	}
	if (!report || !form) {
		return <Loader />;
	}
	const { draft, saved } = form;
	const setDraft = (next: SchedulerSettings) =>
		setForm((f) => f && { ...f, draft: next });
	const dirty = !same(draft, saved);
	const fixedProblem =
		draft.mode === "fixed"
			? scheduleProblem(draft.fixed, draft.maxActiveHours)
			: "";
	const hours = draft.maxActiveHours ?? 0;
	const toggleEnforcedDay = (day: number) =>
		setDraft({
			...draft,
			enforcedDays: draft.enforcedDays.includes(day)
				? draft.enforcedDays.filter((d) => d !== day)
				: [...draft.enforcedDays, day].sort((a, b) => a - b),
		});
	const outside = draft.fixed.days.filter(
		(d) => !draft.enforcedDays.includes(d),
	);
	const enforcedDaysProblem =
		draft.enforcedDays.length === 0
			? "Pick at least one day."
			: draft.mode === "fixed" && outside.length > 0
				? `The schedule's days (${WEEKDAYS.filter((w) =>
						outside.includes(w.day),
					)
						.map((w) => w.label)
						.join(", ")}) must be among the enforced days.`
				: "";

	const onSave = async () => {
		try {
			const result = await save.mutateAsync(draft);
			setForm({ saved: result.settings, draft: result.settings });
			toast.success("Workspace scheduler saved.");
		} catch (e) {
			toast.error(getErrorMessage(e, "The scheduler could not be saved."));
		}
	};

	// The card's switch: on or off at once, keeping any other unsaved changes.
	const onToggle = async (enabled: boolean) => {
		try {
			const result = await save.mutateAsync({ ...saved, enabled });
			setForm({
				saved: result.settings,
				draft: { ...draft, enabled: result.settings.enabled },
			});
			toast.success(
				enabled ? "Workspace scheduler is on." : "Workspace scheduler is off.",
			);
		} catch (e) {
			toast.error(getErrorMessage(e, "The scheduler could not be switched."));
		}
	};

	return (
		<section className="flex flex-col gap-3" aria-labelledby={`${ids}-title`}>
			<div className="flex flex-wrap items-center gap-3">
				<h2
					id={`${ids}-title`}
					className="m-0 flex items-center gap-2 text-base font-medium"
				>
					Global Workspace Scheduler
				</h2>
				<EnabledToggle
					label="Global Workspace Scheduler"
					title={
						saved.enabled
							? "Switch the workspace scheduler off"
							: "Switch it on: every workspace needs a start and stop schedule"
					}
					checked={saved.enabled}
					disabled={save.isPending}
					onCheckedChange={onToggle}
				/>
				{saved.enabled ? (
					<Badge
						variant={report.noncompliant.length ? "warning" : "green"}
						size="xs"
						className="ml-auto"
					>
						{report.noncompliant.length
							? `${report.noncompliant.length} without a valid schedule`
							: "Every workspace complies"}
					</Badge>
				) : (
					<Badge size="xs" className="ml-auto">
						Off
					</Badge>
				)}
			</div>

			{/* Everything but the title in one inner card, as User Quota's */}
			<div className="flex flex-col gap-3 rounded-lg border border-solid border-border p-3">
				<p className="m-0 text-sm text-content-secondary">
					Require schedules for new workspaces and prompt owners to correct
					existing ones. Set shared times, a maximum duration, and exemptions
					below.
				</p>

				<fieldset
					className="m-0 grid grid-cols-1 gap-3 border-0 p-0 disabled:opacity-60 lg:grid-cols-2"
					disabled={!draft.enabled}
				>
					<RadioGroup
						value={draft.mode}
						onValueChange={(mode) =>
							setDraft({ ...draft, mode: mode as SchedulerSettings["mode"] })
						}
						className="grid grid-cols-1 gap-3 text-sm lg:grid-cols-2"
					>
						<div className="flex items-start gap-2">
							<RadioGroupItem value="user" id={`${ids}-user`} />
							<Label htmlFor={`${ids}-user`} className="flex flex-col gap-0.5">
								<span>Users set their own times</span>
								<span className="font-normal text-content-secondary">
									Each workspace needs a start and a stop time; its owner picks
									them.
								</span>
							</Label>
						</div>
						<div className="flex items-start gap-2">
							<RadioGroupItem value="fixed" id={`${ids}-fixed`} />
							<Label htmlFor={`${ids}-fixed`} className="flex flex-col gap-0.5">
								<span>The same schedule for every workspace</span>
								<span className="font-normal text-content-secondary">
									Applied to new workspaces; users cannot change it.
								</span>
							</Label>
						</div>
					</RadioGroup>

					<fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0 text-sm lg:col-span-2">
						<legend className="mb-1.5 font-medium">Enforced days</legend>
						<div className="flex flex-wrap gap-1.5">
							{WEEKDAYS.map(({ day, label }) => {
								const on = draft.enforcedDays.includes(day);
								return (
									<button
										key={day}
										type="button"
										aria-pressed={on}
										aria-label={WEEKDAY_NAMES[day]}
										onClick={() => toggleEnforcedDay(day)}
										className={cn(
											"h-8 min-w-12 cursor-pointer rounded-md border border-solid px-2 text-xs font-medium uppercase transition-colors",
											on
												? "border-content-link bg-surface-secondary text-content-primary"
												: "border-border bg-transparent text-content-secondary hover:text-content-primary",
										)}
									>
										{label}
									</button>
								);
							})}
						</div>
						<p className="m-0 text-content-secondary">
							Workspaces may only be scheduled on the selected days.
						</p>
						{enforcedDaysProblem && (
							<p role="alert" className="m-0 text-content-destructive">
								{enforcedDaysProblem}
							</p>
						)}
					</fieldset>

					{draft.mode === "fixed" && (
						<div className="lg:col-span-2 rounded-md border border-solid border-border p-3">
							<ScheduleFields
								idPrefix={`${ids}-sched`}
								value={draft.fixed}
								onChange={(fixed) => setDraft({ ...draft, fixed })}
								problem={fixedProblem}
							/>
						</div>
					)}

					<div className="flex flex-col gap-2 text-sm">
						<div className="flex items-center justify-between">
							<Label htmlFor={`${ids}-max`}>Maximum active time</Label>
							<span className="tabular-nums text-content-secondary">
								{hours ? `${formatHours(hours)} after it starts` : "No limit"}
							</span>
						</div>
						<Slider
							id={`${ids}-max`}
							aria-label="Maximum active time in hours (0 for no limit)"
							min={0}
							max={MAX_HOURS_SLIDER}
							step={0.5}
							value={[Math.min(hours, MAX_HOURS_SLIDER)]}
							onValueChange={([value]) =>
								setDraft({ ...draft, maxActiveHours: value ? value : null })
							}
						/>
						<p className="m-0 text-content-secondary">
							No workspace may be scheduled to stay up longer than this.
							{draft.mode === "fixed" &&
								` The schedule above is ${formatHours(
									durationMs(draft.fixed.start, draft.fixed.stop) / 3_600_000,
								)}.`}
						</p>
					</div>

					<div className="flex items-center gap-3 text-sm">
						<Switch
							id={`${ids}-admins`}
							checked={draft.ignoreAdmins}
							onCheckedChange={(ignoreAdmins) =>
								setDraft({ ...draft, ignoreAdmins })
							}
						/>
						<Label htmlFor={`${ids}-admins`}>Administrators Exempt</Label>
					</div>

					<div className="flex flex-col gap-1.5 text-sm">
						<span className="font-medium">Excluded users</span>
						<MultiSelectCombobox
							commandProps={{ label: "Excluded users" }}
							placeholder="Users the scheduler leaves alone"
							emptyIndicator={
								<p className="text-center text-sm">No such user</p>
							}
							value={draft.excludedUsers.map((u) => ({ value: u, label: u }))}
							options={report.users.map((u) => ({ value: u, label: u }))}
							onChange={(options) =>
								setDraft({
									...draft,
									excludedUsers: options.map((o) => o.value),
								})
							}
						/>
					</div>
				</fieldset>

				{saved.enabled && report.noncompliant.length > 0 && (
					<div className="text-sm">
						<p className="m-0 mb-1 font-medium">
							Workspaces without a valid schedule
						</p>
						<ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0 text-content-secondary">
							{report.noncompliant.map((w) => (
								<li key={w.id}>
									<span className="text-content-primary">
										{w.owner}/{w.name}
									</span>
									: {w.problem}
								</li>
							))}
						</ul>
					</div>
				)}

				<div className="flex items-center gap-3">
					<Button
						disabled={
							!dirty ||
							save.isPending ||
							Boolean((fixedProblem || enforcedDaysProblem) && draft.enabled)
						}
						onClick={onSave}
					>
						{save.isPending ? "Saving…" : "Save scheduler"}
					</Button>
					{dirty && (
						<Button variant="outline" onClick={() => setDraft(saved)}>
							Discard changes
						</Button>
					)}
				</div>
			</div>
		</section>
	);
};
