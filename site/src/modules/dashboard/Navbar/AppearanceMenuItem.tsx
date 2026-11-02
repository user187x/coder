import { PaletteIcon } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { AnimationsToggleItem } from "./UserDropdown/AnimationsToggleItem";
import { ThemeToggleItem } from "./UserDropdown/ThemeToggleItem";

export const AppearanceMenuItem = ({ className }: { className?: string }) => {
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	const navigate = useNavigate();
	return (
		<>
			<DropdownMenuItem
				className={className}
				aria-expanded={expanded}
				aria-controls={expanded ? id : undefined}
				onSelect={(event) => {
					event.preventDefault();
					setExpanded((open) => !open);
				}}
				title="Click for appearance controls; right-click for deployment appearance"
				onContextMenu={(event) => {
					event.preventDefault();
					event.stopPropagation();
					navigate("/deployment/customize");
				}}
				onKeyDown={(event) => {
					if (
						event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10")
					) {
						event.preventDefault();
						event.stopPropagation();
						navigate("/deployment/customize");
					}
				}}
			>
				<PaletteIcon aria-hidden />
				Appearance
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
