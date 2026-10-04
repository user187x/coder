import { cn } from "cn";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useNavigate } from "react-router";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import { TableLoader } from "#/components/TableLoader/TableLoader";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import {
	type UnhealthyWorkspace,
	useUnhealthyWorkspaces,
} from "#/modules/platform/workspaceHealth/workspaceHealth";
import { pageTitle } from "#/utils/page";
import { Header, HeaderTitle, Main } from "./Content";

/**
 * Health > Workspace Health: the workspaces whose latest build failed or whose
 * agents are unhealthy. Nothing is stored: it is read from Coder's own
 * workspaces API every 30 seconds. A row opens the workspace.
 */
const WorkspaceHealthPage: React.FC = () => {
	const { unhealthy, error, dataUpdatedAt } = useUnhealthyWorkspaces();
	const worst = !unhealthy
		? undefined
		: unhealthy.some((w) => w.severity === "error")
			? "error"
			: unhealthy.length
				? "warning"
				: "ok";

	return (
		<>
			<title>{pageTitle("Workspace Health - Health")}</title>

			<Header>
				<HeaderTitle>
					{worst === "ok" ? (
						<CircleCheckIcon aria-hidden className="size-4 text-content-link" />
					) : worst ? (
						<TriangleAlertIcon
							aria-hidden
							className={cn(
								"size-4",
								worst === "error"
									? "text-content-destructive"
									: "text-content-warning",
							)}
						/>
					) : null}
					Workspace Health
				</HeaderTitle>
				{unhealthy && (
					<Badge
						variant={
							worst === "error"
								? "destructive"
								: worst === "warning"
									? "warning"
									: "default"
						}
					>
						{unhealthy.length
							? `${unhealthy.length} ${unhealthy.length === 1 ? "needs" : "need"} attention`
							: "All healthy"}
					</Badge>
				)}
			</Header>

			<Main>
				{error ? <ErrorAlert error={error} /> : null}
				<Table aria-label="Unhealthy or failed workspaces">
					<TableHeader>
						<TableRow>
							<TableHead>Workspace</TableHead>
							<TableHead>Problem</TableHead>
							<TableHead>Template</TableHead>
							<TableHead>Last build</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{!unhealthy && !error ? (
							<TableLoader />
						) : unhealthy?.length ? (
							unhealthy.map((w) => (
								<WorkspaceHealthRow key={w.id} workspace={w} />
							))
						) : (
							<TableEmpty message="Nothing to triage: no workspace has failed or become unhealthy." />
						)}
					</TableBody>
				</Table>
				<p className="m-0 text-xs text-content-secondary" data-pixel="ignore">
					Select a workspace to open it. Checked every 30 seconds
					{dataUpdatedAt
						? `, last at ${new Date(dataUpdatedAt).toLocaleTimeString("en-US")}`
						: ""}
					.
				</p>
			</Main>
		</>
	);
};

const WorkspaceHealthRow: React.FC<{ workspace: UnhealthyWorkspace }> = ({
	workspace: w,
}) => {
	const navigate = useNavigate();
	const href = `/@${encodeURIComponent(w.owner)}/${encodeURIComponent(w.name)}`;
	const clickable = useClickableTableRow({
		onClick: () => navigate(href),
		onMiddleClick: () => window.open(href, "_blank", "noopener"),
	});

	return (
		<TableRow {...clickable}>
			<TableCell>
				<div className="flex flex-col">
					<span className="flex items-center gap-2 font-semibold">
						<span
							aria-hidden
							className={cn(
								"size-2 shrink-0 rounded-full",
								w.severity === "error"
									? "bg-content-destructive"
									: "bg-content-warning",
							)}
						/>
						{w.owner} / {w.name}
					</span>
					<span className="text-xs text-content-secondary">
						status: {w.status}
					</span>
				</div>
			</TableCell>
			<TableCell>{w.problems.map((p) => p.text).join("; ")}</TableCell>
			<TableCell>{w.template || "N/A"}</TableCell>
			<TableCell>
				{w.updatedAt ? new Date(w.updatedAt).toLocaleString("en-US") : "N/A"}
			</TableCell>
		</TableRow>
	);
};

export default WorkspaceHealthPage;
