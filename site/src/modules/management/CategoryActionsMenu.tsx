import { ChevronDownIcon } from "lucide-react";
import { Link } from "react-router";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { useNavbarActionMenu } from "#/modules/dashboard/Navbar/NavbarAction";

/**
 * The caret at the far right of the settings breadcrumb's category chevron: it opens the menu items of the page's
 * navbar action (NavbarAction's `menu`). Pages without one show no caret.
 */
export const CategoryActionsMenu: React.FC<{ label: string }> = ({ label }) => {
	const items = useNavbarActionMenu();
	if (items.length === 0) return null;
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="category-actions-trigger"
					aria-label={`${label} actions`}
					title={`${label} actions`}
				>
					<span aria-hidden className="category-actions-divider" />
					<ChevronDownIcon aria-hidden className="category-actions-caret" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{items.map((item) =>
					"to" in item ? (
						<DropdownMenuItem key={item.label} asChild>
							<Link to={item.to}>
								<item.icon aria-hidden />
								{item.label}
							</Link>
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem key={item.label} onSelect={item.onSelect}>
							<item.icon aria-hidden />
							{item.label}
						</DropdownMenuItem>
					),
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
