import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { organizations as organizationsQuery } from "#/api/queries/organizations";
import { createQuotaRequest } from "#/api/queries/quotaRequests";
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
import { Textarea } from "#/components/Textarea/Textarea";
import { generateUUID } from "#/utils/random";

/**
 * Cloud Drive > Settings > Capacity: ask an administrator for more storage in the user's own Cloud Drive. It is a
 * quota request (quotaRequests) of Cloud Drive GiB only; once approved, the drive holds that much more until it is
 * revoked.
 */
export const CloudDriveStorageRequest: React.FC = () => {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [requestId, setRequestId] = useState("");
	const [gib, setGib] = useState("");
	const [reason, setReason] = useState("");
	const client = useQueryClient();
	const create = useMutation(createQuotaRequest(client));
	const organizations = useQuery({ ...organizationsQuery(), enabled: open });
	const organization = organizations.data?.[0]?.id;
	const amount = Number(gib);
	const valid =
		Number.isInteger(amount) &&
		amount > 0 &&
		amount <= 1_000_000 &&
		reason.trim().length > 0 &&
		Boolean(organization);
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				className="self-start"
				onClick={() => {
					setRequestId(generateUUID());
					setGib("");
					setReason("");
					create.reset();
					setOpen(true);
				}}
			>
				<PlusIcon aria-hidden className="size-4" />
				Request more storage
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!create.isPending) setOpen(next);
				}}
			>
				<DialogContent>
					<DialogTitle>Request more Cloud Drive storage</DialogTitle>
					<DialogDescription>
						An administrator must approve it. Approved storage stays in your
						Cloud Drive until an administrator revokes it.
					</DialogDescription>
					{organizations.isError && <ErrorAlert error={organizations.error} />}
					{create.isError && <ErrorAlert error={create.error} />}
					{organizations.data && organizations.data.length === 0 && (
						<p className="m-0 text-sm text-content-secondary">
							You need an organization membership before requesting storage. Ask
							an administrator to add you to one.
						</p>
					)}
					<form
						className="flex flex-col gap-4"
						aria-busy={create.isPending}
						onSubmit={(event) => {
							event.preventDefault();
							if (!valid || create.isPending || !organization) return;
							create.mutate(
								{
									organization_id: organization,
									request_id: requestId,
									resources: {
										workspaces: 0,
										cpu: 0,
										memory: 0,
										disk: 0,
										cloudDrive: amount,
									},
									reason: reason.trim(),
								},
								{
									onSuccess: () => {
										toast.success(
											"Storage request submitted for admin approval.",
										);
										setOpen(false);
									},
								},
							);
						}}
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${id}-gib`}>Additional storage (GB)</Label>
							<Input
								id={`${id}-gib`}
								type="number"
								min={1}
								max={1_000_000}
								step={1}
								placeholder="0"
								value={gib}
								disabled={create.isPending}
								onChange={(event) => setGib(event.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${id}-reason`}>Reason</Label>
							<Textarea
								id={`${id}-reason`}
								maxLength={2000}
								value={reason}
								disabled={create.isPending}
								onChange={(event) => setReason(event.target.value)}
							/>
						</div>
						<Button type="submit" disabled={!valid || create.isPending}>
							{create.isPending ? "Submitting…" : "Submit storage request"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
};
