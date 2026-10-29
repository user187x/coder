import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import type { Point } from "../cloudDrive/cables";
import { TunnelOverviewTooltip } from "./TunnelOverview";
import {
	insertTunnelBend,
	routedTunnelPath,
	type TunnelRoute,
} from "./tunnelRouting";

type Props = {
	from: Point;
	to: Point;
	defaultPath: string;
	route: TunnelRoute;
	onChange: (route: TunnelRoute) => void;
	label: string;
	onOpen: () => void;
	onReset?: () => void;
	onAdjustArc?: (delta: number) => void;
	onMoveHead?: (point: Point) => void;
	headOverview?: ReactNode;
	children?: ReactNode;
	defaultCable?: ReactNode;
	actions?: ReactNode;
	flow?: boolean;
	pending?: boolean;
};

/** Edits visual cable routing without changing the underlying tunnel connection. */
export const EditableTunnelCable = ({
	from,
	to,
	defaultPath,
	route,
	onChange,
	label,
	onOpen,
	onReset,
	onAdjustArc,
	onMoveHead,
	headOverview,
	children,
	defaultCable,
	actions,
	flow = false,
	pending = false,
}: Props) => {
	const animations = useAnimationsEnabled();
	const group = useRef<SVGGElement>(null);
	const [selected, setSelected] = useState<number | null>(null);
	const at = useRef<Point>({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
	const moving = useRef<{
		pointerId: number;
		index: number;
		route: TunnelRoute;
		constrained?: boolean;
		originX?: number;
		adjustArc?: (delta: number) => void;
	} | null>(null);
	const suppressClick = useRef(false);
	const frame = useRef<number | null>(null);
	const pendingMove = useRef<(() => void) | null>(null);
	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
		},
		[],
	);
	const flushMove = () => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		const pending = pendingMove.current;
		pendingMove.current = null;
		pending?.();
	};
	const custom = route.points.length > 0 || route.orthogonal || route.straight;
	const d = custom ? routedTunnelPath(from, to, route) : defaultPath;
	const position = (clientX: number, clientY: number): Point => {
		const svg = group.current?.ownerSVGElement;
		const matrix = svg?.getScreenCTM?.();
		if (matrix) {
			const point = new DOMPoint(clientX, clientY).matrixTransform(
				matrix.inverse(),
			);
			return { x: point.x, y: point.y };
		}
		const box = svg?.getBoundingClientRect();
		return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
	};
	const move = (index: number, point: Point) =>
		onChange({
			...route,
			points: route.points.map((p, i) =>
				i === index ? { ...p, ...point } : p,
			),
		});
	const remove = (index: number) =>
		onChange({ ...route, points: route.points.filter((_, i) => i !== index) });
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<g
					ref={group}
					className="workspace-tunnel-cord"
					onPointerMove={(e) => {
						const drag = moving.current;
						if (!drag || drag.pointerId !== e.pointerId) return;
						e.stopPropagation();
						let p = position(e.clientX, e.clientY);
						if (drag.index === -1 && (e.shiftKey || drag.constrained)) {
							p =
								Math.abs(p.x - from.x) >= Math.abs(p.y - from.y)
									? { x: p.x, y: from.y }
									: { x: from.x, y: p.y };
						}
						pendingMove.current = () => {
							if (drag.index === -2) {
								onChange({ points: [], orthogonal: false });
								drag.adjustArc?.((drag.originX ?? p.x) - p.x);
								return;
							}
							if (drag.index === -1) {
								if (e.shiftKey || drag.constrained)
									onChange({ points: [], orthogonal: false, straight: true });
								onMoveHead?.(p);
								return;
							}
							onChange({
								...drag.route,
								points: drag.route.points.map((point, index) =>
									index === drag.index
										? { ...point, x: p.x - from.x, y: p.y - from.y }
										: point,
								),
							});
						};
						if (frame.current === null)
							frame.current = requestAnimationFrame(flushMove);
					}}
					onPointerUp={(e) => {
						if (moving.current?.pointerId !== e.pointerId) return;
						flushMove();
						moving.current = null;
						e.currentTarget.releasePointerCapture?.(e.pointerId);
					}}
					onPointerCancel={() => {
						pendingMove.current = null;
						flushMove();
						moving.current = null;
					}}
					onContextMenuCapture={(e) => {
						setSelected(null);
						at.current =
							e.clientX || e.clientY
								? position(e.clientX, e.clientY)
								: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
					}}
				>
					{!custom && defaultCable ? (
						defaultCable
					) : (
						<>
							<path
								d={d}
								className="workspace-tunnel-conduit"
								strokeDasharray={pending ? "5 4" : undefined}
							/>
							<path d={d} className="workspace-tunnel-ridges" />
							{flow && (
								<>
									<path d={d} className="workspace-tunnel-flow" />
									{animations &&
										[0, 1, 2].map((index) => (
											<g
												key={index}
												className="workspace-tunnel-chevron"
												aria-hidden
											>
												<path d="M -4 -3 L 0 0 L -4 3" />
												<animateMotion
													dur="3s"
													begin={`${-index}s`}
													repeatCount="indefinite"
													rotate="auto"
													path={d}
												/>
											</g>
										))}
								</>
							)}
						</>
					)}
					<g
						className="pointer-events-auto cursor-pointer"
						role="button"
						tabIndex={0}
						aria-label={label}
						onAuxClick={(e) => {
							if (onAdjustArc && e.button === 1) {
								e.preventDefault();
								e.stopPropagation();
							}
						}}
						onClick={(e) => {
							if (suppressClick.current || e.ctrlKey) {
								suppressClick.current = false;
								return;
							}
							onOpen();
						}}
						onPointerDown={(e) => {
							suppressClick.current = false;
							if (e.button === 1 && onAdjustArc) {
								e.preventDefault();
								e.stopPropagation();
								moving.current = {
									pointerId: e.pointerId,
									index: -2,
									route,
									originX: position(e.clientX, e.clientY).x,
									adjustArc: onAdjustArc,
								};
								suppressClick.current = true;
								group.current?.setPointerCapture?.(e.pointerId);
								return;
							}
							if (e.button !== 0 || !e.ctrlKey) return;
							e.preventDefault();
							e.stopPropagation();
							const next = insertTunnelBend(
								from,
								to,
								route,
								position(e.clientX, e.clientY),
							);
							const index = next.points.findIndex(
								(point) =>
									!route.points.some((existing) => existing.id === point.id),
							);
							onChange(next);
							moving.current = { pointerId: e.pointerId, index, route: next };
							suppressClick.current = true;
							group.current?.setPointerCapture?.(e.pointerId);
						}}
						onKeyDown={(e) => {
							if (
								onAdjustArc &&
								e.shiftKey &&
								(e.key === "ArrowLeft" || e.key === "ArrowRight")
							) {
								e.preventDefault();
								onChange({ points: [], orthogonal: false });
								onAdjustArc(e.key === "ArrowLeft" ? 10 : -10);
								return;
							}
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onOpen();
							}
						}}
					>
						<path
							d={d}
							fill="none"
							stroke="transparent"
							strokeWidth={16}
							className="pointer-events-auto cursor-pointer"
						/>
						{onMoveHead ? (
							<circle
								cx={(from.x + to.x) / 2}
								cy={(from.y + to.y) / 2}
								r={8}
								fill="transparent"
							/>
						) : (
							children
						)}
						<title>
							{onAdjustArc &&
								"Middle-drag left to increase the arc, right to reduce it. Shift+Left/Right adjusts the arc. "}
							Ctrl+drag the cable to add and move a bend point. Right-click for
							routing options.
						</title>
					</g>
					{onMoveHead && (
						<TunnelOverviewTooltip overview={headOverview}>
							<g
								role="button"
								tabIndex={0}
								aria-label={`Move cable head: ${label.replace(/^Manage /, "")}`}
								className="pointer-events-auto cursor-move"
								onAuxClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
								}}
								onClick={(e) => {
									e.stopPropagation();
									if (!suppressClick.current && !e.ctrlKey) onOpen();
									suppressClick.current = false;
								}}
								onPointerDown={(e) => {
									suppressClick.current = false;
									if (
										e.button !== 1 &&
										(e.button !== 0 || (!e.ctrlKey && !e.shiftKey))
									)
										return;
									e.preventDefault();
									e.stopPropagation();
									moving.current = {
										pointerId: e.pointerId,
										index: -1,
										route,
										constrained: e.shiftKey,
									};
									if (e.shiftKey)
										onChange({ points: [], orthogonal: false, straight: true });
									suppressClick.current = true;
									group.current?.setPointerCapture?.(e.pointerId);
								}}
								onKeyDown={(e) => {
									const step = e.shiftKey ? 10 : 2;
									const offsets: Record<string, Point> = {
										ArrowLeft: { x: -step, y: 0 },
										ArrowRight: { x: step, y: 0 },
										ArrowUp: { x: 0, y: -step },
										ArrowDown: { x: 0, y: step },
									};
									if (offsets[e.key]) {
										e.preventDefault();
										onMoveHead({
											x: to.x + offsets[e.key].x,
											y: to.y + offsets[e.key].y,
										});
									} else if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										onOpen();
									}
								}}
							>
								{children}
								{!headOverview && (
									<title>
										Middle-drag or Ctrl+drag to move the cable head. Shift-drag
										constrains it to a straight line. Arrow keys adjust its
										position.
									</title>
								)}
							</g>
						</TunnelOverviewTooltip>
					)}
					{route.points.map((point, index) => (
						<circle
							key={point.id}
							cx={from.x + point.x}
							cy={from.y + point.y}
							r={4}
							fill="hsl(var(--surface-primary))"
							stroke="hsl(var(--content-link))"
							strokeWidth={1.5}
							role="button"
							tabIndex={0}
							aria-label={`Bend point ${index + 1}`}
							className="pointer-events-auto cursor-move"
							onClick={(e) => e.stopPropagation()}
							onContextMenu={() => setSelected(index)}
							onPointerDown={(e) => {
								if (e.button !== 0) return;
								e.stopPropagation();
								moving.current = { pointerId: e.pointerId, index, route };
								group.current?.setPointerCapture?.(e.pointerId);
							}}
							onKeyDown={(e) => {
								const step = e.shiftKey ? 10 : 2;
								const offsets: Record<string, Point> = {
									ArrowLeft: { x: -step, y: 0 },
									ArrowRight: { x: step, y: 0 },
									ArrowUp: { x: 0, y: -step },
									ArrowDown: { x: 0, y: step },
								};
								if (e.key === "Delete" || e.key === "Backspace") {
									e.preventDefault();
									remove(index);
								} else if (offsets[e.key]) {
									e.preventDefault();
									move(index, {
										x: point.x + offsets[e.key].x,
										y: point.y + offsets[e.key].y,
									});
								}
							}}
						>
							<title>
								Drag to move; arrow keys adjust; Delete removes. Right-click for
								routing options.
							</title>
						</circle>
					))}
				</g>
			</ContextMenuTrigger>
			<ContextMenuContent className="z-[100]">
				<ContextMenuItem
					onSelect={() =>
						onChange(insertTunnelBend(from, to, route, at.current))
					}
				>
					Add bend point here
				</ContextMenuItem>
				<ContextMenuItem
					disabled={selected === null}
					onSelect={() => {
						if (selected !== null) remove(selected);
					}}
				>
					Remove bend point
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() =>
						onChange({
							...route,
							...(route.straight ? { straight: false } : {}),
							orthogonal: !route.orthogonal,
						})
					}
				>
					{route.orthogonal ? "Use curved routing" : "Use right-angle routing"}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => {
						if (onMoveHead) {
							const head =
								Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
									? { x: to.x, y: from.y }
									: { x: from.x, y: to.y };
							onMoveHead(head);
							onChange({ points: [], orthogonal: false, straight: true });
						} else {
							onChange({ points: [], orthogonal: true });
						}
					}}
				>
					Straighten line
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => {
						onChange({ points: [], orthogonal: false });
						onReset?.();
					}}
				>
					Reset cable routing
				</ContextMenuItem>
				{actions && (
					<>
						<ContextMenuSeparator />
						{actions}
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
};
