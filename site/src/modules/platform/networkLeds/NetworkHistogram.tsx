/**
 * One reading of the workspace's traffic: bytes a second received (rx) and sent
 * (tx) between the previous reading (from) and this one (t), both in ms.
 */
export type NetworkSample = { from: number; t: number; rx: number; tx: number };

/**
 * What the graph shows: the last minute, by the readings' own times (the agent
 * batches its metadata, so readings arrive every few seconds, not every second).
 */
export const NETWORK_WINDOW_MS = 60_000;

/** The readings of the last minute up to the newest, with this one added. */
export const withSample = (history: NetworkSample[], s: NetworkSample) =>
	[...history, s].filter((x) => x.t > s.t - NETWORK_WINDOW_MS);

const UNITS = [
	{ unit: "B/s", size: 1 },
	{ unit: "KB/s", size: 1e3 },
	{ unit: "MB/s", size: 1e6 },
	{ unit: "GB/s", size: 1e9 },
];

/**
 * The Y axis for a peak rate (bytes a second): a round top (1, 2 or 5 times a
 * power of ten) in the largest unit that keeps it at 1 or more, so the labels
 * read 0 / 2.5 / 5 MB/s, not 0 / 2500000 / 5000000.
 */
export const scaleFor = (peak: number) => {
	const p = Math.max(peak, 1);
	const u = [...UNITS].reverse().find((x) => p >= x.size) ?? UNITS[0];
	const v = p / u.size;
	const pow = 10 ** Math.floor(Math.log10(v));
	const step = [1, 2, 5, 10].find((s) => v <= s * pow) ?? 10;
	const top = step * pow;
	const label = (n: number) =>
		`${Number.isInteger(n) ? n : Number(n.toPrecision(2))} ${u.unit}`;
	return {
		/** The top of the axis, in bytes a second. */
		max: top * u.size,
		unit: u.unit,
		ticks: [top, top / 2, 0].map((n) => ({
			value: n * u.size,
			label: label(n),
		})),
	};
};

export const formatRate = (bytesPerSecond: number) => {
	const u =
		[...UNITS].reverse().find((x) => bytesPerSecond >= x.size) ?? UNITS[0];
	const v = bytesPerSecond / u.size;
	return `${v < 10 && u.size > 1 ? v.toFixed(1) : Math.round(v)} ${u.unit}`;
};

const W = 300;
const H = 110;
const AXIS = 54;

/**
 * The workspace's network traffic over the last minute (the network lights'
 * hover): for each reading, a green bar for what it received and a blue one for
 * what it sent, side by side across the time the reading covers, on an axis that
 * scales with the busiest reading shown.
 */
export const NetworkHistogram: React.FC<{
	samples: NetworkSample[];
	/** Lock Down cut the workspace's network: said under the title, in red. */
	locked?: boolean;
}> = ({ samples, locked = false }) => {
	const last = samples[samples.length - 1];
	const end = last?.t ?? 0;
	const start = end - NETWORK_WINDOW_MS;
	const shown = samples.filter((s) => s.t > start);
	const peak = Math.max(0, ...shown.flatMap((s) => [s.rx, s.tx]));
	const scale = scaleFor(peak);
	const plotW = W - AXIS;
	const x = (t: number) =>
		AXIS + ((Math.max(t, start) - start) / NETWORK_WINDOW_MS) * plotW;
	const y = (v: number) => H - (Math.min(v, scale.max) / scale.max) * H;
	return (
		<div className="flex flex-col gap-2" data-testid="network-histogram">
			<div className="flex items-center justify-between gap-4 text-xs text-content-primary">
				<span className="flex flex-col">
					<span className="font-semibold">Network, last minute</span>
					{locked && (
						<span
							className="font-medium text-content-destructive"
							data-testid="network-histogram-locked"
						>
							Locked down: no traffic
						</span>
					)}
				</span>
				<span className="flex items-center gap-3 tabular-nums">
					<span className="inline-flex items-center gap-1">
						<span className="inline-block size-2 rounded-full bg-[#22c55e]" />
						RX ↓ {last ? formatRate(last.rx) : "–"}
					</span>
					<span className="inline-flex items-center gap-1">
						<span className="inline-block size-2 rounded-full bg-[#3b82f6]" />
						TX ↑ {last ? formatRate(last.tx) : "–"}
					</span>
				</span>
			</div>
			<svg
				width={W}
				height={H + 16}
				viewBox={`0 0 ${W} ${H + 16}`}
				role="img"
				aria-label={`Network traffic, last minute: up to ${formatRate(peak)}`}
			>
				{scale.ticks.map((tick) => (
					<g key={tick.label}>
						<line
							x1={AXIS}
							x2={W}
							y1={y(tick.value) + 0.5}
							y2={y(tick.value) + 0.5}
							stroke="currentColor"
							strokeOpacity={tick.value === 0 ? 0.35 : 0.12}
						/>
						<text
							x={AXIS - 6}
							y={Math.max(9, Math.min(H, y(tick.value) + 3))}
							textAnchor="end"
							fontSize={9}
							fill="currentColor"
							fillOpacity={0.7}
							data-testid="network-histogram-tick"
						>
							{tick.label}
						</text>
					</g>
				))}
				{shown.map((s) => {
					const x0 = x(s.from);
					const span = Math.max(2, x(s.t) - x0);
					const gap = span > 6 ? 1 : 0;
					const bw = Math.max(1, (span - gap * 3) / 2);
					return (
						<g key={s.t} data-testid="network-histogram-slot">
							<rect
								x={x0 + gap}
								y={y(s.rx)}
								width={bw}
								height={H - y(s.rx)}
								fill="#22c55e"
								data-kind="rx"
							/>
							<rect
								x={x0 + gap * 2 + bw}
								y={y(s.tx)}
								width={bw}
								height={H - y(s.tx)}
								fill="#3b82f6"
								data-kind="tx"
							/>
						</g>
					);
				})}
				<text
					x={AXIS}
					y={H + 13}
					fontSize={9}
					fill="currentColor"
					fillOpacity={0.6}
				>
					60 s ago
				</text>
				<text
					x={W}
					y={H + 13}
					fontSize={9}
					textAnchor="end"
					fill="currentColor"
					fillOpacity={0.6}
				>
					now
				</text>
			</svg>
		</div>
	);
};
