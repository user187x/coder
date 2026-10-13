import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentNetworkMetadata } from "./agentMetadataStore";
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

const formatRate = (bytesPerSecond: number) => {
	const units = ["B", "KB", "MB", "GB"];
	let v = bytesPerSecond;
	let u = 0;
	while (v >= 1000 && u < units.length - 1) {
		v /= 1000;
		u++;
	}
	return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}/s`;
};

/**
 * The workspace's network lights, by its name in the agent's header: RX (green)
 * and TX (blue) in a small oval, lighting up like a network card's LEDs when the
 * workspace receives or sends data. The template reports the workspace's own
 * byte counters every second (metadata "8_net_io", scripts/metadata.sh net);
 * each reading with traffic flickers its light, more often the busier it is.
 */
export const AgentNetworkLeds: React.FC<{ agentId: string }> = ({
	agentId,
}) => {
	const item = useAgentNetworkMetadata(agentId);
	const [rxOn, showRx] = useLed();
	const [txOn, showTx] = useLed();
	const last = useRef<{ at: number; rx: number; tx: number } | null>(null);
	const [rates, setRates] = useState<{ rx: number; tx: number } | null>(null);

	const value = item?.result.value ?? "";
	const collectedAt = item?.result.collected_at ?? "";
	useEffect(() => {
		const counters = parse(value);
		const at = Date.parse(collectedAt);
		if (!counters || Number.isNaN(at)) {
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
		const windowMs = Math.min(1000, seconds * 1000) * 0.9;
		showRx(flashesFor(rxRate), windowMs);
		showTx(flashesFor(txRate), windowMs);
	}, [value, collectedAt, showRx, showTx]);

	const reporting = Boolean(item && parse(value));
	const title = !reporting
		? "Network activity: update this workspace to a template version that reports it"
		: rates
			? `Network: ↓ ${formatRate(rates.rx)} received · ↑ ${formatRate(rates.tx)} sent`
			: "Network activity";

	return (
		<span
			data-testid="agent-network"
			data-reporting={reporting || undefined}
			title={title}
			aria-label={title}
			role="img"
			className="net-leds inline-flex shrink-0 items-center gap-2.5 rounded-full border border-solid border-border px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-content-secondary"
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
		</span>
	);
};
