import { useQuery } from "react-query";
import type { ClusterUsage } from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";
import {
	diskAmounts,
	diskMeasurement,
} from "#/modules/platform/ClusterDiskGraph";
import {
	graphTop,
	usageMeasurement,
	usageShares,
} from "#/modules/platform/ClusterGauge";
import { ClusterMetricPlot } from "#/modules/platform/ClusterMetricDrilldown";
import {
	type ClusterMetric,
	type ClusterMetricSample,
	formatRate,
	HISTORY_SLOTS,
	historyX,
	networkMetricSamples,
} from "#/modules/platform/clusterMetricHistory";
import { MetricSample } from "#/modules/platform/MetricSample";

type RailSample = ClusterMetricSample & { bar: number };

/** In the narrow rail, time runs down the plot and bar width shows the reading. */
function RailPlot({
	label,
	summary,
	samples,
	every,
	scale,
	metric,
}: {
	label: string;
	summary: string;
	samples: RailSample[];
	every: number;
	scale: number;
	metric: ClusterMetric;
}) {
	return (
		<div
			className="flex min-h-0 flex-col items-stretch gap-1"
			data-panel-metric={metric}
		>
			<span className="text-center text-[9px] font-semibold text-content-secondary">
				{label}
			</span>
			<ClusterMetricPlot
				metric={metric}
				summary={summary}
				samples={samples}
				every={every}
				start={(samples.at(-1)?.t ?? 0) - (HISTORY_SLOTS - 0.5) * every}
				span={HISTORY_SLOTS * every}
				vertical
				className="min-h-0 flex-1 rounded-(--dock-radius)"
			>
				{(shown) => (
					<svg
						data-panel-graph-track
						role="img"
						aria-label={summary}
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						className="absolute inset-0 block size-full bg-surface-tertiary"
					>
						{shown.map(({ t, bar, measurement }) => {
							const y = historyX(t, shown.at(-1)?.t ?? t, every);
							return (
								<MetricSample
									key={t}
									x={0}
									y={y}
									width={100}
									height={100 / HISTORY_SLOTS}
									time={t}
									measurement={measurement}
								>
									<rect
										data-panel-graph-fill
										x={0}
										y={y}
										height={1.4}
										width={Math.min(100, (100 * bar) / scale)}
										className="fill-content-link"
									/>
								</MetricSample>
							);
						})}
					</svg>
				)}
			</ClusterMetricPlot>
		</div>
	);
}

/** A fifteen-minute history for the collapsed Settings sidebar. */
export function CompactClusterGraphs({ data }: { data: ClusterUsage }) {
	const disk = useQuery({
		...hudHistory("15m"),
		retry: false,
		refetchIntervalInBackground: false,
	});
	const network = data.network;
	const traffic = networkMetricSamples(network)
		.slice(-HISTORY_SLOTS)
		.map((p) => ({
			...p,
			bar: p.value + p.received,
		}));
	const storage = (disk.data?.points ?? [])
		.slice(-HISTORY_SLOTS)
		.flatMap((point) => {
			const sample = diskAmounts(point);
			const { used, total } = sample;
			return used !== null && total !== null && total > 0
				? [
						{
							t: point.t,
							value: used,
							bar: (100 * used) / total,
							measurement: diskMeasurement(sample),
						},
					]
				: [];
		});
	return (
		<div
			role="group"
			aria-label="Cluster metric history"
			className="grid h-full min-h-0 grid-rows-4 gap-2"
		>
			{(["cpu", "memory"] as const).map((kind) => {
				const samples = usageShares(
					data.history?.points.slice(-HISTORY_SLOTS) ?? [],
					kind,
				).map((p) => ({
					t: p.t,
					value: kind === "cpu" ? p.used : p.used / 1024 ** 3,
					bar: p.percent,
					measurement: usageMeasurement(kind, p),
				}));
				const label = kind === "cpu" ? "CPU" : "MEM";
				const resource = data[kind];
				const reading =
					resource.total > 0
						? `${Math.round((100 * resource.used) / resource.total)}% ${data.live ? "used" : "requested"}`
						: "unavailable";
				return (
					<RailPlot
						key={kind}
						label={label}
						metric={kind}
						summary={`${label}: ${reading}`}
						samples={samples}
						every={data.history?.every ?? 15}
						scale={graphTop(Math.max(0, ...samples.map((p) => p.bar)))}
					/>
				);
			})}
			<RailPlot
				label="NET"
				metric="net"
				summary={
					network
						? `Network: ${formatRate(network.rx)} received, ${formatRate(network.tx)} sent`
						: "Network unavailable"
				}
				samples={traffic}
				every={network?.every ?? 15}
				scale={Math.max(1, ...traffic.map((p) => p.bar))}
			/>
			<RailPlot
				label="DISK"
				metric="disk"
				summary={
					storage.length
						? `Disk: ${Math.round(storage[storage.length - 1].bar)}% used`
						: "Disk usage unavailable"
				}
				samples={storage}
				every={disk.data?.step ?? 15}
				scale={100}
			/>
		</div>
	);
}
