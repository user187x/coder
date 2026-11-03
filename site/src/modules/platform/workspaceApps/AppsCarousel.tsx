import { cn } from "cn";
import {
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
} from "lucide-react";
import { Children, useState } from "react";
import "./appsCarousel.css";

/**
 * A workspace row's app buttons (the Workspaces table) when there are more than fit: `visible` of them at a time in a
 * window that slides an app at a time - its arrows either side (one gone dim at either end), the arrow keys and a
 * sideways swipe or scroll - with a thin bar under it telling where in the list it is. The buttons out of the window
 * are inert (no tabbing to an app that cannot be seen). What follows it in the row (the update and restart buttons)
 * stays outside: never in it. As many as fit, or fewer: just the buttons - unless `framed`: then always in a frame of
 * the same width (each row's apps line up), its arrows in it, the side with more apps to see lit faintly.
 */
export const AppsCarousel: React.FC<{
	children: React.ReactNode;
	/** The apps shown at once. */
	visible?: number;
	/** In a frame of its own, as wide as `visible` apps, whatever their number. */
	framed?: boolean;
	orientation?: "horizontal" | "vertical";
	label?: string;
	className?: string;
}> = ({
	children,
	visible = 4,
	framed = false,
	orientation = "horizontal",
	label = "Apps",
	className,
}) => {
	const items = Children.toArray(children);
	const [start, setStart] = useState(0);
	if (items.length <= visible && !framed) {
		return items;
	}
	const last = Math.max(0, items.length - visible);
	const at = Math.min(start, last);
	const go = (to: number) => setStart(Math.max(0, Math.min(last, to)));
	const fits = items.length <= visible;

	return (
		<div
			role="group"
			aria-roledescription="carousel"
			aria-label={
				fits
					? `${label} (${items.length})`
					: `${label} ${at + 1} to ${at + visible} of ${items.length}`
			}
			data-testid="workspace-apps-carousel"
			data-framed={framed || undefined}
			data-fits={fits || undefined}
			data-more-before={at > 0 || undefined}
			data-more-after={at < last || undefined}
			className={cn("apps-carousel", className)}
			data-orientation={orientation}
			style={{ "--apps-visible": visible } as React.CSSProperties}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				const previous = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
				const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
				if (e.key === previous || e.key === next) {
					e.preventDefault();
					e.stopPropagation();
					go(at + (e.key === previous ? -1 : 1));
				}
			}}
			onWheel={(e) => {
				// a sideways swipe or scroll (a trackpad, shift and the wheel): the page's own scrolling is left alone
				if (orientation === "vertical" && Math.abs(e.deltaY) > 4) {
					e.stopPropagation();
					go(at + (e.deltaY < 0 ? -1 : 1));
				} else if (
					Math.abs(e.deltaX) > Math.abs(e.deltaY) &&
					Math.abs(e.deltaX) > 4
				) {
					go(at + (e.deltaX < 0 ? -1 : 1));
				}
			}}
		>
			<CarouselArrow
				orientation={orientation}
				itemLabel={label === "Apps" ? "app" : "shortcut"}
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
				{!fits && (
					<span aria-hidden className="apps-carousel-bar">
						<span
							className="apps-carousel-thumb"
							style={{
								[orientation === "vertical" ? "height" : "width"]:
									`${(visible / items.length) * 100}%`,
								[orientation === "vertical" ? "top" : "left"]:
									`${(at / items.length) * 100}%`,
							}}
						/>
					</span>
				)}
			</div>
			<CarouselArrow
				orientation={orientation}
				itemLabel={label === "Apps" ? "app" : "shortcut"}
				side="next"
				disabled={at === last}
				onClick={() => go(at + 1)}
			/>
		</div>
	);
};

export const CarouselArrow: React.FC<{
	side: "previous" | "next";
	orientation: "horizontal" | "vertical";
	itemLabel: string;
	disabled: boolean;
	onClick: () => void;
}> = ({ side, disabled, onClick, orientation, itemLabel }) => {
	const Icon =
		orientation === "vertical"
			? side === "previous"
				? ChevronUpIcon
				: ChevronDownIcon
			: side === "previous"
				? ChevronLeftIcon
				: ChevronRightIcon;
	return (
		<button
			type="button"
			className="apps-carousel-arrow"
			data-testid={`workspace-apps-${side}`}
			aria-label={`${side === "previous" ? "Previous" : "Next"} ${itemLabel}`}
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
