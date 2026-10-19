import { useFormik } from "formik";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "react-query";
import { toast } from "sonner";
import * as Yup from "yup";
import {
	createAndBuildTemplateVersion,
	templateVersion,
	templateVersionVariables,
	updateActiveTemplateVersion,
} from "#/api/queries/templates";
import type {
	CreateTemplateVersionRequest,
	Template,
	TemplateVersion,
	TemplateVersionVariable,
	VariableValue,
} from "#/api/typesGenerated";

/** What a variable starts as in the form: its value, a bool's or a required one's default, a sensitive one's blank. */
export const selectInitialUserVariableValues = (
	templateVariables: TemplateVersionVariable[],
): VariableValue[] => {
	const defaults: VariableValue[] = [];
	for (const templateVariable of templateVariables) {
		// Boolean variables must be always either "true" or "false"
		if (templateVariable.type === "bool" && templateVariable.value === "") {
			defaults.push({
				name: templateVariable.name,
				value: templateVariable.default_value,
			});
			continue;
		}

		if (templateVariable.sensitive) {
			defaults.push({
				name: templateVariable.name,
				value: "",
			});
			continue;
		}

		if (templateVariable.required && templateVariable.value === "") {
			defaults.push({
				name: templateVariable.name,
				value: templateVariable.default_value,
			});
			continue;
		}

		defaults.push({
			name: templateVariable.name,
			value: templateVariable.value,
		});
	}
	return defaults;
};

export const ValidationSchemaForTemplateVariables = (
	_ns: string,
	templateVariables: TemplateVersionVariable[],
): Yup.AnySchema => {
	return Yup.array()
		.of(
			Yup.object().shape({
				name: Yup.string().required(),
				value: Yup.string()
					.test("verify with template", (val, ctx) => {
						const name = ctx.parent.name;
						const templateVariable = templateVariables.find(
							(variable) => variable.name === name,
						);
						if (templateVariable?.sensitive) {
							// It's possible that the secret is already stored in database,
							// so we can't properly verify the "required" condition.
							return true;
						}
						if (templateVariable?.required) {
							if (!val || val.length === 0) {
								return ctx.createError({
									path: ctx.path,
									message: "Variable is required.",
								});
							}
						}
						return true;
					}),
			}),
		)
		.required();
};

/** A sensitive variable left blank keeps the value it has (it is not sent). */
export const filterEmptySensitiveVariables = (
	request: CreateTemplateVersionRequest,
	templateVariables?: TemplateVersionVariable[],
): CreateTemplateVersionRequest => {
	const filtered: VariableValue[] = [];

	if (!templateVariables) {
		return request;
	}

	if (request.user_variable_values) {
		for (const variableValue of request.user_variable_values) {
			const templateVariable = templateVariables.find(
				(t) => t.name === variableValue.name,
			);
			if (templateVariable?.sensitive && variableValue.value === "") {
				continue;
			}
			filtered.push(variableValue);
		}
	}

	return {
		...request,
		user_variable_values: filtered,
	};
};

const NO_VARIABLES: TemplateVersionVariable[] = [];

/**
 * The template's variables on its settings page (the former Variables page's form): the active version's, changed
 * and saved as a new version - built with them, then made the active one.
 */
export const useTemplateVariablesForm = (template: Template) => {
	const queryClient = useQueryClient();
	const versionQuery = useQuery({
		...templateVersion(template.active_version_id),
		placeholderData: keepPreviousData,
	});
	const variablesQuery = useQuery({
		...templateVersionVariables(template.active_version_id),
		placeholderData: keepPreviousData,
	});
	const version: TemplateVersion | undefined = versionQuery.data;
	const variables = variablesQuery.data ?? NO_VARIABLES;
	const build = useMutation(
		createAndBuildTemplateVersion(template.organization_id),
	);
	const publish = useMutation(
		updateActiveTemplateVersion(template, queryClient),
	);

	const form = useFormik<CreateTemplateVersionRequest>({
		initialValues: {
			template_id: version?.template_id ?? template.id,
			provisioner: "terraform",
			storage_method: "file",
			tags: version?.job.tags ?? {},
			file_id: version?.job.file_id ?? "",
			user_variable_values: selectInitialUserVariableValues(variables),
		},
		validationSchema: Yup.object({
			user_variable_values: ValidationSchemaForTemplateVariables(
				"templateVariablesPage",
				variables,
			),
		}),
		onSubmit: () => {},
		enableReinitialize: true,
	});

	return {
		form,
		/** The active version (its name, its job). */
		version,
		variables,
		ready: Boolean(version && variablesQuery.data),
		error: versionQuery.error ?? variablesQuery.error,
		saving: build.isPending || publish.isPending,
		saveError: build.error ?? publish.error,
		changed: form.dirty,
		/** Builds a version with the changed variables and makes it the active one. */
		save: async (): Promise<"saved" | "invalid"> => {
			const errors = await form.validateForm();
			if (Object.keys(errors).length > 0) {
				await form.setTouched(
					{
						user_variable_values: variables.map(() => ({
							value: true,
						})) as never,
					},
					false,
				);
				return "invalid";
			}
			const request = filterEmptySensitiveVariables(form.values, variables);
			const newVersion = await build.mutateAsync(request);
			await publish.mutateAsync(newVersion.id);
			toast.success(
				`Template "${template.name}" variables updated successfully.`,
			);
			return "saved";
		},
	};
};

export type TemplateVariablesForm = ReturnType<typeof useTemplateVariablesForm>;
