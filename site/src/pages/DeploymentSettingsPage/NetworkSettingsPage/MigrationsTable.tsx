import { useQuery } from "react-query";
import "#/modules/workspaces/workspaceBarberPole.css";
import { workspaceMigrations } from "#/api/queries/workspaceMigrations";
import type { WorkspaceMigrationSummary } from "#/api/workspaceMigrations";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
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
	const now = useNow();
	const rows = query.data?.migrations ?? [];
	return (
		<section
			aria-labelledby="workspace-migrations"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6 bg-surface-primary"
		>
			<h2 id="workspace-migrations" className="m-0 text-base font-semibold">
				Workspace migrations
			</h2>
			{query.error ? <ErrorAlert error={query.error} /> : null}
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
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 && (
						<TableRow>
							<TableCell colSpan={10}>
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
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</section>
	);
};
