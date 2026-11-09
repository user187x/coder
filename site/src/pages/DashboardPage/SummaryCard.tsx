import { cn } from "cn";
import { useState } from "react";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { DottedRow, GraphFrame } from "./DashboardCard";
import { QuotaRings, type Ring, WatermarkBadge } from "./dashboardCharts";
import {
	type DashboardScope,
	RESOURCE_UNIT,
	type Resource,
	totalAllocated,
	totalLimit,
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
	/** GPUs the running workspaces claim; null where it is not known (the whole cluster). */
	gpus?: number | null;
};

/** What counts against a resource's limit: the quota's own count, or with a per-workspace limit every
 * workspace's together (measured against the limit times the workspaces allowed, totalLimit). */
const ringUsed = (scope: DashboardScope, resource: Resource) =>
	scope.modes[resource] === "instance"
		? totalAllocated(scope, resource)
		: scope.allocated[resource];

/** The figures under the rings, two to a row: CPU and Memory, then Disk and GPU. */
const LEGEND: readonly (Resource | "gpu")[] = ["cpu", "memory", "disk", "gpu"];

/**
 * Allocations against limits: concentric rings with the limit's watermark, the big numbers beside them, and how
 * the allocation splits between running and stopped workspaces, with what the running ones use now.
 */
export const SummaryCardBody: React.FC<SummaryCardProps> = ({
	scope,
	live,
	limitName,
	gpus = null,
}) => {
	// The ring pointed at, or its legend entry: both light up together.
	const [active, setActive] = useState<number | null>(null);
	const rings: Ring[] = ORDER.map((resource) => ({
		label: RESOURCE_STYLE[resource].label,
		// The workspaces together against the limit for them all, as the resource cards measure: a per-workspace
		// limit counts once for each workspace the account may have.
		used: ringUsed(scope, resource),
		limit: totalLimit(scope, resource),
		unit: RESOURCE_UNIT[resource],
		stroke: RESOURCE_STYLE[resource].stroke,
	}));
	return (
		<div className="@container flex flex-col gap-5">
			<div className="flex flex-col items-center gap-5">
				<GraphFrame className="p-2">
					<QuotaRings
						rings={rings}
						limitName={limitName}
						active={active}
						onActiveChange={setActive}
					/>
				</GraphFrame>
				<ul className="m-0 grid w-full list-none grid-cols-2 gap-x-4 gap-y-3 p-0">
					{LEGEND.map((key) => {
						if (key === "gpu") {
							const none = !gpus;
							return (
								<li
									key="gpu"
									className={cn(
										"-mx-2 flex min-w-0 flex-col rounded-lg px-2",
										none && "opacity-40",
									)}
								>
									<span className="flex items-center gap-2 whitespace-nowrap text-xs text-content-secondary">
										<span
											aria-hidden
											className="size-2 rounded-full bg-content-success"
										/>
										GPU
									</span>
									<span className="whitespace-nowrap text-2xl font-semibold tabular-nums text-content-primary">
										{gpus === null ? "N/A" : formatQuotaNumber(gpus)}
										{gpus !== null && (
											<span className="text-sm font-normal text-content-secondary">
												{gpus === 1 ? " GPU" : " GPUs"}
											</span>
										)}
									</span>
									<span className="whitespace-nowrap text-[11px] text-content-secondary">
										{gpus === null
											? "Per account only"
											: none
												? "None claimed"
												: "Claimed by running workspaces"}
									</span>
								</li>
							);
						}
						const resource = key;
						const index = ORDER.indexOf(resource);
						const used = ringUsed(scope, resource);
						const limit = totalLimit(scope, resource);
						const style = RESOURCE_STYLE[resource];
						const level = watermarkLevel(used, limit);
						return (
							<li
								key={resource}
								className={cn(
									"-mx-2 flex min-w-0 flex-col rounded-lg px-2 transition-[background-color,opacity] duration-200",
									active === index && "bg-surface-secondary",
									active !== null && active !== index && "opacity-50",
								)}
								onMouseEnter={() => setActive(index)}
								onMouseLeave={() => setActive(null)}
							>
								<span className="flex items-center gap-2 whitespace-nowrap text-xs text-content-secondary">
									<span
										aria-hidden
										className={cn("size-2 rounded-full", style.dot)}
									/>
									{style.label}
									{scope.modes[resource] === "instance" &&
										scope.limits[resource] !== null &&
										` (${amount(scope.limits[resource] ?? 0, resource)} per workspace)`}
								</span>
								<span className="whitespace-nowrap text-2xl font-semibold tabular-nums text-content-primary">
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
			{/* Three columns only where the card has room for each reading on one line. */}
			<div className="grid grid-cols-1 gap-4 border-0 border-t border-solid border-border pt-4 @min-[600px]:grid-cols-3">
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
