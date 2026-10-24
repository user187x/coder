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
): [Point, Point] => {
	const reach = Math.min(100, Math.max(30, Math.abs(to.x - from.x) / 2));
	return [
		{ x: from.x + (fromSide === "left" ? -reach : reach), y: from.y + 4 },
		{ x: to.x + (toSide === "left" ? -reach : reach), y: to.y },
	];
};

/** Uses the overview's spring motion and cable material with side-facing sockets. */
export const TunnelCord: React.FC<{
	from: Point;
	to: Point;
	fromSide: "left" | "right";
	toSide: "left" | "right";
	pending?: boolean;
}> = ({ from, to, fromSide, toSide, pending }) => {
	const cable = useRef(makeCable(from, to));
	const line = useRef<SVGPathElement>(null);
	const shine = useRef<SVGPathElement>(null);
	const animations = useAnimationsEnabled();
	const rest = tunnelHandles(from, to, fromSide, toSide);
	const d = cablePath(from, restingCable(rest), to);
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
				className="cd-cable"
				strokeDasharray={pending ? "5 4" : undefined}
			/>
			<path ref={shine} d={d} className="cd-cable-shine" />
		</>
	);
};
