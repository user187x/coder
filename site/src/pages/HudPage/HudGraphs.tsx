import { cn } from "cn";
import { useState } from "react";
import { useQuery } from "react-query";
import type { HudRange } from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";
import { fmt, Graph, peakScale, Swatch } from "./HudGraph";
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
 * The HUD's history graphs, under the totals: system latency (users'
 * connections to their workspaces), CPU and memory in use across the cluster
 * (what workspaces use of it, darker), over a chosen range. Sampled by the
 * platform service every 15 seconds whether or not the page is open.
 */
type HudGraphsProps = {
	/** Shown before the graphs' note, at the left of their controls (the HUD's Sort menu). */
	leading?: React.ReactNode;
};

export const HudGraphs: React.FC<HudGraphsProps> = ({ leading }) => {
	const [order, setOrder] = useState(readHudGraphOrder);
	const [range, setRangeState] = useState<HudRange>(readRange);
	const setRange = (r: HudRange) => {
		setRangeState(r);
		try {
			localStorage.setItem(RANGE_KEY, r);
		} catch {
			// a private window: the choice lasts this visit
		}
	};
	const { data, error } = useQuery(hudHistory(range));

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
				<div className="h-[226px] rounded-lg border border-solid border-border" />
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
										bars={(p) => ({ value: p.latency, mark: p.latencyP95 })}
										top={(ps) =>
											Math.max(
												...ps.map((p) => p.latencyP95 ?? p.latency ?? 0),
											) * 1.15
										}
										summary={(p) => (
											<>
												<span className="text-2xl font-semibold tabular-nums">
													{fmt(p?.latency, 2)}
												</span>
												<span className="text-sm text-content-secondary">
													ms median
													{p?.latencyP95 !== null &&
														p?.latencyP95 !== undefined &&
														` · p95 ${fmt(p.latencyP95, 2)} ms`}
													{p
														? ` · ${p.connections} agent${p.connections === 1 ? "" : "s"}`
														: ""}
												</span>
											</>
										)}
										legend={
											<>
												<Swatch className="opacity-45">median</Swatch>
												<Swatch className="opacity-20">95th percentile</Swatch>
											</>
										}
										empty="No one connected to a workspace in this range"
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
								id: "disk-used",
								label: "Total disk used",
								render: (handle) => (
									<Graph
										handle={handle}
										testId="hud-graph-disk-used"
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
