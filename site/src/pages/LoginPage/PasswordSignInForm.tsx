import { useFormik } from "formik";
import { Link as RouterLink } from "react-router";
import * as Yup from "yup";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Link } from "#/components/Link/Link";
import { Spinner } from "#/components/Spinner/Spinner";
import { getFormHelpers, onChangeTrimmed } from "#/utils/formUtils";

type PasswordSignInFormProps = {
	onSubmit: (credentials: { email: string; password: string }) => void;
	isSigningIn: boolean;
	autoFocus: boolean;
	beforeSubmit?: React.ReactNode;
	submitOptions?: React.ReactNode;
};

export const PasswordSignInForm: React.FC<PasswordSignInFormProps> = ({
	onSubmit,
	isSigningIn,
	autoFocus,
	beforeSubmit,
	submitOptions,
}) => {
	const validationSchema = Yup.object({
		email: Yup.string().trim().required("Please enter your username or email."),
		password: Yup.string(),
	});

	const form = useFormik({
		initialValues: {
			email: "",
			password: "",
		},
		validationSchema,
		onSubmit,
		validateOnBlur: false,
	});
	const getFieldHelpers = getFormHelpers(form);
	const emailField = getFieldHelpers("email");
	const passwordField = getFieldHelpers("password");
	const emailErrorId = "signin-email-error";
	const passwordErrorId = "signin-password-error";

	return (
		<form onSubmit={form.handleSubmit} className="flex flex-col gap-5">
			<div className="flex flex-col items-start gap-2">
				<Label htmlFor={emailField.id}>
					Username or email{" "}
					<span className="text-xs text-content-destructive font-bold">*</span>
				</Label>
				<Input
					id={emailField.id}
					name={emailField.name}
					value={emailField.value}
					onChange={onChangeTrimmed(form)}
					onBlur={emailField.onBlur}
					autoFocus={autoFocus}
					autoComplete="username"
					type="text"
					aria-invalid={Boolean(emailField.error)}
					aria-describedby={emailField.error ? emailErrorId : undefined}
				/>
				{emailField.error && (
					<span
						id={emailErrorId}
						className="text-xs text-content-destructive text-left"
					>
						{emailField.helperText}
					</span>
				)}
			</div>

			<div className="flex flex-col items-start gap-2">
				<Label htmlFor={passwordField.id}>
					Password{" "}
					<span className="text-xs text-content-destructive font-bold">*</span>
				</Label>
				<Input
					id={passwordField.id}
					name={passwordField.name}
					value={passwordField.value}
					onChange={passwordField.onChange}
					onBlur={passwordField.onBlur}
					autoComplete="current-password"
					type="password"
					aria-invalid={Boolean(passwordField.error)}
					aria-describedby={passwordField.error ? passwordErrorId : undefined}
				/>
				{passwordField.error && (
					<span
						id={passwordErrorId}
						className="text-xs text-content-destructive text-left"
					>
						{passwordField.helperText}
					</span>
				)}
			</div>

			{beforeSubmit}
			<div className="flex w-full gap-px [&>button:first-child]:flex-1 [&>button:first-child]:min-w-0">
				<Button
					size="lg"
					disabled={isSigningIn}
					className={submitOptions ? "rounded-r-none" : "w-full"}
					type="submit"
				>
					<Spinner loading={isSigningIn} />
					Sign In
				</Button>
				{submitOptions}
			</div>

			<Link
				asChild
				size="sm"
				showExternalIcon={false}
				className="flex items-center justify-center"
			>
				<RouterLink
					to={
						form.values.email.includes("@")
							? `/reset-password?email=${encodeURIComponent(form.values.email)}`
							: "/reset-password"
					}
					className="mx-auto"
				>
					Forgot password?
				</RouterLink>
			</Link>
		</form>
	);
};
