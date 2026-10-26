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
			<circle r={10} fill="hsl(var(--surface-primary))" stroke="currentColor" />
			{ready ? (
				<>
					<defs>
						<clipPath id={`${id}-clip`}>
							<circle r={8.5} />
						</clipPath>
						<pattern
							id={`${id}-pattern`}
							width={9}
							height={16}
							y={-8}
							patternUnits="userSpaceOnUse"
						>
							<path
								d="M1 3 L6 8 L1 13"
								fill="none"
								stroke="hsl(var(--content-link))"
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</pattern>
					</defs>
					<g clipPath={`url(#${id}-clip)`}>
						<g className="workspace-tunnel-head-flow">
							<rect
								x={-18}
								y={-8}
								width={36}
								height={16}
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
