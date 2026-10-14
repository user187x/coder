import { adminPageIcon } from "#/modules/dashboard/Navbar/adminQuickLinks";

/**
 * A category of General in its sidebar: its label after the icon its quick
 * link shows in the Admin menu (adminQuickLinks).
 */
export const AdminCategoryLabel: React.FC<{
	/** The category's ID in adminQuickLinks, e.g. "health". */
	id: string;
	children?: React.ReactNode;
}> = ({ id, children }) => {
	const Icon = adminPageIcon(id);
	return (
		<span className="inline-flex items-center gap-2">
			{Icon && <Icon aria-hidden className="size-4 shrink-0" />}
			{children}
		</span>
	);
};
