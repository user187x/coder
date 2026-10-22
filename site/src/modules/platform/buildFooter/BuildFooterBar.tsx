import { HistoryIcon } from "lucide-react";
import { useContext, useRef } from "react";
import { BuildFooterEnd } from "./footerEnd";
import "./buildFooter.css";

/** How far (px) the grip is pulled or pushed before the timeline opens or closes. */
const PULL_PX = 12;
/** How far the grip follows the pointer. */
const FOLLOW_PX = 6;

/**
 * Platform: the Build timeline as the workspace card's footer, made like the table cards' footer (TableCard): what it
 * is on the left with the build's time just after it, at the far right what the card puts there (its Uptime pill:
 * BuildFooterEnd), and in the middle a grip - a pill with jimping, the notches of a
 * handle - that pulls the timeline down out of the card's bottom, or pushes it back up. A click (or Enter, Space)
 * anywhere on the bar does the same. Collapsed at first, on every page load.
 */
export const BuildFooterBar: React.FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The timings are still loading: nothing to show yet. */
	disabled?: boolean;
	/** The build's time (or its skeleton). */
	total: React.ReactNode;
	controls?: string;
}> = ({ open, onOpenChange, disabled, total, controls }) => {
	const end = useContext(BuildFooterEnd);
	const drag = useRef<{ y: number; moved: boolean } | null>(null);
	const pulled = useRef(false);
	const grip = useRef<HTMLSpanElement>(null);
	const follow = (dy: number) =>
		grip.current?.style.setProperty(
			"--pull",
			`${Math.max(-FOLLOW_PX, Math.min(FOLLOW_PX, dy / 2))}px`,
		);

	return (
		<div className="build-footer-bar" data-testid="build-timeline-bar">
			<span className="build-footer-label">
				<HistoryIcon aria-hidden className="size-3.5" />
				Build timeline
				<span className="build-footer-total">{total}</span>
			</span>
			<button
				type="button"
				className="build-footer-handle"
				aria-expanded={open}
				aria-controls={controls}
				aria-label={
					open
						? "Push up to hide the build timeline"
						: "Pull down to see the build timeline"
				}
				title={open ? "Push up to hide" : "Pull down to see how the build went"}
				disabled={disabled}
				data-testid="build-timeline-handle"
				onPointerDown={(e) => {
					if (e.button !== 0) {
						return;
					}
					drag.current = { y: e.clientY, moved: false };
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (!d) {
						return;
					}
					const dy = e.clientY - d.y;
					follow(dy);
					if (!d.moved && (open ? dy < -PULL_PX : dy > PULL_PX)) {
						d.moved = true;
						onOpenChange(!open);
					}
				}}
				onPointerUp={() => {
					// a pull already opened or closed it: the click that follows does not undo it
					pulled.current = Boolean(drag.current?.moved);
					drag.current = null;
					follow(0);
				}}
				onPointerCancel={() => {
					drag.current = null;
					follow(0);
				}}
				onClick={() => {
					if (pulled.current) {
						pulled.current = false;
						return;
					}
					onOpenChange(!open);
				}}
			>
				<span ref={grip} className="build-footer-grip" aria-hidden />
			</button>
			<span className="build-footer-end" data-testid="build-timeline-end">
				{end}
			</span>
		</div>
	);
};
