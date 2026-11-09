import { cn } from "cn";
import { useEffect, useRef } from "react";
import { Breadcrumb } from "#/components/Breadcrumb/Breadcrumb";

/**
 * Keeps admin navigation below the navbar and the category rail below the breadcrumb. The connected
 * variant takes the settings page's container (its width and gutters), so the trail starts where the
 * category list does.
 */
export const AdminBreadcrumb: React.FC<
	React.ComponentProps<typeof Breadcrumb> & {
		/** In the category list's header (it stands in for the list's "Settings" label), not a row of its own. */
		inline?: boolean;
	}
> = ({ className, inline = false, ...props }) => {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const nav = ref.current;
		// The layout's metrics go on its outermost element: inline, the breadcrumb sits deep in the category list.
		const parent = inline
			? nav?.closest<HTMLElement>("[data-admin-layout]")
			: nav?.parentElement;
		if (!nav || !parent) return;
		const mobileBanner = document.querySelector<HTMLElement>(
			"[data-dashboard-mobile-announcement]",
		);
		const navbar = document.querySelector(".navbar-soft");
		const update = () => {
			if (navbar) {
				parent.style.setProperty(
					"--breadcrumb-scale",
					getComputedStyle(navbar).zoom,
				);
			}
			// Inline, it takes no row of its own above the page.
			if (!inline) {
				parent.style.setProperty(
					"--admin-breadcrumb-height",
					`${nav.getBoundingClientRect().height}px`,
				);
			}
			parent.style.setProperty(
				"--dashboard-navigation-height",
				`${(navbar?.getBoundingClientRect().height ?? 72) + (mobileBanner?.getBoundingClientRect().height ?? 0)}px`,
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(nav);
		if (navbar) observer.observe(navbar);
		if (mobileBanner) observer.observe(mobileBanner);
		update();
		return () => {
			observer.disconnect();
			if (!inline) parent.style.removeProperty("--admin-breadcrumb-height");
		};
	}, [inline]);
	return (
		<Breadcrumb
			{...props}
			ref={ref}
			data-inline={inline || undefined}
			className={cn(
				inline
					? "min-w-0 flex-1"
					: "sticky top-[calc(var(--dashboard-navigation-height,72px)+var(--coder-classification-h,0px)*max(1,var(--breadcrumb-scale,1)))] z-30 flow-root pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
				!inline &&
					props.variant === "connected" &&
					"mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-10",
				className,
			)}
		/>
	);
};
