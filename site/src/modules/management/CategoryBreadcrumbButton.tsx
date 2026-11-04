import {
	type LucideIcon,
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
} from "lucide-react";

/** The active settings category and its sidebar visibility control. */
export const CategoryBreadcrumbButton = ({
	label,
	icon: CategoryIcon,
	controls,
	sidebarOpen,
	onToggle,
}: {
	label: string;
	icon: LucideIcon;
	controls: string;
	sidebarOpen: boolean;
	onToggle: () => void;
}) => {
	const SidebarIcon = sidebarOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon;
	return (
		<button
			type="button"
			className="category-breadcrumb-button"
			aria-current="page"
			aria-label={label}
			aria-controls={controls}
			aria-expanded={sidebarOpen}
			title={
				sidebarOpen
					? "Double-click to hide categories"
					: "Double-click to show categories"
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
			<CategoryIcon aria-hidden className="size-4 shrink-0" />
			<span className="truncate">{label}</span>
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
