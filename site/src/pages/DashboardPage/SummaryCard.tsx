import { cn } from "cn";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { DottedRow } from "./DashboardCard";
import { QuotaRings, type Ring, WatermarkBadge } from "./dashboardCharts";
import {
	type DashboardScope,
	RESOURCE_UNIT,
	type Resource,
	watermarkLevel,
} from "./dashboardModel";

/** Each resource's label and colours: memory outermost, then CPU, then disk, as in the template's rings. */
export const RESOURCE_STYLE: Record<
	Resource,
	{ label: string; stroke: string; fill: string; dot: string }
> = {
	memory: {
		label: "Memory",
		stroke: "stroke-highlight-purple",
		fill: "fill-highlight-purple",
		dot: "bg-highlight-purple",
	},
	cpu: {
		label: "CPU",
		stroke: "stroke-highlight-sky",
		fill: "fill-highlight-sky",
		dot: "bg-highlight-sky",
	},
	disk: {
		label: "Disk",
		stroke: "stroke-highlight-green",
		fill: "fill-highlight-green",
		dot: "bg-highlight-green",
	},
};

const ORDER: readonly Resource[] = ["memory", "cpu", "disk"];

const amount = (value: number, resource: Resource) =>
	`${formatQuotaNumber(value)} ${RESOURCE_UNIT[resource]}`;

type SummaryCardProps = {
	scope: DashboardScope;
	/** Cores and GiB the running workspaces use now; null where it is not measured. */
	live: { cpu: number | null; memory: number | null };
	limitName: string;
};

/**
 * Allocations against limits: concentric rings with the limit's watermark, the big numbers beside them, and how
 * the allocation splits between running and stopped workspaces, with what the running ones use now.
 */
export const SummaryCardBody: React.FC<SummaryCardProps> = ({
	scope,
	live,
	limitName,
}) => {
	const rings: Ring[] = ORDER.map((resource) => ({
		label: RESOURCE_STYLE[resource].label,
		used: scope.allocated[resource],
		limit: scope.limits[resource],
		unit: RESOURCE_UNIT[resource],
		stroke: RESOURCE_STYLE[resource].stroke,
	}));
	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-6">
				<QuotaRings rings={rings} limitName={limitName} />
				<ul className="m-0 flex min-w-[180px] flex-1 list-none flex-col gap-3 p-0">
					{ORDER.map((resource) => {
						const used = scope.allocated[resource];
						const limit = scope.limits[resource];
						const style = RESOURCE_STYLE[resource];
						const level = watermarkLevel(used, limit);
						return (
							<li key={resource} className="flex flex-col">
								<span className="flex items-center gap-2 text-xs text-content-secondary">
									<span
										aria-hidden
										className={cn("size-2 rounded-full", style.dot)}
									/>
									{style.label}
									{scope.modes[resource] === "instance" && " (per workspace)"}
								</span>
								<span className="text-2xl font-semibold tabular-nums text-content-primary">
									{formatQuotaNumber(used)}
									<span className="text-sm font-normal text-content-secondary">
										{limit === null
											? ` ${RESOURCE_UNIT[resource]}`
											: ` / ${amount(limit, resource)}`}
									</span>
								</span>
								<WatermarkBadge level={level} limitName={limitName} />
							</li>
						);
					})}
				</ul>
			</div>
			{scope.exempt && (
				<p className="m-0 text-xs text-content-secondary">
					Your account is exempt from the quota; the limits are shown for
					reference.
				</p>
			)}
			<div className="grid grid-cols-1 gap-4 border-0 border-t border-solid border-border pt-4 sm:grid-cols-3">
				<div className="flex flex-col gap-1.5">
					<h3 className="m-0 text-xs font-semibold text-content-primary">
						Running
					</h3>
					<dl className="m-0 flex flex-col gap-1.5">
						{ORDER.map((r) => (
							<DottedRow
								key={r}
								label={RESOURCE_STYLE[r].label}
								value={amount(scope.running[r], r)}
							/>
						))}
					</dl>
				</div>
				<div className="flex flex-col gap-1.5">
					<h3 className="m-0 text-xs font-semibold text-content-primary">
						Stopped
					</h3>
					<dl className="m-0 flex flex-col gap-1.5">
						{ORDER.map((r) => (
							<DottedRow
								key={r}
								label={RESOURCE_STYLE[r].label}
								value={amount(scope.stopped[r], r)}
							/>
						))}
					</dl>
				</div>
				<div className="flex flex-col gap-1.5">
					<h3 className="m-0 text-xs font-semibold text-content-primary">
						In use now
					</h3>
					<dl className="m-0 flex flex-col gap-1.5">
						<DottedRow
							label="CPU"
							value={
								live.cpu === null
									? "N/A"
									: `${formatQuotaNumber(live.cpu)} of ${amount(scope.running.cpu, "cpu")}`
							}
						/>
						<DottedRow
							label="Memory"
							value={
								live.memory === null
									? "N/A"
									: `${formatQuotaNumber(live.memory)} of ${amount(scope.running.memory, "memory")}`
							}
						/>
					</dl>
				</div>
			</div>
		</div>
	);
};
