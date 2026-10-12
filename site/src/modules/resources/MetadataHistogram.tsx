import { cn } from "cn";
import { useEffect, useState } from "react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";

/** How many readings each graph shows (at the usual 10 s interval: the last ~7 minutes). */
const SAMPLES = 40;

type Sample = { at: string; value: number; text: string };

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
			const year = new Date(at).getUTCFullYear();
			const parsed = metadataNumber(m.result.value);
			if (!parsed || year <= 1970 || m.result.error) {
				continue;
			}
			const key = `${scope}/${m.description.key}`;
			const past = history.get(key) ?? [];
			if (past.length && past[past.length - 1].at === at) {
				continue;
			}
			history.set(
				key,
				[...past, { at, value: parsed.value, text: m.result.value }].slice(
					-SAMPLES,
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

type MetadataHistogramProps = {
	samples: readonly Sample[];
	/** Values are percentages: the scale is 0–100; else up to the highest reading. */
	percent: boolean;
	stale: boolean;
	label: string;
};

/**
 * A live bar graph of one metadata item's readings, newest on the right, in
 * the colour of its value (grey once stale).
 */
export const MetadataHistogram: React.FC<MetadataHistogramProps> = ({
	samples,
	percent,
	stale,
	label,
}) => {
	const W = 120;
	const H = 26;
	const slot = W / SAMPLES;
	const top = percent
		? 100
		: Math.max(...samples.map((s) => s.value), 0) * 1.15 || 1;
	const offset = SAMPLES - samples.length;
	return (
		<svg
			width={W}
			height={H}
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={`${label}: the last ${samples.length} readings`}
			className={cn(
				"my-1 block overflow-visible",
				stale ? "text-content-disabled" : "text-content-success",
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
			{samples.map((s, i) => {
				const h = Math.max(
					1,
					Math.min(1, Math.max(0, s.value) / top) * (H - 2),
				);
				return (
					<rect
						key={s.at}
						x={(offset + i) * slot + slot * 0.15}
						width={slot * 0.7}
						y={H - 1 - h}
						height={h}
						rx={0.75}
						className={cn(
							"fill-current",
							i === samples.length - 1 ? "opacity-100" : "opacity-55",
						)}
					>
						<title>{`${new Date(s.at).toLocaleTimeString()}: ${s.text}`}</title>
					</rect>
				);
			})}
		</svg>
	);
};
