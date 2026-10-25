import { useEffect, useRef, useState } from "react";
import { useAnimationsEnabled } from "#/modules/platform/animations/animations";
import { CloudDriveMalePlug } from "./CloudDriveMalePlug";
import { motionless } from "./CloudDriveRopes";
import {
	cablePath,
	cableReach,
	makeCable,
	type Point,
	restHandles,
	restingCable,
	stepCable,
} from "./cables";
import {
	GAP,
	PLUG,
	type ShareEdge,
	type ShareRow,
	SOCKET,
	shareEnds,
} from "./shareCables";

export type AccountShareReview = {
	shareId?: string;
	ownerId?: string;
	recipientId?: string;
};
type Account = { id: string; username: string };
type Layout = {
	origin: Point;
	rows: {
		id: string;
		left: number;
		right: number;
		top: number;
		bottom: number;
	}[];
	sockets: { owner: string; at: Point; from: Point }[];
	plugs: { edge: ShareEdge; at: Point; from: Point }[];
};
type Drag = {
	owner: string;
	shareId?: string;
	from: Point;
	at: Point;
	origin: Point;
	pointer: number;
	access: "read" | "write";
};

/** A drag selects existing account grants for review; it never changes permissions itself. */
export const AccountShareDragLayer: React.FC<{
	area: React.RefObject<HTMLDivElement | null>;
	accounts: readonly Account[];
	edges: readonly ShareEdge[];
	onReview: (review: AccountShareReview) => void;
	onDragging: (shareId?: string) => void;
}> = ({ area, accounts, edges, onReview, onDragging }) => {
	const [layout, setLayout] = useState<Layout>();
	const [drag, setDrag] = useState<Drag>();
	const currentDrag = useRef<Drag | undefined>(undefined);
	const moved = useRef(false);
	const names = new Map(
		accounts.map((account) => [account.id, account.username]),
	);
	useEffect(() => {
		const root = area.current;
		if (!root) return;
		let frame = 0;
		const measure = () => {
			const origin = root.getBoundingClientRect();
			const rows: Layout["rows"] = [];
			const places = new Map<string, ShareRow>();
			for (const account of accounts) {
				const row = root.querySelector(
					`[data-testid="user-${CSS.escape(account.id)}"]`,
				);
				if (!row) continue;
				const box = row.getBoundingClientRect();
				if (!box.height) continue;
				const edge =
					row.closest('[data-testid="accounts-card"]')?.getBoundingClientRect()
						.right ?? box.right;
				rows.push({
					id: account.id,
					left: box.left,
					right: edge,
					top: box.top,
					bottom: box.bottom,
				});
				places.set(account.id, {
					right: edge - origin.left,
					mid: box.top + box.height / 2 - origin.top,
				});
			}
			const ends = shareEnds(edges, places);
			for (const [owner, row] of places)
				if (!ends.sockets.has(owner))
					ends.sockets.set(owner, {
						at: { x: row.right, y: row.mid },
						from: { x: row.right + SOCKET, y: row.mid },
					});
			const next: Layout = {
				origin: { x: origin.left, y: origin.top },
				rows,
				sockets: [...ends.sockets].map(([owner, point]) => ({
					owner,
					...point,
				})),
				plugs: edges.flatMap((edge) => {
					const at = ends.plugs.get(edge.key)?.end;
					const from = ends.sockets.get(edge.owner)?.from;
					return at && from ? [{ edge, at, from }] : [];
				}),
			};
			setLayout((before) =>
				JSON.stringify(before) === JSON.stringify(next) ? before : next,
			);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const resize = new ResizeObserver(schedule);
		resize.observe(root);
		const mutations = new MutationObserver(schedule);
		mutations.observe(root, { childList: true, subtree: true });
		root.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule, true);
		measure();
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			mutations.disconnect();
			root.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
			window.removeEventListener("scroll", schedule, true);
		};
	}, [area, accounts, edges]);
	useEffect(() => {
		if (!drag || !layout) return;
		let frame = 0;
		const update = (event: PointerEvent) => {
			const active = currentDrag.current;
			if (!active || active.pointer !== event.pointerId) return;
			const at = {
				x: event.clientX - layout.origin.x,
				y: event.clientY - layout.origin.y,
			};
			if (Math.hypot(at.x - active.origin.x, at.y - active.origin.y) > 4)
				moved.current = true;
			currentDrag.current = { ...active, at };
			setDrag(currentDrag.current);
		};
		const finish = (event?: PointerEvent) => {
			if (event) update(event);
			const active = currentDrag.current;
			currentDrag.current = undefined;
			setDrag(undefined);
			onDragging(undefined);
			if (!event || !active || !moved.current) return;
			const target = layout.rows.find(
				(row) =>
					row.id !== active.owner &&
					event.clientY >= row.top &&
					event.clientY <= row.bottom &&
					event.clientX >= row.left &&
					event.clientX <= row.right + 90,
			);
			onReview(
				target
					? { ownerId: active.owner, recipientId: target.id }
					: active.shareId
						? { shareId: active.shareId }
						: { ownerId: active.owner },
			);
		};
		const move = (event: PointerEvent) => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => update(event));
		};
		const up = (event: PointerEvent) => {
			if (currentDrag.current?.pointer === event.pointerId) finish(event);
		};
		const cancel = () => finish();
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				finish();
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
	}, [drag, layout, onReview, onDragging]);
	const start = (
		event: React.PointerEvent,
		owner: string,
		from: Point,
		at: Point,
		shareId?: string,
		access: "read" | "write" = "read",
	) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		moved.current = false;
		const active = {
			owner,
			from,
			at,
			origin: at,
			shareId,
			pointer: event.pointerId,
			access,
		};
		currentDrag.current = active;
		setDrag(active);
		onDragging(shareId);
	};
	const keyboard = (event: React.KeyboardEvent, review: AccountShareReview) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.stopPropagation();
			onReview(review);
		}
	};
	return (
		<svg
			className="cd-ropes cd-account-drag-layer"
			aria-label="Cloud Drive connection controls"
		>
			{layout?.sockets.map(({ owner, at, from }) => (
				<g key={owner} transform={`translate(${at.x} ${at.y})`}>
					<rect
						className="cd-socket"
						x={-1}
						y={-5}
						width={SOCKET + 1}
						height={10}
						rx={2}
					/>
					<rect
						x={-6}
						y={-14}
						width={22}
						height={28}
						fill="transparent"
						role="button"
						tabIndex={0}
						aria-label={`Review Cloud Drive connections for ${names.get(owner) ?? owner}`}
						className="cd-account-drag-target"
						onPointerDown={(event) => start(event, owner, from, from)}
						onClick={() => {
							if (!moved.current) onReview({ ownerId: owner });
						}}
						onKeyDown={(event) => keyboard(event, { ownerId: owner })}
					/>
				</g>
			))}
			{layout?.plugs.map(({ edge, at, from }) => (
				<rect
					key={edge.key}
					x={at.x - PLUG - GAP - 5}
					y={at.y - 10}
					width={PLUG + GAP + 10}
					height={20}
					fill="transparent"
					role="button"
					tabIndex={0}
					aria-label={`Drag ${edge.label}`}
					className="cd-account-drag-target"
					onPointerDown={(event) =>
						start(event, edge.owner, from, at, edge.key, edge.access)
					}
					onClick={() => {
						if (!moved.current) onReview({ shareId: edge.key });
					}}
					onKeyDown={(event) => keyboard(event, { shareId: edge.key })}
				/>
			))}
			{drag && (
				<DriveDragPreview
					from={drag.from}
					to={drag.at}
					access={drag.access}
					rightLimit={
						document.documentElement.clientWidth - (layout?.origin.x ?? 0) - 8
					}
				/>
			)}
		</svg>
	);
};

const DriveDragPreview: React.FC<{
	from: Point;
	to: Point;
	access: "read" | "write";
	rightLimit: number;
}> = ({ from, to, access, rightLimit }) => {
	const cable = useRef(makeCable(from, to));
	const line = useRef<SVGPathElement>(null);
	const shine = useRef<SVGPathElement>(null);
	const animations = useAnimationsEnabled();
	const rest = restHandles(
		from,
		to,
		Math.max(
			0,
			Math.min(
				cableReach(to.y - from.y, 0),
				rightLimit - Math.max(from.x, to.x),
			),
		),
	);
	const d = cablePath(from, restingCable(rest), to);
	useEffect(() => {
		if (!animations || motionless()) return;
		let frame = 0;
		let last = performance.now();
		const draw = (now: number) => {
			const moving = stepCable(
				cable.current,
				rest,
				Math.min(1 / 30, (now - last) / 1000),
			);
			last = now;
			for (const handle of cable.current.handles)
				handle.x = Math.min(handle.x, rightLimit);
			const next = cablePath(from, cable.current, to);
			line.current?.setAttribute("d", next);
			shine.current?.setAttribute("d", next);
			if (moving) frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	}, [animations, from, to, rest, rightLimit]);
	return (
		<g className="cd-share" data-access={access}>
			<path ref={line} className="cd-cable" d={d} />
			<path ref={shine} className="cd-cable-shine" d={d} />
			<g transform={`translate(${to.x} ${to.y}) rotate(180)`}>
				<CloudDriveMalePlug />
			</g>
		</g>
	);
};
