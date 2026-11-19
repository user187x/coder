import { cn } from "cn";
import { Link } from "react-router";
import type { ClusterNetworkReport } from "#/api/clusterNetwork";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

import { ago, bytes, useNow } from "#/modules/platform/ClusterVisuals";

const MIN_ROWS = 6;

type SkewWorkspace = ClusterNetworkReport["workspaces"][number];
type SkewColumn = {
	node: ClusterNetworkReport["nodes"][number];
	workspaces: SkewWorkspace[];
	latency: number | null;
};

const workspaceStatus = ({ pod, healthy }: SkewWorkspace) => {
	if (pod.deleting)
		return { label: "Terminating", color: "bg-content-warning" };
	if (pod.phase === "Failed" || healthy === false) {
		return {
			label: pod.phase === "Failed" ? "Failed" : "Unhealthy",
			color: "bg-content-destructive",
		};
	}
	if (pod.phase === "Pending" || (pod.phase === "Running" && !pod.ready)) {
		return {
			label: pod.phase === "Pending" ? "Pending" : "Running, not ready",
			color: "bg-content-warning",
		};
	}
	if (pod.phase === "Running")
		return { label: "Running", color: "bg-content-success" };
	return {
		label:
			pod.phase === "Succeeded"
				? "Offline (completed)"
				: (pod.phase ?? "Unknown"),
		color: "bg-surface-quaternary",
	};
};

/** One column per node, in node-name order, holding the workspace pods scheduled on it. */
const workspaceSkew = (report: ClusterNetworkReport): SkewColumn[] =>
	[...report.nodes]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((node) => {
			const placed = report.workspaces.filter(
				(workspace) => workspace.pod.node === node.name,
			);
			const latencies = placed
				.flatMap((workspace) => workspace.agents)
				.flatMap((agent) =>
					agent.status === "connected" && agent.latencyMs !== null
						? [agent.latencyMs]
						: [],
				)
				.sort((a, b) => a - b);
			const middle = Math.floor(latencies.length / 2);
			const high = latencies[middle];
			const low = latencies[Math.floor((latencies.length - 1) / 2)];
			return {
				node,
				workspaces: placed,
				latency:
					high !== undefined && low !== undefined ? (high + low) / 2 : null,
			};
		});

const plural = (n: number) => `${n} ${n === 1 ? "workspace" : "workspaces"}`;

/**
 * Settings > Network, the Workspace Skew card: a tile chart with one column
 * per node and one tile per workspace pod scheduled on it, so an admin sees
 * which nodes the workspaces pile onto.
 */
export const WorkspaceSkewCard: React.FC<{ report: ClusterNetworkReport }> = ({
	report,
}) => {
	const now = useNow();
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
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6 bg-surface-primary"
			data-testid="workspace-skew-card"
		>
			<h2 id="workspace-skew" className="m-0 text-base font-semibold">
				Workspace Skew
			</h2>
			{most && least ? (
				<p className="m-0 text-sm text-content-secondary">
					Most loaded: {most.node.name} ({plural(most.workspaces.length)}),
					least: {least.node.name} ({least.workspaces.length})
				</p>
			) : (
				<p className="m-0 text-sm text-content-secondary">No nodes to show.</p>
			)}
			<div className="overflow-x-auto pb-2">
				<ul
					aria-label="Workspaces per node"
					className="m-0 grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]"
				>
					{columns.map((c) => (
						<li
							key={c.node.name}
							aria-label={`${c.node.name}: ${plural(c.workspaces.length)}`}
							className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-solid border-border bg-surface-secondary"
						>
							<div className="flex flex-1 flex-col-reverse items-center gap-1 p-4">
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
									const status = workspaceStatus(w);
									const name = `${w.name}, owner ${w.owner}, ${status.label}`;
									const square = cn(
										"block size-5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link",
										status.color,
									);
									return (
										<Tooltip key={w.id}>
											<TooltipTrigger asChild>
												{w.orphan ? (
													<span
														role="img"
														aria-label={name}
														className={square}
													/>
												) : (
													<Link
														aria-label={name}
														to={`/@${encodeURIComponent(w.owner)}/${encodeURIComponent(w.name)}`}
														className={square}
													/>
												)}
											</TooltipTrigger>
											<TooltipContent>
												<div className="font-semibold">{w.name}</div>
												<div>Owner: {w.owner}</div>
												<div>Status: {status.label}</div>
												<div>
													Online time:{" "}
													{w.pod.phase === "Running" && w.pod.ready
														? ago(w.pod.started, now)
														: "N/A"}
												</div>
											</TooltipContent>
										</Tooltip>
									);
								})}
							</div>
							<footer className="border-0 border-t border-solid border-border bg-surface-primary p-3">
								<p className="m-0 break-all text-sm font-medium">
									{c.node.name}
								</p>
								<dl className="mb-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
									{[
										[
											"IP",
											c.node.addresses.InternalIP?.join(", ") ||
												c.node.addresses.ExternalIP?.join(", ") ||
												"N/A",
										],
										[
											"Capacity",
											c.node.capacity.cpu === null
												? "N/A"
												: `${c.node.capacity.cpu} cores`,
										],
										["Processor architecture", c.node.arch ?? "N/A"],
										[
											"Workspace latency",
											c.latency === null ? "N/A" : `${c.latency.toFixed(1)} ms`,
										],
										["Workspaces", c.workspaces.length],
										["Total memory", bytes(c.node.capacity.memory)],
										["Used memory", bytes(c.node.usage?.memory)],
										[
											"Total load (1 min)",
											c.node.loadAverage?.toFixed(2) ?? "N/A",
										],
									].map(([label, value]) => (
										<div key={label} className="min-w-0">
											<dt className="text-content-secondary">{label}</dt>
											<dd className="m-0 break-words font-medium">{value}</dd>
										</div>
									))}
								</dl>
							</footer>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};
