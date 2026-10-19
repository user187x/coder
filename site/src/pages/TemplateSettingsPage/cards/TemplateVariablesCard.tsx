import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { BracesGlyph } from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	SettingsCard,
} from "#/modules/platform/settingsPage/settingsParts";
import { getFormHelpers } from "#/utils/formUtils";
import {
	SensitiveVariableHelperText,
	TemplateVariableField,
} from "../TemplateVariablesPage/TemplateVariableField";
import type { TemplateVariablesForm } from "../TemplateVariablesPage/templateVariables";

/**
 * Variables: the active version's Terraform variables (the former Variables page's form). Changed, they are saved as
 * a new version of the template, built with them and made the active one.
 */
export const TemplateVariablesCard: React.FC<{
	variables: TemplateVariablesForm;
	disabled: boolean;
}> = ({ variables, disabled }) => {
	const { form } = variables;
	const field = getFormHelpers(form, variables.saveError);
	return (
		<SettingsCard
			id="variables"
			title="Variables"
			description="The template's Terraform variables: changed, they publish a new version"
			icon={<BracesGlyph size={18} />}
		>
			{variables.error ? (
				<div className="p-6">
					<ErrorAlert error={variables.error} />
				</div>
			) : !variables.ready ? (
				<CardLoader />
			) : variables.variables.length === 0 ? (
				<p className="m-0 p-6 text-[13px] text-(--ws-muted)">
					This template has no variables.
				</p>
			) : (
				<div className="px-6 py-2" aria-label="Template variables" role="group">
					{variables.variables.map((variable, index) => {
						const helpers = field(`user_variable_values[${index}].value`, {
							helperText: variable.sensitive ? (
								<SensitiveVariableHelperText />
							) : undefined,
						});
						return (
							<div key={variable.name} className="ws-row">
								<div className="ws-row-label">
									<div className="ws-mono font-medium">{variable.name}</div>
									{variable.description && (
										<p className="ws-desc">{variable.description}</p>
									)}
								</div>
								{/* the field's own label (the name, again) only for screen readers: its name is on the left */}
								<div className="ws-row-control max-w-[420px] [&>div>label:first-child]:sr-only">
									<TemplateVariableField
										embedded
										templateVersionVariable={variable}
										initialValue={
											form.initialValues.user_variable_values?.[index]?.value ??
											""
										}
										disabled={disabled}
										error={helpers.error}
										helperText={helpers.helperText}
										name={helpers.name}
										onBlur={helpers.onBlur}
										onChange={(value) =>
											void form.setFieldValue(`user_variable_values.${index}`, {
												name: variable.name,
												value,
											})
										}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</SettingsCard>
	);
};
