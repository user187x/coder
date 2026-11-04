import { cn } from "cn";
import { useEffect, useRef } from "react";
import { Breadcrumb } from "#/components/Breadcrumb/Breadcrumb";

/** Keeps admin navigation below the navbar and the category rail below the breadcrumb. */
export const AdminBreadcrumb: React.FC<
	React.ComponentProps<typeof Breadcrumb>
> = ({ className, ...props }) => {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const nav = ref.current;
		const parent = nav?.parentElement;
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
			parent.style.setProperty(
				"--admin-breadcrumb-height",
				`${nav.getBoundingClientRect().height}px`,
			);
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
		return () => observer.disconnect();
	}, []);
	return (
		<Breadcrumb
			{...props}
			ref={ref}
			className={cn(
				"sticky top-[calc(var(--dashboard-navigation-height,72px)+var(--coder-classification-h,0px)*max(1,var(--breadcrumb-scale,1)))] z-30 flow-root pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
				props.variant === "connected" && "w-fit max-w-full",
				className,
			)}
		/>
	);
};
