import { useId, useState } from "react";
import { useMutation } from "react-query";
import { getErrorStatus } from "#/api/errors";
import { leaseLogin } from "#/api/queries/shortTermLeases";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";

export const LeaseTokenSignInForm = ({
	submitOptions,
}: {
	submitOptions?: (pending: boolean) => React.ReactNode;
}) => {
	const tokenId = useId();
	const [token, setToken] = useState("");
	const login = useMutation(leaseLogin());
	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (!token.trim() || login.isPending) return;
				const submitted = token.trim();
				// Drop the token from state as soon as it is submitted.
				setToken("");
				login.mutate(submitted, {
					onSuccess: () => window.location.assign("/"),
				});
			}}
		>
			{login.error &&
				(getErrorStatus(login.error) === 429 ? (
					<ErrorAlert
						error={new Error("Too many attempts. Wait a moment and try again.")}
						showDebugDetail={false}
					/>
				) : (
					<ErrorAlert error={login.error} showDebugDetail={false} />
				))}
			<div className="flex flex-col items-start gap-2">
				<Label htmlFor={tokenId}>Lease token</Label>
				<Input
					id={tokenId}
					type="password"
					autoComplete="off"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					disabled={login.isPending}
					required
				/>
				<p className="m-0 text-left text-xs text-content-secondary">
					Enter the token provided by your administrator.
				</p>
			</div>
			<div
				className="flex w-full gap-px"
				role="group"
				aria-label="Lease sign-in"
			>
				<Button
					size="lg"
					type="submit"
					className={`min-w-0 flex-1 ${submitOptions ? "rounded-r-none" : ""}`}
					disabled={!token.trim() || login.isPending}
				>
					<Spinner loading={login.isPending} />
					Sign In
				</Button>
				{submitOptions?.(login.isPending)}
			</div>
		</form>
	);
};
