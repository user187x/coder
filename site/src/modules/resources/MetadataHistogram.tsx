import { cn } from "cn";
import { useEffect, useState } from "react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";

/** How many bars each graph shows. */
export const BARS = 40;

/** Readings kept per metric (at 10 s: about 4 hours), so a longer graph interval still has data. */
const KEEP = 1500;

export type Sample = { at: string; t: number; value: number; text: string };

/**
 * The readings of each agent's metadata so far, kept for the page's lifetime
 * (a remount, such as a tab switch, keeps them). By "<agent>/<key>".
 */
const history = new Map<string, Sample[]>();

/**
 * The number in a metadata value: its percentage when it has one ("0.4/2
 * cores (23%)" → 23, out of 100), else its first number ("0.12" → 0.12).
 */
export const metadataNumber = (
	text: string,
): { value: number; percent: boolean } | null => {
	const pct = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
	if (pct) {
		return { value: Number(pct[1]), percent: true };
	}
	const n = text.match(/-?\d+(?:\.\d+)?/);
	return n ? { value: Number(n[0]), percent: false } : null;
};

/**
 * A reading's percentage, apart from the rest of it: "2.24 / 24 cores (9%)" →
 * { text: "2.24 / 24 cores", percent: 9 }, for the chip by the metric's name.
 * A reading that is only a percentage keeps it as its text too.
 */
export const splitPercent = (
	text: string,
): { text: string; percent: number | null } => {
	const m = text.match(/^(.*?)\s*\(?\s*(-?\d+(?:\.\d+)?)\s*%\s*\)?\s*$/);
	if (!m) {
		return { text, percent: null };
	}
	return { text: m[1].trim() || text, percent: Number(m[2]) };
};

/**
 * How a metric's readings map to a share of what there is (0–100), for the
 * graph's scale and colour: its percentage; a load average per core (1.0 =
 * every core busy); else nothing (an unscaled number).
 */
export const shareOf = (
	item: Pick<WorkspaceAgentMetadata, "description" | "result">,
) => {
	const parsed = metadataNumber(item.result.value);
	if (!parsed) {
		return null;
	}
	if (parsed.percent) {
		return (v: number) => v;
	}
	if (
		/load/i.test(`${item.description.key} ${item.description.display_name}`)
	) {
		return (v: number) => v * 100;
	}
	return null;
};

/** The colour of a share (0–100): green under 50 %, then yellow-green, yellow, orange, red from 90 %. */
export const LEVELS = [
	{ from: 90, label: "90 % and over: critical", color: "#ef4444" },
	{ from: 75, label: "75–89 %", color: "#f97316" },
	{ from: 65, label: "65–74 %", color: "#eab308" },
	{ from: 50, label: "50–64 %", color: "#84cc16" },
	{ from: Number.NEGATIVE_INFINITY, label: "under 50 %", color: "#22c55e" },
] as const;

export const levelColor = (share: number | null) =>
	share === null
		? LEVELS[LEVELS.length - 1].color
		: (LEVELS.find((l) => share >= l.from) ?? LEVELS[LEVELS.length - 1]).color;

/** Records each new reading (a new collected_at) of the agent's metadata. */
export const useMetadataHistory = (
	scope: string,
	metadata: readonly WorkspaceAgentMetadata[],
	/** Off (the Metrics Interval menu's "off"): nothing is recorded. */
	enabled = true,
) => {
	const [, setVersion] = useState(0);
	useEffect(() => {
		if (!enabled) {
			return;
		}
		let changed = false;
		for (const m of metadata) {
			const at = m.result.collected_at;
			const t = new Date(at).getTime();
			const parsed = metadataNumber(m.result.value);
			if (!parsed || new Date(at).getUTCFullYear() <= 1970 || m.result.error) {
				continue;
			}
			const key = `${scope}/${m.description.key}`;
			const past = history.get(key) ?? [];
			if (past.length && past[past.length - 1].at === at) {
				continue;
			}
			history.set(
				key,
				[...past, { at, t, value: parsed.value, text: m.result.value }].slice(
					-KEEP,
				),
			);
			changed = true;
		}
		if (changed) {
			setVersion((v) => v + 1);
		}
	}, [scope, metadata, enabled]);
	return (key: string) => history.get(`${scope}/${key}`) ?? [];
};

type Bar = {
	t: number;
	value: number;
	text: string;
	count: number;
	/** No reading in this period: the last one, held (periods shorter than the agent's interval). */
	held?: boolean;
};

/**
 * The bars of a graph: each reading (every = 0), or the highest reading of
 * each period of `every` seconds, the last BARS of them (empty where nothing
 * was read).
 */
export const toBars = (
	samples: readonly Sample[],
	every: number,
	/** Seconds a reading stays good for a period without one (about the agent's interval); 0: none. */
	hold = 0,
): (Bar | null)[] => {
	if (every <= 0) {
		const last = samples.slice(-BARS);
		return [
			...Array<null>(BARS - last.length).fill(null),
			...last.map((s) => ({ t: s.t, value: s.value, text: s.text, count: 1 })),
		];
	}
	const ms = every * 1000;
	const end = Math.floor(Date.now() / ms);
	const out: (Bar | null)[] = Array<null>(BARS).fill(null);
	for (const s of samples) {
		const slot = BARS - 1 - (end - Math.floor(s.t / ms));
		if (slot < 0 || slot >= BARS) {
			continue;
		}
		const cur = out[slot];
		if (!cur || s.value > cur.value) {
			out[slot] = {
				t: s.t,
				value: s.value,
				text: s.text,
				count: (cur?.count ?? 0) + 1,
			};
		} else {
			cur.count++;
		}
	}
	if (hold > 0) {
		// a period with no reading shows the last one while it is still fresh (a 1 s graph of 10 s readings)
		let k = -1;
		for (let i = 0; i < BARS; i++) {
			const slotEnd = (end - (BARS - 1 - i) + 1) * ms;
			while (k + 1 < samples.length && samples[k + 1].t < slotEnd) {
				k++;
			}
			const last = samples[k];
			if (!out[i] && last && slotEnd - last.t <= hold * 1000) {
				out[i] = {
					t: last.t,
					value: last.value,
					text: last.text,
					count: 0,
					held: true,
				};
			}
		}
	}
	return out;
};

type MetadataHistogramProps = {
	samples: readonly Sample[];
	/** A reading as a share of what there is (0–100), for scale and colour; null: unscaled. */
	share: ((v: number) => number) | null;
	/** Seconds per bar (0: one bar per reading). */
	every: number;
	/** Seconds a reading holds for a period without one (shorter periods than the agent's interval). */
	hold?: number;
	stale: boolean;
	label: string;
};

/**
 * A live bar graph of one metric, newest on the right: each bar coloured by
 * how much of what there is it shows (green, yellow-green, yellow, orange,
 * red), grey once the metric is stale.
 */
export const MetadataHistogram: React.FC<MetadataHistogramProps> = ({
	samples,
	share,
	every,
	hold = 0,
	stale,
	label,
}) => {
	const W = 120;
	const H = 26;
	const slot = W / BARS;
	const bars = toBars(samples, every, hold);
	const top = share
		? 100
		: Math.max(0, ...bars.map((b) => b?.value ?? 0)) * 1.15 || 1;
	const shown = bars.filter(Boolean).length;
	// the gauge: the current reading (the graph's newest bar, held or not) as a share of the scale
	const current = [...bars].reverse().find(Boolean) ?? null;
	const currentShare = current
		? Math.max(
				0,
				Math.min(
					100,
					((share ? share(current.value) : current.value) / top) * 100,
				),
			)
		: 0;
	const currentColor = levelColor(
		current && share ? share(current.value) : null,
	);
	return (
		<div
			className={cn(
				"my-1 flex flex-col gap-1",
				stale && "opacity-40 grayscale",
			)}
		>
			<div
				role="meter"
				aria-label={`${label} now`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(currentShare)}
				aria-valuetext={current?.text ?? "no reading yet"}
				title={current ? `Now: ${current.text}` : undefined}
				className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
				style={{ width: W }}
				data-testid="metadata-gauge"
			>
				<div
					className="h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-500 motion-safe:ease-out"
					style={{ width: `${currentShare}%`, background: currentColor }}
				/>
			</div>
			<svg
				width={W}
				height={H}
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={`${label}: ${shown} ${every ? `periods of ${every} s` : "readings"}`}
				className="block overflow-visible"
				data-testid="metadata-histogram"
			>
				<line
					x1={0}
					x2={W}
					y1={H - 0.5}
					y2={H - 0.5}
					className="stroke-border"
					strokeWidth={1}
				/>
				{bars.map((b, i) => {
					if (!b) {
						return null;
					}
					const scaled = share ? share(b.value) : b.value;
					const h = Math.max(
						1,
						Math.min(1, Math.max(0, scaled) / top) * (H - 2),
					);
					const latest = bars.slice(i + 1).every((x) => !x);
					return (
						<rect
							key={`${i}-${b.t}`}
							x={i * slot + slot * 0.15}
							width={slot * 0.7}
							y={H - 1 - h}
							height={h}
							rx={0.75}
							fill={levelColor(share ? scaled : null)}
							opacity={b.held ? 0.3 : latest ? 1 : 0.7}
							data-level={levelColor(share ? scaled : null)}
						>
							<title>
								{`${new Date(b.t).toLocaleTimeString()}: ${b.text}${b.held ? " (the last reading, held until the next)" : b.count > 1 ? ` (the highest of ${b.count} readings)` : ""}`}
							</title>
						</rect>
					);
				})}
			</svg>
		</div>
	);
};
