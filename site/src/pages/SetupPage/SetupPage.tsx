import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { Navigate } from "react-router";
import { authMethods, createFirstUser } from "#/api/queries/users";
import { Loader } from "#/components/Loader/Loader";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import { pageTitle } from "#/utils/page";
import { SetupPageView } from "./SetupPageView";

export const SetupPage: React.FC = () => {
	const {
		isLoading,
		signIn,
		isConfiguringTheFirstUser,
		isSignedIn,
		isSigningIn,
	} = useAuthContext();
	const authMethodsQuery = useQuery(authMethods());
	const createFirstUserMutation = useMutation(createFirstUser());
	const setupIsComplete = !isConfiguringTheFirstUser;
	const [setupRequired, setSetupRequired] = useState(false);

	if (isLoading || authMethodsQuery.isLoading) {
		return <Loader fullscreen />;
	}

	// If the user is logged in, navigate to the app
	if (isSignedIn) {
		return setupRequired ? (
			<Navigate to="/templates/new/builder" replace />
		) : (
			<Navigate to="/" state={{ isRedirect: true }} replace />
		);
	}

	// If we've already completed setup, navigate to the login page
	if (setupIsComplete) {
		return <Navigate to="/login" state={{ isRedirect: true }} replace />;
	}

	if (!setupRequired) {
		setSetupRequired(true);
	}

	return (
		<>
			<title>{pageTitle("Set up your account")}</title>
			<SetupPageView
				authMethods={authMethodsQuery.data}
				isLoading={isSigningIn || createFirstUserMutation.isPending}
				error={createFirstUserMutation.error}
				onSubmit={async (firstUser) => {
					await createFirstUserMutation.mutateAsync(firstUser);
					await signIn(firstUser.email, firstUser.password);
				}}
			/>
		</>
	);
};
