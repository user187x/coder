import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Children, type ReactNode, useState } from "react";
import "./appsCarousel.css";

/**
 * A workspace row's app buttons (the Workspaces table) when there are more than fit: `visible` of them at a time in a
 * window that slides an app at a time - its arrows either side (one gone dim at either end), the arrow keys and a
 * sideways swipe or scroll - with a thin bar under it telling where in the list it is. The buttons out of the window
 * are inert (no tabbing to an app that cannot be seen). What follows it in the row (the update and restart buttons)
 * stays outside: never in it. As many as fit, or fewer: just the buttons.
 */
export const AppsCarousel: React.FC<{
	children: ReactNode;
	/** The apps shown at once. */
	visible?: number;
}> = ({ children, visible = 4 }) => {
	const items = Children.toArray(children);
	const [start, setStart] = useState(0);
	if (items.length <= visible) {
		return <>{items}</>;
	}
	const last = items.length - visible;
	const at = Math.min(start, last);
	const go = (to: number) => setStart(Math.max(0, Math.min(last, to)));

	return (
		<div
			role="group"
			aria-roledescription="carousel"
			aria-label={`Apps ${at + 1} to ${at + visible} of ${items.length}`}
			data-testid="workspace-apps-carousel"
			className="apps-carousel"
			style={{ "--apps-visible": visible } as React.CSSProperties}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
					e.preventDefault();
					go(at + (e.key === "ArrowLeft" ? -1 : 1));
				}
			}}
			onWheel={(e) => {
				// a sideways swipe or scroll (a trackpad, shift and the wheel): the page's own scrolling is left alone
				if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 4) {
					go(at + (e.deltaX < 0 ? -1 : 1));
				}
			}}
		>
			<CarouselArrow
				side="previous"
				disabled={at === 0}
				onClick={() => go(at - 1)}
			/>
			<div className="apps-carousel-window">
				<div
					className="apps-carousel-track"
					style={{ "--apps-at": at } as React.CSSProperties}
				>
					{items.map((item, i) => {
						const out = i < at || i >= at + visible;
						return (
							<div
								key={(item as { key?: string }).key ?? i}
								className={cn("apps-carousel-item", out && "apps-carousel-out")}
								data-testid="workspace-apps-carousel-item"
								aria-hidden={out || undefined}
								inert={out}
							>
								{item}
							</div>
						);
					})}
				</div>
				<span aria-hidden className="apps-carousel-bar">
					<span
						className="apps-carousel-thumb"
						style={{
							width: `${(visible / items.length) * 100}%`,
							left: `${(at / items.length) * 100}%`,
						}}
					/>
				</span>
			</div>
			<CarouselArrow
				side="next"
				disabled={at === last}
				onClick={() => go(at + 1)}
			/>
		</div>
	);
};

const CarouselArrow: React.FC<{
	side: "previous" | "next";
	disabled: boolean;
	onClick: () => void;
}> = ({ side, disabled, onClick }) => {
	const Icon = side === "previous" ? ChevronLeftIcon : ChevronRightIcon;
	return (
		<button
			type="button"
			className="apps-carousel-arrow"
			data-testid={`workspace-apps-${side}`}
			aria-label={side === "previous" ? "Previous app" : "Next app"}
			disabled={disabled}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		>
			<Icon aria-hidden className="size-4" />
		</button>
	);
};
