import { useQuery } from "react-query";
import { Navigate, useLocation } from "react-router";
import { buildInfo } from "#/api/queries/buildInfo";
import { authMethods } from "#/api/queries/users";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { getApplicationName } from "#/utils/appearance";
import { retrieveRedirect, sanitizeRedirect } from "#/utils/redirect";
import { LoginPageView } from "./LoginPageView";

const LoginPage: React.FC = () => {
	const routerLocation = useLocation();
	const {
		isLoading,
		isSignedIn,
		isConfiguringTheFirstUser,
		signIn,
		isSigningIn,
		signInError,
	} = useAuthContext();
	const authMethodsQuery = useQuery(authMethods());
	const redirectTo = retrieveRedirect(routerLocation.search);
	const applicationName = getApplicationName();
	const { metadata } = useEmbeddedMetadata();
	const buildInfoQuery = useQuery(buildInfo(metadata["build-info"]));
	let redirectError: Error | null = null;

	const isApiRouteRedirect =
		redirectTo.startsWith("/api/v2") ||
		redirectTo.startsWith("/oauth2/authorize");

	if (isSignedIn) {
		// The reason we need `location.href` for api redirects is that
		// we need the page to reload and make a request to the backend. If we
		// use `<Navigate>`, react would handle the redirect itself and never
		// request the page from the backend.
		if (isApiRouteRedirect) {
			location.href = sanitizeRedirect(redirectTo);
			// Setting the href should immediately request a new page. Show an
			// error state if it doesn't.
			redirectError = new Error("unable to redirect");
		} else {
			return <Navigate to={sanitizeRedirect(redirectTo)} replace />;
		}
	}

	if (isConfiguringTheFirstUser) {
		return <Navigate to="/setup" replace />;
	}

	return (
		<>
			<title>Sign in to {applicationName}</title>
			{/* Shown when the admin allowed it on the sign-in page. */}
			<AnnouncementBanner placement="login" />
			<LoginPageView
				authMethods={authMethodsQuery.data}
				error={signInError ?? redirectError}
				isLoading={isLoading || authMethodsQuery.isLoading}
				buildInfo={buildInfoQuery.data}
				isSigningIn={isSigningIn}
				onSignIn={async ({ email, password }) => {
					await signIn(email, password);
					// Use a hard reload instead of React Router navigation
					// so the server re-renders the HTML with all metadata
					// tags populated (userAppearance, user, permissions,
					// etc.) using the new session cookie.
					location.href = sanitizeRedirect(redirectTo);
				}}
				redirectTo={redirectTo}
			/>
		</>
	);
};

export default LoginPage;
