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
) => {
	const [, setVersion] = useState(0);
	useEffect(() => {
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
	}, [scope, metadata]);
	return (key: string) => history.get(`${scope}/${key}`) ?? [];
};

type Bar = { t: number; value: number; text: string; count: number };

/**
 * The bars of a graph: each reading (every = 0), or the highest reading of
 * each period of `every` seconds, the last BARS of them (empty where nothing
 * was read).
 */
export const toBars = (
	samples: readonly Sample[],
	every: number,
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
	return out;
};

type MetadataHistogramProps = {
	samples: readonly Sample[];
	/** A reading as a share of what there is (0–100), for scale and colour; null: unscaled. */
	share: ((v: number) => number) | null;
	/** Seconds per bar (0: one bar per reading). */
	every: number;
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
	stale,
	label,
}) => {
	const W = 120;
	const H = 26;
	const slot = W / BARS;
	const bars = toBars(samples, every);
	const top = share
		? 100
		: Math.max(0, ...bars.map((b) => b?.value ?? 0)) * 1.15 || 1;
	const shown = bars.filter(Boolean).length;
	return (
		<svg
			width={W}
			height={H}
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={`${label}: ${shown} ${every ? `periods of ${every} s` : "readings"}`}
			className={cn(
				"my-1 block overflow-visible",
				stale && "opacity-40 grayscale",
			)}
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
				const h = Math.max(1, Math.min(1, Math.max(0, scaled) / top) * (H - 2));
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
						opacity={latest ? 1 : 0.7}
						data-level={levelColor(share ? scaled : null)}
					>
						<title>
							{`${new Date(b.t).toLocaleTimeString()}: ${b.text}${b.count > 1 ? ` (the highest of ${b.count} readings)` : ""}`}
						</title>
					</rect>
				);
			})}
		</svg>
	);
};
