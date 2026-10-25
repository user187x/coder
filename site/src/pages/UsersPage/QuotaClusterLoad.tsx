import { cn } from "cn";
import type { QuotaReport } from "#/api/platform";
import { formatQuotaNumber, quotaUserColor } from "./quotaFormatting";

/**
 * How taxed the cluster is: for CPU and memory, each developer's provisioned
 * share as a coloured segment of the cluster's capacity, with what running
 * pods requested and what is in use (metrics-server) marked on it.
 */
export const QuotaClusterLoad: React.FC<{ report: QuotaReport }> = ({
	report,
}) => {
	const { cluster, users } = report;
	if (cluster.error !== undefined) {
		return (
			<p className="m-0 text-sm text-content-secondary">
				The cluster's capacity is not readable: {cluster.error}
			</p>
		);
	}
	const rows = [
		{
			kind: "cpu" as const,
			label: "CPU",
			unit: "cores",
			total: cluster.cpu,
			requested: cluster.requestedCpu,
			used: cluster.usedCpu,
		},
		{
			kind: "memory" as const,
			label: "Memory",
			unit: "GiB",
			total: cluster.memory,
			requested: cluster.requestedMemory,
			used: cluster.usedMemory,
		},
	];

	return (
		<section className="flex flex-col gap-4">
			<div>
				<h3 className="m-0 text-base font-medium">Cluster load</h3>
				<p className="m-0 mt-1 text-sm text-content-secondary">
					What developers' workspaces are built with, each in their colour,
					against the cluster's {cluster.nodes}{" "}
					{cluster.nodes === 1 ? "node" : "nodes"}. The dashed line is what all
					pods reserve; the solid line what is in use
					{cluster.live ? "" : " (no metrics-server: reservations shown)"}.
				</p>
			</div>
			{rows.map((r) => {
				const provisioned = users.reduce((sum, u) => sum + u.usage[r.kind], 0);
				const scale = Math.max(r.total, provisioned, r.requested, 1e-9);
				const pct = (v: number) => `${Math.min((v / scale) * 100, 100)}%`;
				const share = r.total ? provisioned / r.total : 0;
				return (
					<div key={r.kind} className="flex flex-col gap-1.5">
						<div className="flex items-baseline justify-between text-sm">
							<span className="font-medium">{r.label}</span>
							<span className="text-content-secondary">
								{formatQuotaNumber(provisioned)} of {formatQuotaNumber(r.total)}{" "}
								{r.unit} provisioned (
								<span
									className={cn(
										share >= 1
											? "text-content-destructive"
											: share >= 0.75
												? "text-content-warning"
												: "text-content-success",
									)}
								>
									{Math.round(share * 100)}%
								</span>
								) · {formatQuotaNumber(r.used)} in use ·{" "}
								{formatQuotaNumber(r.requested)} reserved
							</span>
						</div>
						<div
							role="img"
							aria-label={`${r.label}: ${formatQuotaNumber(provisioned)} of ${formatQuotaNumber(r.total)} ${r.unit} provisioned`}
							className="relative h-5 overflow-hidden rounded bg-surface-tertiary"
						>
							<div className="absolute inset-0 flex">
								{users.map((u, i) =>
									u.usage[r.kind] > 0 ? (
										<div
											key={u.id}
											title={`${u.username}: ${formatQuotaNumber(u.usage[r.kind])} ${r.unit} in ${u.usage.workspaces} ${u.usage.workspaces === 1 ? "workspace" : "workspaces"}`}
											className="h-full border-0 border-r border-solid border-surface-primary"
											style={{
												width: pct(u.usage[r.kind]),
												background: quotaUserColor(i),
											}}
										/>
									) : null,
								)}
							</div>
							{r.total < scale && (
								<div
									title="The cluster's capacity: beyond this line it is overcommitted"
									className="absolute inset-y-0 w-0.5 bg-content-destructive"
									style={{ left: pct(r.total) }}
								/>
							)}
							<div
								title={`Reserved by all pods: ${formatQuotaNumber(r.requested)} ${r.unit}`}
								className="absolute inset-y-0 w-0 border-0 border-l-2 border-dashed border-content-primary"
								style={{ left: pct(r.requested) }}
							/>
							<div
								title={`In use: ${formatQuotaNumber(r.used)} ${r.unit}`}
								className="absolute inset-y-0 w-0.5 bg-content-primary"
								style={{ left: pct(r.used) }}
							/>
						</div>
					</div>
				);
			})}
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
				{users.map((u, i) =>
					u.usage.workspaces ? (
						<span key={u.id} className="inline-flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2.5 rounded-sm"
								style={{ background: quotaUserColor(i) }}
							/>
							{u.username}
						</span>
					) : null,
				)}
			</div>
		</section>
	);
};
