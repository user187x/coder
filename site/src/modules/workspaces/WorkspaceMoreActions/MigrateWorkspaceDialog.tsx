import { cn } from "cn";
import {
	ArrowRightIcon,
	CheckIcon,
	GripVerticalIcon,
	ServerIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	migrateWorkspace,
	workspaceMigrationKey,
	workspaceMigrationPlan,
} from "#/api/queries/workspaceMigrations";
import type { Workspace } from "#/api/typesGenerated";
import type { MigrationNode } from "#/api/workspaceMigrations";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";

const bytes = (n: number | null) =>
	n === null
		? "Unknown"
		: `${(n / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 1 })} GiB`;
const cores = (n: number | null) =>
	n === null
		? "Unknown"
		: n.toLocaleString("en-US", { maximumFractionDigits: 1 });

const NodeDetails = ({ node }: { node: MigrationNode }) => (
	<>
		<span className="flex items-center gap-2 font-medium">
			<ServerIcon className="size-4 shrink-0" />
			{node.name}
		</span>
		<span className="mt-1 block text-xs text-content-secondary">
			{node.ips.join(" · ") || "IP unavailable"}
		</span>
		<dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
			<div>
				<dt className="text-content-secondary">CPU used / cores</dt>
				<dd className="m-0 mt-1">
					{cores(node.cpu.used)} / {cores(node.cpu.total)}
				</dd>
			</div>
			<div>
				<dt className="text-content-secondary">Memory used / total</dt>
				<dd className="m-0 mt-1">
					{bytes(node.memory.used)} / {bytes(node.memory.total)}
				</dd>
			</div>
			<div>
				<dt className="text-content-secondary">Disk used / total</dt>
				<dd className="m-0 mt-1">
					{bytes(node.disk.used)} / {bytes(node.disk.total)}
				</dd>
			</div>
			<div>
				<dt className="text-content-secondary">Disk remaining</dt>
				<dd className="m-0 mt-1">{bytes(node.disk.free)}</dd>
			</div>
		</dl>
	</>
);

export const MigrateWorkspaceDialog = ({
	workspace,
	open,
	onClose,
}: {
	workspace: Pick<Workspace, "id" | "name">;
	open: boolean;
	onClose: () => void;
}) => {
	const [target, setTarget] = useState<string>();
	const [dragging, setDragging] = useState(false);
	const client = useQueryClient();
	const query = useQuery({
		...workspaceMigrationPlan(workspace.id),
		enabled: open,
		retry: false,
		refetchInterval: (q) =>
			q.state.data?.operation?.status === "running" ? 2000 : 15000,
	});
	const mutation = useMutation({
		...migrateWorkspace(workspace.id),
		onSuccess: ({ operation }) => {
			client.setQueryData(
				workspaceMigrationKey(workspace.id),
				(old: typeof query.data) => (old ? { ...old, operation } : old),
			);
		},
		onSettled: () =>
			client.invalidateQueries({
				queryKey: workspaceMigrationKey(workspace.id),
			}),
	});
	const data = query.data;
	const op = data?.operation;
	const active = Boolean(op && op.status !== "done");
	const busy = mutation.isPending || op?.status === "running";
	const selected = data?.nodes.find(
		(node) => node.name === target && node.eligible,
	);
	const source = data?.nodes.find((node) => node.name === data.sourceNode);
	const select = (node: MigrationNode) => {
		if (node.eligible && !busy && !active) setTarget(node.name);
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] max-w-4xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Migrate Workspace</DialogTitle>
					<DialogDescription>
						Move {workspace.name} and its home data to another cluster node.
					</DialogDescription>
				</DialogHeader>
				{query.isLoading && <Loader />}
				{query.error && (
					<div
						role="alert"
						className="rounded-lg border border-content-destructive/30 p-4 text-sm text-content-destructive"
					>
						{getErrorMessage(
							query.error,
							"Could not load migration destinations.",
						)}
						<Button
							variant="outline"
							size="sm"
							className="ml-3"
							onClick={() => void query.refetch()}
						>
							Retry
						</Button>
					</div>
				)}
				{data && (
					<div className="space-y-5">
						<div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
							<div className="rounded-xl border border-border-default bg-surface-secondary p-4">
								<p className="mt-0 text-xs font-medium uppercase tracking-wide text-content-secondary">
									Current node
								</p>
								{source ? (
									<NodeDetails node={source} />
								) : (
									<span className="text-sm">{data.sourceNode}</span>
								)}
							</div>
							<ArrowRightIcon className="hidden size-5 text-content-secondary md:block" />
							<div
								draggable={!active && !busy}
								onDragStart={(event) => {
									event.dataTransfer.setData(
										"application/x-coder-workspace",
										workspace.id,
									);
									event.dataTransfer.effectAllowed = "move";
									setDragging(true);
								}}
								onDragEnd={() => setDragging(false)}
								className={cn(
									"rounded-xl border border-dashed border-border-default p-4",
									!active && !busy && "cursor-grab active:cursor-grabbing",
								)}
							>
								<span className="flex items-center gap-2 font-medium">
									<GripVerticalIcon className="size-4 text-content-secondary" />
									{workspace.name}
								</span>
								<p className="mb-1 text-sm">
									Home used: {bytes(data.homeUsedBytes)} /{" "}
									{bytes(data.diskBytes)} allocated
								</p>
								<p className="m-0 text-xs leading-relaxed text-content-secondary">
									Drag this workspace onto an available node, or select a node
									below.
								</p>
							</div>
						</div>
						{!active && (
							<>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<h3 className="m-0 text-sm font-medium">Destination nodes</h3>
									<span className="text-xs text-content-secondary">
										Measured{" "}
										{new Date(data.generatedAt).toLocaleTimeString("en-US", {
											hour: "numeric",
											minute: "2-digit",
											second: "2-digit",
										})}
									</span>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									{data.nodes
										.filter((node) => node.name !== data.sourceNode)
										.map((node) => (
											<button
												key={node.name}
												type="button"
												aria-label={`Migrate to ${node.name}`}
												aria-pressed={selected?.name === node.name}
												aria-disabled={!node.eligible || busy}
												onClick={() => select(node)}
												onDragOver={(event) => {
													if (
														node.eligible &&
														!busy &&
														event.dataTransfer.types.includes(
															"application/x-coder-workspace",
														)
													) {
														event.preventDefault();
														event.dataTransfer.dropEffect = "move";
													}
												}}
												onDrop={(event) => {
													event.preventDefault();
													if (
														event.dataTransfer.getData(
															"application/x-coder-workspace",
														) === workspace.id
													)
														select(node);
													setDragging(false);
												}}
												className={cn(
													"rounded-xl border border-solid bg-surface-primary p-4 text-left text-content-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link",
													node.eligible
														? "cursor-pointer hover:bg-surface-secondary"
														: "cursor-not-allowed opacity-50",
													selected?.name === node.name
														? "border-content-link bg-surface-secondary"
														: "border-border-default",
													dragging && node.eligible && "border-content-link",
												)}
											>
												<NodeDetails node={node} />
												{node.needs && (
													<span className="mt-3 block text-xs text-content-secondary">
														Needs {cores(node.needs.cpu)} cores,{" "}
														{bytes(node.needs.memory)} memory and{" "}
														{bytes(node.needs.disk)} disk
													</span>
												)}
												<span
													className={cn(
														"mt-4 flex min-h-5 items-center gap-1.5 text-xs",
														node.eligible
															? "text-content-success"
															: "text-content-secondary",
													)}
												>
													{selected?.name === node.name ? (
														<>
															<CheckIcon className="size-3" />
															Selected destination
														</>
													) : node.eligible ? (
														"Available"
													) : (
														node.reasons.join(". ")
													)}
												</span>
											</button>
										))}
								</div>
								{data.nodes.length < 2 && (
									<p className="text-sm text-content-secondary">
										No other cluster nodes are available.
									</p>
								)}
								<p className="rounded-lg bg-surface-secondary p-3 text-sm leading-relaxed">
									{selected
										? `Move ${workspace.name} from ${data.sourceNode} to ${selected.name}. `
										: "Select a destination to review the migration. "}
									The workspace will stop while its home is copied and verified.
									Its original disk will remain as a recovery copy. Capacity is
									checked again before copying.
								</p>
							</>
						)}
						{op && (
							<div
								role="status"
								aria-live="polite"
								className="rounded-lg border border-border-default bg-surface-secondary p-4 text-sm"
							>
								<span className="flex items-center gap-2 font-medium">
									{op.status === "running" && <Spinner loading size="sm" />}
									{op.sourceNode} → {op.target}
								</span>
								<p className="mb-0 leading-relaxed">
									{op.status === "interrupted"
										? "The migration was interrupted. Resume to continue from its last saved step."
										: op.error || op.message}
								</p>
								{op.retainedVolume && (
									<p className="mb-0 break-all text-xs text-content-secondary">
										Original recovery volume: {op.retainedVolume}
									</p>
								)}
								{op.status === "running" && (
									<p className="mb-0 text-xs text-content-secondary">
										You can close this dialog and reopen it to check progress.
									</p>
								)}
							</div>
						)}
					</div>
				)}
				{mutation.error && (
					<p role="alert" className="text-sm text-content-destructive">
						{getErrorMessage(
							mutation.error,
							"Could not submit migration. Refresh to check its status.",
						)}
					</p>
				)}
				<DialogFooter>
					{op &&
						(op.status === "failed" || op.status === "interrupted") &&
						(op.phase === "prepare" || op.phase === "copy") && (
							<Button
								variant="outline"
								disabled={mutation.isPending}
								onClick={() => mutation.mutate({ cancel: true })}
							>
								Cancel migration
							</Button>
						)}
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
					{op && (op.status === "failed" || op.status === "interrupted") ? (
						<Button
							disabled={mutation.isPending}
							onClick={() => mutation.mutate({ resume: true })}
						>
							Resume migration
						</Button>
					) : (
						!active && (
							<Button
								disabled={!selected || busy || query.isError}
								onClick={() => {
									if (selected) mutation.mutate({ target: selected.name });
								}}
							>
								Stop and migrate
							</Button>
						)
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
