import { cn } from "cn";
import { useQuery } from "react-query";
import type {
	ClusterHistory,
	ClusterNetwork,
	ClusterUsage,
	ResourceUsage,
	UsagePoint,
} from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";

import { ClusterDiskGraph } from "./ClusterDiskGraph";
import { ClusterMetricPlot } from "./ClusterMetricDrilldown";
import {
	formatRate,
	HISTORY_SLOTS,
	historyX,
	horizontalHistoryWindow,
	networkMeasurement,
	networkTrace,
} from "./clusterMetricHistory";
import { MetricMeter } from "./MetricMeter";
import { MetricSample } from "./MetricSample";
import { MetricYAxis } from "./MetricYAxis";

const GiB = 1024 ** 3;

const trimNumber = (value: number): string => {
	if (!Number.isFinite(value)) {
		return "0";
	}
	const fixed =
		value >= 100
			? value.toFixed(0)
			: value >= 10
				? value.toFixed(1)
				: value.toFixed(2);
	return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

type Kind = "cpu" | "memory";

const amount = (kind: Kind, value: number) =>
	trimNumber(kind === "cpu" ? value : value / GiB);

const unit = (kind: Kind, value: number) => {
	if (kind === "memory") {
		return "GiB";
	}
	return Math.abs(value - 1) < 0.005 ? "core" : "cores";
};

const formatAmount = (kind: Kind, value: number) =>
	`${amount(kind, value)} ${unit(kind, value)}`;

/**
 * The last entry of the Settings menu: the cluster's CPU and memory at a glance,
 * refreshed while the menu is open. Each bar fills with what is in use (live
 * from metrics-server; without it, what pods requested), the band behind it
 * is what running pods reserved, and "free" is what new workspaces can still
 * be given; under each, its last 15 minutes; under both, network and disk history.
 * Users who are not admins get no answer, so nothing is shown.
 */
export const ClusterGauge: React.FC<{
	data: ClusterUsage;
	latency?: React.ReactNode;
	active?: boolean;
	className?: string;
}> = ({ data, latency, active = true, className }) => {
	const disk = useQuery({
		...hudHistory("15m"),
		enabled: active,
		retry: false,
		refetchIntervalInBackground: false,
	});

	return (
		<div
			role="group"
			aria-label="Cluster CPU, memory, network and disk"
			data-cluster-gauge=""
			// Platform: its own rounded box, matching the Controls box above it
			className={cn(
				"mx-1 mt-1 mb-1 rounded-lg border border-solid border-border px-2.5 pt-2.5 pb-1.5 cursor-default bg-surface-primary",
				className,
			)}
		>
			<div className="flex items-baseline justify-between mb-2 text-xs font-semibold text-content-primary">
				<span className="inline-flex items-center gap-1.5">
					Cluster
					{latency}
				</span>
				<span
					className="text-2xs font-normal text-content-secondary flex items-center gap-1.5"
					title={
						data.live
							? "In use = live usage (metrics-server)"
							: "metrics-server is not installed: in use = what pods requested"
					}
				>
					{data.live && (
						<span
							aria-hidden
							className="size-1.5 rounded-full bg-content-success animate-pulse motion-reduce:animate-none"
						/>
					)}
					{data.live ? "live" : "requests"} · {data.nodes}{" "}
					{data.nodes === 1 ? "node" : "nodes"}
				</span>
			</div>
			<div className="cluster-gauge-usage grid grid-cols-2 gap-3.5">
				<UsageBar
					kind="cpu"
					label="CPU"
					usage={data.cpu}
					history={data.history}
				/>
				<UsageBar
					kind="memory"
					label="Memory"
					usage={data.memory}
					history={data.history}
				/>
			</div>
			{data.network && data.network.points.length > 0 && (
				<NetworkGraph network={data.network} />
			)}
			<ClusterDiskGraph
				history={disk.data}
				loading={disk.isLoading}
				error={disk.error}
			/>
		</div>
	);
};

/** Use the same units and precision in the full panel and shortcut strip. */
export const usageMeasurement = (
	kind: Kind,
	sample: { used: number; total: number; percent: number },
) =>
	`${formatAmount(kind, sample.used)} of ${formatAmount(kind, sample.total)} (${Math.round(sample.percent)}%)`;

/**
 * Under the CPU and memory bars, as wide as both: the cluster's network
 * traffic over the last 15 minutes, a bar a round (the HUD's samples): what
 * the nodes sent rising above zero in green, what they received below it
 * in blue, both to the same scale (the window's peak). Newest at the
 * right; each bar's time and rates on hover.
 */
const NetworkGraph: React.FC<{ network: ClusterNetwork }> = ({ network }) => {
	const points = network.points.slice(-HISTORY_SLOTS);
	const peakRx = Math.max(1, network.rx, ...points.map((p) => p.rx));
	const peakTx = Math.max(1, network.tx, ...points.map((p) => p.tx));
	const peak = Math.max(peakRx, peakTx);
	const slot = 100 / HISTORY_SLOTS;
	const half = 20;
	const barWidth = slot * 0.7;
	const latest = points.at(-1)?.t;
	const samples = points.map(({ t, tx, rx }) => ({
		t,
		x: historyX(t, latest ?? t, network.every) + slot / 2,
		txY: half - (tx / peak) * (half - 1),
		rxY: half + (rx / peak) * (half - 1),
		tx,
		rx,
		value: tx,
		received: rx,
		measurement: networkMeasurement(tx, rx),
	}));
	const minutes = Math.round((HISTORY_SLOTS * network.every) / 60);

	return (
		<div
			className="cluster-gauge-series mt-3 min-w-0 text-2xs text-content-secondary"
			data-testid="cluster-network"
			data-panel-metric="net"
		>
			<div className="mb-1 flex justify-between font-semibold text-content-primary">
				<span>Network</span>
				<span className="flex gap-2 font-normal tabular-nums">
					<span className="text-content-success" title="TX, sent by the nodes">
						↑ {formatRate(network.tx)}
					</span>
					<span
						data-panel-graph-label
						className="text-content-link"
						title="RX, received by the nodes"
					>
						↓ {formatRate(network.rx)}
					</span>
				</span>
			</div>
			<div className="relative mb-1 flex overflow-hidden rounded">
				<MetricMeter
					label="Network received"
					value={network.rx}
					max={peakRx}
					valueText={`${formatRate(network.rx)} RX · recent peak ${formatRate(peakRx)}`}
					className="w-1/2 rounded-none"
					fillClassName="bg-content-link"
					reverse
				/>
				<MetricMeter
					label="Network sent"
					value={network.tx}
					max={peakTx}
					valueText={`${formatRate(network.tx)} TX · recent peak ${formatRate(peakTx)}`}
					className="w-1/2 rounded-none"
					fillClassName="bg-content-success"
					useMetricColor={false}
				/>
				<span
					aria-hidden
					className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-content-secondary/70"
				/>
			</div>
			<ClusterMetricPlot
				metric="net"
				samples={samples}
				every={network.every}
				{...horizontalHistoryWindow(latest ?? 0, network.every)}
				className="h-10"
			>
				{(shown) => (
					<svg
						data-panel-graph-track
						role="img"
						aria-label={`Cluster network over the last ${minutes} minutes: now ${formatRate(network.rx)} received, ${formatRate(network.tx)} sent`}
						viewBox={`-5 0 105 ${half * 2}`}
						preserveAspectRatio="none"
						className="block h-10 w-full overflow-hidden rounded bg-surface-tertiary"
					>
						{shown.map(({ t, x, txY, rxY, measurement }) => (
							<MetricSample
								key={t}
								x={x - slot / 2}
								width={slot}
								height={half * 2}
								time={t}
								measurement={measurement}
							>
								<rect
									x={x - barWidth / 2}
									width={barWidth}
									y={txY}
									height={half - txY}
									className="fill-content-success/65"
								/>
								<rect
									x={x - barWidth / 2}
									width={barWidth}
									y={half}
									height={rxY - half}
									data-panel-graph-fill
									fillOpacity={0.65}
									className="fill-content-link"
								/>
							</MetricSample>
						))}
						<path
							d={networkTrace(shown, "txY", network.every)}
							className="pointer-events-none fill-none stroke-content-success"
							strokeWidth={1.25}
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={networkTrace(shown, "rxY", network.every)}
							data-panel-graph-stroke
							className="pointer-events-none fill-none stroke-content-link"
							strokeWidth={1.25}
							vectorEffect="non-scaling-stroke"
						/>
						<line
							x1={0}
							x2={100}
							y1={half}
							y2={half}
							className="pointer-events-none stroke-content-secondary/50"
							strokeWidth={0.75}
							vectorEffect="non-scaling-stroke"
						/>
						<MetricYAxis min={-peak} max={peak} top={1} bottom={half * 2 - 1} />
					</svg>
				)}
			</ClusterMetricPlot>
			<div className="mt-1 flex justify-between tabular-nums">
				<span>{minutes} min ago</span>
				<span>peak {formatRate(peak)}</span>
				<span>now</span>
			</div>
		</div>
	);
};

type Level = "high" | "mid" | "low";

const levelOf = (percent: number): Level =>
	percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

/** A round's CPU or memory in use: the amount, of what is allocatable, as a percentage. */
type UsageShare = {
	t: number;
	used: number;
	total: number;
	percent: number;
};

export const usageShares = (
	points: readonly UsagePoint[],
	kind: Kind,
): UsageShare[] =>
	points.map((p) => {
		const used = kind === "cpu" ? p.cpu : p.memory;
		const total = kind === "cpu" ? p.cpuTotal : p.memoryTotal;
		return {
			t: p.t,
			used,
			total,
			percent: total > 0 ? Math.min(100, (used / total) * 100) : 0,
		};
	});

/** The graph's top: the smallest of these (percent) that holds the window's peak, so low usage still shows. */
const GRAPH_TOPS = [10, 25, 50, 100] as const;

export const graphTop = (peak: number): number =>
	GRAPH_TOPS.find((top) => peak <= top) ?? 100;

/**
 * Under a CPU or memory bar: its last 15 minutes, a bar a round (the HUD's
 * samples), each as tall as the share of the allocatable in use then and
 * coloured as the bar above is at that share. The scale's top is the window's
 * peak rounded up (10, 25, 50 or 100%), written under the graph; newest at the
 * right; each bar's time and amount on hover.
 */
const UsageGraph: React.FC<{
	kind: Kind;
	label: string;
	history: ClusterHistory;
}> = ({ kind, label, history }) => {
	const shares = usageShares(history.points.slice(-HISTORY_SLOTS), kind).map(
		(sample) => ({
			...sample,
			value: kind === "cpu" ? sample.used : sample.used / GiB,
			measurement: usageMeasurement(kind, sample),
		}),
	);
	if (shares.length === 0) {
		return null;
	}
	const peak = Math.max(...shares.map((s) => s.percent));
	const top = graphTop(peak);
	const slot = 100 / HISTORY_SLOTS;
	const height = 20;
	const minutes = Math.round((HISTORY_SLOTS * history.every) / 60);

	return (
		<div
			className="cluster-gauge-history mt-1.5"
			data-panel-metric={kind}
			data-testid={`cluster-${kind}-history`}
		>
			<ClusterMetricPlot
				metric={kind}
				samples={shares}
				every={history.every}
				{...horizontalHistoryWindow(shares[shares.length - 1].t, history.every)}
				className="h-6"
			>
				{(shown) => (
					<svg
						data-panel-graph-track
						role="img"
						aria-label={`${label} in use over the last ${minutes} minutes: peak ${Math.round(peak)}%`}
						viewBox={`-5 0 105 ${height}`}
						preserveAspectRatio="none"
						className="block h-6 w-full overflow-hidden rounded bg-surface-tertiary"
					>
						{shown.map((s) => {
							const x = historyX(s.t, shown[shown.length - 1].t, history.every);
							const tall = (Math.min(top, s.percent) / top) * (height - 1);
							const level = levelOf(s.percent);
							return (
								<MetricSample
									key={s.t}
									x={x}
									width={slot}
									height={height}
									time={s.t}
									measurement={s.measurement}
								>
									<rect
										data-panel-graph-fill
										x={x + slot * 0.15}
										width={slot * 0.7}
										y={height - tall}
										height={tall}
										className={
											level === "high"
												? "fill-content-destructive"
												: level === "mid"
													? "fill-content-warning"
													: "fill-content-success"
										}
									/>
								</MetricSample>
							);
						})}
						<MetricYAxis max={top} top={1} bottom={height} />
					</svg>
				)}
			</ClusterMetricPlot>
			<div className="mt-0.5 flex justify-between tabular-nums">
				<span>peak {Math.round(peak)}%</span>
				<span title="The graph's scale">0–{top}%</span>
			</div>
		</div>
	);
};

type UsageBarProps = {
	kind: Kind;
	label: string;
	usage: ResourceUsage;
	/** Its last 15 minutes, drawn under it (UsageGraph); none from an older platform service. */
	history?: ClusterHistory | null;
};

const UsageBar: React.FC<UsageBarProps> = ({ kind, label, usage, history }) => {
	const percentOf = (value: number) =>
		usage.total > 0 ? Math.min(100, (value / usage.total) * 100) : 0;
	const used = percentOf(usage.used);
	const level = levelOf(used);

	return (
		<div
			className="min-w-0 text-2xs text-content-secondary"
			data-panel-metric={kind}
			title={`In use ${formatAmount(kind, usage.used)} · reserved by pods ${formatAmount(kind, usage.requested)} · allocatable ${formatAmount(kind, usage.total)}`}
		>
			<div className="flex justify-between mb-1 font-semibold text-content-primary">
				<span>{label}</span>
				<span>{Math.round(used)}%</span>
			</div>
			<MetricMeter
				label={`${label} in use`}
				value={usage.used}
				max={usage.total}
				reserved={usage.requested}
				valueText={`${formatAmount(kind, usage.used)} of ${formatAmount(kind, usage.total)}`}
				fillClassName={
					level === "high"
						? "bg-content-destructive"
						: level === "mid"
							? "bg-content-warning"
							: "bg-content-success"
				}
			/>
			<div className="mt-1 tabular-nums text-content-primary truncate">
				{amount(kind, usage.used)} / {amount(kind, usage.total)}{" "}
				{unit(kind, usage.total)}
			</div>
			<div className="tabular-nums">{formatAmount(kind, usage.free)} free</div>
			{history && history.points.length > 0 && (
				<UsageGraph kind={kind} label={label} history={history} />
			)}
		</div>
	);
};
