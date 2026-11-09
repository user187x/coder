import { cn } from "cn";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import {
	WATERMARK_TEXT,
	WATERMARK_WARNING,
	type WatermarkLevel,
	watermarkLevel,
} from "./dashboardModel";

/** A bar or ring spans this multiple of its limit, so the limit's watermark sits at 80% and overruns stay visible. */
const HEADROOM = 1 / WATERMARK_WARNING;

/** The share of a track (0-1) a value takes; the limit lands at WATERMARK_WARNING. */
const trackShare = (value: number, limit: number | null) => {
	const top = limit && limit > 0 ? limit * HEADROOM : value;
	return top > 0 ? Math.min(1, Math.max(0, value / top)) : 0;
};

const LEVEL_STROKE: Record<WatermarkLevel, string | null> = {
	none: null,
	ok: null,
	warning: "stroke-content-warning",
	danger: "stroke-content-destructive",
};

const LEVEL_FILL: Record<WatermarkLevel, string | null> = {
	none: null,
	ok: null,
	warning: "bg-content-warning",
	danger: "bg-content-destructive",
};

const LEVEL_TEXT_CLASS: Record<WatermarkLevel, string> = {
	none: "text-content-secondary",
	ok: "text-content-success",
	warning: "text-content-warning",
	danger: "text-content-destructive",
};

export type Ring = {
	label: string;
	used: number;
	limit: number | null;
	unit: string;
	/** Stroke class of the ring's own colour (below the warning level). */
	stroke: string;
};

const percentOf = (used: number, limit: number | null) =>
	limit && limit > 0 ? `${Math.round((used / limit) * 100)}% of quota` : null;

/** "CPU: 3 of 8 cores allocated (38% of quota), within quota"; `format` writes amounts with their unit. */
const allocationText = (
	{ label, used, limit, unit }: Omit<Ring, "stroke">,
	limitName = "quota",
	format?: (value: number) => string,
) => {
	const level = watermarkLevel(used, limit);
	const share = percentOf(used, limit)?.replace("quota", limitName);
	const amounts = format
		? (a: number, b: number) => `${format(a)} of ${format(b)}`
		: (a: number, b: number) =>
				`${formatQuotaNumber(a)} of ${formatQuotaNumber(b)} ${unit}`;
	return limit === null
		? `${label}: ${format ? format(used) : `${formatQuotaNumber(used)} ${unit}`} allocated, no limit`
		: `${label}: ${amounts(used, limit)} allocated (${share}), ${WATERMARK_TEXT[level].toLowerCase().replace("quota", limitName)}`;
};

const RING_SIZE = 168;
const RING_STROKE = 12;
const RING_GAP = 4;

/**
 * Concentric rings, outermost first, each the allocation against its limit. A tick across each ring marks the
 * limit (the watermark); a ring turns the warning colour at 80% of its limit and the danger colour at the limit.
 * Pointing at a ring (or setting `active`, as its legend does) dims the others and writes its reading in the middle.
 */
export const QuotaRings: React.FC<{
	rings: readonly Ring[];
	limitName?: string;
	/** The ring pointed at, by index; null for none. */
	active?: number | null;
	onActiveChange?: (index: number | null) => void;
}> = ({ rings, limitName, active = null, onActiveChange }) => {
	const centre = RING_SIZE / 2;
	const shown = active === null ? undefined : rings[active];
	return (
		<svg
			role="img"
			aria-label={rings.map((r) => allocationText(r, limitName)).join("; ")}
			viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
			className="size-[168px] shrink-0"
			onMouseLeave={() => onActiveChange?.(null)}
		>
			{rings.map((ring, i) => {
				const radius =
					centre - RING_STROKE / 2 - i * (RING_STROKE + RING_GAP) - 2;
				const length = 2 * Math.PI * radius;
				const level = watermarkLevel(ring.used, ring.limit);
				const share = trackShare(ring.used, ring.limit);
				const tickAngle = 2 * Math.PI * WATERMARK_WARNING - Math.PI / 2;
				const inner = radius - RING_STROKE / 2 - 1;
				const outer = radius + RING_STROKE / 2 + 1;
				return (
					<g
						key={ring.label}
						data-ring={ring.label}
						data-active={active === i || undefined}
						className={cn(
							"transition-opacity duration-200",
							active !== null && active !== i && "opacity-30",
						)}
						onMouseEnter={() => onActiveChange?.(i)}
					>
						<title>{allocationText(ring, limitName)}</title>
						{/* what the pointer catches: the ring and half the gaps beside it */}
						<circle
							cx={centre}
							cy={centre}
							r={radius}
							fill="none"
							stroke="transparent"
							strokeWidth={RING_STROKE + RING_GAP}
							pointerEvents="stroke"
						/>
						<circle
							cx={centre}
							cy={centre}
							r={radius}
							fill="none"
							strokeWidth={RING_STROKE}
							className="stroke-surface-tertiary"
						/>
						{share > 0 && (
							<circle
								cx={centre}
								cy={centre}
								r={radius}
								fill="none"
								strokeWidth={RING_STROKE}
								strokeLinecap="round"
								strokeDasharray={`${length * share} ${length}`}
								transform={`rotate(-90 ${centre} ${centre})`}
								className={cn(
									"transition-[stroke-dasharray] duration-500 ease-out",
									LEVEL_STROKE[level] ?? ring.stroke,
								)}
							/>
						)}
						{ring.limit !== null && (
							<line
								x1={centre + inner * Math.cos(tickAngle)}
								y1={centre + inner * Math.sin(tickAngle)}
								x2={centre + outer * Math.cos(tickAngle)}
								y2={centre + outer * Math.sin(tickAngle)}
								strokeWidth={2.5}
								strokeLinecap="round"
								className="stroke-content-primary"
							/>
						)}
					</g>
				);
			})}
			{shown && (
				<g aria-hidden className="pointer-events-none">
					<text
						x={centre}
						y={centre - 8}
						textAnchor="middle"
						className="fill-content-secondary text-[10px]"
					>
						{shown.label}
					</text>
					<text
						x={centre}
						y={centre + 7}
						textAnchor="middle"
						className="fill-content-primary text-[15px] font-semibold tabular-nums"
					>
						{shown.limit && shown.limit > 0
							? `${Math.round((shown.used / shown.limit) * 100)}%`
							: formatQuotaNumber(shown.used)}
					</text>
					<text
						x={centre}
						y={centre + 20}
						textAnchor="middle"
						className="fill-content-secondary text-[9px] tabular-nums"
					>
						{shown.limit === null
							? shown.unit
							: `${formatQuotaNumber(shown.used)}/${formatQuotaNumber(shown.limit)} ${shown.unit}`}
					</text>
				</g>
			)}
		</svg>
	);
};

export type BarSegment = {
	label: string;
	value: number;
	/** Background class of the segment's colour. */
	fill: string;
	/** Claimed by workspaces that are not running: drawn as a dotted line, not a solid fill. */
	offline?: boolean;
};

/** One segment of a bar: solid while its workspaces run; while they are offline, a dotted outline of where its
 * fill would be. */
export const BarSegmentFill: React.FC<{
	segment: BarSegment;
	width: string;
	fill?: string | null;
}> = ({ segment, width, fill }) =>
	segment.offline ? (
		<div
			data-testid="bar-segment-offline"
			title={`${segment.label}: claimed, not running`}
			className="h-full shrink-0 rounded-full border-[1.5px] border-dotted border-content-secondary bg-transparent transition-[width] duration-500"
			style={{ width }}
		/>
	) : (
		<div
			className={cn(
				"h-full shrink-0 transition-[width] duration-500",
				fill ?? segment.fill,
			)}
			style={{ width }}
		/>
	);

/**
 * A horizontal bar of segments against a limit, with the limit drawn as a watermark line at 80% of the track. The
 * total turns the warning colour from 80% of the limit and the danger colour at it.
 */
export const QuotaBar: React.FC<{
	label: string;
	segments: readonly BarSegment[];
	limit: number | null;
	unit: string;
	className?: string;
	limitName?: string;
	format?: (value: number) => string;
}> = ({ label, segments, limit, unit, className, limitName, format }) => {
	const total = segments.reduce((sum, s) => sum + s.value, 0);
	const level = watermarkLevel(total, limit);
	const top = limit && limit > 0 ? limit * HEADROOM : total;
	const usedEnd = top > 0 ? Math.min(100, (total / top) * 100) : 0;
	const amount = (value: number) =>
		format ? format(value) : `${formatQuotaNumber(value)} ${unit}`;
	// What is left under the limit, written in the track's empty part (over the limit: by how much).
	const over = limit !== null && limit > 0 && total > limit;
	const left =
		limit && limit > 0
			? over
				? `${amount(total - limit)} over`
				: `${amount(limit - total)} left`
			: null;
	return (
		<div
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={limit ?? total}
			aria-valuenow={total}
			aria-valuetext={allocationText(
				{ label, used: total, limit, unit },
				limitName,
				format,
			)
				.replace(`${label}: `, "")
				.replace("allocated", "used")}
			className={cn(
				"relative w-full overflow-visible rounded-full bg-surface-tertiary",
				left ? "h-4" : "h-2.5",
				className,
			)}
		>
			<div className="flex h-full overflow-hidden rounded-full">
				{segments.map((s) => (
					<BarSegmentFill
						key={s.label}
						segment={s}
						fill={LEVEL_FILL[level]}
						width={`${top > 0 ? Math.min(100, (s.value / top) * 100) : 0}%`}
					/>
				))}
			</div>
			{left && (
				<span
					aria-hidden
					data-testid="quota-bar-left"
					className={cn(
						"pointer-events-none absolute inset-y-0 flex items-center justify-end overflow-hidden whitespace-nowrap pr-2 text-[10px] leading-none font-medium tabular-nums",
						over ? "text-content-destructive" : "text-content-secondary",
					)}
					style={{ left: `${usedEnd}%`, right: 0 }}
				>
					{left}
				</span>
			)}
			{/* The combined allocation's end: where the segments together stop */}
			{total > 0 && (
				<div
					aria-hidden
					className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-content-primary"
					style={{
						left: `${top > 0 ? Math.min(100, (total / top) * 100) : 0}%`,
					}}
				/>
			)}
		</div>
	);
};

/** The smallest round number (1, 2, 2.5 or 5 times a power of ten) at or above a value: the scale's top, so its
 * ticks read 0, 10, 20 rather than 0, 9.2, 18.4. */
export const niceTop = (value: number) => {
	if (!(value > 0) || !Number.isFinite(value)) {
		return 1;
	}
	const power = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
	return step * power;
};

const SPARK_W = 300;
const SPARK_H = 72;

/**
 * A line and area over time with gaps where nothing was measured, and the limit as a dashed watermark line. The
 * scale reaches a little above the higher of the peak and the limit; major ticks on the left mark its bottom,
 * half-way and top (no axis line).
 */
export const Sparkline: React.FC<{
	label: string;
	points: readonly (number | null)[];
	limit: number | null;
	stroke: string;
	fill: string;
	/** Writes a tick's value; plain numbers by default. */
	format?: (value: number) => string;
}> = ({ label, points, limit, stroke, fill, format = formatQuotaNumber }) => {
	const peak = Math.max(0, ...points.map((p) => p ?? 0));
	const top = niceTop(Math.max(peak, limit ?? 0) * 1.1);
	const step = points.length > 1 ? SPARK_W / (points.length - 1) : SPARK_W;
	const y = (v: number) => SPARK_H - (v / top) * (SPARK_H - 4);
	const runs: { x: number; y: number }[][] = [];
	let run: { x: number; y: number }[] = [];
	points.forEach((p, i) => {
		if (p === null) {
			if (run.length) runs.push(run);
			run = [];
			return;
		}
		run.push({ x: i * step, y: y(p) });
	});
	if (run.length) runs.push(run);
	const ticks = [top, top / 2, 0];
	return (
		<div className="flex items-stretch gap-1.5">
			<div aria-hidden className="relative h-[72px] w-10 shrink-0">
				{ticks.map((value) => (
					<span
						key={value}
						className="absolute right-0 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[9px] leading-none tabular-nums text-content-secondary"
						style={{ top: `${(y(value) / SPARK_H) * 100}%` }}
					>
						{format(value)}
						<span className="w-1.5 border-0 border-t border-solid border-content-secondary" />
					</span>
				))}
			</div>
			<svg
				role="img"
				aria-label={label}
				viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
				preserveAspectRatio="none"
				className="h-[72px] min-w-0 flex-1 overflow-visible"
			>
				{runs.map((r) => {
					const line = r.map((pt) => `${pt.x},${pt.y}`).join(" L");
					const first = r[0];
					const last = r[r.length - 1];
					return (
						<g key={first.x}>
							<path
								d={`M${first.x},${SPARK_H} L${line} L${last.x},${SPARK_H} Z`}
								className={fill}
								opacity={0.18}
							/>
							<path
								d={`M${line}`}
								fill="none"
								strokeWidth={2}
								vectorEffect="non-scaling-stroke"
								className={stroke}
							/>
						</g>
					);
				})}
				{limit !== null && (
					<line
						x1={0}
						x2={SPARK_W}
						y1={y(limit)}
						y2={y(limit)}
						strokeDasharray="6 4"
						strokeWidth={1.5}
						vectorEffect="non-scaling-stroke"
						className="stroke-content-destructive"
					/>
				)}
			</svg>
		</div>
	);
};

/** One key of a graph's legend: its name, its line (solid colour, or the limit's red dashes) and its value. */
type LegendKey = {
	label: string;
	/** Background class of a solid line's colour; omitted for the limit's dashed red line. */
	line?: string;
	value: string;
};

/** A graph's legend: its keys in one centred pill, each on the same line. */
export const GraphLegend: React.FC<{ keys: readonly LegendKey[] }> = ({
	keys,
}) => (
	<div className="flex justify-center">
		<span className="inline-flex max-w-full items-center gap-2.5 whitespace-nowrap rounded-full border border-solid border-border bg-surface-primary px-3 py-0.5 text-[11px] leading-5 text-content-secondary">
			{keys.map((key, i) => (
				<span key={key.label} className="inline-flex items-center gap-1.5">
					{i > 0 && <span aria-hidden className="mr-1 h-3 w-px bg-border" />}
					{key.label}
					{key.line ? (
						<span
							aria-hidden
							className={cn("h-0.5 w-4 rounded-full", key.line)}
						/>
					) : (
						<span
							aria-hidden
							className="w-4 border-0 border-t-2 border-dashed border-content-destructive"
						/>
					)}
					<span className="font-medium tabular-nums text-content-primary">
						{key.value}
					</span>
				</span>
			))}
		</span>
	</div>
);

/** The watermark state in words beside a figure: "Near quota" and the like, coloured by its level. */
export const WatermarkBadge: React.FC<{
	level: WatermarkLevel;
	limitName?: string;
}> = ({ level, limitName = "quota" }) => {
	return (
		<span className={cn("text-xs font-semibold", LEVEL_TEXT_CLASS[level])}>
			{WATERMARK_TEXT[level].replace("quota", limitName)}
		</span>
	);
};
