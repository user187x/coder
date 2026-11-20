import { useQuery } from "react-query";
import type { ClusterUsage } from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";
import {
	diskAmounts,
	diskMeasurement,
} from "#/modules/platform/ClusterDiskGraph";
import {
	formatRate,
	graphTop,
	HISTORY_SLOTS,
	historyX,
	networkMeasurement,
	usageMeasurement,
	usageShares,
} from "#/modules/platform/ClusterGauge";
import { MetricSample } from "#/modules/platform/MetricSample";

type Sample = { t: number; value: number; measurement: string };

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
	samples: Sample[];
	every: number;
	scale: number;
	metric: "cpu" | "memory" | "net" | "disk";
}) {
	const latest = samples.at(-1)?.t;
	return (
		<div
			className="flex min-h-0 flex-col items-stretch gap-1"
			title={summary}
			data-panel-metric={metric}
		>
			<span className="text-center text-[9px] font-semibold text-content-secondary">
				{label}
			</span>
			<svg
				data-panel-graph-track
				role="img"
				aria-label={summary}
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				className="min-h-0 w-full flex-1 overflow-hidden rounded-(--dock-radius) bg-surface-tertiary"
			>
				{latest !== undefined &&
					samples.map(({ t, value, measurement }) => {
						const y = historyX(t, latest, every);
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
									x="0"
									y={y}
									height={1.4}
									width={Math.min(100, (100 * value) / scale)}
									className="fill-content-link"
								/>
							</MetricSample>
						);
					})}
			</svg>
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
	const traffic = (network?.points ?? [])
		.slice(-HISTORY_SLOTS)
		.map(({ t, rx, tx }) => ({
			t,
			value: rx + tx,
			measurement: networkMeasurement(tx, rx),
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
							value: (100 * used) / total,
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
					value: p.percent,
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
						scale={graphTop(Math.max(0, ...samples.map((p) => p.value)))}
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
				scale={Math.max(1, ...traffic.map((p) => p.value))}
			/>
			<RailPlot
				label="DISK"
				metric="disk"
				summary={
					storage.length
						? `Disk: ${Math.round(storage[storage.length - 1].value)}% used`
						: "Disk usage unavailable"
				}
				samples={storage}
				every={disk.data?.step ?? 15}
				scale={100}
			/>
		</div>
	);
}
