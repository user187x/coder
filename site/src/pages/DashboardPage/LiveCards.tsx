import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { formatRate } from "#/modules/platform/networkLeds/NetworkHistogram";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { GraphFrame, ShowWorkspaces } from "./DashboardCard";
import {
	type BarSegment,
	GraphLegend,
	QuotaBar,
	Sparkline,
} from "./dashboardCharts";
import {
	type DashboardScope,
	RESOURCE_UNIT,
	type Series,
	totalLimit,
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
	// Running workspaces first (solid), then the ones claiming without running (dotted), each by size.
	const rows = [...scope.workspaces]
		.filter((w) => w[resource] > 0)
		.sort(
			(a, b) =>
				Number(b.running) - Number(a.running) || b[resource] - a[resource],
		);
	const top = rows.slice(0, SEGMENT_FILLS.length - 1);
	const rest = rows.slice(SEGMENT_FILLS.length - 1);
	const segments: BarSegment[] = top.map((w, i) => ({
		label: w.owner ? `${w.owner}/${w.name}` : w.name,
		value: w[resource],
		fill: SEGMENT_FILLS[i],
		offline: !w.running,
	}));
	const fill = SEGMENT_FILLS[SEGMENT_FILLS.length - 1];
	const others = [
		{ label: "Other", running: true },
		{ label: "Other, not running", running: false },
	].map(({ label, running }) => ({
		label,
		value: rest
			.filter((w) => w.running === running)
			.reduce((sum, w) => sum + w[resource], 0),
		fill,
		offline: !running,
	}));
	return [...segments, ...others.filter((o) => o.value > 0)];
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
	const style = RESOURCE_STYLE[resource];
	const unit = RESOURCE_UNIT[resource];
	// The workspaces together, against the limit for them all (per instance: times the workspace limit)
	const limit = totalLimit(scope, resource);
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
			<GraphFrame className="flex flex-col gap-1">
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
				<GraphLegend
					keys={[
						{
							label: "Current",
							line: style.dot,
							value: now === null ? "N/A" : `${formatQuotaNumber(now)} ${unit}`,
						},
						...(limit === null
							? []
							: [
									{
										label: limitName === "quota" ? "Quota" : "Capacity",
										value: `${formatQuotaNumber(limit)} ${unit}`,
									},
								]),
					]}
				/>
			</GraphFrame>
			{perWorkspace.length > 0 && (
				<ShowWorkspaces
					rows={perWorkspace.map((w) => ({
						id: w.id,
						label: w.name,
						value:
							w.value === null
								? "N/A"
								: `${formatQuotaNumber(w.value)} ${unit}`,
					}))}
				/>
			)}
		</div>
	);
};

/** Received and sent now, for one workspace; null where it has no reading. */
export type NetworkReading = {
	id: string;
	name: string;
	rx: number | null;
	tx: number | null;
};

const COMBINED = "combined";

/** The Network card's header pill: whose traffic the graphs show, chosen from its menu. */
export const NetworkScopePill: React.FC<{
	workspaces: readonly NetworkReading[];
	selected: string | null;
	onSelect: (id: string | null) => void;
}> = ({ workspaces, selected, onSelect }) => {
	const name = workspaces.find((w) => w.id === selected)?.name;
	const label = name ? `${name} Network Activity` : "Combined Network Activity";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={`Network activity shown: ${label}`}
					className="flex max-w-48 cursor-pointer items-center gap-1 rounded-full border border-solid border-border bg-surface-secondary px-1.5 text-[10px] leading-4 text-content-secondary hover:text-content-primary"
				>
					<span className="truncate">{label}</span>
					<ChevronDownIcon aria-hidden className="size-3 shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup
					value={selected ?? COMBINED}
					onValueChange={(value) => onSelect(value === COMBINED ? null : value)}
				>
					<DropdownMenuRadioItem value={COMBINED}>
						Combined Network Activity
					</DropdownMenuRadioItem>
					{workspaces.map((w) => (
						<DropdownMenuRadioItem key={w.id} value={w.id}>
							{w.name} Network Activity
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

export const NetworkCardBody: React.FC<{
	rx: Series;
	tx: Series;
	perWorkspace: readonly NetworkReading[];
	/** The workspace whose traffic the graphs show; none: all of them together. */
	selected?: string | null;
	onSelect?: (id: string | null) => void;
}> = ({ rx, tx, perWorkspace, selected = null, onSelect }) => {
	const rows = [
		{
			label: "Received",
			series: rx,
			stroke: "stroke-highlight-sky",
			fill: "fill-highlight-sky",
			line: "bg-highlight-sky",
		},
		{
			label: "Sent",
			series: tx,
			stroke: "stroke-highlight-orange",
			fill: "fill-highlight-orange",
			line: "bg-highlight-orange",
		},
	];
	return (
		<div className="flex flex-col gap-4">
			<GraphFrame className="flex flex-col gap-4">
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
								format={formatRate}
							/>
							<GraphLegend
								keys={[
									{
										label: "Current",
										line: row.line,
										value: now === null ? "N/A" : formatRate(now),
									},
								]}
							/>
						</div>
					);
				})}
			</GraphFrame>
			{perWorkspace.length > 0 && (
				<ShowWorkspaces
					rows={perWorkspace.map((w) => ({
						id: w.id,
						// Choosing one shows only its traffic; choosing it again, everyone's.
						label: onSelect ? (
							<button
								type="button"
								aria-pressed={selected === w.id}
								title={
									selected === w.id
										? "Show the combined network activity"
										: `Show only ${w.name}'s network activity`
								}
								onClick={() => onSelect(selected === w.id ? null : w.id)}
								className={cn(
									"cursor-pointer border-0 bg-transparent p-0 text-left text-inherit hover:underline",
									selected === w.id && "font-semibold text-content-primary",
								)}
							>
								{w.name}
							</button>
						) : (
							w.name
						),
						value:
							w.rx === null && w.tx === null
								? "N/A"
								: `${w.rx === null ? "N/A" : formatRate(w.rx)} in · ${w.tx === null ? "N/A" : formatRate(w.tx)} out`,
					}))}
				/>
			)}
		</div>
	);
};
