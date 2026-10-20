import { cn } from "cn";
import { ChevronDownIcon as LucideChevronDown } from "lucide-react";
import "./dropdownChevron.css";

type ChevronDownIconProps = React.ComponentProps<typeof LucideChevronDown> & {
	/**
	 * Explicitly control rotation state. When omitted, rotation is
	 * driven by Radix's data-state attribute on a parent element
	 * with className="group".
	 */
	open?: boolean;
};

export const ChevronDownIcon: React.FC<ChevronDownIconProps> = ({
	open,
	className,
	...props
}) => (
	<LucideChevronDown
		className={cn(
			// Platform: played down - smaller and fainter than the trigger's text (dropdownChevron.css)
			"dropdown-chevron transition-transform",
			open !== undefined
				? open && "rotate-180"
				: "group-data-[state=open]:rotate-180",
			className,
		)}
		{...props}
	/>
);
