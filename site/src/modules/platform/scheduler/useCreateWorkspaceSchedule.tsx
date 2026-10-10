import { CalendarClockIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { schedulerMe } from "#/api/queries/platform";
import type { CreateWorkspaceRequest } from "#/api/typesGenerated";
import { ScheduleFields } from "./ScheduleFields";
import {
	browserTimezone,
	type DailySchedule,
	describeSchedule,
	formatHours,
	scheduleProblem,
	toCoderSchedule,
} from "./schedule";

/**
 * The create-workspace form's part of the Global Workspace Scheduler: where it
 * applies, a "Schedule" section (the user's start and stop times, or the
 * administrator's schedule that will be applied), whether the form may be
 * submitted, and the request with the schedule added.
 */
export const useCreateWorkspaceSchedule = () => {
	const { data: me } = useQuery(schedulerMe());
	const [value, setValue] = useState<DailySchedule>(() => ({
		start: "09:00",
		stop: "17:00",
		days: [1, 2, 3, 4, 5],
		timezone: browserTimezone(),
	}));
	const enforced = Boolean(me?.enforced);
	const userSets = enforced && me?.mode === "user";
	const problem = userSets
		? scheduleProblem(value, me?.maxActiveHours ?? null)
		: "";

	const section = enforced ? (
		<section
			className="flex flex-col gap-4"
			aria-labelledby="create-schedule-title"
		>
			<div>
				<h2
					id="create-schedule-title"
					className="m-0 flex items-center gap-2 text-xl font-semibold"
				>
					<CalendarClockIcon aria-hidden className="size-5" />
					Schedule
				</h2>
				<p className="m-0 mt-1 text-sm text-content-secondary">
					{userSets
						? `Your administrator requires a start and a stop time for every workspace${
								me?.maxActiveHours
									? ` (at most ${formatHours(me.maxActiveHours)} apart)`
									: ""
							}.`
						: me?.fixed
							? `This workspace runs on the schedule your administrator set: ${describeSchedule(me.fixed)}.`
							: "This workspace runs on the schedule your administrator set."}
				</p>
			</div>
			{userSets && (
				<ScheduleFields value={value} onChange={setValue} problem={problem} />
			)}
		</section>
	) : null;

	return {
		section,
		blocked: Boolean(problem),
		/** The request with the user's schedule (the server applies the administrator's itself). */
		withSchedule: (request: CreateWorkspaceRequest): CreateWorkspaceRequest => {
			if (!userSets) {
				return request;
			}
			const schedule = toCoderSchedule(value);
			return {
				...request,
				autostart_schedule: schedule.autostart_schedule,
				ttl_ms: schedule.ttl_ms,
			};
		},
	};
};
