import { useEffect, useRef } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import {
	cablePath,
	makeCable,
	type Point,
	restingCable,
	stepCable,
} from "../cloudDrive/cables";

export const tunnelHandles = (
	from: Point,
	to: Point,
	fromSide: "left" | "right",
	toSide: "left" | "right",
	arc?: number,
): [Point, Point] => {
	const reach = arc ?? Math.min(100, Math.max(30, Math.abs(to.x - from.x) / 2));
	return [
		{ x: from.x + (fromSide === "left" ? -reach : reach), y: from.y + 4 },
		{ x: to.x + (toSide === "left" ? -reach : reach), y: to.y },
	];
};

/** Keeps the overview spring motion while drawing a narrow ribbed tunnel conduit. */
export const TunnelCord: React.FC<{
	from: Point;
	to: Point;
	fromSide: "left" | "right";
	toSide: "left" | "right";
	pending?: boolean;
	reverseFlow?: boolean;
	arc?: number;
}> = ({ from, to, fromSide, toSide, pending, arc, reverseFlow = false }) => {
	const cable = useRef(makeCable(from, to));
	const line = useRef<SVGPathElement>(null);
	const shine = useRef<SVGPathElement>(null);
	const ridges = useRef<SVGPathElement>(null);
	const animations = useAnimationsEnabled();
	const rest = tunnelHandles(from, to, fromSide, toSide, arc);
	const d = cablePath(from, restingCable(rest), to);
	const flowPath = reverseFlow
		? cablePath(to, restingCable([rest[1], rest[0]]), from)
		: d;
	const midpoint = {
		x: (from.x + 3 * rest[0].x + 3 * rest[1].x + to.x) / 8,
		y: (from.y + 3 * rest[0].y + 3 * rest[1].y + to.y) / 8,
	};
	const direction =
		(Math.atan2(
			to.y - from.y + rest[1].y - rest[0].y,
			to.x - from.x + rest[1].x - rest[0].x,
		) *
			180) /
		Math.PI;
	useEffect(() => {
		if (
			!animations ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		let frame = 0;
		let last = performance.now();
		const draw = (now: number) => {
			const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
			last = now;
			const moving = stepCable(cable.current, rest, dt);
			const path = cablePath(from, cable.current, to);
			line.current?.setAttribute("d", path);
			shine.current?.setAttribute("d", path);
			ridges.current?.setAttribute("d", path);
			if (moving) frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [from, to, rest, animations]);
	return (
		<>
			<path
				ref={line}
				d={d}
				className="workspace-tunnel-conduit"
				strokeDasharray={pending ? "5 4" : undefined}
			/>
			<path ref={ridges} d={d} className="workspace-tunnel-ridges" />
			<path
				ref={shine}
				d={d}
				className="workspace-tunnel-flow"
				style={{ animationDirection: reverseFlow ? "reverse" : undefined }}
			/>
			<g
				className="workspace-tunnel-chevron-static"
				aria-hidden
				transform={`translate(${midpoint.x} ${midpoint.y}) rotate(${direction + (reverseFlow ? 180 : 0)})`}
			>
				<path d="M -4 -3 L 0 0 L -4 3" />
			</g>
			{[0, 1, 2].map((index) => (
				<g key={index} className="workspace-tunnel-chevron" aria-hidden>
					<path d="M -4 -3 L 0 0 L -4 3" />
					{animations && (
						<animateMotion
							dur="3s"
							begin={`${-index}s`}
							repeatCount="indefinite"
							rotate="auto"
							path={flowPath}
						/>
					)}
				</g>
			))}
		</>
	);
};
