/** Choose rounded major intervals and one minor tick between them. */
export function metricTicks(min: number, max: number) {
	const target = (max - min) / 4;
	if (!Number.isFinite(target) || target <= 0) return [];

	const magnitude = 10 ** Math.floor(Math.log10(target));
	const interval = [1, 2, 2.5, 5, 10].find(
		(step) => step * magnitude >= target,
	);
	if (interval === undefined) {
		return [];
	}
	const minorStep = (interval * magnitude) / 2;
	const first = Math.ceil(min / minorStep);
	const last = Math.floor(max / minorStep);
	return Array.from({ length: last - first + 1 }, (_, index) => {
		const multiple = first + index;
		return {
			value: multiple * minorStep,
			major: multiple % 2 === 0,
		};
	});
}

/** A left-hand scale in the plot's gutter, aligned with its data coordinates. */
export function MetricYAxis({
	min = 0,
	max,
	top,
	bottom,
}: {
	min?: number;
	max: number;
	top: number;
	bottom: number;
}) {
	return (
		<g
			aria-hidden
			className="pointer-events-none stroke-content-secondary"
			strokeWidth={0.75}
		>
			<line
				x1={-1}
				x2={-1}
				y1={top}
				y2={bottom}
				vectorEffect="non-scaling-stroke"
				opacity={0.55}
			/>
			{metricTicks(min, max).map(({ value, major }) => {
				const y = bottom - ((value - min) / (max - min)) * (bottom - top);
				return (
					<line
						key={value}
						x1={major ? -4.5 : -2.75}
						x2={-1}
						y1={y}
						y2={y}
						vectorEffect="non-scaling-stroke"
						opacity={major ? 0.85 : 0.45}
					/>
				);
			})}
		</g>
	);
}
