import { LeaseTokenSignInForm } from "./LeaseTokenSignInForm";
export const LeaseLoginPage = () => {
	return (
		<main className="mx-auto my-16 max-w-md rounded-xl border border-solid border-border p-6">
			<h1 className="text-xl">Short Term Lease</h1>
			<p>Enter the session token provided by your administrator.</p>
			<LeaseTokenSignInForm />
		</main>
	);
};
