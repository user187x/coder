import { cn } from "cn";
import { useState } from "react";
import type { HudHistory, HudHistoryPoint, HudRange } from "#/api/platform";
import { RANGES } from "./hudRanges";

export const fmt = (v: number | null | undefined, digits = 1) =>
	v === null || v === undefined
		? "—"
		: v.toLocaleString("en-US", { maximumFractionDigits: digits });

const clock = (t: number, range: HudRange) =>
	new Date(t * 1000).toLocaleString("en-US", {
		...(range === "7d" || range === "24h"
			? { weekday: "short", hour: "numeric", minute: "2-digit" }
			: { hour: "numeric", minute: "2-digit", second: "2-digit" }),
	});

/**
 * The scale of a usage graph: a little above the range's peak, so the bars
 * show how use moves (never above what the cluster has).
 */
export const peakScale = (
	points: HudHistoryPoint[],
	peak: (p: HudHistoryPoint) => number | null,
	total: (p: HudHistoryPoint) => number | null,
) => {
	const top = Math.max(0, ...points.map((p) => peak(p) ?? 0));
	const all = Math.max(0, ...points.map((p) => total(p) ?? 0));
	return all ? Math.min(all, top * 1.25 || all) : top * 1.25;
};

type Bar = {
	/** The bar (cluster in use, the median latency). */
	value: number | null;
	/** A part of it, drawn darker (what workspaces use). */
	part?: number | null;
	/** A mark above it (the 95th percentile latency). */
	mark?: number | null;
};

type GraphProps = {
	handle?: React.ReactNode;
	title: string;
	unit: string;
	history: HudHistory;
	bars: (p: HudHistoryPoint) => Bar;
	/** The top of the scale for these points. */
	top: (points: HudHistoryPoint[]) => number;
	/** The figure in the card's header: the latest bucket, or the hovered one. */
	summary: (p: HudHistoryPoint | undefined) => React.ReactNode;
	legend: React.ReactNode;
	empty: string;
	testId: string;
};

/**
 * A histogram over time: one bar per bucket of the range (gaps where nothing
 * was measured), scaled to `top`. Hovering a bar shows its bucket in the
 * header.
 */
export const Graph: React.FC<GraphProps> = ({
	handle,
	title,
	unit,
	history,
	bars,
	top,
	summary,
	legend,
	empty,
	testId,
}) => {
	const [hover, setHover] = useState<number | null>(null);
	const slots = Math.max(
		1,
		Math.ceil((history.end - history.start) / history.step),
	);
	const bySlot = new Map<number, HudHistoryPoint>();
	for (const p of history.points) {
		bySlot.set(
			Math.min(slots - 1, Math.floor((p.t - history.start) / history.step)),
			p,
		);
	}
	const measured = history.points.filter((p) => bars(p).value !== null);
	const max = Math.max(top(history.points), 1e-6);
	const latest = [...history.points]
		.reverse()
		.find((p) => bars(p).value !== null);
	const shown = hover !== null ? bySlot.get(hover) : latest;
	const W = 100 / slots;
	const H = 100;
	const y = (v: number) => H - Math.min(1, v / max) * H;

	return (
		<section
			className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-surface-primary p-4"
			data-testid={testId}
			aria-label={title}
		>
			<header className="flex items-baseline justify-between gap-2">
				{handle}
				<h2 className="m-0 flex-1 text-xs font-normal uppercase tracking-wide text-content-secondary">
					{title}
				</h2>
				<span className="truncate text-xs tabular-nums text-content-secondary">
					{shown ? clock(shown.t, history.range) : ""}
				</span>
			</header>
			<div className="flex min-h-9 items-baseline gap-2">{summary(shown)}</div>
			<div className="relative h-28">
				{measured.length === 0 ? (
					<div className="flex h-full items-center justify-center rounded border border-dashed border-border text-sm text-content-secondary">
						{empty}
					</div>
				) : (
					<svg
						viewBox={`0 0 100 ${H}`}
						preserveAspectRatio="none"
						className="h-full w-full overflow-visible"
						role="img"
						aria-label={`${title}, ${RANGES.find((r) => r.value === history.range)?.label}`}
						onMouseLeave={() => setHover(null)}
						onMouseMove={(e) => {
							const box = e.currentTarget.getBoundingClientRect();
							const slot = Math.floor(
								((e.clientX - box.left) / box.width) * slots,
							);
							setHover(Math.max(0, Math.min(slots - 1, slot)));
						}}
					>
						{[0.25, 0.5, 0.75].map((f) => (
							<line
								key={f}
								x1={0}
								x2={100}
								y1={H * f}
								y2={H * f}
								className="stroke-border"
								strokeWidth={0.5}
								vectorEffect="non-scaling-stroke"
							/>
						))}
						{[...bySlot.entries()].map(([slot, p]) => {
							const b = bars(p);
							if (b.value === null) {
								return null;
							}
							const x = slot * W + W * 0.12;
							const w = W * 0.76;
							return (
								<g
									key={slot}
									className={cn(
										"text-content-link",
										hover !== null && hover !== slot && "opacity-50",
									)}
								>
									{b.mark !== null && b.mark !== undefined && (
										<rect
											x={x}
											width={w}
											y={y(b.mark)}
											height={Math.max(0, y(b.value) - y(b.mark))}
											className="fill-current opacity-20"
										/>
									)}
									<rect
										x={x}
										width={w}
										y={y(b.value)}
										height={H - y(b.value)}
										className="fill-current opacity-45"
									/>
									{b.part !== null && b.part !== undefined && (
										<rect
											x={x}
											width={w}
											y={y(b.part)}
											height={H - y(b.part)}
											className="fill-current"
										/>
									)}
								</g>
							);
						})}
					</svg>
				)}
			</div>
			<footer className="flex items-center justify-between gap-2 text-xs text-content-secondary">
				<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
					{legend}
				</span>
				<span className="tabular-nums">
					scale {fmt(max)} {unit}
				</span>
			</footer>
		</section>
	);
};

export const Swatch: React.FC<{
	className: string;
	children: React.ReactNode;
}> = ({ className, children }) => (
	<span className="flex items-center gap-1">
		<span
			aria-hidden
			className={cn(
				"inline-block size-2.5 rounded-sm bg-content-link",
				className,
			)}
		/>
		{children}
	</span>
);
