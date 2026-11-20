import { networkTrace } from "./ClusterGauge";
import {
	type ClusterMetricSelection,
	clusterMetrics,
	nearestSample,
} from "./clusterMetricHistory";
import { MetricSample } from "./MetricSample";
import { metricTicks } from "./MetricYAxis";

const plot = { left: 88, right: 754, top: 24, bottom: 211 };
const width = plot.right - plot.left;

const sampleClock = (t: number) =>
	new Date(t * 1000).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

const tickNumber = new Intl.NumberFormat("en-US", {
	maximumSignificantDigits: 4,
});

/** Draws recorded samples against elapsed time. Network shares a signed scale centered on zero. */
export const ClusterMetricHistoryChart = ({
	metric,
	samples,
	every,
	focusedTime,
}: ClusterMetricSelection & { focusedTime?: number }) => {
	const first = samples[0];
	const last = samples.at(-1);
	if (!first || !last) {
		return (
			<p className="text-sm text-content-secondary">
				No samples in this range.
			</p>
		);
	}
	const network = metric === "net";
	const { title, unit } = clusterMetrics[metric];
	const peak = Math.max(
		network ? 1 : 0.01,
		...samples.flatMap((p) => [p.value, p.received ?? 0]),
	);
	const max = peak * 1.12;
	const min = network ? -max : 0;
	const span = last.t - first.t;
	const x = (time: number) =>
		span > 0
			? plot.left + ((time - first.t) / span) * width
			: plot.left + width / 2;
	const y = (value: number) =>
		plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);
	const baseline = y(0);
	const focus =
		focusedTime === undefined ? undefined : nearestSample(samples, focusedTime);
	const barWidth = Math.max(
		1,
		Math.min(7, (width / Math.max(samples.length, 1)) * 0.45),
	);
	const timeTicks =
		span === 0 ? [first.t] : [first.t, (first.t + last.t) / 2, last.t];
	const pathPoints = samples.map((p) => ({
		t: p.t,
		x: x(p.t),
		txY: y(p.value),
		rxY: y(-(p.received ?? 0)),
	}));

	return (
		<div className="min-w-0" data-panel-metric={metric}>
			<svg
				role="img"
				aria-label={`${title} from ${sampleClock(first.t)} to ${sampleClock(last.t)}, ${unit}`}
				viewBox="0 0 780 255"
				className="block w-full"
			>
				<text x={plot.left} y={14} className="fill-content-secondary text-xs">
					{unit}
				</text>
				{metricTicks(min, max).map(({ value, major }) => (
					<g key={value}>
						<line
							x1={major ? plot.left - 6 : plot.left - 3}
							x2={major ? plot.right : plot.left}
							y1={y(value)}
							y2={y(value)}
							className={
								value === 0 ? "stroke-content-secondary" : "stroke-border"
							}
							vectorEffect="non-scaling-stroke"
						/>
						{major && (
							<text
								x={plot.left - 10}
								y={y(value)}
								textAnchor="end"
								dominantBaseline="middle"
								className="fill-content-secondary text-xs"
							>
								{tickNumber.format(value)}
							</text>
						)}
					</g>
				))}
				<path
					d={`M${plot.left},${plot.top} V${plot.bottom} H${plot.right}`}
					fill="none"
					className="stroke-content-secondary"
				/>
				{timeTicks.map((time, index) => (
					<text
						key={time}
						x={x(time)}
						y={plot.bottom + 19}
						textAnchor={
							timeTicks.length === 1 || index === 1
								? "middle"
								: index === 0
									? "start"
									: "end"
						}
						className="fill-content-secondary text-xs tabular-nums"
					>
						{sampleClock(time)}
					</text>
				))}
				<text
					x={plot.left + width / 2}
					y={249}
					textAnchor="middle"
					className="fill-content-secondary text-xs"
				>
					Time
				</text>
				{network && (
					<g fill="none" strokeWidth={1.5} aria-hidden>
						<path
							d={networkTrace(pathPoints, "txY", every)}
							className="stroke-content-success"
						/>
						<path
							d={networkTrace(pathPoints, "rxY", every)}
							className="stroke-content-link"
						/>
					</g>
				)}
				{samples.map((p, index) => {
					const position = x(p.t);
					const before = samples[index - 1]?.t;
					const after = samples[index + 1]?.t;
					const left =
						before === undefined ? plot.left : (x(before) + position) / 2;
					const right =
						after === undefined ? plot.right : (x(after) + position) / 2;
					return (
						<MetricSample
							key={p.t}
							x={left}
							y={plot.top}
							width={right - left}
							height={plot.bottom - plot.top}
							time={p.t}
							measurement={p.measurement}
						>
							{network ? (
								<>
									<circle
										cx={position}
										cy={y(p.value)}
										r={2}
										className="fill-content-success"
									/>
									<circle
										cx={position}
										cy={y(-(p.received ?? 0))}
										r={2}
										className="fill-content-link"
									/>
								</>
							) : (
								<rect
									data-panel-graph-fill
									x={position - barWidth / 2}
									y={y(p.value)}
									width={barWidth}
									height={baseline - y(p.value)}
									className="fill-content-link"
								/>
							)}
						</MetricSample>
					);
				})}
				{focus &&
					focusedTime !== undefined &&
					Math.abs(focusedTime - focus.t) <= every && (
						<line
							key={focusedTime}
							x1={x(focus.t)}
							x2={x(focus.t)}
							y1={plot.top}
							y2={plot.bottom}
							className="hud-focused-sample pointer-events-none stroke-content-primary"
							strokeWidth={2}
						/>
					)}
			</svg>
			{network && (
				<p className="m-0 flex justify-center gap-4 text-xs">
					<span className="text-content-success">↑ TX sent</span>
					<span className="text-content-link">↓ RX received</span>
				</p>
			)}
		</div>
	);
};
