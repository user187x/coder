import { ListXIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import "#/modules/workspaces/workspaceBarberPole.css";
import {
	hideWorkspaceMigrationHistory,
	workspaceMigrations,
} from "#/api/queries/workspaceMigrations";
import type { WorkspaceMigrationSummary } from "#/api/workspaceMigrations";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import LinearProgress from "#/components/LinearProgress/LinearProgress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { ago, bytes, useNow } from "#/modules/platform/ClusterVisuals";

const stateLabel = (m: WorkspaceMigrationSummary) =>
	m.phase === "canceled"
		? "Canceled"
		: {
				running: "Running",
				failed: "Failed",
				interrupted: "Interrupted",
				done: "Complete",
			}[m.status];

/** Workspace migrations, newest first, with the share of the home volume copied. */
export const MigrationsTable: React.FC = () => {
	const query = useQuery(workspaceMigrations());
	const client = useQueryClient();
	const hide = useMutation(hideWorkspaceMigrationHistory(client));
	const [selection, setSelection] = useState<
		{ id: string; name: string } | { ids: string[] } | "all" | null
	>(null);
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const clearAll = selection === "all";
	const bulk = selection !== null && selection !== "all" && "ids" in selection;
	const now = useNow();
	const rows = query.data?.migrations ?? [];
	const removable = rows.filter((row) => row.status !== "running");
	const selectedIds = removable
		.filter((row) => checked.has(row.id))
		.map((row) => row.id);
	const allChecked =
		selectedIds.length > 0 && selectedIds.length === removable.length;
	return (
		<section
			aria-labelledby="workspace-migrations"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6 bg-surface-primary"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="workspace-migrations" className="m-0 text-base font-semibold">
					Workspace migrations
				</h2>
				<div className="flex flex-wrap gap-2">
					{selectedIds.length > 0 && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setSelection({ ids: selectedIds })}
						>
							<ListXIcon aria-hidden />
							Remove selected ({selectedIds.length})
						</Button>
					)}
					{removable.length > 0 && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setSelection("all")}
						>
							<ListXIcon aria-hidden />
							Clear inactive history
						</Button>
					)}
				</div>
			</div>
			{query.error ? <ErrorAlert error={query.error} /> : null}
			{hide.error ? <ErrorAlert error={hide.error} /> : null}
			<Table aria-label="Workspace migrations">
				<TableHeader>
					<TableRow>
						<TableHead>
							<Checkbox
								aria-label="Select all inactive migrations"
								disabled={removable.length === 0 || hide.isPending}
								checked={
									allChecked || (selectedIds.length > 0 && "indeterminate")
								}
								onCheckedChange={(next) =>
									setChecked(
										next === true
											? new Set(removable.map((row) => row.id))
											: new Set(),
									)
								}
							/>
						</TableHead>
						{[
							"Workspace",
							"From",
							"To",
							"CPU",
							"Memory",
							"Disk",
							"State",
							"Progress",
							"Started",
							"Duration",
						].map((label) => (
							<TableHead key={label}>{label}</TableHead>
						))}
						<TableHead>
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 && (
						<TableRow>
							<TableCell colSpan={12}>
								{query.isLoading ? "Loading migrations." : "No migrations yet."}
							</TableCell>
						</TableRow>
					)}
					{rows.map((m) => {
						const name = m.workspaceName ?? m.workspaceId.slice(0, 8);
						return (
							<TableRow key={m.id}>
								<TableCell>
									{m.status !== "running" && (
										<Checkbox
											aria-label={`Select migration for ${name}`}
											disabled={hide.isPending}
											checked={checked.has(m.id)}
											onCheckedChange={(next) =>
												setChecked((previous) => {
													const ids = new Set(previous);
													if (next === true) ids.add(m.id);
													else ids.delete(m.id);
													return ids;
												})
											}
										/>
									)}
								</TableCell>
								<TableCell>{name}</TableCell>
								<TableCell>{m.sourceNode ?? "N/A"}</TableCell>
								<TableCell>{m.target ?? "N/A"}</TableCell>
								<TableCell>
									{m.cpu === null ? "N/A" : `${m.cpu} cores`}
								</TableCell>
								<TableCell>{bytes(m.memoryBytes)}</TableCell>
								<TableCell>{bytes(m.diskBytes)}</TableCell>
								<TableCell title={m.error ?? undefined}>
									{stateLabel(m)}
								</TableCell>
								<TableCell className="min-w-40">
									<LinearProgress
										variant="determinate"
										striped={m.status === "running"}
										value={m.percent}
										aria-label={`Migration progress for ${name}`}
									/>
									<span className="text-xs text-content-secondary">
										{m.percent}% copied{m.phase ? `, ${m.phase}` : ""}
									</span>
								</TableCell>
								<TableCell>{ago(m.startedAt, now)} ago</TableCell>
								<TableCell>
									{ago(
										m.startedAt,
										m.status === "running" ? now : Date.parse(m.updatedAt),
									)}
								</TableCell>
								<TableCell>
									{m.status !== "running" && (
										<Button
											size="icon"
											variant="subtle"
											aria-label={`Remove migration history for ${name}`}
											onClick={() => setSelection({ id: m.id, name })}
										>
											<XIcon aria-hidden />
										</Button>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
			<ConfirmDialog
				type="delete"
				open={selection !== null}
				title={
					clearAll
						? "Clear inactive migration history?"
						: bulk
							? "Remove selected migrations?"
							: "Remove migration history entry?"
				}
				description={
					clearAll
						? "Remove inactive entries from this list. Running migrations stay visible."
						: bulk
							? `Remove ${selection.ids.length} selected entries from the list? The workspaces and their volumes will be kept.`
							: `Remove ${selection?.name ?? "this migration"} from the list? The workspace and its volumes will be kept.`
				}
				confirmText={
					clearAll ? "Clear history" : bulk ? "Remove selected" : "Remove entry"
				}
				confirmLoading={hide.isPending}
				onClose={() => {
					if (!hide.isPending) setSelection(null);
				}}
				onConfirm={() => {
					if (!selection) return;
					const target =
						selection === "all"
							? null
							: "ids" in selection
								? selection.ids
								: selection.id;
					hide.mutate(target, {
						onSuccess: () => {
							setChecked((previous) => {
								if (target === null) return new Set();
								const removed = new Set(
									typeof target === "string" ? [target] : target,
								);
								return new Set([...previous].filter((id) => !removed.has(id)));
							});
							setSelection(null);
						},
						onError: () => setSelection(null),
					});
				}}
			/>
		</section>
	);
};
