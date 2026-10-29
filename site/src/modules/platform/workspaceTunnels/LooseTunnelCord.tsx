import { useEffect, useRef } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { CloudDriveMalePlug } from "../cloudDrive/CloudDriveMalePlug";
import {
	cableLength,
	cablePath,
	fall,
	hangingRest,
	type Point,
	plugAngle,
	reelSpeed,
	restingCable,
	stepCable,
} from "../cloudDrive/cables";
import { tunnelHandles } from "./TunnelCord";

export type ReleasedTunnelCord = {
	id: number;
	from: Point;
	at: Point;
	side: "left" | "right";
	velocity: Point;
};

/** A released plug swings for half a second before its cord reels into its socket. */
export const LooseTunnelCord: React.FC<{
	cord: ReleasedTunnelCord;
	onDone: (id: number) => void;
}> = ({ cord, onDone }) => {
	const line = useRef<SVGPathElement>(null);
	const shine = useRef<SVGPathElement>(null);
	const plug = useRef<SVGGElement>(null);
	const animations = useAnimationsEnabled();
	const done = useRef(onDone);
	useEffect(() => {
		done.current = onDone;
	}, [onDone]);
	useEffect(() => {
		if (
			!animations ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			done.current(cord.id);
			return;
		}
		const end = { ...cord.at };
		const velocity = { ...cord.velocity };
		const cable = restingCable(
			tunnelHandles(cord.from, end, cord.side, "left"),
		);
		let length = cableLength(cord.from, cable, end);
		const since = performance.now();
		let last = since;
		let frame = 0;
		const direction = cord.side === "left" ? -1 : 1;
		const draw = (now: number) => {
			const elapsed = (now - since) / 1000;
			const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000)) / 2;
			last = now;
			for (let step = 0; step < 2; step++) {
				if (elapsed > 0.5) length -= reelSpeed(elapsed - 0.5) * dt;
				fall(end, velocity, cord.from, Math.max(0, length), dt);
				const mirrored = hangingRest(
					{ x: cord.from.x * direction, y: cord.from.y },
					{ x: end.x * direction, y: end.y },
				);
				const rest: [Point, Point] = [
					{ x: mirrored[0].x * direction, y: mirrored[0].y },
					{ x: mirrored[1].x * direction, y: mirrored[1].y },
				];
				stepCable(cable, rest, dt);
			}
			if (length <= 2) {
				done.current(cord.id);
				return;
			}
			const path = cablePath(cord.from, cable, end);
			line.current?.setAttribute("d", path);
			shine.current?.setAttribute("d", path);
			plug.current?.setAttribute("visibility", "visible");
			plug.current?.setAttribute(
				"transform",
				`translate(${end.x} ${end.y}) rotate(${(plugAngle(cable, end) * 180) / Math.PI})`,
			);
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [cord, animations]);
	return (
		<g aria-hidden>
			<path ref={line} className="workspace-tunnel-conduit" />
			<path ref={shine} className="workspace-tunnel-ridges" />
			<g
				ref={plug}
				visibility="hidden"
				className="workspace-tunnel-output-connector"
			>
				<CloudDriveMalePlug />
			</g>
		</g>
	);
};
