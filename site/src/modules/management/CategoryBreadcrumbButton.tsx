import {
	type LucideIcon,
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

/** The active settings category, shown by its icon, and its sidebar visibility control. */
export const CategoryBreadcrumbButton = ({
	label,
	icon: CategoryIcon,
	controls,
	sidebarOpen,
	onToggle,
	focusOnMount = false,
}: {
	label: string;
	icon: LucideIcon;
	controls: string;
	sidebarOpen: boolean;
	onToggle: () => void;
	/** Take the focus when it appears: the breadcrumb moves between the list's header and a row of its own as the
	 * categories show and hide, and the keyboard stays on the toggle. */
	focusOnMount?: boolean;
}) => {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (focusOnMount) ref.current?.focus();
	}, [focusOnMount]);
	const SidebarIcon = sidebarOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon;
	return (
		<button
			ref={ref}
			type="button"
			className="category-breadcrumb-button"
			aria-current="page"
			aria-label={label}
			aria-controls={controls}
			aria-expanded={sidebarOpen}
			title={
				sidebarOpen
					? `${label}: double-click to hide categories`
					: `${label}: double-click to show categories`
			}
			onDoubleClick={(event) => {
				if (
					!(
						event.target instanceof Element &&
						event.target.closest("[data-category-toggle]")
					)
				)
					onToggle();
			}}
			onClick={(event) => {
				if (
					event.detail === 0 ||
					(event.detail === 1 &&
						event.target instanceof Element &&
						event.target.closest("[data-category-toggle]"))
				)
					onToggle();
			}}
		>
			{/* The category by its icon alone; its name is the button's label and tooltip */}
			<CategoryIcon aria-hidden className="size-4 shrink-0" />
			<span
				data-category-toggle=""
				aria-hidden="true"
				title={sidebarOpen ? "Hide categories" : "Show categories"}
				className="absolute inset-y-0 right-0 inline-flex items-center justify-center rounded-r-[6px] bg-surface-tertiary text-content-primary hover:bg-surface-quaternary"
			>
				<SidebarIcon className="size-3.5" />
			</span>
		</button>
	);
};
