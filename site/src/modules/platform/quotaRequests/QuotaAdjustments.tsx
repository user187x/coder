import { type FC, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { organizations as organizationsQuery } from "#/api/queries/organizations";
import { decideQuotaRequest, quotaRequests } from "#/api/queries/quotaRequests";
import type { QuotaDecision, QuotaRequest } from "#/api/quotaRequests";
import type { Organization, User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import { Textarea } from "#/components/Textarea/Textarea";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { QuotaRequestDetails } from "./QuotaRequestDetails";

export type QuotaReviewProps = {
	requests: readonly QuotaRequest[];
	organizations?: readonly Pick<Organization, "id" | "name" | "display_name">[];
	busy?: boolean;
	onDecide: (
		request: QuotaRequest,
		action: QuotaDecision,
		reason: string,
	) => void;
};

export const QuotaRequestsView: FC<QuotaReviewProps> = ({
	requests,
	organizations,
	busy,
	onDecide,
}) => {
	const id = useId();
	const [reason, setReason] = useState("");
	return (
		<div className="flex flex-col gap-4">
			<p className="m-0 text-sm text-content-secondary">
				Approvals add to the developer’s personal global allowance across
				organizations. They remain until an admin revokes them. Revocation does
				not stop existing workspaces; further resource increases must fit the
				remaining quota.
			</p>
			{requests.some(
				(request) =>
					request.status === "pending" || request.status === "approved",
			) && (
				<>
					<Label htmlFor={id}>Review note (optional)</Label>
					<Textarea
						id={id}
						maxLength={2000}
						value={reason}
						disabled={busy}
						onChange={(event) => setReason(event.target.value)}
					/>
				</>
			)}
			{requests.length === 0 ? (
				<p className="text-sm text-content-secondary">No quota requests.</p>
			) : (
				requests.map((request) => (
					<section
						key={request.id}
						aria-label={`Quota request by ${request.username}`}
						className="rounded-md border border-solid border-border p-3"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<strong>{request.username}</strong>
							<span className="text-sm capitalize">{request.status}</span>
						</div>
						<div className="my-3">
							<QuotaRequestDetails
								request={request}
								organizations={organizations}
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							{request.status === "pending" && (
								<>
									<Button
										size="sm"
										disabled={busy}
										aria-label={`Approve request by ${request.username}`}
										onClick={() => onDecide(request, "approve", reason.trim())}
									>
										Approve
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										aria-label={`Deny request by ${request.username}`}
										onClick={() => onDecide(request, "deny", reason.trim())}
									>
										Deny
									</Button>
								</>
							)}
							{request.status === "approved" && (
								<Button
									size="sm"
									variant="destructive"
									disabled={busy}
									aria-label={`Revoke extra quota for ${request.username}`}
									onClick={() => onDecide(request, "revoke", reason.trim())}
								>
									Revoke extra quota
								</Button>
							)}
						</div>
					</section>
				))
			)}
		</div>
	);
};

/** Deployment owners review additive grants without editing the quota draft. */
export const QuotaAdjustments: FC<{
	user?: Pick<User, "id" | "username">;
}> = ({ user }) => {
	const [open, setOpen] = useState(false);
	const auth = useAuthenticated();
	const admin = auth.user.roles.some((role) => role.name === "owner");
	const query = useQuery({ ...quotaRequests(true), enabled: open && admin });
	const queryClient = useQueryClient();
	const decide = useMutation(decideQuotaRequest(queryClient));
	const organizations = useQuery({
		...organizationsQuery(),
		enabled: open && admin,
	});
	if (!admin) return null;
	const requests =
		query.data?.requests.filter(
			(request) => !user || request.user_id === user.id,
		) ?? [];
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					decide.reset();
					setOpen(true);
				}}
			>
				{user ? "Quota requests" : "Review extra quota requests"}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!decide.isPending) setOpen(next);
				}}
			>
				<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
					<DialogTitle>
						{user
							? `Quota requests: ${user.username}`
							: "Review extra quota requests"}
					</DialogTitle>
					<DialogDescription>
						Review requests and manage approved personal quota additions.
					</DialogDescription>
					{query.isError && <ErrorAlert error={query.error} />}
					{decide.isError && <ErrorAlert error={decide.error} />}
					{organizations.isError && (
						<>
							<ErrorAlert error={organizations.error} />
							<Button
								variant="outline"
								disabled={organizations.isFetching}
								onClick={() => void organizations.refetch()}
							>
								Retry organization names
							</Button>
						</>
					)}
					{query.isLoading ? (
						<p role="status">Loading quota requests…</p>
					) : (
						query.data && (
							<QuotaRequestsView
								requests={requests}
								organizations={organizations.data}
								busy={decide.isPending}
								onDecide={(request, action, reason) =>
									decide.mutate(
										{ request, action, reason },
										{
											onSuccess: () => toast.success("Quota request updated."),
										},
									)
								}
							/>
						)
					)}
					{query.isError && (
						<Button
							variant="outline"
							disabled={query.isFetching}
							onClick={() => void query.refetch()}
						>
							Retry quota requests
						</Button>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};
