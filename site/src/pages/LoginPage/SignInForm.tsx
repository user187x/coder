import {
	ChevronDownIcon,
	KeyRoundIcon,
	TicketIcon,
	UserRoundIcon,
} from "lucide-react";
import { useState } from "react";
import type { AuthMethods } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	justSignedOut,
	SignInTitle,
	useLoginPageSettings,
} from "#/modules/platform/loginPage/SignInTitle";
import { LeaseTokenSignInForm } from "#/modules/platform/shortTermLeases/LeaseTokenSignInForm";
import { getApplicationName } from "#/utils/appearance";
import { EmailSignIn } from "./EmailSignIn";
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
	const [selection, setSelection] = useState("");
	const defaultMethod = passwordEnabled
		? "password"
		: oAuthEnabled
			? "oidc"
			: "lease";
	const method =
		(selection === "password" && passwordEnabled) ||
		(selection === "oidc" && oAuthEnabled) ||
		selection === "lease"
			? selection
			: defaultMethod;
	const methodMenu = (pending: boolean) => (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					size="lg"
					className="min-w-0 shrink-0 rounded-l-none px-3"
					aria-label="Choose sign-in method"
					disabled={pending}
				>
					<ChevronDownIcon aria-hidden />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" aria-label="Sign-in methods">
				<DropdownMenuRadioGroup value={method} onValueChange={setSelection}>
					{passwordEnabled && (
						<DropdownMenuRadioItem value="password">
							<UserRoundIcon aria-hidden className="mr-2 size-4" />
							Username and password
						</DropdownMenuRadioItem>
					)}
					{oAuthEnabled && (
						<DropdownMenuRadioItem value="oidc">
							<KeyRoundIcon aria-hidden className="mr-2 size-4" />
							{authMethods?.oidc.signInText || "OpenID Connect"}
						</DropdownMenuRadioItem>
					)}
					<DropdownMenuRadioItem value="lease">
						<TicketIcon aria-hidden className="mr-2 size-4" />
						Lease token
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);

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

			{method === "password" && (
				<PasswordSignInForm
					onSubmit={onSubmit}
					autoFocus={!oAuthEnabled}
					isSigningIn={isSigningIn}
					submitOptions={methodMenu(isSigningIn)}
				/>
			)}
			{method === "oidc" && (
				<div
					className="flex w-full gap-px"
					role="group"
					aria-label="Provider sign-in"
				>
					<OAuthSignInForm
						compact
						isSigningIn={isSigningIn}
						redirectTo={redirectTo}
						authMethods={authMethods}
					/>
					{methodMenu(isSigningIn)}
				</div>
			)}
			{method === "lease" && (
				<LeaseTokenSignInForm submitOptions={methodMenu} />
			)}

			{authMethods?.email_login && <EmailSignIn />}
		</div>
	);
};
