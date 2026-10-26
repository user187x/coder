import { type ReactNode, useRef, useState } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import type { Point } from "../cloudDrive/cables";
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
	const moving = useRef<number | null>(null);
	const custom = route.points.length > 0 || route.orthogonal;
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
									<path
										d={d}
										className="workspace-tunnel-flow"
										style={{ animationDirection: "reverse" }}
									/>
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
													path={routedTunnelPath(from, to, route, true)}
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
						onClick={onOpen}
						onKeyDown={(e) => {
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
						{children}
					</g>
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
								moving.current = e.pointerId;
								e.currentTarget.setPointerCapture?.(e.pointerId);
							}}
							onPointerMove={(e) => {
								if (moving.current !== e.pointerId) return;
								e.stopPropagation();
								const p = position(e.clientX, e.clientY);
								move(index, { x: p.x - from.x, y: p.y - from.y });
							}}
							onPointerUp={(e) => {
								moving.current = null;
								e.currentTarget.releasePointerCapture?.(e.pointerId);
							}}
							onPointerCancel={() => {
								moving.current = null;
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
					onSelect={() => onChange({ ...route, orthogonal: !route.orthogonal })}
				>
					{route.orthogonal ? "Use curved routing" : "Use right-angle routing"}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => onChange({ points: [], orthogonal: false })}
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
