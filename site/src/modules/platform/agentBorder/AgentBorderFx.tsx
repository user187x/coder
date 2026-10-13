import { useId } from "react";
import type { AgentBorderState } from "./agentBorderState";
import "./agentBorder.css";

const prefersReducedMotion = () =>
	window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type AgentBorderFxProps = {
	state: AgentBorderState | null;
	children: React.ReactNode;
};

/**
 * The agent card's border on the workspace page, by state (agentBorderState):
 * the electric border while it initializes (green), is pending or has a
 * problem (fiery orange) or has failed (red), and a green border pulsing a
 * soft ring outward once it is ready. The card keeps its own (transparent)
 * border, so nothing moves when the state changes; without a state it is
 * Coder's own border.
 */
export const AgentBorderFx: React.FC<AgentBorderFxProps> = ({
	state,
	children,
}) => {
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const filterId = `agent-fx-turbulence-${id}`;
	const animated = !prefersReducedMotion();
	// Always this wrapper, even without a state: the card must not remount
	// (its open logs and terminal session) when the state comes and goes.
	return (
		<div
			className="agent-fx"
			data-fx={state ?? undefined}
			style={
				{
					"--fx-filter": animated ? `url(#${filterId})` : "none",
				} as React.CSSProperties
			}
		>
			{children}
			{!state ? null : state === "ready" ? (
				<div aria-hidden className="agent-fx-layer agent-fx-pulse" />
			) : (
				<>
					{animated && <TurbulenceFilter id={filterId} />}
					<div aria-hidden className="agent-fx-layer agent-fx-electric">
						<div className="agent-fx-layer agent-fx-outer" />
						<div className="agent-fx-layer agent-fx-main" />
						<div className="agent-fx-layer agent-fx-glow-1" />
						<div className="agent-fx-layer agent-fx-glow-2" />
						<div className="agent-fx-layer agent-fx-sheen" />
						<div className="agent-fx-layer agent-fx-sheen agent-fx-sheen-2" />
					</div>
					<div aria-hidden className="agent-fx-layer agent-fx-backglow" />
				</>
			)}
		</div>
	);
};

/**
 * The original's "turbulent-displace" filter: two pairs of turbulence fields
 * sliding past each other, displacing the border. Five octaves instead of
 * ten: the finer ones are below a pixel at this frequency, so they look the
 * same and cost twice as much. Toned down: a third of the original's pace
 * (18 s instead of 6 s per cycle) and less than half its displacement.
 */
const FLOW = "18s";
const DISPLACEMENT = "12";
const TurbulenceFilter: React.FC<{ id: string }> = ({ id }) => (
	<svg aria-hidden width="0" height="0" className="absolute">
		<defs>
			<filter
				id={id}
				colorInterpolationFilters="sRGB"
				x="-20%"
				y="-20%"
				width="140%"
				height="140%"
			>
				<feTurbulence
					type="turbulence"
					baseFrequency="0.02"
					numOctaves="5"
					result="noise1"
					seed="1"
				/>
				<feOffset in="noise1" dx="0" dy="0" result="offsetNoise1">
					<animate
						attributeName="dy"
						values="700; 0"
						dur={FLOW}
						repeatCount="indefinite"
						calcMode="linear"
					/>
				</feOffset>
				<feTurbulence
					type="turbulence"
					baseFrequency="0.02"
					numOctaves="5"
					result="noise2"
					seed="1"
				/>
				<feOffset in="noise2" dx="0" dy="0" result="offsetNoise2">
					<animate
						attributeName="dy"
						values="0; -700"
						dur={FLOW}
						repeatCount="indefinite"
						calcMode="linear"
					/>
				</feOffset>
				<feTurbulence
					type="turbulence"
					baseFrequency="0.02"
					numOctaves="5"
					result="noise3"
					seed="2"
				/>
				<feOffset in="noise3" dx="0" dy="0" result="offsetNoise3">
					<animate
						attributeName="dx"
						values="490; 0"
						dur={FLOW}
						repeatCount="indefinite"
						calcMode="linear"
					/>
				</feOffset>
				<feTurbulence
					type="turbulence"
					baseFrequency="0.02"
					numOctaves="5"
					result="noise4"
					seed="2"
				/>
				<feOffset in="noise4" dx="0" dy="0" result="offsetNoise4">
					<animate
						attributeName="dx"
						values="0; -490"
						dur={FLOW}
						repeatCount="indefinite"
						calcMode="linear"
					/>
				</feOffset>
				<feComposite in="offsetNoise1" in2="offsetNoise2" result="part1" />
				<feComposite in="offsetNoise3" in2="offsetNoise4" result="part2" />
				<feBlend
					in="part1"
					in2="part2"
					mode="color-dodge"
					result="combinedNoise"
				/>
				<feDisplacementMap
					in="SourceGraphic"
					in2="combinedNoise"
					scale={DISPLACEMENT}
					xChannelSelector="R"
					yChannelSelector="B"
				/>
			</filter>
		</defs>
	</svg>
);
