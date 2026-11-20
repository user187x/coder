/** Gives each recorded sample a hover target even when its bar is empty or thin. */
export function MetricSample({
	x,
	y = 0,
	width,
	height,
	time,
	measurement,
	children,
}: {
	x: number;
	y?: number;
	width: number;
	height: number;
	time: number;
	measurement: string;
	children: React.ReactNode;
}) {
	return (
		<g>
			<rect
				x={x}
				y={y}
				width={width}
				height={height}
				className="cursor-pointer fill-transparent hover:fill-content-primary/10"
			>
				<title>{`${new Date(time * 1000).toLocaleTimeString("en-US")} · ${measurement}`}</title>
			</rect>
			<g className="pointer-events-none">{children}</g>
		</g>
	);
}
