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
		{ id: string; name: string } | "all" | null
	>(null);
	const clearAll = selection === "all";
	const now = useNow();
	const rows = query.data?.migrations ?? [];
	return (
		<section
			aria-labelledby="workspace-migrations"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6 bg-surface-primary"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="workspace-migrations" className="m-0 text-base font-semibold">
					Workspace migrations
				</h2>
				{rows.some((m) => m.status === "done") && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setSelection("all")}
					>
						<ListXIcon aria-hidden />
						Clear finished history
					</Button>
				)}
			</div>
			{query.error ? <ErrorAlert error={query.error} /> : null}
			{hide.error ? <ErrorAlert error={hide.error} /> : null}
			<Table aria-label="Workspace migrations">
				<TableHeader>
					<TableRow>
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
							<TableCell colSpan={11}>
								{query.isLoading ? "Loading migrations." : "No migrations yet."}
							</TableCell>
						</TableRow>
					)}
					{rows.map((m) => {
						const name = m.workspaceName ?? m.workspaceId.slice(0, 8);
						return (
							<TableRow key={m.id}>
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
									{m.status === "done" && (
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
						? "Clear finished migration history?"
						: "Remove migration history entry?"
				}
				description={
					clearAll
						? "Remove all completed and canceled entries from this list. Active and resumable migrations will stay visible."
						: `Remove ${selection?.name ?? "this migration"} from the list? The workspace and its volumes will be kept.`
				}
				confirmText={clearAll ? "Clear history" : "Remove entry"}
				confirmLoading={hide.isPending}
				onClose={() => {
					if (!hide.isPending) setSelection(null);
				}}
				onConfirm={() => {
					if (!selection) return;
					hide.mutate(clearAll ? null : selection.id, {
						onSuccess: () => setSelection(null),
						onError: () => setSelection(null),
					});
				}}
			/>
		</section>
	);
};
