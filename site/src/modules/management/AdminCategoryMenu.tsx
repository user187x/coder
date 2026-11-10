import { SettingsIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { preferenceSettings } from "#/api/queries/users";
import { BreadcrumbLink } from "#/components/Breadcrumb/Breadcrumb";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { adminPagesFor } from "#/modules/dashboard/Navbar/adminQuickLinks";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { useSettingsDefaultView } from "./settingsDefaultView";

/** The admin landing link and permission-filtered category shortcuts. */
export const AdminCategoryMenu = () => {
	const { permissions } = useAuthenticated();
	const { buildInfo } = useDashboard();
	const preferences = useQuery(preferenceSettings());
	// Settings opens on the user's Default View (a category's right-click menu), else Accounts.
	const defaultView = useSettingsDefaultView();
	const order = preferences.data?.admin_sidebar_order ?? [];
	const pages = adminPagesFor({
		permissions,
		oauth2Provider: buildInfo.oauth2_provider,
	}).sort((a, b) => {
		const ai = order.indexOf(a.id);
		const bi = order.indexOf(b.id);
		return (
			(ai < 0 ? Number.POSITIVE_INFINITY : ai) -
				(bi < 0 ? Number.POSITIVE_INFINITY : bi) ||
			a.label.localeCompare(b.label, "en-US")
		);
	});
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<BreadcrumbLink
					to={defaultView.path ?? "/deployment/users"}
					end
					title={`${defaultView.path ? "Your default view" : "Accounts"}; right-click for admin categories`}
				>
					<SettingsIcon aria-hidden className="size-4 shrink-0" />
					Settings
				</BreadcrumbLink>
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="Admin categories"
				className="max-h-[calc(70vh/var(--app-zoom,1))] overflow-y-auto"
			>
				{pages.map((page) => (
					<ContextMenuItem key={page.id} asChild>
						<Link to={page.path}>
							<page.icon aria-hidden className="size-4" />
							{page.label}
						</Link>
					</ContextMenuItem>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
};
