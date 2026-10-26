import { useId } from "react";

/** Clips a seamless directional flow pattern inside the free tunnel connector. */
export const TunnelConnectionHead = ({
	x,
	y,
	angle,
	ready,
}: {
	x: number;
	y: number;
	angle: number;
	ready: boolean;
}) => {
	const id = useId().replace(/:/g, "");
	return (
		<g transform={`translate(${x} ${y}) rotate(${angle})`} aria-hidden>
			<circle r={8} fill="hsl(var(--surface-primary))" stroke="currentColor" />
			{ready ? (
				<>
					<defs>
						<clipPath id={`${id}-clip`}>
							<circle r={6.5} />
						</clipPath>
						<pattern
							id={`${id}-pattern`}
							width={6}
							height={14}
							y={-7}
							patternUnits="userSpaceOnUse"
						>
							<path
								d="M0 0 H4.5 L11.5 7 L4.5 14 H0 L7 7 Z M-6 0 H-1.5 L5.5 7 L-1.5 14 H-6 L1 7 Z"
								fill="hsl(var(--content-link))"
							/>
						</pattern>
					</defs>
					<g clipPath={`url(#${id}-clip)`}>
						<g className="workspace-tunnel-head-flow">
							<rect
								x={-14}
								y={-7}
								width={28}
								height={14}
								fill={`url(#${id}-pattern)`}
							/>
						</g>
					</g>
				</>
			) : (
				<text y={3} textAnchor="middle" className="fill-current text-[10px]">
					…
				</text>
			)}
		</g>
	);
};
