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
 */
export const QuotaRings: React.FC<{
	rings: readonly Ring[];
	limitName?: string;
}> = ({ rings, limitName }) => {
	const centre = RING_SIZE / 2;
	return (
		<svg
			role="img"
			aria-label={rings.map((r) => allocationText(r, limitName)).join("; ")}
			viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
			className="size-[168px] shrink-0"
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
					<g key={ring.label}>
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
		</svg>
	);
};

export type BarSegment = {
	label: string;
	value: number;
	/** Background class of the segment's colour. */
	fill: string;
};

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
				"relative h-2.5 w-full overflow-visible rounded-full bg-surface-tertiary",
				className,
			)}
		>
			<div className="flex h-full overflow-hidden rounded-full">
				{segments.map((s) => (
					<div
						key={s.label}
						className={cn(
							"h-full transition-[width] duration-500",
							LEVEL_FILL[level] ?? s.fill,
						)}
						style={{
							width: `${top > 0 ? Math.min(100, (s.value / top) * 100) : 0}%`,
						}}
					/>
				))}
			</div>
			{limit !== null && (
				<div
					aria-hidden
					className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-content-primary"
					style={{ left: `${WATERMARK_WARNING * 100}%` }}
				/>
			)}
		</div>
	);
};

const SPARK_W = 300;
const SPARK_H = 72;

/**
 * A line and area over time with gaps where nothing was measured, and the limit as a dashed watermark line. The
 * scale reaches a little above the higher of the peak and the limit.
 */
export const Sparkline: React.FC<{
	label: string;
	points: readonly (number | null)[];
	limit: number | null;
	stroke: string;
	fill: string;
}> = ({ label, points, limit, stroke, fill }) => {
	const peak = Math.max(0, ...points.map((p) => p ?? 0));
	const top = Math.max(peak, limit ?? 0) * 1.15 || 1;
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
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			preserveAspectRatio="none"
			className="h-[72px] w-full overflow-visible"
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
	);
};

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
