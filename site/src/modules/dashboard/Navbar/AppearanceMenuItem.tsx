import { ChevronDownIcon, PaletteIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { AnimationsToggleItem } from "./UserDropdown/AnimationsToggleItem";
import { ThemeToggleItem } from "./UserDropdown/ThemeToggleItem";

export const AppearanceMenuItem = ({ className }: { className?: string }) => {
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	return (
		<>
			<DropdownMenuItem
				asChild
				className={className}
				aria-expanded={expanded}
				aria-controls={expanded ? id : undefined}
				onContextMenu={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setExpanded((open) => !open);
				}}
				onKeyDown={(event) => {
					if (
						event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10")
					) {
						event.preventDefault();
						event.stopPropagation();
						setExpanded((open) => !open);
					}
				}}
			>
				<Link
					to="/deployment/customize"
					title="Right-click for your dashboard appearance controls"
				>
					<PaletteIcon aria-hidden />
					Appearance
					<ChevronDownIcon
						aria-hidden
						className={`ml-auto size-3.5 ${expanded ? "rotate-180" : ""}`}
					/>
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
				</div>
			)}
		</>
	);
};
