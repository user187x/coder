import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import {
	replaceLeaseToken,
	revealLeaseToken,
} from "#/api/queries/shortTermLeases";
import type { ShortTermLease } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { LeaseSignInLink } from "./LeaseSignInLink";

export const LeaseAccess = ({ lease }: { lease: ShortTermLease }) => {
	const client = useQueryClient();
	const reveal = useMutation(revealLeaseToken());
	const replace = useMutation(replaceLeaseToken(client));
	const [confirm, setConfirm] = useState(false);
	const token = replace.data?.token || reveal.data?.token;
	const pending = reveal.isPending || replace.isPending;
	const request = { org: lease.organization_id, user: lease.user_id };
	return (
		<div
			className="flex flex-col gap-2"
			role="group"
			aria-label={`Sign-in details for lease-${lease.user_id.slice(0, 8)}`}
		>
			<LeaseSignInLink />
			<div className="flex items-center gap-2">
				<span className="text-xs">lease-{lease.user_id.slice(0, 8)}</span>
				<Button
					size="sm"
					variant="outline"
					disabled={pending}
					onClick={() => {
						if (token) {
							reveal.reset();
							replace.reset();
						} else reveal.mutate(request);
					}}
				>
					{pending ? "Loading token…" : token ? "Hide token" : "Reveal token"}
				</Button>
				<Button
					size="sm"
					variant="subtle"
					disabled={pending}
					onClick={() => setConfirm(true)}
				>
					Replace token…
				</Button>
			</div>
			{token && (
				<CodeExample code={token} secret={false} copyLabel="Copy lease token" />
			)}
			{Boolean(reveal.error) && (
				<ErrorAlert error={reveal.error} showDebugDetail={false} />
			)}
			<Dialog
				open={confirm}
				onOpenChange={(open) => {
					if (!replace.isPending) setConfirm(open);
				}}
			>
				<DialogContent>
					<DialogTitle>Replace lease token</DialogTitle>
					<DialogDescription>
						The previous token and browser sessions will stop working. Give the
						new token to the tenant to sign in again.
					</DialogDescription>
					{Boolean(replace.error) && (
						<ErrorAlert error={replace.error} showDebugDetail={false} />
					)}
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							disabled={replace.isPending}
							onClick={() => setConfirm(false)}
						>
							Cancel
						</Button>
						<Button
							disabled={replace.isPending}
							onClick={() =>
								replace.mutate(request, {
									onSuccess: () => {
										reveal.reset();
										setConfirm(false);
									},
								})
							}
						>
							Replace token
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
};
