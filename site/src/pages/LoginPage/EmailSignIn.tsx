import { useId, useState } from "react";
import { useMutation } from "react-query";
import { requestEmailLogin, verifyEmailLogin } from "#/api/queries/users";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";

export const EmailSignIn = () => {
	const inputId = useId();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [token, setToken] = useState("");
	const request = useMutation(requestEmailLogin());
	const verify = useMutation({
		...verifyEmailLogin(),
		onSuccess: () => window.location.reload(),
	});
	if (!open)
		return (
			<Button
				variant="outline"
				className="mt-3 w-full"
				onClick={() => setOpen(true)}
			>
				Sign in by email
			</Button>
		);
	return (
		<form
			className="mt-3 flex flex-col gap-3 text-left"
			onSubmit={(event) => {
				event.preventDefault();
				if (request.isSuccess) verify.mutate({ email, token });
				else request.mutate(email);
			}}
		>
			<label htmlFor={inputId}>
				Email address
				<Input
					id={inputId}
					type="email"
					autoComplete="email"
					required
					value={email}
					readOnly={request.isSuccess || request.isPending}
					onChange={(event) => setEmail(event.target.value)}
				/>
			</label>
			{request.isSuccess && (
				<>
					<p role="status">
						If this account is eligible, a sign-in token will arrive by email.
						It expires in ten minutes.
					</p>
					<label htmlFor={`${inputId}-token`}>
						Sign-in token
						<Input
							required
							id={`${inputId}-token`}
							autoComplete="one-time-code"
							value={token}
							onChange={(event) => setToken(event.target.value)}
						/>
					</label>
				</>
			)}
			{(request.error || verify.error) && (
				<ErrorAlert
					error={request.error || verify.error}
					showDebugDetail={false}
				/>
			)}
			<Button type="submit" disabled={request.isPending || verify.isPending}>
				{request.isSuccess ? "Sign in with token" : "Email me a sign-in token"}
			</Button>
			<Button
				type="button"
				variant="subtle"
				onClick={() => {
					request.reset();
					verify.reset();
					setToken("");
					setOpen(false);
				}}
			>
				Cancel
			</Button>
		</form>
	);
};
