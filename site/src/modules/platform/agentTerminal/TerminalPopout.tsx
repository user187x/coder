import { PanelBottomCloseIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "#/components/Button/Button";

type TerminalPopoutProps = {
	title: string;
	/** Puts the terminal back into the drop-down, still running. */
	onDock: () => void;
	/** Closes the window; the drop-down is back, collapsed. */
	onClose: () => void;
	/** Controls shown in the title bar (e.g. the text size buttons). */
	toolbar?: React.ReactNode;
	children: React.ReactNode;
};

/**
 * A floating window over the page for the agent terminal, popped out of its
 * drop-down: dragged by the title bar, resized from the corner. The terminal in
 * it is the same session as in the drop-down.
 */
export const TerminalPopout: React.FC<TerminalPopoutProps> = ({
	title,
	onDock,
	onClose,
	toolbar,
	children,
}) => {
	// Where the window was dragged to; centred until then.
	const [position, setPosition] = useState<{ x: number; y: number }>();
	const windowRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ dx: number; dy: number }>(undefined);

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
			return;
		}
		const rect = windowRef.current?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		drag.current = {
			dx: event.clientX - rect.left,
			dy: event.clientY - rect.top,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const offset = drag.current;
		const rect = windowRef.current?.getBoundingClientRect();
		if (!offset || !rect) {
			return;
		}
		// Keep the title bar on screen.
		setPosition({
			x: Math.min(
				Math.max(event.clientX - offset.dx, 0),
				window.innerWidth - Math.min(rect.width, 160),
			),
			y: Math.min(
				Math.max(event.clientY - offset.dy, 0),
				window.innerHeight - 40,
			),
		});
	};
	const onPointerUp = () => {
		drag.current = undefined;
	};

	return createPortal(
		<div
			ref={windowRef}
			role="dialog"
			aria-label={title}
			className="fixed z-50 flex resize flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary shadow-2xl"
			style={{
				width: "min(1100px, 92vw)",
				height: "min(640px, 75vh)",
				minWidth: 420,
				minHeight: 260,
				...(position
					? { left: position.x, top: position.y }
					: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }),
			}}
		>
			<div
				className="flex cursor-move select-none items-center gap-2 border-0 border-b border-solid border-border px-3 py-1.5"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
			>
				{toolbar}
				<span className="min-w-0 flex-1 truncate text-center text-sm text-content-secondary">
					{title}
				</span>
				<Button
					size="icon"
					variant="subtle"
					aria-label="Put the terminal back in the drop-down"
					title="Dock"
					onClick={onDock}
				>
					<PanelBottomCloseIcon />
				</Button>
				<Button
					size="icon"
					variant="subtle"
					aria-label="Close the terminal window"
					title="Close"
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</div>
			<div className="min-h-0 flex-1 p-2">{children}</div>
		</div>,
		document.body,
	);
};
