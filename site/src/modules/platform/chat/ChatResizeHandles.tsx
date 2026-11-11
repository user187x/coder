import { useEffect, useRef } from "react";
import type { UserUIPreferences } from "#/api/platform";
import { toCssPx } from "#/utils/appZoom";
import { bottomBarsHeight } from "#/utils/bottomBars";
import { dockTop, moveDock } from "./dockPosition";

type Edge =
	| "left"
	| "right"
	| "top"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";
type ResizeStart = {
	x: number;
	y: number;
	rect: DOMRect;
	edge: Edge;
	width: string;
	height: string;
	left: string;
	top: string;
	right: string;
	bottom: string;
};

/** Resize the floating dock from a fixed starting rectangle, without feeding measurements back into the drag. */
export const ChatResizeHandles = ({
	dock,
	panel,
	onResize,
}: {
	dock: React.RefObject<HTMLElement | null>;
	panel: React.RefObject<HTMLElement | null>;
	onResize: (size: UserUIPreferences["chat_size"]) => void;
}) => {
	const drag = useRef<ResizeStart | null>(null);
	useEffect(() => {
		const element = dock.current;
		return () => {
			if (element) delete element.dataset.resizing;
		};
	}, [dock]);
	const start = (edge: Edge, x: number, y: number) => {
		const element = dock.current;
		const body = panel.current;
		if (!element || !body || element.dataset.resizing) return false;
		drag.current = {
			x,
			y,
			edge,
			rect: body.getBoundingClientRect(),
			width: body.style.width,
			height: body.style.height,
			left: element.style.left,
			top: element.style.top,
			right: element.style.right,
			bottom: element.style.bottom,
		};
		element.dataset.resizing = "true";
		return true;
	};
	const move = (x: number, y: number) => {
		const initial = drag.current;
		const element = dock.current;
		const body = panel.current;
		if (!initial || !element || !body) return;
		const { rect, edge } = initial;
		const dx = x - initial.x;
		const dy = y - initial.y;
		const top = dockTop(element) + 8;
		const bottom = window.innerHeight - bottomBarsHeight(element) - 10;
		const right = document.documentElement.clientWidth - 16;
		const minWidth = Math.min(320, right - 16);
		const minHeight = Math.min(240, bottom - top);
		const clamp = (value: number, min: number, max: number) =>
			Math.max(min, Math.min(max, value));
		const leftEdge = edge.includes("left")
			? clamp(rect.left + dx, 16, rect.right - minWidth)
			: rect.left;
		const rightEdge = edge.includes("right")
			? clamp(rect.right + dx, rect.left + minWidth, right)
			: rect.right;
		const topEdge = edge.startsWith("top")
			? clamp(rect.top + dy, top, rect.bottom - minHeight)
			: rect.top;
		const bottomEdge = edge.startsWith("bottom")
			? clamp(rect.bottom + dy, rect.top + minHeight, bottom)
			: rect.bottom;
		// Measured on the screen, set as CSS lengths under the app's scale.
		body.style.width = `${toCssPx(rightEdge - leftEdge)}px`;
		body.style.height = `${toCssPx(bottomEdge - topEdge)}px`;
		element.style.right = "auto";
		element.style.bottom = "auto";
		moveDock(element, leftEdge, topEdge);
	};
	const finish = () => {
		if (!drag.current || !panel.current) return;
		drag.current = null;
		onResize({
			// Saved as CSS lengths, as the panel's size is set.
			width: Math.max(
				320,
				Math.round(toCssPx(panel.current.getBoundingClientRect().width)),
			),
			height: Math.max(
				240,
				Math.round(toCssPx(panel.current.getBoundingClientRect().height)),
			),
		});
	};
	const cancel = () => {
		const initial = drag.current;
		const element = dock.current;
		const body = panel.current;
		if (!initial || !element || !body) return;
		body.style.width = initial.width;
		body.style.height = initial.height;
		Object.assign(element.style, {
			left: initial.left,
			top: initial.top,
			right: initial.right,
			bottom: initial.bottom,
		});
		delete element.dataset.resizing;
		drag.current = null;
	};
	return (
		<>
			{(
				[
					"left",
					"right",
					"top",
					"top-left",
					"top-right",
					"bottom-left",
					"bottom-right",
				] as const
			).map((edge) => (
				<button
					key={edge}
					type="button"
					aria-label={`Resize chat from ${edge.replace("-", " ")}`}
					title="Drag to resize, or use arrow keys. Home resets the size."
					className="chat-resize-handle"
					data-edge={edge}
					onPointerDown={(event) => {
						if (
							event.button !== 0 ||
							!start(edge, event.clientX, event.clientY)
						)
							return;
						event.preventDefault();
						event.stopPropagation();
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => move(event.clientX, event.clientY)}
					onPointerUp={(event) => {
						if (!drag.current) return;
						move(event.clientX, event.clientY);
						finish();
						event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={cancel}
					onLostPointerCapture={cancel}
					onKeyDown={(event) => {
						if (event.key === "Home") {
							event.preventDefault();
							onResize(null);
							return;
						}
						if (event.key === "Escape" && drag.current) {
							event.preventDefault();
							event.stopPropagation();
							cancel();
							return;
						}
						if (!event.key.startsWith("Arrow")) return;
						event.preventDefault();
						event.stopPropagation();
						if (!start(edge, 0, 0)) return;
						move(
							event.key === "ArrowLeft"
								? -20
								: event.key === "ArrowRight"
									? 20
									: 0,
							event.key === "ArrowUp"
								? -20
								: event.key === "ArrowDown"
									? 20
									: 0,
						);
						finish();
					}}
				/>
			))}
		</>
	);
};
