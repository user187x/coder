import { isAxiosError } from "axios";
import { type FormikContextType, useFormik } from "formik";
import * as Yup from "yup";
import type * as TypesGen from "#/api/typesGenerated";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { FormField } from "#/components/FormField/FormField";
import { ProductLogo } from "#/components/Icons/ProductLogo";
import { PasswordField } from "#/components/PasswordField/PasswordField";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	getFormHelpers,
	nameValidator,
	onChangeTrimmed,
} from "#/utils/formUtils";

const usernameValidator = nameValidator("Username");
const usernameFromEmail = (email: string): string => {
	try {
		const emailPrefix = email.split("@")[0];
		const username = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, "-");
		usernameValidator.validateSync(username);
		return username;
	} catch (error) {
		console.warn(
			"failed to automatically generate username, defaulting to 'admin'",
			error,
		);
		return "admin";
	}
};

const validationSchema = Yup.object({
	email: Yup.string()
		.trim()
		.email("Please enter a valid email address.")
		.required("Please enter an email address."),
	password: Yup.string().required("Please enter a password."),
	username: usernameValidator,
});

type SetupPageViewProps = {
	onSubmit: (firstUser: TypesGen.CreateFirstUserRequest) => void;
	error?: unknown;
	isLoading?: boolean;
	authMethods: TypesGen.AuthMethods | undefined;
};

export const SetupPageView: React.FC<SetupPageViewProps> = ({
	onSubmit,
	error,
	isLoading,
	authMethods,
}) => {
	const form: FormikContextType<TypesGen.CreateFirstUserRequest> =
		useFormik<TypesGen.CreateFirstUserRequest>({
			initialValues: {
				email: "",
				password: "",
				username: "",
				name: "",
			},
			validationSchema,
			onSubmit,
			validateOnBlur: false,
			validateOnMount: true,
		});
	const getFieldHelpers = getFormHelpers<TypesGen.CreateFirstUserRequest>(
		form,
		error,
	);

	return (
		<div className="grow basis-0 min-h-screen flex justify-center items-center py-12">
			<div className="flex flex-col w-full max-w-[500px] px-4">
				<header className="mb-8">
					<ProductLogo />
					<h1 className="text-2xl font-semibold mt-4 mb-0">Welcome to Coder</h1>
					<p className="mt-3 mb-0 text-sm text-content-secondary font-normal">
						Set up your admin account and start building secure, reproducible
						dev environments.
					</p>
				</header>

				<form onSubmit={form.handleSubmit} className="flex flex-col gap-6">
					{authMethods?.github.enabled && (
						<>
							<Button className="w-full" asChild type="submit" size="lg">
								<a
									href={`/api/v2/users/oauth2/github/callback?redirect=${encodeURIComponent(
										"/templates/new/builder",
									)}`}
								>
									<ExternalImage src="/icon/github.svg?blackWithColor" />
									GitHub
								</a>
							</Button>
							<div className="flex items-center gap-4">
								<div className="h-px w-full bg-border" />
								<div className="shrink-0 text-xs uppercase text-content-secondary tracking-wider">
									or
								</div>
								<div className="h-px w-full bg-border" />
							</div>
						</>
					)}

					{/* Email */}
					<FormField
						label="Email"
						field={getFieldHelpers("email")}
						autoComplete="email"
						onChange={onChangeTrimmed(form, (email) => {
							form.setFieldValue("username", usernameFromEmail(email));
						})}
						disabled={isLoading}
					/>

					{/* Password */}
					<PasswordField
						label="Password"
						field={getFieldHelpers("password")}
						autoComplete="new-password"
						disabled={isLoading}
					/>

					{/* Error alert */}
					{isAxiosError(error) && error.response?.data?.message && (
						<Alert severity="error" prominent>
							<AlertTitle>{error.response.data.message}</AlertTitle>
							{error.response.data.detail && (
								<AlertDescription>
									{error.response.data.detail}
								</AlertDescription>
							)}
						</Alert>
					)}

					<div className="flex justify-end">
						<Button disabled={isLoading} type="submit" data-testid="create">
							<Spinner loading={isLoading} />
							Continue
						</Button>
					</div>
				</form>

				<div className="text-xs text-content-secondary pt-6">
					&copy; {new Date().getFullYear()} Coder Technologies, Inc.
				</div>
			</div>
		</div>
	);
};
