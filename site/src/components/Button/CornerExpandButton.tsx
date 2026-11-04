import { cn } from "cn";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "./Button";
import "./cornerExpandButton.css";

/** A folded corner control for expanding and restoring a panel. */
export const CornerExpandButton = ({
	expanded,
	onToggle,
	label,
	bottom = false,
	onResize,
}: {
	expanded: boolean;
	onToggle: () => void;
	label: string;
	bottom?: boolean;
	onResize?: (size: { width: number; height: number }) => void;
}) => {
	const drag = useRef<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
	const labelText = `${expanded ? "Restore" : "Expand"} ${label}`;
	return (
		<Button
			size="icon"
			variant="subtle"
			className={cn(
				"corner-expand-tab",
				bottom && "corner-expand-bottom",
				onResize && "touch-none cursor-nwse-resize",
			)}
			aria-label={labelText}
			title={
				onResize
					? `Drag to resize. Double-click or press Enter to ${labelText.toLowerCase()}.`
					: labelText
			}
			aria-pressed={expanded}
			onClick={(event) => {
				if (!onResize || event.detail === 0) onToggle();
			}}
			onDoubleClick={onResize ? onToggle : undefined}
			onPointerDown={(event) => {
				if (!onResize || expanded || event.button !== 0) return;
				const bounds =
					event.currentTarget.parentElement?.getBoundingClientRect();
				if (!bounds) return;
				drag.current = {
					x: event.clientX,
					y: event.clientY,
					width: bounds.width,
					height: bounds.height,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				const start = drag.current;
				if (
					onResize &&
					start &&
					event.currentTarget.hasPointerCapture(event.pointerId)
				) {
					onResize({
						width: start.width + event.clientX - start.x,
						height: start.height + event.clientY - start.y,
					});
				}
			}}
			onLostPointerCapture={() => {
				drag.current = null;
			}}
			onKeyDown={(event) => event.stopPropagation()}
		>
			{expanded ? (
				<ChevronDownIcon className="size-3 rotate-45" />
			) : (
				<ChevronUpIcon className="size-3 rotate-45" />
			)}
		</Button>
	);
};
