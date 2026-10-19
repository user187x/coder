import { type FormikProps, useFormik } from "formik";
import { useState } from "react";
import { useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	invalidateTemplateListQueries,
	templateByNameKey,
} from "#/api/queries/templates";
import type { Template, UpdateTemplateMeta } from "#/api/typesGenerated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { useFollowWhileClean } from "#/modules/platform/settingsPage/useFollowWhileClean";
import { useTemplateScheduleForm } from "./TemplateSchedulePage/useTemplateScheduleForm";
import { useTemplateVariablesForm } from "./TemplateVariablesPage/templateVariables";
import { metaInitialValues, validationSchema } from "./templateMetaForm";

/** A form's errors, shown: every field with one touched. True when it has none. */
const checked = async <T extends object>(form: FormikProps<T>) => {
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

/**
 * The template settings page's state: its own settings (General, Operations, Port sharing, Deprecate - the
 * template's metadata), its schedule and its variables, each a form, saved together from the page's save bar: the
 * metadata, then the schedule (which may stop to ask about the workspaces it affects), then the variables (a new
 * version of the template, made the active one).
 */
export const useTemplateSettingsForm = (template: Template) => {
	const navigate = useNavigate();
	const getLink = useLinks();
	const queryClient = useQueryClient();
	const { entitlements } = useDashboard();
	const flags = {
		accessControlEnabled: entitlements.features.access_control.enabled,
		advancedSchedulingEnabled:
			entitlements.features.advanced_template_scheduling.enabled,
		portSharingControlsEnabled:
			entitlements.features.control_shared_ports.enabled,
	};

	const metaInitial = metaInitialValues(template);
	const meta = useFormik<UpdateTemplateMeta>({
		initialValues: metaInitial,
		validationSchema,
		onSubmit: () => {},
	});
	useFollowWhileClean(meta, metaInitial);
	const [metaError, setMetaError] = useState<unknown>();

	const schedule = useTemplateScheduleForm({
		template,
		allowAdvancedScheduling: flags.advancedSchedulingEnabled,
		send: (data) => API.updateTemplateMeta(template.id, data),
	});
	const variables = useTemplateVariablesForm(template);

	const [saving, setSaving] = useState(false);
	const metaChanged = meta.dirty;
	const scheduleChanged = schedule.form.dirty;
	const variablesChanged = variables.changed;
	const changed = metaChanged || scheduleChanged || variablesChanged;

	const save = async () => {
		if (!changed || saving) {
			return;
		}
		const results = await Promise.all([
			metaChanged ? checked(meta) : true,
			scheduleChanged ? checked(schedule.form) : true,
			variablesChanged ? checked(variables.form) : true,
		]);
		if (!results.every(Boolean)) {
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
		setSaving(true);
		let name = template.name;
		try {
			if (metaChanged) {
				setMetaError(undefined);
				const values = meta.values;
				try {
					// A 304 (nothing changed) comes back empty: the template as it is.
					const data = await API.updateTemplateMeta(template.id, {
						...template,
						...values,
					});
					name = (data ?? template).name;
				} catch (error) {
					setMetaError(error);
					throw error;
				}
				meta.resetForm({ values });
				toast.success(`Template "${name}" updated successfully.`);
			}
			if (scheduleChanged) {
				const outcome = await schedule.save();
				if (outcome !== "saved") {
					return; // called off at its confirmation: still changed, still in the save bar
				}
				schedule.form.resetForm({ values: schedule.form.values });
				toast.success(`Template "${name}" schedule updated successfully.`);
			}
			if (variablesChanged) {
				await variables.save();
				variables.form.resetForm({ values: variables.form.values });
			}
		} catch (error) {
			toast.error(
				getErrorMessage(error, `Failed to update template "${template.name}".`),
				{ description: getErrorDetail(error) },
			);
		} finally {
			await Promise.all([
				invalidateTemplateListQueries(queryClient),
				queryClient.invalidateQueries({
					queryKey: templateByNameKey(template.organization_name, name),
				}),
			]);
			setSaving(false);
			if (name !== template.name) {
				navigate(
					`${getLink(linkToTemplate(template.organization_name, name))}/settings`,
					{ replace: true },
				);
			}
		}
	};

	const discard = () => {
		meta.resetForm();
		schedule.form.resetForm();
		variables.form.resetForm();
		setMetaError(undefined);
	};

	return {
		flags,
		meta,
		metaError,
		schedule,
		variables,
		changed,
		variablesChanged,
		saving: saving || variables.saving,
		save,
		discard,
	};
};

export type TemplateSettingsForm = ReturnType<typeof useTemplateSettingsForm>;
