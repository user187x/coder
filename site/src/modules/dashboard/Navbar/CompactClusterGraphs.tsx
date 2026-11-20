import { useId, useRef, useState } from "react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import type { ClusterUsage } from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	diskAmounts,
	diskMeasurement,
} from "#/modules/platform/ClusterDiskGraph";
import {
	formatRate,
	graphTop,
	HISTORY_SLOTS,
	historyX,
	usageMeasurement,
	usageShares,
} from "#/modules/platform/ClusterGauge";
import { ClusterMetricHistoryChart } from "#/modules/platform/ClusterMetricHistoryChart";
import {
	type ClusterMetric,
	type ClusterMetricSample,
	type ClusterMetricSelection,
	clusterMetrics,
	hudSamplePath,
	nearestSample,
	networkMetricSamples,
} from "#/modules/platform/clusterMetricHistory";
import { MetricSample } from "#/modules/platform/MetricSample";

type RailSample = ClusterMetricSample & { bar: number };

type Gesture = {
	pointer: number;
	y: number;
	start: number;
	samples: RailSample[];
};

function sampleAt(
	samples: RailSample[],
	every: number,
	button: HTMLButtonElement,
	y: number,
) {
	const latest = samples.at(-1);
	if (!latest) return undefined;
	const box = button.getBoundingClientRect();
	if (!box.height) return latest;
	const offset = Math.min(1, Math.max(0, (y - box.top) / box.height));
	return nearestSample(
		samples,
		latest.t - (HISTORY_SLOTS - 0.5 - offset * HISTORY_SLOTS) * every,
	);
}

/** In the narrow rail, time runs down the plot and bar width shows the reading. */
function RailPlot({
	label,
	summary,
	samples,
	every,
	scale,
	metric,
	onSample,
	onRange,
}: {
	label: string;
	summary: string;
	samples: RailSample[];
	every: number;
	scale: number;
	metric: ClusterMetric;
	onSample: (
		metric: ClusterMetric,
		sample: RailSample,
		every: number,
		control: HTMLButtonElement,
	) => void;
	onRange: (range: ClusterMetricSelection, control: HTMLButtonElement) => void;
}) {
	const gesture = useRef<Gesture | null>(null);
	const instructions = useId();
	const [selection, setSelection] = useState<{
		start: number;
		end: number;
		samples: RailSample[];
	}>();
	const shown = selection?.samples ?? samples;
	const latest = shown.at(-1)?.t;
	const top =
		selection && latest !== undefined
			? historyX(Math.min(selection.start, selection.end), latest, every)
			: 0;
	const bottom =
		selection && latest !== undefined
			? historyX(Math.max(selection.start, selection.end), latest, every) +
				100 / HISTORY_SLOTS
			: 0;
	const title = clusterMetrics[metric].title;
	const cancel = () => {
		gesture.current = null;
		setSelection(undefined);
	};

	return (
		<div
			className="flex min-h-0 flex-col items-stretch gap-1"
			data-panel-metric={metric}
		>
			<span className="text-center text-[9px] font-semibold text-content-secondary">
				{label}
			</span>
			<span id={instructions} hidden>
				Activate a sample or drag to select a time range.
			</span>
			<DropdownMenuItem
				asChild
				disabled={!samples.length}
				onSelect={(event) => event.preventDefault()}
			>
				<button
					type="button"
					aria-label={title}
					aria-describedby={instructions}
					title={summary}
					className="min-h-0 w-full flex-1 touch-none overflow-hidden rounded-(--dock-radius) p-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link"
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						const sample = sampleAt(
							samples,
							every,
							event.currentTarget,
							event.clientY,
						);
						if (!sample) return;
						gesture.current = {
							pointer: event.pointerId,
							y: event.clientY,
							start: sample.t,
							samples,
						};
						event.currentTarget.setPointerCapture?.(event.pointerId);
					}}
					onPointerMove={(event) => {
						const held = gesture.current;
						if (
							held?.pointer !== event.pointerId ||
							Math.abs(event.clientY - held.y) < 5
						)
							return;
						const sample = sampleAt(
							held.samples,
							every,
							event.currentTarget,
							event.clientY,
						);
						if (sample && sample.t !== selection?.end) {
							setSelection({
								start: held.start,
								end: sample.t,
								samples: held.samples,
							});
						}
					}}
					onPointerUp={(event) => {
						const held = gesture.current;
						if (held?.pointer !== event.pointerId) return;
						const sample = sampleAt(
							held.samples,
							every,
							event.currentTarget,
							event.clientY,
						);
						cancel();
						if (!sample) return;
						if (Math.abs(event.clientY - held.y) >= 5) {
							const from = Math.min(held.start, sample.t);
							const to = Math.max(held.start, sample.t);
							onRange(
								{
									metric,
									every,
									samples: held.samples.filter((p) => p.t >= from && p.t <= to),
								},
								event.currentTarget,
							);
						} else {
							onSample(metric, sample, every, event.currentTarget);
						}
					}}
					onPointerCancel={cancel}
					onLostPointerCapture={cancel}
					onClick={(event) => {
						const sample = samples.at(-1);
						if (event.detail === 0 && sample)
							onSample(metric, sample, every, event.currentTarget);
					}}
				>
					<svg
						data-panel-graph-track
						role="img"
						aria-label={summary}
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						className="h-full w-full bg-surface-tertiary"
					>
						{latest !== undefined &&
							shown.map(({ t, bar, measurement }) => {
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
											width={Math.min(100, (100 * bar) / scale)}
											className="fill-content-link"
										/>
									</MetricSample>
								);
							})}
						{selection && (
							<rect
								x={0}
								y={top}
								width={100}
								height={bottom - top}
								className="pointer-events-none fill-content-primary/20 stroke-content-primary"
								vectorEffect="non-scaling-stroke"
							/>
						)}
					</svg>
				</button>
			</DropdownMenuItem>
		</div>
	);
}

/** A fifteen-minute history for the collapsed Settings sidebar. */
export function CompactClusterGraphs({
	data,
	canViewHud,
}: {
	data: ClusterUsage;
	canViewHud: boolean;
}) {
	const navigate = useNavigate();
	const [range, setRange] = useState<ClusterMetricSelection>();
	const returnFocus = useRef<HTMLButtonElement>(null);
	const showRange = (
		selection: ClusterMetricSelection,
		control: HTMLButtonElement,
	) => {
		returnFocus.current = control;
		setRange(selection);
	};
	const selectSample = (
		metric: ClusterMetric,
		sample: RailSample,
		every: number,
		control: HTMLButtonElement,
	) => {
		if (canViewHud) void navigate(hudSamplePath(metric, sample.t));
		else showRange({ metric, every, samples: [sample] }, control);
	};
	const actions = { onSample: selectSample, onRange: showRange };
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
	const first = range?.samples[0];
	const last = range?.samples.at(-1);
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
						{...actions}
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
				{...actions}
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
				{...actions}
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
			<Dialog
				open={Boolean(range)}
				onOpenChange={(open) => !open && setRange(undefined)}
			>
				{range && first && last && (
					<DialogContent
						className="w-[min(94vw,52rem)] max-w-none gap-4 rounded-2xl"
						overlayClassName="backdrop-blur-md"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							returnFocus.current?.focus();
						}}
					>
						<DialogTitle>{clusterMetrics[range.metric].title}</DialogTitle>
						<DialogDescription>
							{new Date(first.t * 1000).toLocaleString("en-US")}
							{last.t !== first.t &&
								` to ${new Date(last.t * 1000).toLocaleString("en-US")}`}
						</DialogDescription>
						<ClusterMetricHistoryChart {...range} />
						<DialogClose asChild>
							<Button variant="outline" className="justify-self-end">
								Close
							</Button>
						</DialogClose>
					</DialogContent>
				)}
			</Dialog>
		</div>
	);
}
