import { useId, useState } from "react";
import { useMutation } from "react-query";
import { leaseLogin } from "#/api/queries/shortTermLeases";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
export const LeaseLoginPage = () => {
	const tokenId = useId();
	const [token, setToken] = useState("");
	const login = useMutation(leaseLogin());
	return (
		<main className="mx-auto my-16 max-w-md rounded-xl border border-solid border-border p-6">
			<h1 className="text-xl">Short Term Lease</h1>
			<p>Enter the session token provided by your administrator.</p>
			{login.error && <ErrorAlert error={login.error} />}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					login.mutate(token.trim(), {
						onSuccess: () => window.location.assign("/workspaces"),
					});
				}}
			>
				<Label htmlFor={tokenId}>Session token</Label>
				<Input
					id={tokenId}
					type="password"
					autoComplete="off"
					value={token}
					onChange={(e) => setToken(e.target.value)}
				/>
				<Button
					className="mt-4"
					type="submit"
					disabled={!token.trim() || login.isPending}
				>
					Open Browser workspace
				</Button>
			</form>
		</main>
	);
};
