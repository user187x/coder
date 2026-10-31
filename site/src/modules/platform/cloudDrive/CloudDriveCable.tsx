import { useEffect, useEffectEvent, useRef } from "react";
import { useAnimationsEnabled } from "#/hooks/useAnimationSettings";
import { CloudDriveMalePlug } from "./CloudDriveMalePlug";
import {
	type Cable,
	cableLength,
	cablePath,
	fall,
	hangingRest,
	heldRest,
	makeCable,
	type Point,
	plugAngle,
	reelSpeed,
	stepCable,
} from "./cables";
import "./cloudDrive.css";

/** The shared cable jacket, highlight and male connector. Children extend the plug's hit area. */
export const CloudDriveCable = ({
	children,
}: {
	children?: React.ReactNode;
}) => (
	<>
		<path className="cd-cable" />
		<path className="cd-cable-shine" />
		<g className="cd-plug">
			<CloudDriveMalePlug />
			{children}
		</g>
	</>
);

/** A freely dragged Cloud Drive cable, falling and reeling back when released. */
export const CloudDriveDragCable = ({
	origin,
	pointer,
	connectorTarget,
}: {
	origin: Point | null;
	pointer: Point | null;
	/** Aim the held plug at its destination while retaining cable physics. */
	connectorTarget?: () => Point | null;
}) => {
	const group = useRef<SVGGElement>(null);
	const animations = useAnimationsEnabled();
	const latest = useEffectEvent(() => ({
		origin,
		pointer,
		animations,
		connectorTarget,
	}));
	const wake = useRef<(() => void) | null>(null);
	useEffect(() => {
		const element = group.current;
		if (!element) return;
		let wire:
			| (Cable & {
					origin: Point;
					end: Point;
					velocityEnd: Point;
					released: number;
					length: number;
			  })
			| null = null;
		let frame = 0;
		let last = performance.now();
		const tick = (now: number) => {
			frame = 0;
			const {
				origin: from,
				pointer: to,
				animations,
				connectorTarget,
			} = latest();
			const reduced =
				!animations ||
				(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
					false);
			if (from && to) {
				if (
					!wire ||
					wire.released ||
					wire.origin.x !== from.x ||
					wire.origin.y !== from.y
				) {
					wire = {
						...makeCable(from, to),
						origin: from,
						end: { ...to },
						velocityEnd: { x: 0, y: 0 },
						released: 0,
						length: 0,
					};
				}
				wire.end = { ...to };
			} else if (wire && !wire.released) {
				wire.released = now;
				wire.length = cableLength(wire.origin, wire, wire.end);
			}
			if (wire) {
				const target = !wire.released ? connectorTarget?.() : null;
				const rest = (start: Point, end: Point) =>
					target ? heldRest(start, end, target) : hangingRest(start, end);
				let dt = Math.min((now - last) / 1000, 0.05);
				if (reduced) {
					wire.handles = rest(wire.origin, wire.end);
					if (wire.released) wire.length = 0;
				} else
					while (dt > 0) {
						const step = Math.min(dt, 1 / 120);
						if (wire.released) {
							const elapsed = (now - wire.released) / 1000;
							if (elapsed > 0.5) wire.length -= reelSpeed(elapsed - 0.5) * step;
							fall(
								wire.end,
								wire.velocityEnd,
								wire.origin,
								Math.max(0, wire.length),
								step,
							);
						}
						stepCable(wire, rest(wire.origin, wire.end), step);
						dt -= step;
					}
				if (wire.released && wire.length <= 2) wire = null;
			}
			element.setAttribute("visibility", wire ? "visible" : "hidden");
			if (wire) {
				const path = cablePath(wire.origin, wire, wire.end);
				const target = !wire.released ? connectorTarget?.() : null;
				const angle = target
					? Math.atan2(target.y - wire.end.y, target.x - wire.end.x)
					: plugAngle(wire, wire.end);
				for (const part of element.querySelectorAll("path"))
					part.setAttribute("d", path);
				element
					.querySelector(".cd-plug")
					?.setAttribute(
						"transform",
						`translate(${wire.end.x},${wire.end.y}) rotate(${(angle * 180) / Math.PI})`,
					);
			}
			last = now;
			if (wire || from) frame = requestAnimationFrame(tick);
		};
		wake.current = () => {
			if (!frame) {
				last = performance.now();
				frame = requestAnimationFrame(tick);
			}
		};
		wake.current();
		return () => {
			cancelAnimationFrame(frame);
			wake.current = null;
		};
	}, []);
	useEffect(() => {
		wake.current?.();
	}, [origin, pointer]);
	return (
		<svg
			aria-hidden
			className="pointer-events-none fixed inset-0 z-[110] size-full overflow-visible"
		>
			<g ref={group} visibility="hidden">
				<CloudDriveCable />
			</g>
		</svg>
	);
};
