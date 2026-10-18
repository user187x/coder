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
import { BARS } from "#/modules/resources/MetadataHistogram";
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
/** What the pill shows: the last 5 minutes (the platform service keeps them, so a page opens with them). */
export const PILL_WINDOW_MS = 300_000;
/** How often the window slides on its own (readings or not). */
export const PILL_TICK_MS = 1000;
/** Live readings this late: the minutes are asked of the platform service again (and again, while it lasts). */
export const PILL_STALL_MS = 20_000;

/**
 * The bars of the last 5 minutes, as the metric graphs below draw theirs
 * (MetadataHistogram): BARS slots of 7.5 s, each holding its busiest reading,
 * newest at the right, empty where nothing was read; what was received rising
 * above the middle line, what was sent hanging below it, to the busiest
 * reading shown.
 */
export const pillBars = (samples: readonly NetworkSample[], now: number) => {
	const span = PILL_WINDOW_MS / BARS;
	const start = now - PILL_WINDOW_MS;
	const slots: ({ t: number; rx: number; tx: number } | undefined)[] = [];
	for (const s of samples) {
		if (s.t <= start || s.t > now) {
			continue;
		}
		const i = Math.min(BARS - 1, Math.floor((s.t - start) / span));
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
	const slot = W / BARS;
	const half = H / 2 - 0.5;
	return shown.map((s, n) => ({
		t: s.t,
		x: s.i * slot + slot * 0.15,
		width: slot * 0.7,
		up: Math.max(0.5, (Math.min(s.rx, peak) / peak) * half),
		down: Math.max(0.5, (Math.min(s.tx, peak) / peak) * half),
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
	const [history, setHistory] = useState<NetworkSample[]>([]);
	// the window's clock: it slides every second, readings or not
	const [clock, setClock] = useState(() => Date.now());
	useEffect(() => {
		if (stopped) {
			return;
		}
		const id = setInterval(() => setClock(Date.now()), PILL_TICK_MS);
		return () => clearInterval(id);
	}, [stopped]);
	const stalled =
		!stopped && !locked && clock - (last.current?.at ?? 0) > PILL_STALL_MS;
	const seed = useNetworkSeed(workspaceId, agentId, stopped, stalled);
	const value = item?.result.value ?? "";
	const collectedAt = item?.result.collected_at ?? "";

	// the minutes before the page opened (or before contact came back), and the counters to go on from
	useEffect(() => {
		if (!seed) {
			return;
		}
		setHistory((h) => mergeSamples(seed.samples, h, PILL_WINDOW_MS));
		if (seed.last && (!last.current || seed.last.at > last.current.at)) {
			last.current = seed.last;
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
		last.current = { at, rx, tx };
		if (!prev || at <= prev.at) {
			return;
		}
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
				PILL_WINDOW_MS,
			),
		);
	}, [value, collectedAt, locked]);

	useEffect(() => {
		if (locked) {
			last.current = null;
			setHistory([]);
		}
	}, [locked]);

	// what slid out of the window is dropped (a page left open for days keeps 5 minutes, no more)
	useEffect(() => {
		setHistory((h) =>
			h.length > 0 && h[0].t <= clock - PILL_WINDOW_MS
				? h.filter((s) => s.t > clock - PILL_WINDOW_MS)
				: h,
		);
	}, [clock]);

	if (!(item && parse(value)) && !seed?.last) {
		return null;
	}
	const now = history[history.length - 1];
	const bars = locked ? [] : pillBars(history, stoppedAt ?? clock);
	const label = locked
		? "Network locked down: nothing gets in or out but Coder's own connection"
		: stopped
			? "Network: no live readings (no contact with the workspace) - the last 5 minutes as they were"
			: now
				? `Network, the last 5 minutes: now ↓ ${formatRate(now.rx)} received · ↑ ${formatRate(now.tx)} sent`
				: "Network: waiting for the second reading";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={label}
					data-testid="agent-network-pill"
					data-locked={locked || undefined}
					data-stopped={stopped || undefined}
					className={cn(
						WORKSPACE_PILL,
						"px-3 transition-[filter,opacity] duration-500",
						stopped && "opacity-60 grayscale",
					)}
				>
					<svg
						viewBox={`0 0 ${W} ${H}`}
						preserveAspectRatio="none"
						className="block h-4 w-full overflow-visible"
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
									className="fill-content-success"
								/>
								<rect
									x={b.x}
									width={b.width}
									y={H / 2}
									height={b.down}
									rx={0.75}
									opacity={b.latest ? 1 : 0.7}
									className="fill-content-link"
								/>
							</g>
						))}
					</svg>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
};
