import { useAnimationsEnabled } from "#/modules/platform/animations/animations";

/** One illuminated chevron per ready tunnel, flowing outward from the center. */
export const TunnelFlowIndicator = ({
	incoming,
	outgoing,
}: {
	incoming: number;
	outgoing: number;
}) => {
	const animations = useAnimationsEnabled();
	return (
		<span
			className="inline-flex items-center gap-1 rounded-full border border-solid border-border px-1.5 py-1"
			aria-hidden
		>
			{[
				{ count: outgoing, left: true, color: "#4ade80" },
				{ count: incoming, left: false, color: "#60a5fa" },
			].map(({ count, left, color }) => {
				const slots = Math.max(6, count);
				const points = left
					? "8,0 4,0 0,5 4,10 8,10 4,5"
					: "0,0 4,0 8,5 4,10 0,10 4,5";
				return (
					<svg
						key={left ? "outgoing" : "incoming"}
						width={44}
						height={10}
						viewBox={`0 0 ${slots * 8} 10`}
					>
						{Array.from({ length: slots }, (_, index) => {
							const distance = left ? slots - 1 - index : index;
							return (
								<g key={index} transform={`translate(${index * 8} 0)`}>
									<polygon points={points} fill="currentColor" opacity={0.18} />
									<polygon
										points={points}
										fill={color}
										opacity={distance < count ? 1 : 0}
										className={
											animations && count > 0 && count < slots
												? "tunnel-flow-animated"
												: undefined
										}
									>
										{animations && count > 0 && count < slots && (
											<animate
												attributeName="opacity"
												values="1;0;0"
												keyTimes={`0;${count / slots};1`}
												calcMode="discrete"
												dur="3s"
												begin={`${(-((slots - distance) % slots) * 3) / slots}s`}
												repeatCount="indefinite"
											/>
										)}
									</polygon>
									{animations && count > 0 && count < slots && (
										<polygon
											points={points}
											fill={color}
											opacity={distance < count ? 1 : 0}
											className="tunnel-flow-reduced"
										/>
									)}
								</g>
							);
						})}
					</svg>
				);
			})}
		</span>
	);
};
