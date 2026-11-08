import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	networkLocked,
	useWorkspaceLockdown,
} from "#/modules/platform/lockdown/Lockdown";
import { WORKSPACE_PILL } from "#/modules/platform/workspaceUptime/WorkspaceUptime";
import { useAgentNetworkMetadata } from "./agentMetadataStore";
import { formatRate, type NetworkSample } from "./NetworkHistogram";
import { mergeSamples, useNetworkSeed } from "./networkSeed";

const parse = (value: string): [number, number] | null => {
	const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(value);
	return m ? [Number(m[1]), Number(m[2])] : null;
};

/** The graph's floor: an idle workspace's few bytes a second stay near the line. */
const MIN_PEAK = 1024;
const W = 104;
const H = 16;
/** "08:10–08:15" on the pill; "Oct 22, 08:10:12 – 08:15:12" in its tooltip (this browser's time). */
export const spanText = (from: number, to: number) => {
	const hm = (t: number) =>
		new Date(t).toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});
	const hms = (t: number) =>
		new Date(t).toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
			hour12: true,
		});
	const day = new Date(from).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	return {
		start: hm(from),
		end: hm(to),
		long: `${day}, ${hms(from)} – ${hms(to)}`,
	};
};

/** What the pill shows at its narrowest: the last 5 minutes (the platform service keeps them, so a page opens with them). */
const PILL_WINDOW_MS = 300_000;
const PILL_BARS = 80;
/** Dragged wider, the pill shows proportionally more history, up to what the platform service keeps. */
const PILL_GRAPH_WIDTH = 110;
const PILL_MAX_WINDOW_MS = 1_800_000;
/** The gap the dragged pill keeps from the Metrics Interval control. */
const PILL_DRAG_GAP = 12;
const WIDTH_KEY = "coder:network-pill-width";

/** How much history a graph this wide shows: the narrowest pill's density of bars, kept. */
export const pillWindow = (width: number) =>
	Math.min(
		PILL_MAX_WINDOW_MS,
		Math.max(PILL_WINDOW_MS, (PILL_WINDOW_MS * width) / PILL_GRAPH_WIDTH),
	);

const savedWidth = () => {
	const width = Number(localStorage.getItem(WIDTH_KEY));
	return Number.isFinite(width) && width >= PILL_GRAPH_WIDTH
		? width
		: PILL_GRAPH_WIDTH;
};
/** How often the window slides on its own (readings or not). */
const PILL_TICK_MS = 1000;
/** Live readings this late: the minutes are asked of the platform service again (and again, while it lasts). */
const PILL_STALL_MS = 20_000;

const heatColor = (ratio: number) => {
	if (ratio < 0.25) return "fill-content-link";
	if (ratio < 0.5) return "fill-content-success";
	if (ratio < 0.75) return "fill-content-warning";
	return "fill-content-destructive";
};

/**
 * The bars of the last 5 minutes, as the metric graphs below draw theirs
 * (MetadataHistogram): 80 slots of 3.75 s, each holding its busiest reading,
 * newest at the right, empty where nothing was read; what was received rising
 * above the middle line, what was sent hanging below it, to the busiest
 * reading shown.
 */
export const pillBars = (
	samples: readonly NetworkSample[],
	now: number,
	windowMs = PILL_WINDOW_MS,
) => {
	const count = Math.round((PILL_BARS * windowMs) / PILL_WINDOW_MS);
	const span = windowMs / count;
	const start = now - windowMs;
	const slots: ({ t: number; rx: number; tx: number } | undefined)[] = [];
	for (const s of samples) {
		if (s.t <= start || s.t > now) {
			continue;
		}
		const i = Math.min(count - 1, Math.floor((s.t - start) / span));
		const cur = slots[i];
		slots[i] = cur
			? {
					t: Math.max(cur.t, s.t),
					rx: Math.max(cur.rx, s.rx),
					tx: Math.max(cur.tx, s.tx),
				}
			: { t: s.t, rx: s.rx, tx: s.tx };
	}
	const shown = slots.flatMap((v, i) => (v ? [{ ...v, i }] : []));
	const peak = Math.max(MIN_PEAK, ...shown.flatMap((s) => [s.rx, s.tx]));
	const slot = W / count;
	const half = H / 2 - 0.5;
	return shown.map((s, n) => ({
		t: s.t,
		x: s.i * slot + slot * 0.15,
		width: slot * 0.7,
		up: Math.max(0.5, (Math.min(s.rx, peak) / peak) * half),
		down: Math.max(0.5, (Math.min(s.tx, peak) / peak) * half),
		rxColor: heatColor(s.rx / peak),
		txColor: heatColor(s.tx / peak),
		latest: n === shown.length - 1,
	}));
};

/**
 * The workspace page's network at a glance: a pill the uptime pill's size,
 * on the other side of the card under the workspace's name, holding the last
 * 5 minutes of its traffic as a tiny histogram drawn as the metric graphs are
 * - received in green above the line, sent in blue below - its rates on hover.
 * The page opens with the minutes before it (the platform service keeps them),
 * then goes on from the live readings. The window slides every second for as
 * long as the page is open - readings or none: old bars move out at the left -
 * and when live readings stop coming (a dropped stream, a tab woken from
 * sleep) the minutes are asked of the platform service again until they come
 * back, so it never stops on a stale picture. Locked down (Lock Down), a flat
 * red line; stopped (no contact with Coder, the agent gone), still and grey.
 * Nothing for a template that does not report the network.
 */
export const AgentNetworkPill: React.FC<{
	agentId: string;
	workspaceId?: string;
	/** The card's live parts stopped at (ms): no contact with Coder, or the agent not connected. */
	stoppedAt?: number;
}> = ({ agentId, workspaceId, stoppedAt }) => {
	const item = useAgentNetworkMetadata(agentId);
	const locked = networkLocked(useWorkspaceLockdown(workspaceId));
	const stopped = stoppedAt !== undefined;
	const last = useRef<{ at: number; rx: number; tx: number } | null>(null);
	const [lastAt, setLastAt] = useState<number | null>(null);
	const [history, setHistory] = useState<NetworkSample[]>([]);
	const [width, setWidth] = useState(savedWidth);
	const pill = useRef<HTMLSpanElement>(null);
	const drag = useRef<{ x: number; width: number } | null>(null);
	// The widest the graph may be: up to the card's controls (Metrics Interval, Open ports, Lock Down)
	// less a gap, or, when they wrap below, up to the card's edge.
	const [most, setMost] = useState(Number.POSITIVE_INFINITY);
	const measure = () => {
		const el = pill.current;
		const graph = el?.querySelector("svg")?.getBoundingClientRect();
		const controlsEl = el
			?.closest(".workspace-agent-card")
			?.querySelector("[data-agent-controls]");
		if (!(el && graph && controlsEl)) {
			return Number.POSITIVE_INFINITY;
		}
		const box = el.getBoundingClientRect();
		const controls = controlsEl.getBoundingClientRect();
		const row = controlsEl.parentElement?.getBoundingClientRect();
		const tail = box.right - graph.right;
		const sameRow = controls.top < box.bottom && controls.bottom > box.top;
		const edge = sameRow ? controls.left - PILL_DRAG_GAP : row?.right;
		return edge === undefined
			? Number.POSITIVE_INFINITY
			: edge - graph.left - tail;
	};
	const bound = (next: number, limit: number) =>
		Math.round(
			Math.max(PILL_GRAPH_WIDTH, Math.min(next, limit, PILL_GRAPH_WIDTH * 6)),
		);
	const resize = (next: number) => {
		const limit = measure();
		setMost(limit);
		const bounded = bound(next, limit);
		setWidth(bounded);
		return bounded;
	};
	// The graph's drawn width: the row may have shrunk it below the chosen one, and a drag starts from what is seen.
	const drawnWidth = () =>
		Math.round(
			pill.current?.querySelector("svg")?.getBoundingClientRect().width ||
				shownWidth,
		);
	const keep = (value: number) =>
		localStorage.setItem(WIDTH_KEY, String(value));
	// the window's clock: it slides every second, readings or not
	const [clock, setClock] = useState(() => Date.now());
	useEffect(() => {
		if (stopped) {
			return;
		}
		const id = setInterval(() => setClock(Date.now()), PILL_TICK_MS);
		return () => clearInterval(id);
	}, [stopped]);
	const stalled = !stopped && !locked && clock - (lastAt ?? 0) > PILL_STALL_MS;
	const seed = useNetworkSeed(workspaceId, agentId, stopped, stalled);
	const value = item?.result.value ?? "";
	const collectedAt = item?.result.collected_at ?? "";

	// the minutes before the page opened (or before contact came back), and the counters to go on from
	useEffect(() => {
		if (!seed) {
			return;
		}
		setHistory((h) => mergeSamples(seed.samples, h, PILL_MAX_WINDOW_MS));
		if (seed.last && (!last.current || seed.last.at > last.current.at)) {
			last.current = seed.last;
			setLastAt(seed.last.at);
		}
	}, [seed]);

	useEffect(() => {
		const counters = parse(value);
		const at = Date.parse(collectedAt);
		if (locked || !counters || Number.isNaN(at)) {
			return;
		}
		const [rx, tx] = counters;
		const prev = last.current;
		if (!prev) {
			last.current = { at, rx, tx };
			setLastAt(at);
			return;
		}
		if (at <= prev.at) {
			return;
		}
		last.current = { at, rx, tx };
		setLastAt(at);
		const seconds = (at - prev.at) / 1000;
		// counters restart with the workspace: a drop is no traffic
		setHistory((h) =>
			mergeSamples(
				h,
				[
					{
						from: prev.at,
						t: at,
						rx: rx >= prev.rx ? (rx - prev.rx) / seconds : 0,
						tx: tx >= prev.tx ? (tx - prev.tx) / seconds : 0,
					},
				],
				PILL_MAX_WINDOW_MS,
			),
		);
	}, [value, collectedAt, locked]);

	useEffect(() => {
		if (locked) {
			last.current = null;
			setLastAt(null);
			setHistory([]);
		}
	}, [locked]);

	// what slid out of the window is dropped (a page left open for days keeps 5 minutes, no more)
	useEffect(() => {
		setHistory((h) =>
			h.length > 0 && h[0].t <= clock - PILL_MAX_WINDOW_MS
				? h.filter((s) => s.t > clock - PILL_MAX_WINDOW_MS)
				: h,
		);
	}, [clock]);

	const visible = Boolean((item && parse(value)) || seed?.last);
	// the card narrows or widens: the bound is measured again, not only on a drag
	useEffect(() => {
		const el = pill.current;
		if (!(visible && el && typeof ResizeObserver !== "undefined")) {
			return;
		}
		const observer = new ResizeObserver(() => setMost(measure()));
		const row = el
			.closest(".workspace-agent-card")
			?.querySelector("[data-agent-controls]")?.parentElement;
		observer.observe(el);
		if (row) observer.observe(row);
		setMost(measure());
		return () => observer.disconnect();
	}, [visible]);

	if (!visible) {
		return null;
	}
	const shownWidth = bound(width, most);
	const now = history[history.length - 1];
	const end = stoppedAt ?? clock;
	const windowMs = pillWindow(shownWidth);
	const bars = locked ? [] : pillBars(history, end, windowMs);
	// the graph's span, as it is: from its first bar's time to its last's
	const span = spanText(end - windowMs, end);
	const label = locked
		? "Network locked down: nothing gets in or out but Coder's own connection"
		: stopped
			? `Network: no live readings (no contact with the workspace) - ${span.long} as it was`
			: now
				? `Network, ${span.long}: now ↓ ${formatRate(now.rx)} received · ↑ ${formatRate(now.tx)} sent`
				: "Network: waiting for the second reading";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					ref={pill}
					role="img"
					aria-label={label}
					data-testid="agent-network-pill"
					data-locked={locked || undefined}
					data-stopped={stopped || undefined}
					className={cn(
						WORKSPACE_PILL,
						"w-auto min-w-0 max-w-full gap-2 overflow-hidden px-3 transition-[filter,opacity] duration-500",
						stopped && "opacity-60 grayscale",
					)}
				>
					{!locked && (
						<span
							data-testid="agent-network-start"
							className="shrink-0 text-[10px] leading-none tabular-nums"
						>
							{span.start}
						</span>
					)}
					<svg
						viewBox={`0 0 ${W} ${H}`}
						preserveAspectRatio="none"
						style={{ width: shownWidth }}
						className="block h-4 min-w-0 shrink overflow-visible"
						aria-hidden
					>
						<line
							x1={0}
							x2={W}
							y1={H / 2}
							y2={H / 2}
							strokeWidth={locked ? 1.2 : 0.6}
							vectorEffect="non-scaling-stroke"
							className={
								locked ? "stroke-content-destructive" : "stroke-border"
							}
						/>
						{bars.map((b) => (
							<g key={b.t}>
								<rect
									x={b.x}
									width={b.width}
									y={H / 2 - b.up}
									height={b.up}
									rx={0.75}
									opacity={b.latest ? 1 : 0.7}
									className={b.rxColor}
								/>
								<rect
									x={b.x}
									width={b.width}
									y={H / 2}
									height={b.down}
									rx={0.75}
									opacity={b.latest ? 1 : 0.7}
									className={b.txColor}
								/>
							</g>
						))}
					</svg>
					{!locked && (
						<span
							data-testid="agent-network-span"
							className="shrink-0 text-[10px] leading-none tabular-nums"
						>
							{span.end}
						</span>
					)}
					{!locked && (
						<span
							role="separator"
							tabIndex={0}
							aria-orientation="vertical"
							aria-label="Network history width"
							aria-valuenow={shownWidth}
							aria-valuemin={PILL_GRAPH_WIDTH}
							aria-valuemax={PILL_GRAPH_WIDTH * 6}
							aria-valuetext={`${Math.round(windowMs / 60_000)} minutes`}
							title="Drag to show more history (arrow keys too; Home resets)"
							className="-mr-1.5 h-4 w-1.5 shrink-0 cursor-ew-resize touch-none rounded-full bg-border hover:bg-content-link focus-visible:bg-content-link focus-visible:outline-none"
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								drag.current = { x: event.clientX, width: drawnWidth() };
								event.currentTarget.setPointerCapture(event.pointerId);
							}}
							onPointerMove={(event) => {
								const start = drag.current;
								if (start) resize(start.width + event.clientX - start.x);
							}}
							onLostPointerCapture={() => {
								if (drag.current) keep(shownWidth);
								drag.current = null;
							}}
							onKeyDown={(event) => {
								const step = { ArrowRight: 20, ArrowLeft: -20 }[event.key];
								if (step === undefined && event.key !== "Home") return;
								event.preventDefault();
								keep(
									event.key === "Home"
										? resize(PILL_GRAPH_WIDTH)
										: resize(drawnWidth() + (step ?? 0)),
								);
							}}
						/>
					)}
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
};
