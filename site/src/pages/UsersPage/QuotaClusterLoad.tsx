import { cn } from "cn";
import { useQuery } from "react-query";
import type { QuotaReport } from "#/api/platform";
import { hud } from "#/api/queries/platform";
import { formatQuotaNumber } from "./quotaFormatting";

const consumptionColor = (used: number, total: number) => {
	const ratio = total > 0 ? Math.max(0, Math.min(used / total, 1)) : 0;
	return `hsl(${120 * (1 - ratio)} 75% 45%)`;
};

export const QuotaClusterLoad: React.FC<{ report: QuotaReport }> = ({
	report,
}) => {
	const { cluster, users } = report;
	const storageQuery = useQuery(hud());
	const storage = storageQuery.data?.storage;
	const allocatedDisk = users.reduce(
		(sum, user) => sum + (user.usage.disk ?? 0),
		0,
	);
	const diskTotal =
		storage?.total == null || storage.total <= 0
			? null
			: (storage.total * 1024 ** 3) / 1e9;
	const diskUsed =
		storage?.used == null ? null : (storage.used * 1024 ** 3) / 1e9;
	const diskFree =
		storage?.free == null ? null : (storage.free * 1024 ** 3) / 1e9;
	const diskScale = Math.max(diskTotal ?? 0, allocatedDisk, 1);
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
		<section className="flex flex-col gap-3">
			<div>
				<h3 className="m-0 text-base font-medium">Cluster load</h3>
				<p className="m-0 mt-1 text-xs text-content-secondary">
					Live consumption across {cluster.nodes}{" "}
					{cluster.nodes === 1 ? "node" : "nodes"}: green is low, yellow is
					moderate, and red is near capacity. The dashed marker shows
					reservations.
					{cluster.live
						? ""
						: " Metrics unavailable: CPU and memory show reservations."}
				</p>
			</div>
			{rows.map((r) => {
				const provisioned = users.reduce((sum, u) => sum + u.usage[r.kind], 0);
				const scale = Math.max(r.total, provisioned, r.requested, 1e-9);
				const pct = (v: number) => `${Math.min((v / scale) * 100, 100)}%`;
				const share = r.total ? provisioned / r.total : 0;
				return (
					<div key={r.kind} className="flex flex-col gap-1.5">
						<div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
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
							aria-label={`${r.label}: ${formatQuotaNumber(r.used)} of ${formatQuotaNumber(r.total)} ${r.unit} in use`}
							className="relative h-3 overflow-hidden rounded bg-surface-tertiary"
						>
							<div
								className="absolute inset-y-0 left-0"
								style={{
									width: pct(r.used),
									background: consumptionColor(r.used, r.total),
								}}
							/>
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
			<div className="flex flex-col gap-1.5">
				<div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
					<span className="font-medium">Disk</span>
					<span className="text-content-secondary">
						{formatQuotaNumber(allocatedDisk)}
						{diskTotal !== null
							? ` of ${formatQuotaNumber(diskTotal)} GB allocated (${formatQuotaNumber((allocatedDisk / diskTotal) * 100)}%)`
							: " GB allocated · capacity unavailable"}
						{diskFree !== null && ` · ${formatQuotaNumber(diskFree)} GB free`}
						{diskUsed !== null && ` · ${formatQuotaNumber(diskUsed)} GB in use`}
					</span>
				</div>
				<div
					role="img"
					aria-label={
						diskTotal !== null && diskUsed !== null
							? `Disk: ${formatQuotaNumber(diskUsed)} of ${formatQuotaNumber(diskTotal)} GB in use`
							: "Disk usage unavailable"
					}
					className="relative flex h-3 overflow-hidden rounded bg-surface-tertiary"
				>
					{diskUsed !== null && diskTotal !== null && (
						<div
							className="h-full"
							style={{
								width: `${Math.min((diskUsed / diskTotal) * 100, 100)}%`,
								background: consumptionColor(diskUsed, diskTotal),
							}}
						/>
					)}
					{diskUsed !== null && (
						<div
							title={`Physical disk used: ${formatQuotaNumber(diskUsed)} GB`}
							className="absolute inset-y-0 w-0.5 bg-content-primary"
							style={{
								left: `${Math.min((diskUsed / diskScale) * 100, 100)}%`,
							}}
						/>
					)}
				</div>
				<span className="text-xs text-content-secondary">
					Home allocations include stopped workspaces. The fill shows physical
					disk usage. Node storage excludes remote volumes and additional
					devices.
				</span>
			</div>
		</section>
	);
};
