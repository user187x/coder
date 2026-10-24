import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "react-query";
import type { WorkspaceTunnel } from "#/api/platform";
import {
	createWorkspaceTunnel,
	deleteWorkspaceTunnel,
	workspaceTunnels,
} from "#/api/queries/workspaceTunnels";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import { cablePath, type Point, restingCable } from "../cloudDrive/cables";
import "../cloudDrive/cloudDrive.css";
import "./workspaceTunnels.css";
import { LooseTunnelCord, type ReleasedTunnelCord } from "./LooseTunnelCord";
import { TunnelCord, tunnelHandles } from "./TunnelCord";

type Port = Point & { workspace: Workspace; side: "left" | "right" };
type Drag = {
	from: Port;
	at: Point;
	origin: Point;
	pointer: number;
	target?: Port;
	tunnel?: WorkspaceTunnel;
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
) => {
	return cablePath(
		from,
		restingCable(tunnelHandles(from, to, fromSide, toSide)),
		to,
	);
};

export const WorkspaceTunnelPorts: React.FC<{
	shown: readonly Workspace[];
	cols: number;
	cellW: number;
	cellH: number;
	gap: number;
	onDragging: (dragging: boolean) => void;
}> = ({ shown, cols, cellW, cellH, gap, onDragging }) => {
	const svg = useRef<SVGSVGElement>(null);
	const moved = useRef(false);
	const looseId = useRef(0);
	const [loose, setLoose] = useState<ReleasedTunnelCord[]>([]);
	const [drag, setDrag] = useState<Drag>();
	const dragRef = useRef<Drag | undefined>(undefined);
	const [selected, setSelected] = useState<Workspace>();
	const [error, setError] = useState<string>();
	const client = useQueryClient();
	const create = useMutation(createWorkspaceTunnel(client));
	const remove = useMutation(deleteWorkspaceTunnel(client));
	const organizations = [...new Set(shown.map((w) => w.organization_id))];
	const results = useQueries({ queries: organizations.map(workspaceTunnels) });
	const tunnels = results.flatMap((r) => r.data?.tunnels ?? []);
	const ports: Port[] = shown.flatMap((workspace, index) =>
		["left", "right"].map((side) => ({
			workspace,
			side: side === "left" ? "left" : "right",
			x: (index % cols) * (cellW + gap) + (side === "left" ? 8 : cellW - 8),
			y: Math.floor(index / cols) * (cellH + gap) + 18,
		})),
	);
	const fail = (e: unknown) =>
		setError(e instanceof Error ? e.message : "Tunnel request failed");
	const connect = (
		a: Workspace,
		b: Workspace,
		replace?: WorkspaceTunnel,
		sourceSide: "left" | "right" = "right",
		targetSide: "left" | "right" = "left",
	) => {
		if (replace && samePair(replace, a.id, b.id)) return;
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
				onSuccess: () => {
					if (replace) disconnect(replace);
				},
			},
		);
	};
	const disconnect = (t: WorkspaceTunnel) =>
		remove.mutate(
			{ organizationId: t.organization_id, id: t.id },
			{ onError: fail },
		);
	const valid = (from: Port, to: Port) =>
		from.workspace.id !== to.workspace.id &&
		from.workspace.organization_id === to.workspace.organization_id &&
		to.workspace.latest_build.status === "running" &&
		!tunnels.some(
			(t) =>
				samePair(t, from.workspace.id, to.workspace.id) &&
				t.id !== dragRef.current?.tunnel?.id,
		);
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
					current.tunnel,
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
				if (current.tunnel) disconnect(current.tunnel);
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
	const start = (
		e: React.PointerEvent,
		from: Port,
		tunnel?: WorkspaceTunnel,
	) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		moved.current = false;
		const box = svg.current?.getBoundingClientRect();
		const next = {
			from,
			origin: box
				? { x: e.clientX - box.left, y: e.clientY - box.top }
				: { x: from.x, y: from.y },
			at:
				tunnel && box
					? { x: e.clientX - box.left, y: e.clientY - box.top }
					: { x: from.x, y: from.y },
			pointer: e.pointerId,
			tunnel,
		};
		dragRef.current = next;
		setDrag(next);
		onDragging(true);
	};
	return (
		<>
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
				{tunnels.map((t) => {
					const from = ports.find(
						(p) =>
							p.workspace.id === t.source_workspace_id &&
							p.side === (t.source_side ?? "right"),
					);
					const to = ports.find(
						(p) =>
							p.workspace.id === t.target_workspace_id &&
							p.side === (t.target_side ?? "left"),
					);
					if (!from || !to || drag?.tunnel?.id === t.id) return null;
					const d = tunnelPath(from, to, from.side, to.side);
					return (
						<g
							key={t.id}
							className="workspace-tunnel-cord"
							data-state={t.status}
						>
							<TunnelCord
								from={from}
								to={to}
								fromSide={from.side}
								toSide={to.side}
								pending={t.status !== "ready"}
							/>
							<path
								d={d}
								fill="none"
								stroke="transparent"
								strokeWidth={14}
								className="pointer-events-stroke cursor-pointer"
								role="button"
								tabIndex={0}
								aria-label={`Manage tunnel ${from.workspace.name} to ${to.workspace.name}: ${t.status}`}
								onClick={() => setSelected(from.workspace)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setSelected(from.workspace);
									}
								}}
							/>
						</g>
					);
				})}
				{drag && (
					<g>
						<TunnelCord
							from={drag.from}
							to={drag.target ?? drag.at}
							fromSide={drag.from.side}
							toSide={drag.target?.side ?? "left"}
						/>
						<rect
							x={drag.at.x - 6}
							y={drag.at.y - 5}
							width={12}
							height={10}
							rx={2}
							className="cd-plug-body"
						/>
					</g>
				)}
				{ports.map((p) => (
					<g key={`${p.workspace.id}-${p.side}`}>
						<rect
							x={p.x - 4}
							y={p.y - 5}
							width={8}
							height={10}
							rx={2}
							className="cd-socket"
						/>
						<rect
							x={p.x - 8}
							y={p.y - 13}
							width={16}
							height={26}
							fill="transparent"
							className="pointer-events-auto cursor-grab"
							role="button"
							tabIndex={0}
							aria-label={`Connect ${p.workspace.name} ${p.side} tunnel port`}
							aria-disabled={p.workspace.latest_build.status !== "running"}
							onPointerDown={(e) => {
								const attached = tunnels.find(
									(t) =>
										t.target_workspace_id === p.workspace.id &&
										(t.target_side ?? "left") === p.side,
								);
								const anchor = attached
									? ports.find(
											(candidate) =>
												candidate.workspace.id ===
													attached.source_workspace_id &&
												candidate.side === (attached.source_side ?? "right"),
										)
									: undefined;
								if (attached && anchor) start(e, anchor, attached);
								else if (p.workspace.latest_build.status === "running")
									start(e, p);
							}}
							onClick={() => {
								if (!moved.current) setSelected(p.workspace);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setSelected(p.workspace);
								}
							}}
						/>
					</g>
				))}
				{tunnels.map((t) => {
					const from = ports.find(
						(p) =>
							p.workspace.id === t.source_workspace_id &&
							p.side === (t.source_side ?? "right"),
					);
					const to = ports.find(
						(p) =>
							p.workspace.id === t.target_workspace_id &&
							p.side === (t.target_side ?? "left"),
					);
					if (!from || !to || drag?.tunnel?.id === t.id) return null;
					return (
						<rect
							key={t.id}
							x={to.x - 6}
							y={to.y - 5}
							width={12}
							height={10}
							rx={2}
							className="cd-plug-body pointer-events-auto cursor-grab"
							role="button"
							tabIndex={0}
							aria-label={`Disconnect tunnel ${from.workspace.name} to ${to.workspace.name}`}
							onPointerDown={(e) => start(e, from, t)}
							onClick={() => {
								if (!moved.current) setSelected(to.workspace);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setSelected(to.workspace);
								}
							}}
						/>
					);
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
						private TCP and UDP traffic.
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
												create.isPending ||
												remove.isPending ||
												t?.status === "disconnecting" ||
												(!t &&
													(w.latest_build.status !== "running" ||
														selected.latest_build.status !== "running"))
											}
											onClick={() => (t ? disconnect(t) : connect(selected, w))}
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
