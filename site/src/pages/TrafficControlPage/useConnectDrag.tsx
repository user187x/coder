import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toCssPx } from "#/utils/appZoom";

type Point = { x: number; y: number };

/** The workspace orb (any diagram's) under a screen point, other than the one dragged from. */
const workspaceAt = (x: number, y: number, from: string) => {
	const id = document
		.elementFromPoint(x, y)
		?.closest("[data-workspace]")
		?.getAttribute("data-workspace");
	return id && id !== from ? id : null;
};

/**
 * Pulling a connector out of a workspace's orb: after a short move a cable follows the pointer (drawn over the
 * page, so it reaches the orbs of every diagram), and released on another workspace's orb it asks for a tunnel
 * from the first to the second. A press that does not move stays a click.
 */
export const useConnectDrag = (
	onConnect?: (sourceId: string, targetId: string) => void,
) => {
	const [drag, setDrag] = useState<{
		from: Point;
		to: Point;
		over: string | null;
	} | null>(null);
	const dragged = useRef(false);

	const start =
		(sourceId: string) => (event: React.PointerEvent<SVGGElement>) => {
			if (!onConnect || event.button !== 0) return;
			const box = event.currentTarget.getBoundingClientRect();
			const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			const pressed = { x: event.clientX, y: event.clientY };
			dragged.current = false;
			const onMove = (move: PointerEvent) => {
				if (
					!dragged.current &&
					Math.hypot(move.clientX - pressed.x, move.clientY - pressed.y) < 6
				)
					return;
				dragged.current = true;
				setDrag({
					from,
					to: { x: move.clientX, y: move.clientY },
					over: workspaceAt(move.clientX, move.clientY, sourceId),
				});
			};
			const end = (up: PointerEvent, connect: boolean) => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				window.removeEventListener("pointercancel", onCancel);
				setDrag(null);
				const target =
					connect && dragged.current
						? workspaceAt(up.clientX, up.clientY, sourceId)
						: null;
				if (target) onConnect(sourceId, target);
			};
			const onUp = (up: PointerEvent) => end(up, true);
			const onCancel = (cancel: PointerEvent) => end(cancel, false);
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onCancel);
		};

	/** True once for the click that ends a drag, which is not a click on the orb. */
	const consumeDrag = () => {
		const was = dragged.current;
		dragged.current = false;
		return was;
	};

	const cable =
		drag &&
		createPortal(
			<svg
				aria-hidden
				data-testid="connect-cable"
				className="pointer-events-none fixed inset-0 z-50 h-full w-full overflow-visible"
			>
				<line
					x1={toCssPx(drag.from.x)}
					y1={toCssPx(drag.from.y)}
					x2={toCssPx(drag.to.x)}
					y2={toCssPx(drag.to.y)}
					stroke={drag.over ? "#22c55e" : "hsl(var(--content-link))"}
					strokeWidth={3}
					strokeDasharray={drag.over ? undefined : "8 6"}
					strokeLinecap="round"
				/>
				<circle
					cx={toCssPx(drag.to.x)}
					cy={toCssPx(drag.to.y)}
					r={6}
					fill={drag.over ? "#22c55e" : "hsl(var(--content-link))"}
				/>
			</svg>,
			document.body,
		);

	return { start, consumeDrag, cable, over: drag?.over ?? null };
};
