import { cn } from "cn";
import { useState } from "react";
import { useQuery } from "react-query";
import type { HudHistory, HudHistoryPoint, HudRange } from "#/api/platform";
import { hudHistory } from "#/api/queries/platform";

const RANGES: { value: HudRange; label: string }[] = [
	{ value: "15m", label: "15 min" },
	{ value: "1h", label: "1 hour" },
	{ value: "6h", label: "6 hours" },
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
];

const RANGE_KEY = "hud.graphs.range";

const readRange = (): HudRange => {
	try {
		const v = localStorage.getItem(RANGE_KEY);
		return RANGES.some((r) => r.value === v) ? (v as HudRange) : "1h";
	} catch {
		return "1h";
	}
};

const fmt = (v: number | null | undefined, digits = 1) =>
	v === null || v === undefined
		? "—"
		: v.toLocaleString("en-US", { maximumFractionDigits: digits });

const clock = (t: number, range: HudRange) =>
	new Date(t * 1000).toLocaleString("en-US", {
		...(range === "7d" || range === "24h"
			? { weekday: "short", hour: "numeric", minute: "2-digit" }
			: { hour: "numeric", minute: "2-digit", second: "2-digit" }),
	});

type Bar = {
	/** The bar (cluster in use, the median latency). */
	value: number | null;
	/** A part of it, drawn darker (what workspaces use). */
	part?: number | null;
	/** A mark above it (the 95th percentile latency). */
	mark?: number | null;
};

type GraphProps = {
	title: string;
	unit: string;
	history: HudHistory;
	bars: (p: HudHistoryPoint) => Bar;
	/** The top of the scale for these points. */
	top: (points: HudHistoryPoint[]) => number;
	/** The figure in the card's header: the latest bucket, or the hovered one. */
	summary: (p: HudHistoryPoint | undefined) => React.ReactNode;
	legend: React.ReactNode;
	empty: string;
	testId: string;
};

/**
 * A histogram over time: one bar per bucket of the range (gaps where nothing
 * was measured), scaled to `top`. Hovering a bar shows its bucket in the
 * header.
 */
const Graph: React.FC<GraphProps> = ({
	title,
	unit,
	history,
	bars,
	top,
	summary,
	legend,
	empty,
	testId,
}) => {
	const [hover, setHover] = useState<number | null>(null);
	const slots = Math.max(
		1,
		Math.ceil((history.end - history.start) / history.step),
	);
	const bySlot = new Map<number, HudHistoryPoint>();
	for (const p of history.points) {
		bySlot.set(
			Math.min(slots - 1, Math.floor((p.t - history.start) / history.step)),
			p,
		);
	}
	const measured = history.points.filter((p) => bars(p).value !== null);
	const max = Math.max(top(history.points), 1e-6);
	const latest = [...history.points]
		.reverse()
		.find((p) => bars(p).value !== null);
	const shown = hover !== null ? bySlot.get(hover) : latest;
	const W = 100 / slots;
	const H = 100;
	const y = (v: number) => H - Math.min(1, v / max) * H;

	return (
		<section
			className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-surface-primary p-4"
			data-testid={testId}
			aria-label={title}
		>
			<header className="flex items-baseline justify-between gap-2">
				<h2 className="m-0 text-xs font-normal uppercase tracking-wide text-content-secondary">
					{title}
				</h2>
				<span className="truncate text-xs tabular-nums text-content-secondary">
					{shown ? clock(shown.t, history.range) : ""}
				</span>
			</header>
			<div className="flex min-h-9 items-baseline gap-2">{summary(shown)}</div>
			<div className="relative h-28">
				{measured.length === 0 ? (
					<div className="flex h-full items-center justify-center rounded border border-dashed border-border text-sm text-content-secondary">
						{empty}
					</div>
				) : (
					<svg
						viewBox={`0 0 100 ${H}`}
						preserveAspectRatio="none"
						className="h-full w-full overflow-visible"
						role="img"
						aria-label={`${title}, ${RANGES.find((r) => r.value === history.range)?.label}`}
						onMouseLeave={() => setHover(null)}
						onMouseMove={(e) => {
							const box = e.currentTarget.getBoundingClientRect();
							const slot = Math.floor(
								((e.clientX - box.left) / box.width) * slots,
							);
							setHover(Math.max(0, Math.min(slots - 1, slot)));
						}}
					>
						{[0.25, 0.5, 0.75].map((f) => (
							<line
								key={f}
								x1={0}
								x2={100}
								y1={H * f}
								y2={H * f}
								className="stroke-border"
								strokeWidth={0.5}
								vectorEffect="non-scaling-stroke"
							/>
						))}
						{[...bySlot.entries()].map(([slot, p]) => {
							const b = bars(p);
							if (b.value === null) {
								return null;
							}
							const x = slot * W + W * 0.12;
							const w = W * 0.76;
							return (
								<g
									key={slot}
									className={cn(
										"text-content-link",
										hover !== null && hover !== slot && "opacity-50",
									)}
								>
									{b.mark !== null && b.mark !== undefined && (
										<rect
											x={x}
											width={w}
											y={y(b.mark)}
											height={Math.max(0, y(b.value) - y(b.mark))}
											className="fill-current opacity-20"
										/>
									)}
									<rect
										x={x}
										width={w}
										y={y(b.value)}
										height={H - y(b.value)}
										className="fill-current opacity-45"
									/>
									{b.part !== null && b.part !== undefined && (
										<rect
											x={x}
											width={w}
											y={y(b.part)}
											height={H - y(b.part)}
											className="fill-current"
										/>
									)}
								</g>
							);
						})}
					</svg>
				)}
			</div>
			<footer className="flex items-center justify-between gap-2 text-xs text-content-secondary">
				<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
					{legend}
				</span>
				<span className="tabular-nums">
					scale {fmt(max)} {unit}
				</span>
			</footer>
		</section>
	);
};

const Swatch: React.FC<{ className: string; children: React.ReactNode }> = ({
	className,
	children,
}) => (
	<span className="flex items-center gap-1">
		<span
			aria-hidden
			className={cn(
				"inline-block size-2.5 rounded-sm bg-content-link",
				className,
			)}
		/>
		{children}
	</span>
);

/**
 * The HUD's three graphs, under the totals: system latency (users'
 * connections to their workspaces), CPU and memory in use across the cluster
 * (what workspaces use of it, darker), over a chosen range. Sampled by the
 * platform service every 15 seconds whether or not the page is open.
 */
export const HudGraphs: React.FC = () => {
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
				<p className="m-0 text-xs text-content-secondary">
					{data?.points.some((p) => !p.live)
						? "CPU and memory are live from metrics-server where it ran; before that, what pods requested."
						: "Live: sampled every 15 seconds, kept 7 days."}
				</p>
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
			{error ? (
				<p className="m-0 text-sm text-content-destructive">
					The history could not be read.
				</p>
			) : !data ? (
				<div className="h-[226px] rounded-lg border border-solid border-border" />
			) : (
				<div className="grid gap-3 lg:grid-cols-3">
					<Graph
						testId="hud-graph-latency"
						title="System latency"
						unit="ms"
						history={data}
						bars={(p) => ({ value: p.latency, mark: p.latencyP95 })}
						top={(ps) =>
							Math.max(...ps.map((p) => p.latencyP95 ?? p.latency ?? 0)) * 1.15
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
					<Graph
						testId="hud-graph-cpu"
						title="Total CPU used"
						unit="cores"
						history={data}
						bars={(p) => ({ value: p.cpu, part: p.cpuWorkspaces })}
						top={(ps) => Math.max(...ps.map((p) => p.cpuTotal ?? p.cpu ?? 0))}
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
					<Graph
						testId="hud-graph-memory"
						title="Total memory used"
						unit="GiB"
						history={data}
						bars={(p) => ({ value: p.memory, part: p.memoryWorkspaces })}
						top={(ps) =>
							Math.max(...ps.map((p) => p.memoryTotal ?? p.memory ?? 0))
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
				</div>
			)}
		</div>
	);
};
