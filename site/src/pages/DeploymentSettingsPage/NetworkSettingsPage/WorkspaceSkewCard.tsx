import { cn } from "cn";
import type { ClusterNetworkReport } from "#/api/clusterNetwork";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

const MIN_ROWS = 6;
const LABEL_MAX = 12;

type SkewWorkspace = { key: string; label: string };
type SkewColumn = { node: string; workspaces: SkewWorkspace[] };

const statusOf = (pod: ClusterNetworkReport["workspaces"][number]["pod"]) => {
	if (pod.deleting) {
		return "Terminating";
	}
	const phase = pod.phase ?? "Unknown";
	return phase === "Running" && !pod.ready ? "Running, not ready" : phase;
};

/** One column per node, in node-name order, holding the workspace pods scheduled on it. */
const workspaceSkew = (report: ClusterNetworkReport): SkewColumn[] =>
	[...report.nodes]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((node) => ({
			node: node.name,
			workspaces: report.workspaces
				.filter((w) => w.pod.node === node.name)
				.map((w) => ({
					key: w.id,
					label: `${w.name}, owner ${w.owner}, ${statusOf(w.pod)}`,
				})),
		}));

/** Keeps the end of a long node name, where k3d puts the distinguishing part. */
const shortNode = (name: string) =>
	name.length > LABEL_MAX ? `…${name.slice(-(LABEL_MAX - 1))}` : name;

const plural = (n: number) => `${n} ${n === 1 ? "workspace" : "workspaces"}`;

/** Fill colour by row height: the top row is red, the one below amber, the rest green. */
const tileColor = (row: number, rows: number) =>
	row === rows
		? "bg-content-destructive"
		: row === rows - 1
			? "bg-content-warning"
			: "bg-content-success";

/**
 * Settings > Network, the Workspace Skew card: a tile chart with one column
 * per node and one tile per workspace pod scheduled on it, so an admin sees
 * which nodes the workspaces pile onto.
 */
export const WorkspaceSkewCard: React.FC<{ report: ClusterNetworkReport }> = ({
	report,
}) => {
	const columns = workspaceSkew(report);
	const rows = Math.max(MIN_ROWS, ...columns.map((c) => c.workspaces.length));
	const most = columns.reduce<SkewColumn | undefined>(
		(top, c) => (!top || c.workspaces.length > top.workspaces.length ? c : top),
		undefined,
	);
	const least = columns.reduce<SkewColumn | undefined>(
		(low, c) => (!low || c.workspaces.length < low.workspaces.length ? c : low),
		undefined,
	);

	return (
		<section
			aria-labelledby="workspace-skew"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
			data-testid="workspace-skew-card"
		>
			<h2 id="workspace-skew" className="m-0 text-base font-semibold">
				Workspace Skew
			</h2>
			{most && least ? (
				<p className="m-0 text-sm text-content-secondary">
					Most loaded: {most.node} ({plural(most.workspaces.length)}), least:{" "}
					{least.node} ({least.workspaces.length})
				</p>
			) : (
				<p className="m-0 text-sm text-content-secondary">No nodes to show.</p>
			)}
			<div className="overflow-x-auto pb-2">
				<ul
					aria-label="Workspaces per node"
					className="m-0 grid list-none gap-2 p-0"
					style={{
						gridTemplateColumns: `repeat(${columns.length}, minmax(2rem, 1fr))`,
						minWidth: `${columns.length * 2.5}rem`,
					}}
				>
					{columns.map((c) => (
						<li
							key={c.node}
							aria-label={`${c.node}: ${plural(c.workspaces.length)}`}
							className="flex min-w-0 flex-col gap-2"
						>
							<div className="flex flex-col-reverse items-center gap-1">
								{Array.from({ length: rows }, (_, i) => {
									const w = c.workspaces[i];
									if (!w) {
										return (
											<span
												key={`empty-${i}`}
												aria-hidden
												className="size-5 rounded bg-surface-tertiary"
											/>
										);
									}
									return (
										<Tooltip key={w.key}>
											<TooltipTrigger asChild>
												<span
													role="img"
													aria-label={w.label}
													className={cn(
														"size-5 rounded",
														tileColor(i + 1, rows),
													)}
												/>
											</TooltipTrigger>
											<TooltipContent>{w.label}</TooltipContent>
										</Tooltip>
									);
								})}
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<span
										aria-hidden
										className="block truncate text-center text-xs text-content-secondary"
									>
										{shortNode(c.node)}
									</span>
								</TooltipTrigger>
								<TooltipContent>{c.node}</TooltipContent>
							</Tooltip>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};
