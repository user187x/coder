import { CalendarClockIcon } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import type { CoderSchedule, SchedulerMe } from "#/api/platform";
import { schedulerMe, schedulerMeKey } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Spinner } from "#/components/Spinner/Spinner";
import { ScheduleFields } from "./ScheduleFields";
import {
	browserTimezone,
	type DailySchedule,
	describeSchedule,
	formatHours,
	fromCoderSchedule,
	scheduleProblem,
	toCoderSchedule,
} from "./schedule";

type Broken = SchedulerMe["workspaces"][number];

/** Sets a workspace's start, then its stop time (the server checks each). */
const saveSchedule = async (workspaceId: string, s: CoderSchedule) => {
	await API.putWorkspaceAutostart(workspaceId, {
		schedule: s.autostart_schedule,
	});
	await API.putWorkspaceAutostop(workspaceId, { ttl_ms: s.ttl_ms });
};

/**
 * The Global Workspace Scheduler's gate: when it applies to the signed-in user
 * and one of their workspaces has no valid schedule (no start or stop time, too
 * long, or not the required one), this dialog covers the dashboard until each
 * is fixed. It cannot be dismissed.
 */
export const WorkspaceScheduleGate: React.FC = () => {
	const { data } = useQuery(schedulerMe());
	const broken = data?.enforced
		? data.workspaces.filter((w) => !w.compliant)
		: [];
	if (!data || broken.length === 0) {
		return null;
	}
	return <GateDialog me={data} broken={broken} />;
};

const GateDialog: React.FC<{ me: SchedulerMe; broken: Broken[] }> = ({
	me,
	broken,
}) => {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: schedulerMeKey });

	const applyFixed = async () => {
		if (!me.fixed) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			for (const w of broken) {
				await saveSchedule(w.id, me.fixed);
			}
			await refresh();
		} catch (e) {
			setError(getErrorMessage(e, "The schedule could not be set."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={() => {}}>
			<DialogContent
				className="max-h-[90vh] max-w-2xl overflow-y-auto"
				// Not dismissable: the schedule has to be set first.
				onEscapeKeyDown={(e) => e.preventDefault()}
				onPointerDownOutside={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<CalendarClockIcon aria-hidden className="size-5" />
						Set your workspace {broken.length === 1 ? "schedule" : "schedules"}
					</DialogTitle>
					<DialogDescription>
						{me.mode === "fixed" && me.fixed
							? `Your administrator requires every workspace to run on the same schedule: ${describeSchedule(me.fixed)}.`
							: `Your administrator requires every workspace to have a start and a stop time${
									me.maxActiveHours
										? `, at most ${formatHours(me.maxActiveHours)} apart`
										: ""
								}. Set them to go on.`}
					</DialogDescription>
				</DialogHeader>

				{me.mode === "fixed" ? (
					<div className="flex flex-col gap-3 text-sm">
						<ul className="m-0 flex list-none flex-col gap-1 p-0">
							{broken.map((w) => (
								<li key={w.id}>
									<span className="font-medium">{w.name}</span>{" "}
									<span className="text-content-secondary">– {w.problem}</span>
								</li>
							))}
						</ul>
						{error && (
							<p role="alert" className="m-0 text-content-destructive">
								{error}
							</p>
						)}
						<div>
							<Button disabled={busy} onClick={applyFixed}>
								<Spinner loading={busy} />
								Apply the required schedule
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-5">
						{broken.map((w) => (
							<WorkspaceScheduleForm
								key={w.id}
								workspace={w}
								maxActiveHours={me.maxActiveHours}
								onSaved={refresh}
							/>
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};

const WorkspaceScheduleForm: React.FC<{
	workspace: Broken;
	maxActiveHours: number | null;
	onSaved: () => Promise<void>;
}> = ({ workspace, maxActiveHours, onSaved }) => {
	const [value, setValue] = useState<DailySchedule>(
		() =>
			fromCoderSchedule(
				workspace.autostart_schedule,
				workspace.ttl_ms,
				browserTimezone(),
			) ?? {
				start: "09:00",
				stop: "17:00",
				days: [1, 2, 3, 4, 5],
				timezone: browserTimezone(),
			},
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const problem = scheduleProblem(value, maxActiveHours);

	const save = async () => {
		setBusy(true);
		setError("");
		try {
			await saveSchedule(workspace.id, toCoderSchedule(value));
			await onSaved();
		} catch (e) {
			setError(getErrorMessage(e, "The schedule could not be saved."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section
			className="flex flex-col gap-3 rounded-md border border-solid border-border p-4"
			aria-label={`Schedule of ${workspace.name}`}
		>
			<div className="flex items-baseline justify-between gap-2 text-sm">
				<span className="font-medium">{workspace.name}</span>
				<span className="text-content-secondary">{workspace.problem}</span>
			</div>
			<ScheduleFields
				value={value}
				onChange={setValue}
				disabled={busy}
				problem={problem || error}
			/>
			<div>
				<Button size="sm" disabled={busy || Boolean(problem)} onClick={save}>
					<Spinner loading={busy} />
					Save schedule
				</Button>
			</div>
		</section>
	);
};
