import { type FC, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { organizations as organizationsQuery } from "#/api/queries/organizations";
import { quotaMe } from "#/api/queries/platform";
import { createQuotaRequest, quotaRequests } from "#/api/queries/quotaRequests";
import type { CreateQuotaRequest } from "#/api/quotaRequests";
import type { Organization } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Textarea } from "#/components/Textarea/Textarea";
import { generateUUID } from "#/utils/random";
import { QuotaRequestDetails } from "./QuotaRequestDetails";

const resources = [
	{ key: "cpu", label: "Additional CPU cores" },
	{ key: "memory", label: "Additional memory (GiB)" },
	{ key: "workspaces", label: "Additional workspaces" },
] as const;

type Props = {
	organizations: readonly Pick<Organization, "id" | "name" | "display_name">[];
	requestId: string;
	busy?: boolean;
	onSubmit: (value: CreateQuotaRequest) => void;
};

export const QuotaRequestForm: FC<Props> = ({
	organizations,
	requestId,
	busy,
	onSubmit,
}) => {
	const id = useId();
	const [organization, setOrganization] = useState("");
	const [values, setValues] = useState({ cpu: "", memory: "", workspaces: "" });
	const [reason, setReason] = useState("");
	const selected = organization || organizations[0]?.id || "";
	const amounts = {
		cpu: Number(values.cpu),
		memory: Number(values.memory),
		workspaces: Number(values.workspaces),
	};
	const valid =
		organizations.some((org) => org.id === selected) &&
		Object.values(amounts).every(
			(value) => Number.isFinite(value) && value >= 0 && value <= 1_000_000,
		) &&
		Number.isInteger(amounts.workspaces) &&
		Object.values(amounts).some((value) => value > 0) &&
		reason.trim().length > 0;
	if (organizations.length === 0) {
		return (
			<p className="text-sm text-content-secondary">
				You need an organization membership before requesting extra quota. Ask
				an administrator to add you to an organization.
			</p>
		);
	}
	return (
		<form
			className="flex flex-col gap-4"
			aria-busy={busy}
			onSubmit={(event) => {
				event.preventDefault();
				if (valid && !busy) {
					onSubmit({
						organization_id: selected,
						request_id: requestId,
						resources: amounts,
						reason: reason.trim(),
					});
				}
			}}
		>
			<p className="m-0 text-sm text-content-secondary">
				An administrator must approve this request. Approved extras add to your
				personal global quota across organizations until an admin revokes them.
				Everyone else’s default quota stays the same. Request at least one
				resource and include a reason.
			</p>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${id}-organization`}>Organization</Label>
				<Select
					value={selected}
					onValueChange={setOrganization}
					disabled={busy}
				>
					<SelectTrigger id={`${id}-organization`}>
						<SelectValue placeholder="Choose an organization" />
					</SelectTrigger>
					<SelectContent>
						{organizations.map((org) => (
							<SelectItem key={org.id} value={org.id}>
								{org.display_name || org.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{resources.map(({ key, label }) => (
				<div key={key} className="flex flex-col gap-2">
					<Label htmlFor={`${id}-${key}`}>{label}</Label>
					<Input
						id={`${id}-${key}`}
						type="number"
						min={0}
						max={1_000_000}
						step={key === "workspaces" ? 1 : "any"}
						value={values[key]}
						disabled={busy}
						placeholder="0"
						onChange={(event) =>
							setValues({ ...values, [key]: event.target.value })
						}
					/>
				</div>
			))}
			<div className="flex flex-col gap-2">
				<Label htmlFor={`${id}-reason`}>Reason for extra quota</Label>
				<Textarea
					id={`${id}-reason`}
					value={reason}
					maxLength={2000}
					disabled={busy}
					onChange={(event) => setReason(event.target.value)}
				/>
			</div>
			<Button type="submit" disabled={!valid || busy}>
				{busy ? "Submitting…" : "Submit quota request"}
			</Button>
		</form>
	);
};

/** Developers submit requests without modifying global quota settings. */
export const QuotaRequestButton: FC = () => {
	const [open, setOpen] = useState(false);
	const [requestId, setRequestId] = useState("");
	const client = useQueryClient();
	const create = useMutation(createQuotaRequest(client));
	const organizations = useQuery({ ...organizationsQuery(), enabled: open });
	const own = useQuery({ ...quotaRequests(false), enabled: open });
	const quota = useQuery({ ...quotaMe(), enabled: open });
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					setRequestId(generateUUID());
					create.reset();
					setOpen(true);
				}}
			>
				Request extra quota
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!create.isPending) setOpen(next);
				}}
			>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogTitle>Request extra quota</DialogTitle>
					<DialogDescription>
						Request personal resource additions for administrator approval.
					</DialogDescription>
					{organizations.isError && (
						<>
							<ErrorAlert error={organizations.error} />
							<Button
								variant="outline"
								disabled={organizations.isFetching}
								onClick={() => void organizations.refetch()}
							>
								Retry organizations
							</Button>
						</>
					)}
					{create.isError && <ErrorAlert error={create.error} />}
					{organizations.isLoading ? (
						<p role="status">Loading organizations…</p>
					) : organizations.data ? (
						<QuotaRequestForm
							key={requestId}
							requestId={requestId}
							organizations={organizations.data ?? []}
							busy={create.isPending}
							onSubmit={(value) =>
								create.mutate(value, {
									onSuccess: () => {
										toast.success(
											"Quota request submitted for admin approval.",
										);
										setOpen(false);
									},
								})
							}
						/>
					) : null}
					{(quota.data?.exempt || quota.data?.limited === false) && (
						<p className="text-xs text-content-secondary">
							Your current quota is unlimited or exempt. An approval is recorded
							separately and does not turn an unlimited allowance into a finite
							cap.
						</p>
					)}
					{quota.isError && (
						<>
							<ErrorAlert error={quota.error} />
							<Button
								variant="outline"
								disabled={quota.isFetching}
								onClick={() => void quota.refetch()}
							>
								Retry current quota
							</Button>
						</>
					)}
					{own.isLoading && <p role="status">Loading your quota requests…</p>}
					{own.isError && (
						<>
							<ErrorAlert error={own.error} />
							<Button
								variant="outline"
								disabled={own.isFetching}
								onClick={() => void own.refetch()}
							>
								Retry your quota requests
							</Button>
						</>
					)}
					{own.data && (
						<section aria-label="Your quota requests">
							<h3 className="text-sm">Your quota requests</h3>
							{own.data.requests.length === 0 ? (
								<p className="text-sm text-content-secondary">
									No requests yet.
								</p>
							) : (
								<ul className="space-y-3 pl-4">
									{own.data.requests.map((request) => (
										<li key={request.id} className="text-sm">
											<p className="mb-2 mt-0 font-medium capitalize">
												{request.status}
											</p>
											<QuotaRequestDetails
												request={request}
												organizations={organizations.data}
											/>
										</li>
									))}
								</ul>
							)}
						</section>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};
