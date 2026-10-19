import { type FormikProps, useFormik } from "formik";
import { useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import * as Yup from "yup";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { templateByName } from "#/api/queries/templates";
import { workspaceByOwnerAndNameKey } from "#/api/queries/workspaces";
import {
	type AutomaticUpdates,
	AutomaticUpdateses,
	type Workspace,
} from "#/api/typesGenerated";
import { WorkspaceExtrasAPI, workspaceIconsKey } from "#/api/workspaceVolumes";
import { useFollowWhileClean } from "#/modules/platform/settingsPage/useFollowWhileClean";
import type { WorkspacePermissions } from "#/modules/workspaces/permissions";
import { useWorkspaceIcons } from "#/modules/workspaces/WorkspaceIcon/useWorkspaceIcon";
import { nameValidator } from "#/utils/formUtils";
import { useBuildParameters } from "./useBuildParameters";
import {
	formValuesToAutostartRequest,
	formValuesToTTLRequest,
} from "./WorkspaceSchedulePage/formToRequest";
import {
	scheduleChanged,
	scheduleToAutostart,
} from "./WorkspaceSchedulePage/schedule";
import {
	validationSchema as scheduleValidationSchema,
	type WorkspaceScheduleFormValues,
} from "./WorkspaceSchedulePage/scheduleForm";
import { ttlMsToAutostop } from "./WorkspaceSchedulePage/ttl";

export type GeneralValues = {
	name: string;
	automatic_updates: AutomaticUpdates;
	/** The workspace's own icon ("" = its template's), kept by the platform service. */
	icon: string;
};

const getAutostart = (workspace: Workspace) =>
	scheduleToAutostart(workspace.autostart_schedule);

const getAutostop = (workspace: Workspace) => ttlMsToAutostop(workspace.ttl_ms);

/** What a field's form has to say about it: its error once touched (or once a save was tried). */
const fieldError = <T>(form: FormikProps<T>, name: keyof T & string) =>
	form.touched[name] && typeof form.errors[name] === "string"
		? (form.errors[name] as string)
		: undefined;

/**
 * The workspace settings page's state: General (name, icon, update policy), the schedule, and the build parameters
 * (Resources and Environment), each in its own form, saved together from the page's save bar - each changed group
 * through its own endpoint, the build parameters last, as a new build.
 */
export const useWorkspaceSettingsForm = ({
	owner,
	workspace,
	permissions,
	templateVersionId,
}: {
	owner: string;
	workspace: Workspace;
	permissions: WorkspacePermissions | undefined;
	templateVersionId: string | undefined;
}) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// General
	const icons = useWorkspaceIcons();
	const generalInitial: GeneralValues = {
		name: workspace.name,
		automatic_updates: workspace.automatic_updates,
		icon: icons.data?.[workspace.id] ?? "",
	};
	const general = useFormik<GeneralValues>({
		initialValues: generalInitial,
		validationSchema: Yup.object({
			name: nameValidator("Name"),
			automatic_updates: Yup.string().oneOf(AutomaticUpdateses),
		}),
		onSubmit: () => {},
	});
	useFollowWhileClean(general, generalInitial);
	const [generalError, setGeneralError] = useState<unknown>();

	// Schedule
	const templateQuery = useQuery(
		templateByName(workspace.organization_id, workspace.template_name),
	);
	const template = templateQuery.data;
	const scheduleInitial: WorkspaceScheduleFormValues = {
		...getAutostart(workspace),
		...getAutostop(workspace),
	};
	const schedule = useFormik<WorkspaceScheduleFormValues>({
		initialValues: scheduleInitial,
		validationSchema: scheduleValidationSchema,
		onSubmit: () => {},
	});
	useFollowWhileClean(schedule, scheduleInitial);
	const canEditSchedule =
		Boolean(template) &&
		!workspace.is_prebuild &&
		permissions?.updateWorkspace !== false &&
		Boolean(template?.allow_user_autostart || template?.allow_user_autostop);

	// Resources and Environment
	const params = useBuildParameters({
		workspace,
		templateVersionId,
		canChangeVersions: Boolean(permissions?.updateWorkspaceVersion),
	});

	const generalChanged = general.dirty;
	const scheduleDirty = schedule.dirty;
	const changed = generalChanged || scheduleDirty || params.changed;

	const [saving, setSaving] = useState(false);
	// Build parameters changed on a running workspace: it restarts, asked first.
	const [confirmingRestart, setConfirmingRestart] = useState(false);
	// Only autostop changed on a running workspace: restart now to apply it, or at its next start.
	const [askingAutostopRestart, setAskingAutostopRestart] = useState(false);

	const saveGeneral = async () => {
		const values = general.values;
		setGeneralError(undefined);
		try {
			await Promise.all([
				values.name !== workspace.name &&
					API.patchWorkspace(workspace.id, { name: values.name }),
				values.automatic_updates !== workspace.automatic_updates &&
					API.updateWorkspaceAutomaticUpdates(
						workspace.id,
						values.automatic_updates,
					),
				values.icon !== general.initialValues.icon &&
					WorkspaceExtrasAPI.setIcon(workspace.id, values.icon).then(() =>
						queryClient.invalidateQueries({ queryKey: workspaceIconsKey }),
					),
			]);
		} catch (error) {
			setGeneralError(error);
			throw error;
		}
		general.resetForm({ values });
	};

	const saveSchedule = async () => {
		const values = schedule.values;
		const autostartChanged = scheduleChanged(getAutostart(workspace), values);
		const autostopChanged = scheduleChanged(getAutostop(workspace), values);
		await Promise.all([
			autostartChanged &&
				API.putWorkspaceAutostart(
					workspace.id,
					formValuesToAutostartRequest(values),
				),
			autostopChanged &&
				API.putWorkspaceAutostop(workspace.id, formValuesToTTLRequest(values)),
		]);
		schedule.resetForm({ values });
		return autostopChanged && values.autostopEnabled;
	};

	/** Every changed group, in order: General, the schedule, then the build parameters (a new build). */
	const saveAll = async () => {
		setSaving(true);
		const renamedTo =
			general.values.name !== workspace.name ? general.values.name : null;
		let autostopApplies = false;
		try {
			if (generalChanged) {
				await saveGeneral();
			}
			if (scheduleDirty) {
				autostopApplies = await saveSchedule();
			}
			await queryClient.invalidateQueries({
				queryKey: workspaceByOwnerAndNameKey(owner, workspace.name),
			});
			if (params.changed) {
				await params.apply();
				navigate(`/@${owner}/${renamedTo ?? workspace.name}`);
				return;
			}
			toast.success("Workspace settings saved.");
			if (autostopApplies && params.running) {
				setAskingAutostopRestart(true);
			}
			if (renamedTo) {
				navigate(`/@${owner}/${renamedTo}/settings`, { replace: true });
			}
		} catch (error) {
			toast.error(getErrorMessage(error, "The settings were not saved."));
		} finally {
			setSaving(false);
		}
	};

	/** Checks the changed groups (their errors shown), then saves - asking first when the workspace restarts. */
	const save = async () => {
		if (!changed || saving) {
			return;
		}
		const checks: Array<Promise<boolean>> = [];
		const check = async <T extends object>(form: FormikProps<T>) => {
			const errors = await form.validateForm();
			if (Object.keys(errors).length === 0) {
				return true;
			}
			await form.setTouched(
				Object.fromEntries(Object.keys(errors).map((k) => [k, true])) as never,
				false,
			);
			return false;
		};
		if (generalChanged) {
			checks.push(check(general));
		}
		if (scheduleDirty) {
			checks.push(check(schedule));
		}
		if (!(await Promise.all(checks)).every(Boolean)) {
			toast.error("Some settings need fixing first.");
			window.requestAnimationFrame(() =>
				document
					.querySelector<HTMLElement>(
						".ws-settings [aria-invalid='true'], .ws-settings .ws-error",
					)
					?.scrollIntoView({ block: "center" }),
			);
			return;
		}
		if (params.changed && params.running) {
			setConfirmingRestart(true);
			return;
		}
		await saveAll();
	};

	const discard = () => {
		general.resetForm();
		schedule.resetForm();
		if (params.changed) {
			params.reset();
		}
		setGeneralError(undefined);
	};

	const blocked =
		saving ||
		params.applying ||
		(params.changed &&
			(params.disabled || params.unsynced || params.hasErrors));

	return {
		general,
		generalError,
		generalField: (name: keyof GeneralValues) => fieldError(general, name),
		schedule,
		scheduleField: (name: keyof WorkspaceScheduleFormValues) =>
			fieldError(schedule, name),
		template,
		templateError: templateQuery.error,
		canEditSchedule,
		params,
		changed,
		paramsChanged: params.changed,
		saving: saving || params.applying,
		blocked,
		save,
		saveAll,
		discard,
		confirmingRestart,
		setConfirmingRestart,
		askingAutostopRestart,
		setAskingAutostopRestart,
		iconsLoading: icons.isLoading,
	};
};

export type WorkspaceSettingsForm = ReturnType<typeof useWorkspaceSettingsForm>;
