import { cn } from "cn";
import { useFormik } from "formik";
import upperFirst from "lodash/upperFirst";
import * as Yup from "yup";
import {
	type AutomaticUpdates,
	AutomaticUpdateses,
	type Workspace,
} from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	FormFields,
	FormFooter,
	FormSection,
	HorizontalForm,
} from "#/components/Form/Form";
import { FormField } from "#/components/FormField/FormField";
import { IconField } from "#/components/IconField/IconField";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	getFormHelpers,
	nameValidator,
	onChangeTrimmed,
} from "#/utils/formUtils";

export type WorkspaceSettingsFormValues = {
	name: string;
	automatic_updates: AutomaticUpdates;
	/** The workspace's own icon ("" = its template's), kept by the platform service. */
	icon: string;
};

type WorkspaceSettingsFormProps = {
	workspace: Workspace;
	/** Its own icon now ("" when it shows the template's). */
	icon: string;
	error: unknown;
	onCancel: () => void;
	onSubmit: (values: WorkspaceSettingsFormValues) => Promise<void>;
};

export const WorkspaceSettingsForm: React.FC<WorkspaceSettingsFormProps> = ({
	onCancel,
	onSubmit,
	workspace,
	icon,
	error,
}) => {
	const form = useFormik<WorkspaceSettingsFormValues>({
		onSubmit,
		initialValues: {
			name: workspace.name,
			automatic_updates: workspace.automatic_updates,
			icon,
		},
		validationSchema: Yup.object({
			name: nameValidator("Name"),
			automatic_updates: Yup.string().oneOf(AutomaticUpdateses),
		}),
	});
	const getFieldHelpers = getFormHelpers<WorkspaceSettingsFormValues>(
		form,
		error,
	);
	const automaticUpdatesField = getFieldHelpers("automatic_updates", {
		helperText: workspace.template_require_active_version
			? "The template for this workspace requires automatic updates."
			: undefined,
	});
	const automaticUpdatesHelperId = `${automaticUpdatesField.id}-helper`;

	return (
		<HorizontalForm onSubmit={form.handleSubmit} data-testid="form">
			<FormSection
				title="Workspace Name"
				description="Update the name of your workspace."
			>
				<FormFields>
					<FormField
						field={getFieldHelpers("name", {
							helperText: workspace.allow_renames
								? form.values.name !== form.initialValues.name && (
										<span className="text-content-warning">
											Depending on the template, renaming your workspace may be
											destructive
										</span>
									)
								: "Renaming your workspace can be destructive and is disabled by the template.",
						})}
						label="Name"
						disabled={!workspace.allow_renames || form.isSubmitting}
						onChange={onChangeTrimmed(form)}
						autoFocus
						className="w-full"
					/>
				</FormFields>
			</FormSection>
			<FormSection
				title="Icon"
				description="Its own icon in the workspaces list and on its page. Empty: the template's."
			>
				<FormFields>
					<IconField
						{...getFieldHelpers("icon", {
							helperText:
								"A Coder icon or emoji (Emoji / Icon), or a path such as /icon/go.svg.",
						})}
						disabled={form.isSubmitting}
						onChange={onChangeTrimmed(form)}
						fullWidth
						label="Icon"
						placeholder={workspace.template_icon || "/emojis/1f4bb.png"}
						onPickEmoji={(value) => form.setFieldValue("icon", value)}
					/>
				</FormFields>
			</FormSection>
			<FormSection
				title="Automatic Updates"
				description="Configure your workspace to automatically update when started."
			>
				<FormFields>
					<div className="flex flex-col gap-2">
						<Label htmlFor={automaticUpdatesField.id}>Update Policy</Label>
						<Select
							value={
								workspace.template_require_active_version
									? "always"
									: form.values.automatic_updates
							}
							onValueChange={(value) =>
								void form.setFieldValue("automatic_updates", value)
							}
							disabled={
								form.isSubmitting || workspace.template_require_active_version
							}
						>
							<SelectTrigger
								id={automaticUpdatesField.id}
								className={cn(
									"w-full",
									automaticUpdatesField.error && "border-border-destructive",
								)}
								aria-invalid={automaticUpdatesField.error}
								aria-describedby={
									automaticUpdatesField.helperText
										? automaticUpdatesHelperId
										: undefined
								}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AutomaticUpdateses.map((value) => (
									<SelectItem value={value} key={value}>
										{upperFirst(value)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{automaticUpdatesField.helperText && (
							<span
								id={automaticUpdatesHelperId}
								className={cn(
									"text-xs",
									automaticUpdatesField.error
										? "text-content-destructive"
										: "text-content-secondary",
								)}
							>
								{automaticUpdatesField.helperText}
							</span>
						)}
					</div>
				</FormFields>
			</FormSection>
			<FormFooter>
				<Button onClick={onCancel} variant="outline">
					Cancel
				</Button>

				<Button type="submit" disabled={form.isSubmitting}>
					<Spinner loading={form.isSubmitting} />
					Save
				</Button>
			</FormFooter>
		</HorizontalForm>
	);
};
