import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "react-query";
import type { WorkspaceTunnel } from "#/api/platform";
import {
	createWorkspaceTunnel,
	deleteWorkspaceTunnel,
	workspaceTunnels,
} from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { CloudDriveMalePlug } from "../cloudDrive/CloudDriveMalePlug";
import { cablePath, type Point, restingCable } from "../cloudDrive/cables";
import { EditableTunnelCable } from "./EditableTunnelCable";
import { TunnelConnectionHead } from "./TunnelConnectionHead";
import { TunnelDetails } from "./TunnelDetails";
import { TunnelOverview, TunnelOverviewTooltip } from "./TunnelOverview";
import { readTunnelLayout, saveTunnelLayout } from "./tunnelLayout";
import type { TunnelRoute } from "./tunnelRouting";
import "../cloudDrive/cloudDrive.css";
import "./workspaceTunnels.css";
import { LooseTunnelCord, type ReleasedTunnelCord } from "./LooseTunnelCord";
import { TunnelCord, tunnelHandles } from "./TunnelCord";

export type TableTunnelAnchor = Point & { workspaceId: string };

type Port = Point & {
	workspace: Workspace;
	side: "left" | "right";
	terminal?: "input" | "output";
};
type Drag = {
	from: Port;
	at: Point;
	origin: Point;
	pointer: number;
	target?: Port;
	velocity?: Point;
	sampled?: number;
};
const samePair = (t: WorkspaceTunnel, a: string, b: string) =>
	(t.source_workspace_id === a && t.target_workspace_id === b) ||
	(t.source_workspace_id === b && t.target_workspace_id === a);
export const tunnelPath = (
	from: Point,
	to: Point,
	fromSide: "left" | "right",
	toSide: "left" | "right",
	arc?: number,
) => {
	return cablePath(
		from,
		restingCable(tunnelHandles(from, to, fromSide, toSide, arc)),
		to,
	);
};

export type TunnelManagerActions = { open: (workspaceId: string) => void };

export const WorkspaceTunnelPorts: React.FC<{
	managerRef?: React.Ref<TunnelManagerActions>;
	shown: readonly Workspace[];
	cols: number;
	cellW: number;
	cellH: number;
	gap: number;
	portCenterY?: number;
	onDragging: (dragging: boolean) => void;
	tableAnchors?: readonly TableTunnelAnchor[];
	listMode?: boolean;
	canManage?: boolean;
	actorId?: string;
}> = ({
	shown,
	managerRef,
	cols,
	cellW,
	cellH,
	gap,
	portCenterY = cellH / 2,
	onDragging,
	tableAnchors,
	listMode = false,
	canManage = true,
	actorId,
}) => {
	const manages = (workspace: Workspace) =>
		canManage || Boolean(actorId && workspace.owner_id === actorId);
	const managesPair = (a: Workspace, b: Workspace) =>
		a.organization_id === b.organization_id && manages(a) && manages(b);
	const managesTunnel = (tunnel: WorkspaceTunnel) => {
		if (canManage) return true;
		const source = shown.find(
			(workspace) => workspace.id === tunnel.source_workspace_id,
		);
		const target = shown.find(
			(workspace) => workspace.id === tunnel.target_workspace_id,
		);
		return Boolean(source && target && managesPair(source, target));
	};
	const svg = useRef<SVGSVGElement>(null);
	const moved = useRef(false);
	const looseId = useRef(0);
	const [loose, setLoose] = useState<ReleasedTunnelCord[]>([]);
	const [drag, setDrag] = useState<Drag>();
	const dragRef = useRef<Drag | undefined>(undefined);
	const [selected, setSelected] = useState<Workspace>();
	useImperativeHandle(managerRef, () => ({
		open: (workspaceId) => {
			const workspace = shown.find((item) => item.id === workspaceId);
			if (workspace) setSelected(workspace);
		},
	}));
	const [selectedTerminal, setSelectedTerminal] = useState<"input" | "output">(
		"output",
	);
	const [selectedSide, setSelectedSide] = useState<"left" | "right">("right");
	const layoutKey = `coder-tunnel-layout-v1:${actorId ?? "anonymous"}:${tableAnchors ? "table" : listMode ? "list" : "grid"}`;
	const [saved] = useState(() => readTunnelLayout(layoutKey));
	const [routes, setRoutes] = useState<Record<string, TunnelRoute>>(
		saved.routes,
	);
	const [heads, setHeads] = useState<Record<string, { x: number; y: number }>>(
		saved.heads,
	);
	const [arcs, setArcs] = useState<Record<string, number>>(saved.arcs);
	const [stubs, setStubs] = useState<
		Record<string, { length: number; bend: number }>
	>(saved.stubs);
	useEffect(() => {
		saveTunnelLayout(layoutKey, { routes, heads, arcs, stubs });
	}, [layoutKey, routes, heads, arcs, stubs]);
	const resetLayout = (id: string) => {
		const clear = <T,>(current: Record<string, T>) => {
			const next = { ...current };
			delete next[id];
			return next;
		};
		setRoutes(clear);
		setHeads(clear);
		setArcs(clear);
		setStubs(clear);
	};
	const [error, setError] = useState<string>();
	const client = useQueryClient();
	const create = useMutation(createWorkspaceTunnel(client));
	const remove = useMutation(deleteWorkspaceTunnel(client));
	const [detailsId, setDetailsId] = useState<string | null>(null);
	const organizations = [...new Set(shown.map((w) => w.organization_id))];
	const results = useQueries({ queries: organizations.map(workspaceTunnels) });
	const tunnels = results.flatMap((r) =>
		r.isError ? [] : (r.data?.tunnels ?? []),
	);
	const gridPorts: Port[] = shown.flatMap((workspace, index) =>
		(["left", "right"] as const)
			.filter((side) => {
				if (listMode) return side === "right";
				if (cols === 1) return side === "left";
				return side === "left" ? index % cols > 0 : index % cols < cols - 1;
			})
			.flatMap((side) =>
				(["input", "output"] as const).map((terminal) => ({
					workspace,
					side,
					terminal,
					x: listMode
						? cellW + 8
						: cols === 1
							? Math.min(128, Math.max(24, cellW / 3))
							: (index % cols) * (cellW + gap) +
								(side === "left" ? -8 : cellW + 8),
					y:
						Math.floor(index / cols) * (cellH + gap) +
						portCenterY +
						(terminal === "output" ? -12 : 12),
				})),
			),
	);
	const ports: Port[] = tableAnchors
		? tableAnchors.flatMap((anchor) => {
				const workspace = shown.find((w) => w.id === anchor.workspaceId);
				return workspace
					? (["input", "output"] as const).map((terminal) => ({
							...anchor,
							workspace,
							side: "left" as const,
							terminal,
							y: anchor.y + (terminal === "output" ? -12 : 12),
						}))
					: [];
			})
		: gridPorts;
	const portFor = (
		id: string,
		side: "left" | "right",
		terminal: "input" | "output",
	) => {
		const candidates = ports.filter(
			(p) => p.workspace.id === id && p.terminal === terminal,
		);
		return (
			candidates.find((p) => tableAnchors || p.side === side) ?? candidates[0]
		);
	};
	const maxArc = (tunnel: WorkspaceTunnel) => {
		if (tableAnchors) return 112;
		if (listMode) return 52;
		const from = portFor(
			tunnel.source_workspace_id,
			tunnel.source_side ?? "right",
			"output",
		);
		const to = portFor(
			tunnel.target_workspace_id,
			tunnel.target_side ?? "left",
			"input",
		);
		if (!from || !to) return 112;
		const width = cols * cellW + (cols - 1) * gap;
		return Math.max(
			0,
			Math.min(
				112,
				(from.side === "left" ? from.x : width - from.x) - 8,
				(to.side === "left" ? to.x : width - to.x) - 8,
			),
		);
	};
	const arcFor = (tunnel: WorkspaceTunnel, index: number) =>
		Math.min(maxArc(tunnel), arcs[tunnel.id] ?? 40 + (index % 5) * 12);

	const fail = (e: unknown) =>
		setError(e instanceof Error ? e.message : "Tunnel request failed");
	const connect = (
		a: Workspace,
		b: Workspace,
		sourceSide: "left" | "right" = tableAnchors ? "left" : "right",
		targetSide: "left" | "right" = "left",
	) => {
		if (!managesPair(a, b)) return;
		setError(undefined);
		create.mutate(
			{
				organizationId: a.organization_id,
				source: a.id,
				target: b.id,
				sourceSide,
				targetSide,
			},
			{
				onError: fail,
			},
		);
	};
	const disconnect = (t: WorkspaceTunnel) => {
		if (!managesTunnel(t)) return;
		return remove.mutate(
			{ organizationId: t.organization_id, id: t.id },
			{ onError: fail },
		);
	};
	const valid = (from: Port, to: Port) =>
		managesPair(from.workspace, to.workspace) &&
		from.terminal === "output" &&
		to.terminal === "input" &&
		from.workspace.id !== to.workspace.id &&
		from.workspace.organization_id === to.workspace.organization_id &&
		to.workspace.latest_build.status === "running" &&
		!tunnels.some((t) => samePair(t, from.workspace.id, to.workspace.id));
	useEffect(() => {
		if (!drag) return;
		let frame = 0;
		const update = (e: PointerEvent) => {
			const current = dragRef.current;
			const box = svg.current?.getBoundingClientRect();
			if (!current || !box || e.pointerId !== current.pointer) return;
			const at = { x: e.clientX - box.left, y: e.clientY - box.top };
			if (Math.hypot(at.x - current.origin.x, at.y - current.origin.y) > 4)
				moved.current = true;
			const target = ports.find(
				(p) =>
					Math.hypot(p.x - at.x, p.y - at.y) < 24 && valid(current.from, p),
			);
			const now = performance.now();
			const dt = Math.max(16, now - (current.sampled ?? now)) / 1000;
			const speed = {
				x: (at.x - current.at.x) / dt,
				y: (at.y - current.at.y) / dt,
			};
			const velocity =
				Math.hypot(speed.x, speed.y) > 1 ? speed : current.velocity;
			const next = { ...current, at, target, velocity, sampled: now };
			dragRef.current = next;
			setDrag(next);
		};
		const move = (e: PointerEvent) => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => update(e));
		};
		const finish = (cancelled: boolean) => {
			cancelAnimationFrame(frame);
			const current = dragRef.current;
			dragRef.current = undefined;
			setDrag(undefined);
			onDragging(false);
			if (!current || cancelled) return;
			if (current.target)
				connect(
					current.from.workspace,
					current.target.workspace,
					current.from.side,
					current.target.side,
				);
			else {
				if (moved.current) {
					const cord: ReleasedTunnelCord = {
						id: looseId.current++,
						from: { x: current.from.x, y: current.from.y },
						at: current.at,
						side: current.from.side,
						velocity: current.velocity ?? { x: 0, y: 0 },
					};
					setLoose((previous) => [...previous, cord]);
				}
			}
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId === dragRef.current?.pointer) {
				update(e);
				finish(false);
			}
		};
		const cancel = () => finish(true);
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				finish(true);
			}
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", key, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", key, true);
		};
	});
	useEffect(() => () => onDragging(false), [onDragging]);
	const start = (e: React.PointerEvent, from: Port) => {
		if (
			e.button !== 0 ||
			from.terminal !== "output" ||
			!manages(from.workspace)
		)
			return;
		e.preventDefault();
		e.stopPropagation();
		moved.current = false;
		const box = svg.current?.getBoundingClientRect();
		const next = {
			from,
			origin: box
				? { x: e.clientX - box.left, y: e.clientY - box.top }
				: { x: from.x, y: from.y },
			at: { x: from.x, y: from.y },
			pointer: e.pointerId,
		};
		dragRef.current = next;
		setDrag(next);
		onDragging(true);
	};
	const details = tunnels.find((t) => t.id === detailsId);
	return (
		<>
			<Dialog
				open={detailsId !== null}
				onOpenChange={(open) => {
					if (!open) setDetailsId(null);
				}}
			>
				<DialogContent
					className="z-[95] max-h-[85vh] overflow-y-auto"
					overlayClassName="z-[94] backdrop-blur-sm"
				>
					<DialogTitle>Connection details</DialogTitle>
					{details ? (
						<TunnelDetails tunnel={details} />
					) : (
						<p>This connection is no longer available.</p>
					)}
					<DialogClose asChild>
						<Button variant="outline">Close</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>
			<svg
				ref={svg}
				className="absolute inset-0 z-20 size-full overflow-visible pointer-events-none"
				aria-label="Workspace tunnel connections"
			>
				{loose.map((cord) => (
					<LooseTunnelCord
						key={cord.id}
						cord={cord}
						onDone={(id) =>
							setLoose((previous) => previous.filter((c) => c.id !== id))
						}
					/>
				))}
				{tunnels.map((t, index) => {
					const from = portFor(
						t.source_workspace_id,
						t.source_side ?? "right",
						"output",
					);
					const to = portFor(
						t.target_workspace_id,
						t.target_side ?? "left",
						"input",
					);
					if (!from || !to) {
						const visible = from ?? to;
						if (!visible) return null;
						const peer = from
							? t.target_workspace_name
							: t.source_workspace_name;
						const label = `Manage tunnel to ${peer || "workspace"} outside this view: ${t.status}`;
						const open = () => {
							setSelected(visible.workspace);
							setSelectedTerminal(visible.terminal ?? "output");
							setSelectedSide(visible.side);
						};
						const stub = stubs[t.id] ?? { length: 26, bend: 0 };
						const direction = visible.side === "left" ? -1 : 1;
						const head = heads[t.id] ?? { x: 0, y: 0 };
						const end = visible.x + direction * stub.length + head.x;
						const endY = visible.y + head.y;
						const route = routes[t.id] ?? { points: [], orthogonal: false };

						return (
							<EditableTunnelCable
								key={t.id}
								onReset={() => resetLayout(t.id)}
								from={{ x: visible.x - direction * 15, y: visible.y }}
								to={{ x: end, y: endY }}
								onMoveHead={(point) =>
									setHeads((current) => ({
										...current,
										[t.id]: {
											x: point.x - visible.x - direction * stub.length,
											y: point.y - visible.y,
										},
									}))
								}
								defaultPath={`M ${visible.x - direction * 15} ${visible.y} C ${visible.x + (direction * stub.length) / 3} ${visible.y + stub.bend}, ${end - (direction * stub.length) / 3} ${endY - stub.bend}, ${end} ${endY}`}
								route={route}
								headOverview={<TunnelOverview tunnel={t} peerSource={!from} />}
								onChange={(route) =>
									setRoutes((current) => ({ ...current, [t.id]: route }))
								}
								label={label}
								onOpen={open}
							>
								<TunnelConnectionHead
									x={end}
									y={endY}
									outgoing={Boolean(from)}
									ready={t.status === "ready"}
								/>
							</EditableTunnelCable>
						);
					}
					const arc = arcFor(t, index);
					const d = tunnelPath(from, to, from.side, to.side, arc);
					return (
						<EditableTunnelCable
							key={t.id}
							onReset={() => resetLayout(t.id)}
							from={from}
							to={to}
							defaultPath={d}
							onAdjustArc={(delta) =>
								setArcs((current) => ({
									...current,
									[t.id]: Math.max(0, Math.min(maxArc(t), arc + delta)),
								}))
							}
							route={routes[t.id] ?? { points: [], orthogonal: false }}
							onChange={(route) =>
								setRoutes((current) => ({ ...current, [t.id]: route }))
							}
							label={`Manage tunnel ${from.workspace.name} to ${to.workspace.name}: ${t.status}`}
							onOpen={() => {
								setSelected(from.workspace);
								setSelectedTerminal("output");
								setSelectedSide(from.side);
							}}
							flow
							pending={t.status !== "ready"}
							defaultCable={
								<TunnelCord
									from={from}
									to={to}
									fromSide={from.side}
									toSide={to.side}
									pending={t.status !== "ready"}
									arc={arc}
								/>
							}
							actions={
								<>
									<ContextMenuItem onSelect={() => setDetailsId(t.id)}>
										View connection
									</ContextMenuItem>
									<ContextMenuItem
										disabled={
											!managesTunnel(t) ||
											remove.isPending ||
											t.status === "disconnecting"
										}
										onSelect={() => disconnect(t)}
									>
										Delete connection
									</ContextMenuItem>
								</>
							}
						/>
					);
				})}
				{drag && (
					<g>
						<TunnelCord
							from={drag.from}
							reverseFlow={drag.from.terminal === "input"}
							to={drag.target ?? drag.at}
							fromSide={drag.from.side}
							toSide={drag.target?.side ?? "left"}
						/>
						<g
							className="workspace-tunnel-output-connector"
							transform={`translate(${drag.at.x} ${drag.at.y}) scale(${(drag.target?.side ?? "left") === "left" ? 1 : -1} 1)`}
						>
							<CloudDriveMalePlug />
						</g>
					</g>
				)}
				{ports.map((p) => {
					const connectedOutput = tunnels.some(
						(t) =>
							portFor(
								t.source_workspace_id,
								t.source_side ?? "right",
								"output",
							) === p,
					);
					const idleOutput = p.terminal === "output" && !connectedOutput;
					return (
						<g key={`${p.workspace.id}-${p.side}-${p.terminal}`}>
							{idleOutput ? (
								<g
									aria-hidden
									transform={`translate(${p.x + (p.side === "left" ? 15 : -15)} ${p.y}) scale(${p.side === "left" ? -1 : 1} 1)`}
									className="workspace-tunnel-output-connector"
								>
									<CloudDriveMalePlug />
								</g>
							) : (
								<rect
									x={p.x + (p.side === "left" ? 3 : -15)}
									y={p.y - 4.5}
									width={12}
									height={9}
									rx={2}
									className={`cd-socket ${p.terminal ? `workspace-tunnel-${p.terminal}` : ""}`}
								/>
							)}
							<rect
								x={
									p.x +
									(idleOutput || p.terminal === "input"
										? p.side === "left"
											? -7
											: -17
										: p.side === "left"
											? 12
											: -32)
								}
								y={p.y - 13}
								width={idleOutput || p.terminal === "input" ? 24 : 20}
								height={26}
								fill="transparent"
								className={`pointer-events-auto ${p.terminal === "output" ? "cursor-grab" : "cursor-pointer"}`}
								role="button"
								tabIndex={0}
								aria-label={`Connect ${p.workspace.name} ${tableAnchors ? "" : `${p.side} `}${p.terminal} tunnel port`}
								aria-disabled={
									!manages(p.workspace) ||
									p.workspace.latest_build.status !== "running"
								}
								onPointerDown={(e) => {
									if (p.workspace.latest_build.status === "running")
										start(e, p);
								}}
								onClick={() => {
									if (!moved.current) {
										setSelected(p.workspace);
										setSelectedTerminal(p.terminal ?? "output");
										setSelectedSide(p.side);
									}
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setSelected(p.workspace);
										setSelectedTerminal(p.terminal ?? "output");
										setSelectedSide(p.side);
									}
								}}
							/>
						</g>
					);
				})}
				{tunnels.flatMap((t) => {
					const from = portFor(
						t.source_workspace_id,
						t.source_side ?? "right",
						"output",
					);
					const to = portFor(
						t.target_workspace_id,
						t.target_side ?? "left",
						"input",
					);
					if (!from || !to) return [];
					return [
						{ at: from, source: true },
						{ at: to, source: false },
					].map(({ at, source }) => (
						<ContextMenu key={`${t.id}-${source}`}>
							<TunnelOverviewTooltip
								overview={<TunnelOverview tunnel={t} peerSource={!source} />}
							>
								<ContextMenuTrigger asChild>
									<g
										className="workspace-tunnel-output-connector"
										transform={`translate(${at.x} ${at.y}) scale(${at.side === "left" ? 1 : -1} 1)`}
									>
										{source && <CloudDriveMalePlug />}
										<rect
											x={-4}
											y={-9}
											width={16}
											height={18}
											fill="transparent"
											className={
												source
													? "pointer-events-auto cursor-grab"
													: "pointer-events-auto cursor-pointer"
											}
											role="button"
											tabIndex={0}
											aria-label={`Disconnect tunnel ${from.workspace.name} to ${to.workspace.name}${source ? " source plug" : ""}`}
											onPointerDown={
												source ? (event) => start(event, from) : undefined
											}
											onClick={() => {
												if (!moved.current) {
													setSelected(at.workspace);
													setSelectedTerminal(source ? "output" : "input");
													setSelectedSide(at.side);
												}
											}}
											onKeyDown={(event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													setSelected(at.workspace);
													setSelectedTerminal(source ? "output" : "input");
													setSelectedSide(at.side);
												}
											}}
										/>
									</g>
								</ContextMenuTrigger>
							</TunnelOverviewTooltip>
							<ContextMenuContent className="z-[100]">
								<ContextMenuItem onSelect={() => setDetailsId(t.id)}>
									View connection
								</ContextMenuItem>
								<ContextMenuItem
									disabled={
										!managesTunnel(t) ||
										remove.isPending ||
										t.status === "disconnecting"
									}
									onSelect={() => disconnect(t)}
								>
									Delete connection
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					));
				})}
			</svg>
			{error && (
				<div
					role="alert"
					className="absolute bottom-3 left-3 z-30 rounded bg-surface-primary p-3 text-sm text-content-destructive"
				>
					{error}
				</div>
			)}
			<Dialog
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) setSelected(undefined);
				}}
			>
				<DialogContent className="z-[90]">
					<DialogTitle>
						Workspace tunnels{selected ? `: ${selected.name}` : ""}
					</DialogTitle>
					<p className="text-sm text-content-secondary">
						Connect running workspaces in the same organization. Tunnels carry
						private TCP and UDP traffic in both directions. Arrows flow from the
						male plug toward the female socket.
					</p>
					{error && (
						<p role="alert" className="text-content-destructive">
							{error}
						</p>
					)}
					{results.some((r) => r.isLoading) && <p>Loading tunnels…</p>}
					{results.some((r) => r.isError) && (
						<p role="alert">Could not load workspace tunnels. Try again.</p>
					)}
					{selected &&
						tunnels
							.filter(
								(t) =>
									t.source_workspace_id === selected.id ||
									t.target_workspace_id === selected.id,
							)
							.map((tunnel) => (
								<details
									key={`settings-${tunnel.id}`}
									className="rounded-lg border border-solid border-border p-3"
								>
									<summary className="cursor-pointer text-sm font-medium">
										{tunnel.source_workspace_name ?? tunnel.source_workspace_id}{" "}
										→{" "}
										{tunnel.target_workspace_name ?? tunnel.target_workspace_id}
										: ports and connection
									</summary>
									<div className="mt-3">
										<TunnelDetails tunnel={tunnel} />
									</div>
									<Button
										className="mt-3"
										variant="outline"
										size="sm"
										disabled={
											!managesTunnel(tunnel) ||
											remove.isPending ||
											tunnel.status === "disconnecting"
										}
										onClick={() => disconnect(tunnel)}
									>
										Disconnect connection
									</Button>
								</details>
							))}
					{selected &&
						tunnels
							.filter((t) => {
								const other =
									t.source_workspace_id === selected.id
										? t.target_workspace_id
										: t.target_workspace_id === selected.id
											? t.source_workspace_id
											: undefined;
								return other && !shown.some((w) => w.id === other);
							})
							.map((t) => (
								<div
									key={t.id}
									className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-2"
								>
									<span>
										{t.source_workspace_id === selected.id
											? (t.target_workspace_name ?? t.target_workspace_id)
											: (t.source_workspace_name ?? t.source_workspace_id)}
										<small className="block text-content-secondary">
											{t.error ?? t.status} · Not on this page
										</small>
									</span>
									<Button
										size="sm"
										variant="outline"
										disabled={
											!managesTunnel(t) ||
											remove.isPending ||
											t.status === "disconnecting"
										}
										onClick={() => disconnect(t)}
									>
										Disconnect
									</Button>
								</div>
							))}
					{selected &&
						shown
							.filter(
								(w) =>
									w.id !== selected.id &&
									w.organization_id === selected.organization_id,
							)
							.map((w) => {
								const t = tunnels.find((t) => samePair(t, selected.id, w.id));
								return (
									<div
										key={w.id}
										className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-2"
									>
										<span>
											{w.name}
											<small className="block text-content-secondary">
												{t?.error ?? t?.status ?? "Disconnected"}
												{t?.status === "ready" &&
													t.source_address &&
													` · ${t.source_address} ↔ ${t.target_address}`}
											</small>
										</span>
										<Button
											size="sm"
											variant="outline"
											disabled={
												!managesPair(selected, w) ||
												create.isPending ||
												remove.isPending ||
												t?.status === "disconnecting" ||
												(!t &&
													(w.latest_build.status !== "running" ||
														selected.latest_build.status !== "running"))
											}
											onClick={() =>
												t
													? disconnect(t)
													: selectedTerminal === "input"
														? connect(
																w,
																selected,
																tableAnchors ? "left" : "right",
																selectedSide,
															)
														: connect(
																selected,
																w,
																selectedSide,
																listMode ? "right" : "left",
															)
											}
										>
											{t ? "Disconnect" : "Connect"}
										</Button>
									</div>
								);
							})}
				</DialogContent>
			</Dialog>
		</>
	);
};
