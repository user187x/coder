import { type FormikTouched, useFormik } from "formik";
import * as Yup from "yup";
import type { UpdateUserProfileRequest } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Form, FormFields } from "#/components/Form/Form";
import { FormField } from "#/components/FormField/FormField";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	getFormHelpers,
	nameValidator,
	onChangeTrimmed,
} from "#/utils/formUtils";

const validationSchema = Yup.object({
	username: nameValidator("Username"),
	email: Yup.string()
		.trim()
		.email("Enter a valid email address.")
		.required("Email is required."),
	name: Yup.string(),
});

type AccountFormProps = {
	editable: boolean;
	focusUsername?: boolean;
	emailEditable: boolean;
	providerAccountURL?: string;
	email: string;
	isLoading: boolean;
	initialValues: UpdateUserProfileRequest;
	onSubmit: (values: UpdateUserProfileRequest) => void;
	updateProfileError?: unknown;
	// initialTouched is only used for testing the error state of the form.
	initialTouched?: FormikTouched<UpdateUserProfileRequest>;
};

export const AccountForm: React.FC<AccountFormProps> = ({
	editable,
	focusUsername = false,
	emailEditable,
	providerAccountURL,
	email,
	isLoading,
	onSubmit,
	initialValues,
	updateProfileError,
	initialTouched,
}) => {
	const form = useFormik<
		UpdateUserProfileRequest & { email: string; current_password: string }
	>({
		initialValues: { ...initialValues, email, current_password: "" },
		validationSchema,
		onSubmit: ({ email: nextEmail, current_password, ...profile }) => {
			const changedEmail =
				emailEditable && nextEmail.toLowerCase() !== email.toLowerCase();
			onSubmit(
				changedEmail
					? { ...profile, email: nextEmail, current_password }
					: profile,
			);
		},
		initialTouched,
	});
	const getFieldHelpers = getFormHelpers(form, updateProfileError);

	return (
		<Form onSubmit={form.handleSubmit}>
			<FormFields>
				{Boolean(updateProfileError) && (
					<ErrorAlert error={updateProfileError} />
				)}

				<FormField
					field={getFieldHelpers("email")}
					label="Email"
					type="email"
					autoComplete="email"
					onChange={onChangeTrimmed(form)}
					disabled={!emailEditable}
				/>
				{!emailEditable && (
					<p className="text-sm text-content-secondary">
						Your sign-in provider manages your email address.
						{providerAccountURL && (
							<>
								{" "}
								<a
									className="text-content-link underline"
									href={providerAccountURL}
									target="_blank"
									rel="noreferrer"
								>
									Change email with your sign-in provider
								</a>
								. Sign in to Coder again afterward to sync the change.
							</>
						)}
					</p>
				)}
				{emailEditable &&
					form.values.email.toLowerCase() !== email.toLowerCase() && (
						<FormField
							field={getFieldHelpers("current_password")}
							label="Current password"
							type="password"
							autoComplete="current-password"
							required
						/>
					)}
				<FormField
					field={getFieldHelpers("username")}
					onChange={onChangeTrimmed(form)}
					aria-disabled={!editable}
					autoComplete="username"
					autoFocus={focusUsername}
					disabled={!editable}
					className="w-full"
					label="Username"
				/>
				<FormField
					field={{
						...getFieldHelpers("name"),
						helperText:
							'The human-readable name is optional and can be accessed in a template via the "data.coder_workspace_owner.me.full_name" property.',
					}}
					autoComplete="name"
					className="w-full"
					label="Name"
					onBlur={(event) => {
						event.target.value = event.target.value.trim();
						form.handleChange(event);
					}}
				/>
				<div>
					<Button disabled={isLoading} type="submit">
						<Spinner loading={isLoading} />
						Update account
					</Button>
				</div>
			</FormFields>
		</Form>
	);
};
