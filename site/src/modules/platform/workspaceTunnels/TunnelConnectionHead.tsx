import { useId } from "react";
import { useMediaQuery } from "#/hooks/useMediaQuery";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";

/** Clips a seamless directional flow pattern inside the free tunnel connector. */
export const TunnelConnectionHead = ({
	x,
	y,
	outgoing,
	ready,
}: {
	x: number;
	y: number;
	outgoing: boolean;
	ready: boolean;
}) => {
	const angle = outgoing ? 180 : 0;
	const color = outgoing ? "#94a3b8" : "#4ade80";
	const id = useId().replace(/:/g, "");
	const animations = useAnimationsEnabled();
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	return (
		<g
			transform={`translate(${x} ${y}) rotate(${angle}) scale(0.55)`}
			aria-hidden
		>
			<rect
				x={-16}
				y={-16}
				width={32}
				height={32}
				fill="transparent"
				stroke="none"
			/>
			<circle
				r={10}
				fill="hsl(var(--surface-primary))"
				stroke={ready ? color : "currentColor"}
			/>
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
								stroke={color}
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							{animations && !reducedMotion && (
								<animateTransform
									attributeName="patternTransform"
									type="translate"
									from="-9 0"
									to="0 0"
									dur="1.5s"
									repeatCount="indefinite"
								/>
							)}
						</pattern>
					</defs>
					<g clipPath={`url(#${id}-clip)`}>
						<g>
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
