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
 * applies, its Schedule card (the user's start and stop times, or the
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

	const description = !enforced
		? ""
		: userSets
			? `Your administrator requires a start and a stop time for every workspace${
					me?.maxActiveHours
						? ` (at most ${formatHours(me.maxActiveHours)} apart)`
						: ""
				}.`
			: me?.fixed
				? `This workspace runs on the schedule your administrator set: ${describeSchedule(me.fixed)}.`
				: "This workspace runs on the schedule your administrator set.";

	return {
		/** The page's Schedule card, where the scheduler applies: what it says, and the user's fields (theirs to set). */
		card: enforced
			? {
					description,
					fields: userSets ? (
						<ScheduleFields
							value={value}
							onChange={setValue}
							problem={problem}
						/>
					) : null,
				}
			: null,
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
