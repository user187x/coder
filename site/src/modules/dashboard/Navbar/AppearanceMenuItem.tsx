import { PaletteIcon, SlidersHorizontalIcon } from "lucide-react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { InlineMenuPanel, MenuLabel, useInlineMenu } from "./InlineMenu";
import { AnimationsToggleItem } from "./UserDropdown/AnimationsToggleItem";
import { ThemeToggleItem } from "./UserDropdown/ThemeToggleItem";

export const AppearanceMenuItem = ({
	to,
	className,
	options,
	labelBadge,
}: {
	to: string;
	className?: string;
	labelBadge?: React.ReactNode;
	/** More right-click options, after its own. */
	options?: React.ReactNode;
}) => {
	const menu = useInlineMenu({ arrowRight: true });
	return (
		<>
			<DropdownMenuItem
				asChild
				className={className}
				{...menu.trigger}
				title="Right-click for appearance controls"
			>
				<Link to={to}>
					<PaletteIcon aria-hidden />
					{labelBadge ? (
						<MenuLabel badge={labelBadge}>Appearance</MenuLabel>
					) : (
						"Appearance"
					)}
				</Link>
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					label="Personal dashboard appearance"
					quickLinkMenu={menu}
					className="order-last"
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
				</InlineMenuPanel>
			)}
		</>
	);
};
