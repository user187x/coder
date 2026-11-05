import { useEffect, useRef } from "react";
import { SettingsTrayHandle } from "./SettingsTrayHandle";

type DrawerPosition = { x: number; y: number };

/** Bounds left-button dragging without changing panel visibility or its lock. */
export const SettingsDrawerHandle = ({
	position,
	limits,
	onChange,
	onCommit,
	...handle
}: React.ComponentProps<typeof SettingsTrayHandle> & {
	position: DrawerPosition;
	limits: { minY: number; maxY: number };
	onChange: (position: DrawerPosition) => void;
	onCommit: (position: DrawerPosition) => void;
}) => {
	const drag = useRef<{
		y: number;
		position: DrawerPosition;
		moved: boolean;
		element: HTMLElement;
	} | null>(null);
	const frame = useRef(0);
	const suppressClick = useRef(false);
	useEffect(() => () => cancelAnimationFrame(frame.current), []);
	const clamp = (y: number) => ({
		x: 0,
		y: Math.max(limits.minY, Math.min(limits.maxY, y)),
	});
	const change = (y: number) => {
		onChange({
			x: 0,
			y: Math.max(limits.minY, Math.min(limits.maxY, y)),
		});
	};
	const move = (y: number) => {
		const start = drag.current;
		if (start && (start.moved || Math.abs(y - start.y) >= 6)) {
			start.moved = true;
			change(start.position.y + y - start.y);
		}
	};
	return (
		<div
			className="settings-drawer-handle"
			onClickCapture={(event) => {
				if (suppressClick.current) {
					suppressClick.current = false;
					event.preventDefault();
					event.stopPropagation();
				}
			}}
			onPointerDownCapture={(event) => {
				if (event.button === 1) event.preventDefault();
				if (
					event.button !== 0 ||
					!(event.target instanceof Element) ||
					!event.target.closest("[data-settings-panel-grip]")
				)
					return;
				event.stopPropagation();
				const element = event.target.closest("[data-settings-panel-grip]");
				if (!(element instanceof HTMLElement)) return;
				suppressClick.current = false;
				drag.current = { y: event.clientY, position, moved: false, element };
				element.setPointerCapture(event.pointerId);
			}}
			onPointerMoveCapture={(event) => {
				if (!drag.current) return;
				event.stopPropagation();
				cancelAnimationFrame(frame.current);
				const { clientY } = event;
				frame.current = requestAnimationFrame(() => move(clientY));
			}}
			onPointerUpCapture={(event) => {
				if (!drag.current) return;
				event.stopPropagation();
				cancelAnimationFrame(frame.current);
				move(event.clientY);
				suppressClick.current = drag.current.moved;
				if (drag.current.moved)
					onCommit(
						clamp(drag.current.position.y + event.clientY - drag.current.y),
					);
				const element = drag.current.element;
				drag.current = null;
				element.releasePointerCapture(event.pointerId);
			}}
			onPointerCancelCapture={() => {
				cancelAnimationFrame(frame.current);
				if (drag.current) onChange(drag.current.position);
				drag.current = null;
			}}
			onLostPointerCapture={() => {
				cancelAnimationFrame(frame.current);
				drag.current = null;
			}}
			onAuxClickCapture={(event) => {
				if (event.button === 1) {
					event.preventDefault();
					event.stopPropagation();
				}
			}}
			onKeyDownCapture={(event) => {
				if (event.key === "Escape" && drag.current) {
					event.preventDefault();
					event.stopPropagation();
					cancelAnimationFrame(frame.current);
					onChange(drag.current.position);
					drag.current = null;
					return;
				}
				if (!event.altKey) return;
				if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				const next = clamp(
					event.key === "Home"
						? 0
						: position.y + (event.key === "ArrowUp" ? -20 : 20),
				);
				onChange(next);
				onCommit(next);
			}}
		>
			<SettingsTrayHandle
				{...handle}
				instructions="Left-drag up or down to slide along Settings. Alt+Up/Down moves it; Alt+Home resets it."
			/>
		</div>
	);
};
