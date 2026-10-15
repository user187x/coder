import { useState } from "react";
import { useLocation } from "react-router";
import type { AuthMethods, BuildInfoResponse } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { ProductLogo } from "#/components/Icons/ProductLogo";
import { Loader } from "#/components/Loader/Loader";
import { PlatformBackground } from "#/modules/platform/background/PlatformBackground";
import { SignInForm } from "./SignInForm";
import { TermsOfServiceLink } from "./TermsOfServiceLink";

type LoginPageViewProps = {
	authMethods: AuthMethods | undefined;
	error: unknown;
	isLoading: boolean;
	buildInfo?: BuildInfoResponse;
	isSigningIn: boolean;
	onSignIn: (credentials: { email: string; password: string }) => void;
	redirectTo: string;
};

export const LoginPageView: React.FC<LoginPageViewProps> = ({
	authMethods,
	error,
	isLoading,
	isSigningIn,
	onSignIn,
	redirectTo,
}) => {
	const location = useLocation();
	// This allows messages to be displayed at the top of the sign in form.
	// Helpful for any redirects that want to inform the user of something.
	const message = new URLSearchParams(location.search).get("message");
	const [tosAccepted, setTosAccepted] = useState(false);
	const tosAcceptanceRequired =
		authMethods?.terms_of_service_url && !tosAccepted;

	return (
		<div className="p-6 flex items-center justify-center min-h-full text-center">
			{/* Platform: the sign-in page's background image (Customize). */}
			<PlatformBackground slot="login" />
			<div className="w-full max-w-xs flex flex-col items-center gap-4">
				{/* Platform: the deployment's logo, large: the page's emblem, above the sign-in button. */}
				<ProductLogo className="h-28 max-w-[320px]" />
				{isLoading ? (
					<Loader />
				) : tosAcceptanceRequired ? (
					<>
						<TermsOfServiceLink url={authMethods.terms_of_service_url} />
						<Button
							size="lg"
							className="w-full"
							onClick={() => setTosAccepted(true)}
						>
							I agree
						</Button>
					</>
				) : (
					<SignInForm
						authMethods={authMethods}
						redirectTo={redirectTo}
						isSigningIn={isSigningIn}
						error={error}
						message={message}
						onSubmit={onSignIn}
					/>
				)}
				{/* Platform: no footer (copyright and version); the terms, once accepted, stay linked. */}
				{tosAccepted && (
					<div className="mt-6 text-xs text-content-secondary">
						<TermsOfServiceLink url={authMethods?.terms_of_service_url} />
					</div>
				)}
			</div>
		</div>
	);
};
