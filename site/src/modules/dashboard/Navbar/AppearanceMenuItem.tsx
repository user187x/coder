import { PaletteIcon, SlidersHorizontalIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { AnimationsToggleItem } from "./UserDropdown/AnimationsToggleItem";
import { ThemeToggleItem } from "./UserDropdown/ThemeToggleItem";

export const AppearanceMenuItem = ({
	to,
	className,
	options,
}: {
	to: string;
	className?: string;
	/** More right-click options, after its own. */
	options?: React.ReactNode;
}) => {
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	const toggle = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setExpanded((open) => !open);
	};
	return (
		<>
			<DropdownMenuItem
				asChild
				className={className}
				aria-expanded={expanded}
				aria-controls={expanded ? id : undefined}
				title="Right-click for appearance controls"
				onContextMenu={toggle}
				onKeyDown={(event) => {
					if (
						event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10") ||
						event.key === "ArrowRight"
					) {
						toggle(event);
					}
				}}
			>
				<Link to={to}>
					<PaletteIcon aria-hidden />
					Appearance
				</Link>
			</DropdownMenuItem>
			{expanded && (
				<div
					id={id}
					role="group"
					aria-label="Personal dashboard appearance"
					className="order-last my-1 w-full rounded-md border border-solid border-border bg-surface-secondary p-1"
				>
					<ThemeToggleItem showDetails={false} />
					<AnimationsToggleItem showDetails={false} />
					<DropdownMenuItem asChild>
						<Link to={to}>
							<SlidersHorizontalIcon aria-hidden />
							Personalize
						</Link>
					</DropdownMenuItem>
					{options}
				</div>
			)}
		</>
	);
};
