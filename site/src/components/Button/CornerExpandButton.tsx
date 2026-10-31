import { cn } from "cn";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "./Button";
import "./cornerExpandButton.css";

/** A folded corner control for expanding and restoring a panel. */
export const CornerExpandButton = ({
	expanded,
	onToggle,
	label,
	bottom = false,
}: {
	expanded: boolean;
	onToggle: () => void;
	label: string;
	bottom?: boolean;
}) => (
	<Button
		size="icon"
		variant="subtle"
		className={cn("corner-expand-tab", bottom && "corner-expand-bottom")}
		aria-label={`${expanded ? "Restore" : "Expand"} ${label}`}
		title={`${expanded ? "Restore" : "Expand"} ${label}`}
		aria-pressed={expanded}
		onClick={onToggle}
		onKeyDown={(event) => event.stopPropagation()}
	>
		{expanded ? (
			<ChevronDownIcon className="size-3 rotate-45" />
		) : (
			<ChevronUpIcon className="size-3 rotate-45" />
		)}
	</Button>
);
