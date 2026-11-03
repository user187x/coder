import { ServerIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { createWorkerNode, nodeOperator } from "#/api/nodeProvisioning";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";
import { useDashboard } from "#/modules/dashboard/useDashboard";

export const CreateNode = () => {
	const { organizations } = useDashboard();
	const [open, setOpen] = useState(false);
	const [org, setOrg] = useState("");
	const organization =
		org ||
		organizations.find((o) => o.is_default)?.id ||
		organizations[0]?.id ||
		"";
	const [picked, setPicked] = useState("");
	const query = useQuery({
		...nodeOperator(organization),
		enabled: open && Boolean(organization),
	});
	const client = useQueryClient();
	const mutation = useMutation({
		...createWorkerNode(organization),
		onSettled: () =>
			client.invalidateQueries({
				queryKey: nodeOperator(organization).queryKey,
			}),
	});
	const operator = query.data;
	const profile =
		operator?.profiles.find((p) => p.id === picked) ?? operator?.profiles[0];
	const operation = operator?.operation;
	const busy =
		operation?.phase === "queued" || operation?.phase === "provisioning";
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<ServerIcon aria-hidden />
					Create node
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogTitle>Add a worker node</DialogTitle>
				<DialogDescription>
					Add one worker to this cluster. Local providers consume host
					resources. AWS workers incur charges until they are removed.
				</DialogDescription>
				{organizations.length > 1 && (
					<label className="flex flex-col gap-1 text-sm">
						Organization
						<select
							value={organization}
							onChange={(e) => {
								setOrg(e.target.value);
								setPicked("");
								mutation.reset();
							}}
							className="rounded-md border border-border bg-surface-primary p-2"
						>
							{organizations.map((o) => (
								<option key={o.id} value={o.id}>
									{o.display_name || o.name}
								</option>
							))}
						</select>
					</label>
				)}
				{query.isLoading && <p role="status">Checking available providers…</p>}
				{query.error && (
					<p role="alert">
						{query.error instanceof Error
							? query.error.message
							: "Could not check the node operator."}
					</p>
				)}
				{operator && !operator.online && (
					<p role="status">
						Connect the host node provisioner for this organization to enable
						node creation.
					</p>
				)}
				{profile && (
					<label className="flex flex-col gap-1 text-sm">
						Provisioning target
						<select
							className="rounded-md border border-border bg-surface-primary p-2"
							value={profile.id}
							onChange={(e) => setPicked(e.target.value)}
							disabled={busy || mutation.isPending}
						>
							{operator?.profiles.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</select>
					</label>
				)}
				{operation && (
					<p
						role="status"
						className="rounded-md border border-solid border-border p-3 text-sm"
					>
						<strong className="capitalize">{operation.phase}</strong> ·{" "}
						{operation.message}
					</p>
				)}
				{mutation.error && <p role="alert">{mutation.error.message}</p>}
				<div className="flex justify-end gap-2">
					<DialogClose asChild>
						<Button variant="outline">Close</Button>
					</DialogClose>
					<Button
						disabled={
							!profile ||
							!operator?.online ||
							query.isError ||
							busy ||
							mutation.isPending
						}
						onClick={() => {
							if (profile)
								mutation.mutate({
									id: crypto.randomUUID(),
									profile: profile.id,
									previous: operation?.id ?? null,
								});
						}}
					>
						{mutation.isPending ? "Submitting…" : "Create one node"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
