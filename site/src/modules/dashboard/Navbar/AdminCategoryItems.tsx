import { useQuery } from "react-query";
import { preferenceSettings } from "#/api/queries/users";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { type AdminPage, adminPagesFor } from "./adminQuickLinks";
import { PageMenuItem } from "./InlineMenu";

/**
 * The admin settings' categories the quick links leave out, in the admin's sidebar order: the Settings menu lists them
 * after its quick links while the settings navigation lives in the navbar, so the one menu reaches every category.
 */
export const AdminCategoryItems: React.FC<{
	quickLinks: readonly AdminPage[];
}> = ({ quickLinks }) => {
	const { permissions } = useAuthenticated();
	const { buildInfo } = useDashboard();
	const preferences = useQuery(preferenceSettings());
	const order = preferences.data?.admin_sidebar_order ?? [];
	const linked = new Set(quickLinks.map((link) => link.id));
	const rank = (page: AdminPage) => {
		const index = order.indexOf(page.id);
		return index < 0 ? Number.POSITIVE_INFINITY : index;
	};
	const pages = adminPagesFor({
		permissions,
		oauth2Provider: buildInfo.oauth2_provider,
	})
		.filter((page) => !linked.has(page.id))
		.sort(
			(a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "en-US"),
		);
	return pages.map((page) => (
		<PageMenuItem
			key={page.id}
			to={page.path}
			icon={page.icon}
			label={page.label}
		/>
	));
};
