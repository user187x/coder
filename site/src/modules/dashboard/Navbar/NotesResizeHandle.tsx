import { useRef } from "react";
import "#/modules/platform/buildFooter/buildFooter.css";

/** Resizes notes from a fixed starting height, keeping the grip inside the viewport. */
export const NotesResizeHandle = ({
	panel,
	height,
	onResize,
}: {
	panel: React.RefObject<HTMLDivElement | null>;
	height: number | null;
	onResize: (height: number | null) => void;
}) => {
	const drag = useRef<{
		y: number;
		height: number;
		top: number;
		previous: number | null;
	} | null>(null);
	const resize = (value: number, top: number) => {
		const maximum = Math.max(0, window.innerHeight - top - 12);
		onResize(Math.min(maximum, Math.max(Math.min(280, maximum), value)));
	};
	const cancel = () => {
		if (!drag.current) return;
		onResize(drag.current.previous);
		drag.current = null;
	};
	return (
		<button
			type="button"
			className="settings-notes-resize"
			aria-label="Resize notes panel"
			title="Drag to resize. Up and Down resize; Home resets."
			onPointerDown={(event) => {
				if (event.button !== 0 || !panel.current) return;
				event.preventDefault();
				event.stopPropagation();
				const rect = panel.current.getBoundingClientRect();
				drag.current = {
					y: event.clientY,
					height: rect.height,
					top: rect.top,
					previous: height,
				};
				event.currentTarget.focus();
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				const start = drag.current;
				if (start) resize(start.height + event.clientY - start.y, start.top);
			}}
			onPointerUp={(event) => {
				const start = drag.current;
				if (!start) return;
				resize(start.height + event.clientY - start.y, start.top);
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={cancel}
			onLostPointerCapture={cancel}
			onDoubleClick={() => onResize(null)}
			onKeyDown={(event) => {
				if (event.key === "Escape" && drag.current) {
					event.preventDefault();
					event.stopPropagation();
					cancel();
					return;
				}
				if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.key === "Home") {
					onResize(null);
					return;
				}
				const rect = panel.current?.getBoundingClientRect();
				if (rect)
					resize(rect.height + (event.key === "ArrowUp" ? -20 : 20), rect.top);
			}}
		>
			<span className="build-footer-grip" aria-hidden />
		</button>
	);
};
