import { useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import type {
	ResourceHistorySample,
	WorkspaceResourceHistory,
} from "#/api/platform";
import { workspaceResourceHistory } from "#/api/queries/platform";
import { workspaceInfrastructureMetrics } from "#/api/queries/workspaceMetrics";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { Badge } from "#/components/Badge/Badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { workspaceMaximum } from "#/modules/resources/infrastructureMetrics";
import { levelColor } from "#/modules/resources/MetadataHistogram";

const clock = (ms: number) =>
	new Date(ms).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
	});

/** A detailed five-minute history is requested only while a metric's popup is open. */
export const WorkspaceMetricDetails: React.FC<{
	workspaceId: string;
	organizationId: string;
	agentId: string;
	kind: "cpu" | "ram" | "disk";
	label: string;
	metric?: WorkspaceAgentMetadata;
	children: React.ReactNode;
}> = ({
	workspaceId,
	organizationId,
	agentId,
	kind,
	label,
	metric,
	children,
}) => {
	const [open, setOpen] = useState(false);
	const query = useQuery({
		...workspaceResourceHistory(workspaceId, 300, 60),
		enabled: open,
	});
	const infrastructure = useQuery({
		...workspaceInfrastructureMetrics(organizationId, workspaceId),
		enabled: open,
	});
	const maximum = metric
		? workspaceMaximum(metric, infrastructure.data?.allocation)
		: null;
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={`${label} metric details`}
					className="border-0 rounded-md bg-transparent p-0 text-left cursor-pointer focus-visible:outline focus-visible:outline-content-link"
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				className="w-[360px] max-w-[calc(100vw-32px)] p-4 shadow-lg"
			>
				<WorkspaceMetricHistory
					label={kind === "ram" ? "MEM" : label.toUpperCase()}
					capacity={
						maximum && {
							...maximum,
							text: kind === "ram" ? `${maximum.text}GiB` : maximum.text,
						}
					}
					capacityLoading={infrastructure.isLoading}
					metric={metric}
					history={query.data}
					samples={query.data?.agents[agentId]?.[kind]}
					loading={query.isLoading}
					error={query.error}
				/>
			</TooltipContent>
		</Tooltip>
	);
};

/** Discard invalid or out-of-window readings without turning gaps into zero usage. */
export const metricHistorySamples = (
	samples: readonly ResourceHistorySample[],
	history: Pick<WorkspaceResourceHistory, "asOf" | "windowSeconds">,
) =>
	samples.filter(
		(sample) =>
			Number.isFinite(sample.t) &&
			Number.isFinite(sample.share) &&
			sample.share >= 0 &&
			sample.t >= history.asOf - history.windowSeconds * 1000 &&
			sample.t <= history.asOf,
	);

/** The expanded metric graph uses the backend's finer buckets, preserving their measurement timestamps. */
export const WorkspaceMetricHistory: React.FC<{
	label: string;
	capacity?: { text: string; label: string } | null;
	capacityLoading?: boolean;
	metric?: WorkspaceAgentMetadata;
	history?: WorkspaceResourceHistory;
	samples?: readonly ResourceHistorySample[];
	loading?: boolean;
	error?: unknown;
}> = ({
	label,
	capacity,
	capacityLoading = false,
	metric,
	history,
	samples = [],
	loading = false,
	error,
}) => {
	const [hovered, setHovered] = useState<number | null>(null);
	const points = history ? metricHistorySamples(samples, history) : [];
	const selected = points.find((point) => point.t === hovered);
	const peak = Math.max(0, ...points.map((point) => point.share));
	const scale = Math.max(5, Math.ceil(peak / 10) * 10);

	const measuredAt = metric
		? Date.parse(metric.result.collected_at)
		: Number.NaN;
	const start = history ? history.asOf - history.windowSeconds * 1000 : 0;
	const span = history ? history.windowSeconds * 1000 : 300000;
	return (
		<section
			aria-label={`${label} measurements`}
			className="flex flex-col gap-2 font-normal"
		>
			<div className="flex items-center gap-2">
				<span className="font-semibold text-content-primary">{label}</span>
				<Badge
					variant="default"
					className="px-1.5 py-0 text-xs tabular-nums"
					title={
						capacity?.label ??
						(capacityLoading
							? "Loading allocated capacity"
							: "Allocated capacity unavailable")
					}
				>
					{capacity?.text ?? (capacityLoading ? "..." : "?")}
				</Badge>
			</div>
			<div className="text-content-primary tabular-nums">
				{metric?.result.error
					? "Unavailable"
					: metric?.result.value || "No current reading"}
			</div>
			<div className="text-2xs">
				{Number.isFinite(measuredAt)
					? `Measured ${new Date(measuredAt).toLocaleDateString("en-US")} at ${clock(measuredAt)}`
					: "Measurement time unavailable"}
			</div>
			{metric?.result.error && (
				<p className="m-0 text-content-warning">{metric.result.error}</p>
			)}
			{loading && !history ? (
				<p role="status" className="m-0 py-4">
					Loading metric history...
				</p>
			) : error && !history ? (
				<p className="m-0 text-content-destructive">
					{getErrorMessage(
						error,
						"History is unavailable. It will retry automatically.",
					)}
				</p>
			) : points.length === 0 ? (
				<p className="m-0 py-4">No measurements in the last five minutes.</p>
			) : (
				<>
					<div className="flex justify-between text-2xs tabular-nums">
						<span>
							{selected
								? `${clock(selected.t)} · ${selected.share.toFixed(1)}%`
								: `Peak ${peak.toFixed(1)}%`}
						</span>
						<span>0 to {scale}%</span>
					</div>
					<svg
						role="img"
						aria-label={`${label} usage over the last five minutes, peak ${peak.toFixed(1)} percent`}
						viewBox="0 0 300 100"
						preserveAspectRatio="none"
						className="block h-28 w-full rounded bg-surface-secondary"
						onPointerLeave={() => setHovered(null)}
					>
						{[25, 50, 75].map((y) => (
							<line
								key={y}
								x1={0}
								x2={300}
								y1={y}
								y2={y}
								className="stroke-border"
								strokeWidth={0.5}
							/>
						))}
						{points.map((point) => {
							const x = Math.min(295, ((point.t - start) / span) * 300);
							const height = Math.max(1, (point.share / scale) * 96);
							return (
								<g key={point.t} onPointerEnter={() => setHovered(point.t)}>
									<title>{`${clock(point.t)} · ${point.text} · ${point.share.toFixed(1)}%`}</title>
									<rect x={x} y={0} width={5} height={100} fill="transparent" />
									<rect
										x={x + 0.5}
										y={100 - height}
										width={3.5}
										height={height}
										rx={0.5}
										fill={levelColor(point.share)}
									/>
								</g>
							);
						})}
					</svg>
					<div className="flex justify-between text-2xs tabular-nums">
						<span>{clock(start)}</span>
						<span>{clock(history?.asOf ?? 0)}</span>
					</div>
					<p className="m-0 text-2xs">
						Five-minute history, peak reading per 5-second interval. Gaps
						indicate missing measurements.
					</p>
				</>
			)}
			{Boolean(error) && history && (
				<p className="m-0 text-content-warning">
					Updates unavailable. Showing the last readings.
				</p>
			)}
		</section>
	);
};
