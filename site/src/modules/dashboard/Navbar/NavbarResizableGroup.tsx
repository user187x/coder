import { cn } from "cn";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";

const MIN_WIDTH = 20;
const MAX_WIDTH = 100;
const KEY_STEP = 2;

const clampWidth = (percent: number) =>
	Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(percent)));

/**
 * Appearance > Navigation bar, Resizable: the bar's buttons (the Settings chevron group among them) in one centred
 * pill whose width the user sets by dragging the handles that appear on its ends while it is pointed at (or with the
 * arrow keys on a focused handle; a double click goes back to the pill's natural width). The width is kept in the
 * user's preferences as a percentage of the bar. Off, the children sit in the bar as they are.
 */
export const NavbarResizableGroup: React.FC<{
	resizable: boolean;
	children: React.ReactNode;
}> = ({ resizable, children }) => {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(client));
	const saved = preferences.data?.navbar_resizable_width ?? null;
	// While dragging: the width shown, saved when the drag ends.
	const [dragging, setDragging] = useState<number | null>(null);
	const pill = useRef<HTMLDivElement>(null);
	if (!resizable) {
		return <div className="contents">{children}</div>;
	}
	const width = dragging ?? saved;

	// The pill's width now, as a percentage of the room the bar gives it.
	const measure = () => {
		const element = pill.current;
		const bar = element?.parentElement;
		if (!element || !bar) return null;
		const style = getComputedStyle(bar);
		const room =
			bar.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		if (!Number.isFinite(room) || room <= 0) return null;
		return { element, room, percent: (element.offsetWidth / room) * 100 };
	};

	const onPointerDown =
		(side: -1 | 1) => (event: React.PointerEvent<HTMLDivElement>) => {
			const start = measure();
			if (!start || event.button !== 0) return;
			event.preventDefault();
			const handle = event.currentTarget;
			handle.setPointerCapture(event.pointerId);
			// Pointer moves are in screen pixels; the navbar is drawn zoomed.
			const scale =
				start.element.getBoundingClientRect().width /
					start.element.offsetWidth || 1;
			const startX = event.clientX;
			let latest = clampWidth(start.percent);
			setDragging(latest);
			const onMove = (move: PointerEvent) => {
				// Centred, the pill grows on both ends: twice the handle's move.
				const grown = (2 * side * (move.clientX - startX)) / scale;
				latest = clampWidth(start.percent + (grown / start.room) * 100);
				setDragging(latest);
			};
			const onUp = () => {
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onUp);
				save.mutate(
					{ navbar_resizable_width: latest },
					{ onSettled: () => setDragging(null) },
				);
			};
			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onUp);
		};

	const onKeyDown =
		(side: -1 | 1) => (event: React.KeyboardEvent<HTMLDivElement>) => {
			const grow =
				event.key === "ArrowRight"
					? side
					: event.key === "ArrowLeft"
						? -side
						: 0;
			if (!grow && event.key !== "Home" && event.key !== "End") return;
			event.preventDefault();
			const current = width ?? measure()?.percent;
			if (current === undefined) return;
			const next =
				event.key === "Home"
					? MIN_WIDTH
					: event.key === "End"
						? MAX_WIDTH
						: clampWidth(current + grow * KEY_STEP);
			save.mutate({ navbar_resizable_width: next });
		};

	const handle = (side: -1 | 1) => (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize the navigation bar from its ${side === -1 ? "left" : "right"} end`}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			aria-valuenow={width ?? undefined}
			tabIndex={0}
			title="Drag to resize; double-click for its natural width"
			className={cn(
				"navbar-resize-handle",
				side === -1
					? "navbar-resize-handle-left"
					: "navbar-resize-handle-right",
			)}
			onPointerDown={onPointerDown(side)}
			onKeyDown={onKeyDown(side)}
			onDoubleClick={() => save.mutate({ navbar_resizable_width: null })}
		/>
	);

	return (
		<div
			ref={pill}
			data-testid="navbar-resizable-group"
			data-dragging={dragging !== null || undefined}
			className="navbar-resizable-group"
			style={width === null ? undefined : { width: `${width}%` }}
		>
			{handle(-1)}
			{children}
			{handle(1)}
		</div>
	);
};
