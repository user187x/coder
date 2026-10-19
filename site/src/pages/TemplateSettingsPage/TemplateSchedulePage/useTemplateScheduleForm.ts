import { useFormik } from "formik";
import { useEffect, useRef, useState } from "react";
import type { Template, UpdateTemplateMeta } from "#/api/typesGenerated";
import {
	calculateAutostopRequirementDaysValue,
	type TemplateAutostartRequirementDaysValue,
} from "#/utils/schedule";
import { convertAutostopRequirementDaysValue } from "./AutostopRequirementHelperText";
import {
	getValidationSchema,
	type TemplateScheduleFormValues,
} from "./formHelpers";
import {
	useWorkspacesToBeDeleted,
	useWorkspacesToGoDormant,
} from "./useWorkspacesToBeDeleted";

const MS_HOUR_CONVERSION = 3600000;
const MS_DAY_CONVERSION = 86400000;
const FAILURE_CLEANUP_DEFAULT = 7 * MS_DAY_CONVERSION;
const INACTIVITY_CLEANUP_DEFAULT = 180 * MS_DAY_CONVERSION;
const DORMANT_AUTODELETION_DEFAULT = 30 * MS_DAY_CONVERSION;

/** What saving the schedule came to: sent, held back by an error in it, or called off at its confirmation. */
export type SaveOutcome = "saved" | "invalid" | "cancelled";

const initialValuesOf = (
	template: Template,
	allowAdvancedScheduling: boolean,
): TemplateScheduleFormValues => ({
	// on display, convert from ms => hours
	default_ttl_ms: template.default_ttl_ms / MS_HOUR_CONVERSION,
	activity_bump_ms: template.activity_bump_ms / MS_HOUR_CONVERSION,
	time_til_autostop_notify_ms:
		template.time_til_autostop_notify_ms / MS_HOUR_CONVERSION,
	failure_ttl_ms: template.failure_ttl_ms,
	time_til_dormant_ms: template.time_til_dormant_ms,
	time_til_dormant_autodelete_ms: template.time_til_dormant_autodelete_ms,
	autostop_requirement_days_of_week: allowAdvancedScheduling
		? convertAutostopRequirementDaysValue(
				template.autostop_requirement.days_of_week,
			)
		: "off",
	autostop_requirement_weeks: allowAdvancedScheduling
		? template.autostop_requirement.weeks > 0
			? template.autostop_requirement.weeks
			: 1
		: 1,
	autostart_requirement_days_of_week: template.autostart_requirement
		.days_of_week as TemplateAutostartRequirementDaysValue[],
	allow_user_autostart: template.allow_user_autostart,
	allow_user_autostop: template.allow_user_autostop,
	failure_cleanup_enabled:
		allowAdvancedScheduling && Boolean(template.failure_ttl_ms),
	inactivity_cleanup_enabled:
		allowAdvancedScheduling && Boolean(template.time_til_dormant_ms),
	dormant_autodeletion_cleanup_enabled:
		allowAdvancedScheduling && Boolean(template.time_til_dormant_autodelete_ms),
	update_workspace_last_used_at: false,
	update_workspace_dormant_at: false,
	require_active_version: false,
	disable_everyone_group_access: false,
});

/**
 * The template's schedule on its settings page (the former Schedule page's form, its rules kept): autostop, autostart
 * and dormancy, in hours and days on screen and milliseconds when sent. A changed dormancy or deletion threshold that
 * affects workspaces within a week asks first (ScheduleDialog); the page's save bar waits for that answer.
 */
export const useTemplateScheduleForm = ({
	template,
	allowAdvancedScheduling,
	send,
}: {
	template: Template;
	allowAdvancedScheduling: boolean;
	/** Sends the schedule (the template's metadata update). */
	send: (data: UpdateTemplateMeta) => Promise<unknown>;
}) => {
	const form = useFormik<TemplateScheduleFormValues>({
		initialValues: initialValuesOf(template, allowAdvancedScheduling),
		validationSchema: getValidationSchema(),
		onSubmit: () => {},
		enableReinitialize: true,
	});

	const now = new Date();
	const weekFromNow = new Date(now);
	weekFromNow.setDate(now.getDate() + 7);
	const workspacesToDormancyNow = useWorkspacesToGoDormant(
		template,
		form.values,
		now,
	);
	const workspacesToDormancyInWeek = useWorkspacesToGoDormant(
		template,
		form.values,
		weekFromNow,
	);
	const workspacesToBeDeletedNow = useWorkspacesToBeDeleted(
		template,
		form.values,
		now,
	);
	const workspacesToBeDeletedInWeek = useWorkspacesToBeDeleted(
		template,
		form.values,
		weekFromNow,
	);

	const [dialogOpen, setDialogOpen] = useState(false);
	// The save waiting on the dialog's answer (rejected when sending then fails)
	const answer = useRef<{
		resolve: (outcome: SaveOutcome) => void;
		reject: (error: unknown) => void;
	} | null>(null);

	/** The values as the template takes them (hours and days back to milliseconds). */
	const request = (): UpdateTemplateMeta => {
		const v = form.values;
		const autostop_requirement_weeks = ["saturday", "sunday"].includes(
			v.autostop_requirement_days_of_week,
		)
			? v.autostop_requirement_weeks
			: 1;
		return {
			default_ttl_ms: v.default_ttl_ms
				? v.default_ttl_ms * MS_HOUR_CONVERSION
				: undefined,
			// Activity bump has no effect without a scheduled stop time, so
			// discard any stale value when there is no default TTL AND users
			// cannot customize autostop on their workspaces.
			activity_bump_ms:
				(v.default_ttl_ms || v.allow_user_autostop) && v.activity_bump_ms
					? v.activity_bump_ms * MS_HOUR_CONVERSION
					: undefined,
			// 0 disables the reminder, so always send an explicit value.
			time_til_autostop_notify_ms: v.time_til_autostop_notify_ms
				? v.time_til_autostop_notify_ms * MS_HOUR_CONVERSION
				: 0,
			failure_ttl_ms: v.failure_ttl_ms,
			time_til_dormant_ms: v.time_til_dormant_ms,
			time_til_dormant_autodelete_ms: v.time_til_dormant_autodelete_ms,
			autostop_requirement: {
				days_of_week: calculateAutostopRequirementDaysValue(
					v.autostop_requirement_days_of_week,
				),
				weeks: autostop_requirement_weeks,
			},
			autostart_requirement: {
				days_of_week: v.autostart_requirement_days_of_week,
			},
			allow_user_autostart: v.allow_user_autostart,
			allow_user_autostop: v.allow_user_autostop,
			update_workspace_last_used_at: v.update_workspace_last_used_at,
			update_workspace_dormant_at: v.update_workspace_dormant_at,
			disable_everyone_group_access: false,
		};
	};

	const sendNow = async () => {
		await send(request());
		// request-scoped: reset after every submission
		await form.setFieldValue("update_workspace_dormant_at", false, false);
		await form.setFieldValue("update_workspace_last_used_at", false, false);
		// clear browser storage of workspaces impending deletion
		localStorage.removeItem("dismissedWorkspaceList"); // workspaces page
		localStorage.removeItem("dismissedWorkspace"); // workspace page
	};

	/** Saves the schedule: checked, confirmed where workspaces are affected within a week, sent. */
	const save = async (): Promise<SaveOutcome> => {
		const errors = await form.validateForm();
		if (Object.keys(errors).length > 0) {
			await form.setTouched(
				Object.fromEntries(Object.keys(errors).map((k) => [k, true])),
				false,
			);
			return "invalid";
		}
		const v = form.values;
		const dormancyChanged =
			form.initialValues.time_til_dormant_ms !== v.time_til_dormant_ms;
		const deletionChanged =
			form.initialValues.time_til_dormant_autodelete_ms !==
			v.time_til_dormant_autodelete_ms;
		const asks =
			v.inactivity_cleanup_enabled &&
			((dormancyChanged && (workspacesToDormancyInWeek?.length ?? 0) > 0) ||
				(deletionChanged && (workspacesToBeDeletedInWeek?.length ?? 0) > 0));
		if (!asks) {
			await sendNow();
			return "saved";
		}
		setDialogOpen(true);
		return new Promise<SaveOutcome>((resolve, reject) => {
			answer.current = { resolve, reject };
		});
	};

	// Set autostop_requirement weeks to 1 when days_of_week is set to "off" or
	// "daily": the weeks input is disabled then, so users can't set it to 1
	// themselves.
	const { values: currentValues, setValues } = form;
	useEffect(() => {
		if (
			!["saturday", "sunday"].includes(
				currentValues.autostop_requirement_days_of_week,
			) &&
			currentValues.autostop_requirement_weeks !== 1
		) {
			void setValues({ ...currentValues, autostop_requirement_weeks: 1 });
		}
	}, [currentValues, setValues]);

	const toggle = {
		failureCleanup: (checked: boolean) =>
			form.setValues({
				...form.values,
				failure_cleanup_enabled: checked,
				failure_ttl_ms: checked ? FAILURE_CLEANUP_DEFAULT : 0,
			}),
		inactivityCleanup: (checked: boolean) =>
			form.setValues({
				...form.values,
				inactivity_cleanup_enabled: checked,
				time_til_dormant_ms: checked ? INACTIVITY_CLEANUP_DEFAULT : 0,
			}),
		dormantAutoDeletion: (checked: boolean) =>
			form.setValues({
				...form.values,
				dormant_autodeletion_cleanup_enabled: checked,
				time_til_dormant_autodelete_ms: checked
					? DORMANT_AUTODELETION_DEFAULT
					: 0,
			}),
	};

	const dialogReady = Boolean(
		workspacesToDormancyNow &&
			workspacesToBeDeletedNow &&
			workspacesToDormancyInWeek &&
			workspacesToBeDeletedInWeek,
	);

	return {
		form,
		save,
		toggle,
		dialog: {
			open: dialogOpen && dialogReady,
			counts: {
				inactiveWorkspacesToGoDormant: workspacesToDormancyNow?.length ?? 0,
				inactiveWorkspacesToGoDormantInWeek:
					(workspacesToDormancyInWeek?.length ?? 0) -
					(workspacesToDormancyNow?.length ?? 0),
				dormantWorkspacesToBeDeleted: workspacesToBeDeletedNow?.length ?? 0,
				dormantWorkspacesToBeDeletedInWeek:
					(workspacesToBeDeletedInWeek?.length ?? 0) -
					(workspacesToBeDeletedNow?.length ?? 0),
			},
			confirm: async () => {
				setDialogOpen(false);
				const waiting = answer.current;
				answer.current = null;
				try {
					await sendNow();
					waiting?.resolve("saved");
				} catch (error) {
					waiting?.reject(error);
				}
			},
			close: () => {
				setDialogOpen(false);
				answer.current?.resolve("cancelled");
				answer.current = null;
			},
		},
	};
};

export type TemplateScheduleForm = ReturnType<typeof useTemplateScheduleForm>;
