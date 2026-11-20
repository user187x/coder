import { cn } from "cn";
import { useState } from "react";
import { useQuery } from "react-query";
import type { HudRange } from "#/api/platform";
import { clusterUsage, hudHistory } from "#/api/queries/platform";
import { ClusterMetricHistoryChart } from "#/modules/platform/ClusterMetricHistoryChart";
import {
	type ClusterMetric,
	networkMetricSamples,
} from "#/modules/platform/clusterMetricHistory";
import { fmt, Graph, peakScale, Swatch, useHudSampleScroll } from "./HudGraph";
import { type HudPanel, HudSortableGrid } from "./HudSortableGrid";
import { applyOrder, readHudGraphOrder, writeHudGraphOrder } from "./hudOrder";
import { RANGES } from "./hudRanges";

const RANGE_KEY = "hud.graphs.range";

const readRange = (): HudRange => {
	try {
		const v = localStorage.getItem(RANGE_KEY);
		return RANGES.some((r) => r.value === v) ? (v as HudRange) : "1h";
	} catch {
		return "1h";
	}
};

/**
 * The HUD's history graphs, under the totals: system latency (Coder's health endpoint), CPU and memory in use across the cluster
 * (what workspaces use of it, darker), over a chosen range. Sampled by the
 * platform service every 15 seconds whether or not the page is open.
 */
type HudGraphsProps = {
	/** Shown before the graphs' note, at the left of their controls (the HUD's Sort menu). */
	leading?: React.ReactNode;
	focus?: { metric: ClusterMetric; time: number };
	onClearFocus?: () => void;
};

export const HudGraphs: React.FC<HudGraphsProps> = ({
	leading,
	focus,
	onClearFocus,
}) => {
	const [order, setOrder] = useState(readHudGraphOrder);
	const [savedRange, setRangeState] = useState<HudRange>(readRange);
	const range = focus ? "15m" : savedRange;
	const setRange = (r: HudRange) => {
		if (focus) onClearFocus?.();
		setRangeState(r);
		try {
			localStorage.setItem(RANGE_KEY, r);
		} catch {
			// a private window: the choice lasts this visit
		}
	};
	const { data, error } = useQuery(hudHistory(range));
	const focusedTime = (metric: ClusterMetric) =>
		focus?.metric === metric && (metric === "net" || data?.range === range)
			? focus.time
			: undefined;

	return (
		<div className="flex flex-col gap-3" data-testid="hud-graphs">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-3">
					{leading}
					<p className="m-0 text-xs text-content-secondary">
						{data?.points.some((p) => !p.live)
							? "CPU and memory are live from metrics-server where it ran; before that, what pods requested."
							: "Live: sampled every 15 seconds, kept 7 days."}
					</p>
				</div>
				<div role="radiogroup" aria-label="Range" className="flex gap-1">
					{RANGES.map((r) => (
						<button
							key={r.value}
							type="button"
							role="radio"
							aria-checked={range === r.value}
							onClick={() => setRange(r.value)}
							className={cn(
								"cursor-pointer rounded-md border border-solid px-2.5 py-1 text-xs",
								range === r.value
									? "border-content-primary bg-surface-secondary text-content-primary"
									: "border-border bg-transparent text-content-secondary hover:text-content-primary",
							)}
						>
							{r.label}
						</button>
					))}
				</div>
			</div>
			{error && !data ? (
				<p className="m-0 text-sm text-content-destructive">
					The history could not be read.
				</p>
			) : !data ? (
				<div className="h-[226px] rounded-lg border border-solid border-border bg-surface-primary" />
			) : (
				<HudSortableGrid
					className="grid gap-3 lg:grid-cols-3"
					panels={applyOrder<HudPanel>(
						[
							{
								id: "latency",
								label: "System latency",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-latency"
										title="System latency"
										unit="ms"
										history={data}
										bars={(p) => ({ value: p.serviceLatency ?? null })}
										top={(ps) =>
											Math.max(...ps.map((p) => p.serviceLatency ?? 0)) * 1.15
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.serviceLatency, 2)}
												</span>
												<span className="text-sm text-content-secondary">
													ms · Coder response
												</span>
											</>
										)}
										legend={
											<Swatch className="opacity-45">
												health endpoint round trip
											</Swatch>
										}
										empty="No successful Coder response samples in this range"
									/>
								),
							},
							{
								id: "cpu",
								label: "Total CPU used",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-cpu"
										focusedTime={focusedTime("cpu")}
										title="Total CPU used"
										unit="cores"
										history={data}
										bars={(p) => ({ value: p.cpu, part: p.cpuWorkspaces })}
										top={(ps) =>
											peakScale(
												ps,
												(p) => p.cpuPeak ?? p.cpu,
												(p) => p.cpuTotal,
											)
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.cpu, 2)}
												</span>
												<span className="text-sm text-content-secondary">
													of {fmt(p?.cpuTotal)} cores
													{p?.cpuWorkspaces !== null &&
														p?.cpuWorkspaces !== undefined &&
														` · workspaces ${fmt(p.cpuWorkspaces, 2)}`}
												</span>
											</>
										)}
										legend={
											<>
												<Swatch className="opacity-45">cluster</Swatch>
												<Swatch className="">workspaces</Swatch>
											</>
										}
										empty="No samples yet"
									/>
								),
							},
							{
								id: "memory",
								label: "Total memory used",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-memory"
										focusedTime={focusedTime("memory")}
										title="Total memory used"
										unit="GiB"
										history={data}
										bars={(p) => ({
											value: p.memory,
											part: p.memoryWorkspaces,
										})}
										top={(ps) =>
											peakScale(
												ps,
												(p) => p.memoryPeak ?? p.memory,
												(p) => p.memoryTotal,
											)
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.memory)}
												</span>
												<span className="text-sm text-content-secondary">
													of {fmt(p?.memoryTotal)} GiB
													{p?.memoryWorkspaces !== null &&
														p?.memoryWorkspaces !== undefined &&
														` · workspaces ${fmt(p.memoryWorkspaces)}`}
												</span>
											</>
										)}
										legend={
											<>
												<Swatch className="opacity-45">cluster</Swatch>
												<Swatch className="">workspaces</Swatch>
											</>
										}
										empty="No samples yet"
									/>
								),
							},
							{
								id: "network",
								label: "Cluster network",
								render: (handle) => (
									<HudNetworkGraph
										handle={handle}
										focusedTime={focusedTime("net")}
									/>
								),
							},
							{
								id: "disk-used",
								label: "Total disk used",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-disk-used"
										focusedTime={focusedTime("disk")}
										title="Total disk used"
										unit="GiB"
										history={data}
										bars={(p) => ({ value: p.diskUsed ?? null })}
										top={(ps) =>
											Math.max(0, ...ps.map((p) => p.diskUsed ?? 0)) * 1.1
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.diskUsed)}
												</span>
												<span className="text-sm text-content-secondary">
													GiB
												</span>
											</>
										)}
										legend={
											<Swatch className="opacity-45">
												node root filesystems
											</Swatch>
										}
										empty="No storage measurements in this range"
									/>
								),
							},
							{
								id: "disk-claimed",
								label: "Disk claimed",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-disk-claimed"
										title="Disk claimed"
										unit="GiB"
										history={data}
										bars={(p) => ({
											value: p.diskClaimed ?? null,
											part: p.volumeUsed,
										})}
										top={(ps) =>
											Math.max(0, ...ps.map((p) => p.diskClaimed ?? 0)) * 1.1
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.diskClaimed)}
												</span>
												<span className="text-sm text-content-secondary">
													GiB
												</span>
											</>
										)}
										legend={
											<>
												<Swatch className="opacity-45">PVC requests</Swatch>
												<Swatch className="">measured volume usage</Swatch>
											</>
										}
										empty="No storage measurements in this range"
									/>
								),
							},
							{
								id: "disk-total",
								label: "Total disk capacity",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-disk-total"
										title="Total disk capacity"
										unit="GiB"
										history={data}
										bars={(p) => ({
											value: p.diskTotal ?? null,
											part: p.diskUsed,
										})}
										top={(ps) =>
											Math.max(0, ...ps.map((p) => p.diskTotal ?? 0)) * 1.1
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.diskTotal)}
												</span>
												<span className="text-sm text-content-secondary">
													GiB
												</span>
											</>
										)}
										legend={
											<>
												<Swatch className="opacity-45">
													node root filesystems
												</Swatch>
												<Swatch className="">used</Swatch>
											</>
										}
										empty="No storage measurements in this range"
									/>
								),
							},
						],
						order,
					)}
					onReorder={(next) => {
						setOrder(next);
						writeHudGraphOrder(next);
					}}
				/>
			)}
		</div>
	);
};

const HudNetworkGraph = ({
	handle,
	focusedTime,
}: {
	handle?: React.ReactNode;
	focusedTime?: number;
}) => {
	const section = useHudSampleScroll(focusedTime);
	const { data, error } = useQuery(clusterUsage());
	const network = data?.network;
	return (
		<section
			ref={section}
			aria-label="Cluster network"
			className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-surface-primary p-4"
		>
			<header className="flex items-baseline gap-2">
				{handle}
				<h2 className="m-0 flex-1 text-xs font-normal uppercase tracking-wide text-content-secondary">
					Cluster network
				</h2>
				<span className="text-xs text-content-secondary">Last 15 min</span>
			</header>
			{error && !data ? (
				<p className="text-sm text-content-destructive">
					Network history could not be read.
				</p>
			) : (
				<ClusterMetricHistoryChart
					metric="net"
					samples={networkMetricSamples(network)}
					every={network?.every ?? 15}
					focusedTime={focusedTime}
				/>
			)}
		</section>
	);
};
