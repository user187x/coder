import { useCallback, useEffect, useRef, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	networkLocked,
	useWorkspaceLockdown,
} from "#/modules/platform/lockdown/Lockdown";
import { useAgentNetworkMetadata } from "./agentMetadataStore";
import {
	formatRate,
	NetworkHistogram,
	type NetworkSample,
	withSample,
} from "./NetworkHistogram";
import "./networkLeds.css";

/** "received sent" byte counters, as the template's net metadata reports them. */
const parse = (value: string): [number, number] | null => {
	const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(value);
	return m ? [Number(m[1]), Number(m[2])] : null;
};

const animationsOff = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** How many times an LED flickers for a second at this many bytes a second: more traffic, busier light. */
export const flashesFor = (bytesPerSecond: number) =>
	bytesPerSecond <= 0
		? 0
		: Math.max(1, Math.min(5, Math.ceil(Math.log10(bytesPerSecond + 1) / 1.5)));

/** One LED: flickers (blink) for activity, or stays lit for the reading (steady) without animations. */
const useLed = () => {
	const [on, setOn] = useState(false);
	const timers = useRef<number[]>([]);
	const clear = useCallback(() => {
		for (const t of timers.current) {
			window.clearTimeout(t);
		}
		timers.current = [];
	}, []);
	useEffect(() => clear, [clear]);
	const show = useCallback(
		(flashes: number, windowMs: number) => {
			clear();
			if (flashes === 0) {
				setOn(false);
				return;
			}
			if (animationsOff()) {
				setOn(true); // lit until the next reading says otherwise
				return;
			}
			const slot = windowMs / flashes;
			for (let i = 0; i < flashes; i++) {
				const start = i * slot + Math.random() * slot * 0.4;
				const length = 50 + Math.random() * 70;
				timers.current.push(
					window.setTimeout(() => setOn(true), start),
					window.setTimeout(() => setOn(false), start + length),
				);
			}
		},
		[clear],
	);
	return [on, show] as const;
};

/**
 * The workspace's network lights, by its name in the agent's header: RX (green)
 * and TX (blue) in a small oval, lighting up like a network card's LEDs when the
 * workspace receives or sends data. The template reports the workspace's own
 * byte counters every second (metadata "8_net_io", scripts/metadata.sh net);
 * each reading with traffic flickers its light, more often the busier it is.
 * Hovering the lights (or focusing them) shows the last minute as a live bar
 * graph, received in green and sent in blue (NetworkHistogram). While an admin
 * has the workspace's network locked down (Lock Down: Network, Complete or
 * Freeze) both lights are red and still, and the graph shows no traffic: none
 * gets in or out but Coder's own connection to its agent.
 */
export const AgentNetworkLeds: React.FC<{
	agentId: string;
	/** Its workspace, for Lock Down (none: never shown as locked). */
	workspaceId?: string;
}> = ({ agentId, workspaceId }) => {
	const item = useAgentNetworkMetadata(agentId);
	const locked = networkLocked(useWorkspaceLockdown(workspaceId));
	const [rxOn, showRx] = useLed();
	const [txOn, showTx] = useLed();
	const last = useRef<{ at: number; rx: number; tx: number } | null>(null);
	const [rates, setRates] = useState<{ rx: number; tx: number } | null>(null);
	// the last minute's readings (since the page opened), for the hover graph
	const [history, setHistory] = useState<NetworkSample[]>([]);

	const value = item?.result.value ?? "";
	const collectedAt = item?.result.collected_at ?? "";
	// Locked down: the lights off (red, still), and the graph started afresh with a reading of no traffic each
	// second, whether or not the agent still reports (Freeze pauses it); the counters start afresh once it is lifted.
	useEffect(() => {
		if (!locked) {
			return;
		}
		showRx(0, 0);
		showTx(0, 0);
		last.current = null;
		setRates({ rx: 0, tx: 0 });
		setHistory([]);
		const add = () => {
			const t = Date.now();
			setHistory((h) =>
				withSample(h, {
					from: h.length ? Math.max(h[h.length - 1].t, t - 1000) : t - 1000,
					t,
					rx: 0,
					tx: 0,
				}),
			);
		};
		add();
		const id = window.setInterval(add, 1000);
		return () => window.clearInterval(id);
	}, [locked, showRx, showTx]);

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
		const rxRate = rx >= prev.rx ? (rx - prev.rx) / seconds : 0;
		const txRate = tx >= prev.tx ? (tx - prev.tx) / seconds : 0;
		setRates({ rx: rxRate, tx: txRate });
		setHistory((h) =>
			withSample(h, { from: prev.at, t: at, rx: rxRate, tx: txRate }),
		);
		const windowMs = Math.min(1000, seconds * 1000) * 0.9;
		showRx(flashesFor(rxRate), windowMs);
		showTx(flashesFor(txRate), windowMs);
	}, [value, collectedAt, locked, showRx, showTx]);

	const reporting = Boolean(item && parse(value));
	const title = locked
		? "Network locked down: nothing gets in or out but Coder's own connection"
		: !reporting
			? "Network activity: update this workspace to a template version that reports it"
			: rates
				? `Network: ↓ ${formatRate(rates.rx)} received · ↑ ${formatRate(rates.tx)} sent`
				: "Network activity";

	const leds = (
		// a button, so the graph opens from the keyboard as well (it does nothing on a click)
		<button
			type="button"
			data-testid="agent-network"
			data-reporting={reporting || undefined}
			data-locked={locked || undefined}
			aria-label={title}
			className="net-leds inline-flex shrink-0 cursor-default items-center gap-2.5 rounded-full border border-solid border-border bg-transparent px-2.5 py-0.5 font-[inherit] text-[11px] font-medium tabular-nums text-content-secondary"
		>
			<span className="inline-flex items-center gap-1">
				<span
					className="net-led net-led-rx"
					data-testid="agent-network-rx"
					data-on={rxOn || undefined}
				/>
				RX ↓
			</span>
			<span className="inline-flex items-center gap-1">
				<span
					className="net-led net-led-tx"
					data-testid="agent-network-tx"
					data-on={txOn || undefined}
				/>
				TX ↑
			</span>
		</button>
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>{leds}</TooltipTrigger>
			<TooltipContent
				side="bottom"
				align="start"
				className="px-3 py-2.5"
				data-testid="agent-network-tooltip"
			>
				{locked || reporting ? (
					history.length > 0 ? (
						<NetworkHistogram samples={history} locked={locked} />
					) : (
						"Network: waiting for the next reading…"
					)
				) : (
					title
				)}
			</TooltipContent>
		</Tooltip>
	);
};
