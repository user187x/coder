import type { AuthMethods } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import {
	justSignedOut,
	SignInTitle,
	useLoginPageSettings,
} from "#/modules/platform/loginPage/SignInTitle";
import { getApplicationName } from "#/utils/appearance";
import { OAuthSignInForm } from "./OAuthSignInForm";
import { PasswordSignInForm } from "./PasswordSignInForm";

type SignInFormProps = {
	isSigningIn: boolean;
	redirectTo: string;
	error?: unknown;
	message?: React.ReactNode;
	authMethods?: AuthMethods;
	onSubmit: (credentials: { email: string; password: string }) => void;
};

export const SignInForm: React.FC<SignInFormProps> = ({
	authMethods,
	redirectTo,
	isSigningIn,
	error,
	message,
	onSubmit,
}) => {
	const oAuthEnabled = Boolean(authMethods?.oidc.enabled);
	const passwordEnabled = authMethods?.password.enabled ?? true;
	const applicationName = getApplicationName();
	const settings = useLoginPageSettings();

	return (
		<div className="w-full">
			{/* Platform: the title with its effect and message (Customize > Sign-in page), on signing in and after
			    signing out */}
			<SignInTitle
				settings={settings}
				applicationName={applicationName}
				signedOut={justSignedOut()}
			/>

			{Boolean(error) && (
				<div className="mb-8">
					<ErrorAlert error={error} showDebugDetail={false} />
				</div>
			)}

			{message && (
				<div className="mb-8">
					<Alert severity="info">{message}</Alert>
				</div>
			)}

			{oAuthEnabled && (
				<OAuthSignInForm
					isSigningIn={isSigningIn}
					redirectTo={redirectTo}
					authMethods={authMethods}
				/>
			)}

			{passwordEnabled && oAuthEnabled && (
				<div className="py-6 flex items-center gap-4">
					<div className="w-full h-px bg-border" />
					<div className="shrink-0 text-content-secondary uppercase text-xs tracking-widest">
						or
					</div>
					<div className="w-full h-px bg-border" />
				</div>
			)}

			{passwordEnabled && (
				<PasswordSignInForm
					onSubmit={onSubmit}
					autoFocus={!oAuthEnabled}
					isSigningIn={isSigningIn}
				/>
			)}

			{!passwordEnabled && !oAuthEnabled && (
				<Alert severity="error" prominent>
					No authentication methods configured!
				</Alert>
			)}
		</div>
	);
};
