import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

/** Labels icon-only strip controls while allowing open menus to hide their hints. */
export function SettingsStripTooltip({
	children,
	label,
	enabled = true,
}: {
	children: React.ReactElement;
	label: string;
	enabled?: boolean;
}) {
	if (!enabled) return children;
	return (
		<Tooltip disableHoverableContent>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent data-settings-strip-tooltip>{label}</TooltipContent>
		</Tooltip>
	);
}
