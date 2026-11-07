import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { formatRate } from "#/modules/platform/networkLeds/NetworkHistogram";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { DottedRow } from "./DashboardCard";
import { type BarSegment, QuotaBar, Sparkline } from "./dashboardCharts";
import {
	type DashboardScope,
	RESOURCE_UNIT,
	type Series,
} from "./dashboardModel";
import { RESOURCE_STYLE } from "./SummaryCard";

/** Segment colours for the largest allocations; the rest are grouped as "Other". */
const SEGMENT_FILLS = [
	"bg-highlight-purple",
	"bg-highlight-sky",
	"bg-highlight-green",
	"bg-highlight-orange",
	"bg-highlight-magenta",
] as const;

const allocationSegments = (
	scope: DashboardScope,
	resource: "cpu" | "memory",
): BarSegment[] => {
	const rows = [...scope.workspaces]
		.filter((w) => w[resource] > 0)
		.sort((a, b) => b[resource] - a[resource]);
	const top = rows.slice(0, SEGMENT_FILLS.length - 1);
	const rest = rows.slice(SEGMENT_FILLS.length - 1);
	const segments = top.map((w, i) => ({
		label: w.owner ? `${w.owner}/${w.name}` : w.name,
		value: w[resource],
		fill: SEGMENT_FILLS[i],
	}));
	const other = rest.reduce((sum, w) => sum + w[resource], 0);
	return other > 0
		? [
				...segments,
				{
					label: "Other",
					value: other,
					fill: SEGMENT_FILLS[SEGMENT_FILLS.length - 1],
				},
			]
		: segments;
};

type WorkspaceReading = {
	id: string;
	name: string;
	value: number | null;
};

type UsageCardBodyProps = {
	resource: "cpu" | "memory";
	scope: DashboardScope;
	series: Series | null;
	perWorkspace: readonly WorkspaceReading[];
	limitName: string;
};

/**
 * Memory or Processor: the allocation split by workspace against the limit, what the running workspaces use over
 * the last five minutes with the limit as a dashed watermark line, and a drawer with each workspace's reading.
 */
export const UsageCardBody: React.FC<UsageCardBodyProps> = ({
	resource,
	scope,
	series,
	perWorkspace,
	limitName,
}) => {
	const [open, setOpen] = useState(false);
	const style = RESOURCE_STYLE[resource];
	const unit = RESOURCE_UNIT[resource];
	const limit = scope.limits[resource];
	const segments = allocationSegments(scope, resource);
	const points = series?.points ?? [];
	const peak = Math.max(0, ...points.map((p) => p ?? 0));
	const now = series?.latest ?? null;
	const trendLabel =
		now === null
			? `${style.label} in use: no readings in the last 5 minutes`
			: `${style.label} in use over the last 5 minutes: now ${formatQuotaNumber(now)} ${unit}, peak ${formatQuotaNumber(peak)} ${unit}${limit === null ? "" : `, ${limitName} ${formatQuotaNumber(limit)} ${unit}`}`;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<QuotaBar
					label={`${style.label} allocated by workspace`}
					segments={segments}
					limit={limit}
					unit={unit}
					limitName={limitName}
				/>
				{segments.length > 0 && (
					<ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 sm:grid-cols-3">
						{segments.map((s) => (
							<li
								key={s.label}
								className="flex min-w-0 items-center gap-1.5 text-[11px] text-content-secondary"
							>
								<span
									aria-hidden
									className={cn("size-2 shrink-0 rounded-full", s.fill)}
								/>
								<span className="truncate">{s.label}</span>
								<span className="tabular-nums text-content-primary">
									{formatQuotaNumber(s.value)}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<div className="flex items-baseline justify-between text-xs">
					<span className="font-semibold text-content-primary">In use</span>
					<span className="tabular-nums text-content-secondary">
						{now === null ? "N/A" : `${formatQuotaNumber(now)} ${unit}`}
					</span>
				</div>
				<Sparkline
					label={trendLabel}
					points={points}
					limit={limit}
					stroke={style.stroke}
					fill={style.fill}
				/>
				{limit !== null && (
					<span className="flex items-center gap-1.5 text-[11px] text-content-secondary">
						<span
							aria-hidden
							className="w-4 border-0 border-t-2 border-dashed border-content-destructive"
						/>
						{limitName === "quota" ? "Quota" : "Capacity"}{" "}
						{formatQuotaNumber(limit)} {unit}
					</span>
				)}
			</div>
			{perWorkspace.length > 0 && (
				<Collapsible open={open} onOpenChange={setOpen}>
					<CollapsibleTrigger className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-medium text-content-link">
						{open ? "Hide workspaces" : "Show workspaces"}
						<ChevronDownIcon
							aria-hidden
							className={cn(
								"size-3.5 transition-transform",
								open && "rotate-180",
							)}
						/>
					</CollapsibleTrigger>
					<CollapsibleContent asChild>
						<dl className="m-0 mt-2 flex flex-col gap-1.5">
							{perWorkspace.map((w) => (
								<DottedRow
									key={w.id}
									label={w.name}
									value={
										w.value === null
											? "N/A"
											: `${formatQuotaNumber(w.value)} ${unit}`
									}
								/>
							))}
						</dl>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
};

export const NetworkCardBody: React.FC<{
	rx: Series;
	tx: Series;
}> = ({ rx, tx }) => {
	const rows = [
		{
			label: "Received",
			series: rx,
			stroke: "stroke-highlight-sky",
			fill: "fill-highlight-sky",
		},
		{
			label: "Sent",
			series: tx,
			stroke: "stroke-highlight-orange",
			fill: "fill-highlight-orange",
		},
	];
	return (
		<div className="flex flex-col gap-4">
			{rows.map((row) => {
				const now = row.series.latest;
				const peak = Math.max(0, ...row.series.points.map((p) => p ?? 0));
				return (
					<div key={row.label} className="flex flex-col gap-1">
						<div className="flex items-baseline justify-between text-xs">
							<span className="font-semibold text-content-primary">
								{row.label}
							</span>
							<span className="tabular-nums text-content-secondary">
								{now === null ? "N/A" : formatRate(now)}
							</span>
						</div>
						<Sparkline
							label={
								now === null
									? `${row.label}: no readings in the last 5 minutes`
									: `${row.label} over the last 5 minutes: now ${formatRate(now)}, peak ${formatRate(peak)}`
							}
							points={row.series.points}
							limit={null}
							stroke={row.stroke}
							fill={row.fill}
						/>
					</div>
				);
			})}
		</div>
	);
};
