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

const parse = (value: string): [number, number] | null => {
	const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(value);
	return m ? [Number(m[1]), Number(m[2])] : null;
};

/** The graph's floor: an idle workspace's few bytes a second stay near the line. */
const MIN_PEAK = 1024;
const W = 104;
const H = 16;

/**
 * The bars of the latest readings, as the metric graphs below draw theirs
 * (MetadataHistogram): BARS slots, a thin bar a reading, newest at the right;
 * what was received rising above the middle line, what was sent hanging below
 * it, to the busiest reading shown.
 */
export const pillBars = (samples: NetworkSample[]) => {
	const shown = samples.slice(-BARS);
	const peak = Math.max(MIN_PEAK, ...shown.flatMap((s) => [s.rx, s.tx]));
	const slot = W / BARS;
	const half = H / 2 - 0.5;
	return shown.map((s, i) => ({
		t: s.t,
		x: (BARS - shown.length + i) * slot + slot * 0.15,
		width: slot * 0.7,
		up: Math.max(0.5, (Math.min(s.rx, peak) / peak) * half),
		down: Math.max(0.5, (Math.min(s.tx, peak) / peak) * half),
		latest: i === shown.length - 1,
	}));
};

/**
 * The workspace page's network at a glance: a pill the uptime pill's size,
 * on the other side of the card under the workspace's name, holding its
 * latest traffic readings as a tiny histogram drawn as the metric graphs are
 * (a thin bar a reading) - received in green above the line, sent in blue
 * below - its rates on hover. Locked down (Lock Down), a
 * flat red line. Nothing for a template that does not report the network.
 */
export const AgentNetworkPill: React.FC<{
	agentId: string;
	workspaceId?: string;
}> = ({ agentId, workspaceId }) => {
	const item = useAgentNetworkMetadata(agentId);
	const locked = networkLocked(useWorkspaceLockdown(workspaceId));
	const last = useRef<{ at: number; rx: number; tx: number } | null>(null);
	const [history, setHistory] = useState<NetworkSample[]>([]);
	const value = item?.result.value ?? "";
	const collectedAt = item?.result.collected_at ?? "";

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
			[
				...h,
				{
					from: prev.at,
					t: at,
					rx: rx >= prev.rx ? (rx - prev.rx) / seconds : 0,
					tx: tx >= prev.tx ? (tx - prev.tx) / seconds : 0,
				},
			].slice(-BARS),
		);
	}, [value, collectedAt, locked]);

	useEffect(() => {
		if (locked) {
			last.current = null;
			setHistory([]);
		}
	}, [locked]);

	if (!item || !parse(value)) {
		return null;
	}
	const now = history[history.length - 1];
	const bars = locked ? [] : pillBars(history);
	const label = locked
		? "Network locked down: nothing gets in or out but Coder's own connection"
		: now
			? `Network, latest readings: now ↓ ${formatRate(now.rx)} received · ↑ ${formatRate(now.tx)} sent`
			: "Network: waiting for the second reading";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={label}
					data-testid="agent-network-pill"
					data-locked={locked || undefined}
					className={`${WORKSPACE_PILL} px-3`}
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
