import { cn } from "cn";
import { useCallback, useRef, useState } from "react";
import "./tableCard.css";

/** What a table's element says on hover, read from it: its hint, title, or (a control's) label. */
const HINTED =
	"[data-hint], [title], button[aria-label], a[aria-label], [role=button][aria-label], [role=checkbox][aria-label]";

const hintOf = (
	target: EventTarget | null,
	card: HTMLElement,
): string | null => {
	let el = target instanceof Element ? target.closest(HINTED) : null;
	while (el && card.contains(el)) {
		// A title moves to data-hint the first time: the footer says it, not a browser tooltip as well.
		const title = el.getAttribute("title");
		if (title) {
			el.setAttribute("data-hint", title);
			el.removeAttribute("title");
		}
		const text =
			el.getAttribute("data-hint") ||
			(el.matches("button, a, [role=button], [role=checkbox]")
				? el.getAttribute("aria-label")
				: null);
		if (text?.trim()) {
			return text.trim();
		}
		el = el.parentElement?.closest(HINTED) ?? null;
	}
	return null;
};

/**
 * Platform: a table in a rounded card (the Workspaces, Templates and Images lists): its header inside the card, a
 * footer under the rows - what the list holds on the left ("Showing 3 of 3 workspaces"), and on the right one place
 * for what any element of the table says on hover or focus (its hint, title or label), instead of a tooltip by
 * each. Nothing hovered: `hint`, the table's own advice.
 */
export const TableCard: React.FC<{
	children: React.ReactNode;
	/** The footer's left side; none: no footer. */
	summary?: React.ReactNode;
	/** The footer's right side while nothing in the table is hovered. */
	hint?: React.ReactNode;
	/** Persistent footer status, taking precedence over hover hints. */
	footerRight?: React.ReactNode;
	className?: string;
	"data-testid"?: string;
}> = ({ children, summary, hint, footerRight, className, ...props }) => {
	const card = useRef<HTMLDivElement>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const follow = useCallback((e: React.SyntheticEvent) => {
		if (card.current) {
			setHovered(hintOf(e.target, card.current));
		}
	}, []);
	return (
		<div
			ref={card}
			className={cn("table-card", className)}
			data-testid={props["data-testid"]}
			onPointerOver={follow}
			onFocus={follow}
			onPointerLeave={() => setHovered(null)}
			onBlur={(e) => {
				if (!card.current?.contains(e.relatedTarget as Node | null)) {
					setHovered(null);
				}
			}}
		>
			{children}
			{summary !== undefined && (
				<div className="table-card-footer" data-testid="table-card-footer">
					<span className="table-card-summary">{summary}</span>
					<span
						className={cn("table-card-hint", hovered && "table-card-hint-on")}
						data-testid="table-card-hint"
					>
						{footerRight ?? hovered ?? hint}
					</span>
				</div>
			)}
		</div>
	);
};
