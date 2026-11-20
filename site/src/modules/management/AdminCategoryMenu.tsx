import { arrayMove } from "@dnd-kit/sortable";
import { GaugeIcon, MenuIcon } from "lucide-react";
import { useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	preferenceSettings,
	preferenceSettingsKey,
	updatePreferenceSettings,
} from "#/api/queries/users";
import { BreadcrumbLink } from "#/components/Breadcrumb/Breadcrumb";
import {
	ContextMenu,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { settingsUtilityPages } from "#/modules/dashboard/Navbar/AdminSettings";
import {
	canonicalAdminPageId,
	defaultHomeLabel,
	settingsPagesFor,
} from "#/modules/dashboard/Navbar/adminQuickLinks";
import { BreadcrumbContextMenuContent } from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import {
	NavbarMoveOption,
	NavbarMoveScope,
} from "#/modules/dashboard/Navbar/NavbarMoveMenu";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import { orderCategories, SortableCategories } from "./SortableCategories";
import { useSettingsDefaultView } from "./settingsDefaultView";

/** The admin landing link and permission-filtered category shortcuts. */
export const AdminCategoryMenu = ({
	fallbackPath = "/deployment/users",
}: {
	fallbackPath?: string;
}) => {
	const navbarMove = useContext(NavbarMoveScope);
	const { permissions } = useAuthenticated();
	const { buildInfo, canViewOrganizationSettings } = useDashboard();
	const features = useFeatureVisibility();
	const client = useQueryClient();
	const preferences = useQuery(preferenceSettings());
	const save = useMutation(updatePreferenceSettings(client));
	const defaultView = useSettingsDefaultView();
	const order = preferences.data?.admin_sidebar_order ?? [];
	const pages = [
		...(permissions.viewDeploymentConfig
			? [{ id: "hud", label: "HUD", icon: GaugeIcon, path: "/hud" }]
			: []),
		...settingsPagesFor({
			permissions,
			oauth2Provider: buildInfo.oauth2_provider,
		}),
		...settingsUtilityPages({
			canViewOrganizations: canViewOrganizationSettings,
			canViewAuditLog: features.audit_log && permissions.viewAnyAuditLog,
			canViewConnectionLog:
				features.connection_log && permissions.viewAnyConnectionLog,
		}),
	];
	const reorder = (ids: string[]) => {
		const next = ids.length
			? [
					...ids,
					...order.filter(
						(id) => !pages.some((page) => page.id === canonicalAdminPageId(id)),
					),
				]
			: ids;
		client.setQueryData(preferenceSettingsKey, {
			...preferences.data,
			admin_sidebar_order: next,
		});
		save.mutate(
			{ admin_sidebar_order: next },
			{
				onError: (error) => {
					void client.invalidateQueries({ queryKey: preferenceSettingsKey });
					toast.error(
						getErrorMessage(error, "Could not save the categories' order."),
					);
				},
			},
		);
	};
	const pageOrder = orderCategories(
		pages.map(({ id, label }) => ({ id, label, node: null })),
		order,
	).map(({ id }) => id);

	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger asChild>
				<BreadcrumbLink
					to={defaultView.path ?? fallbackPath}
					end
					aria-label={defaultHomeLabel(defaultView.path)}
					title="Right-click for admin categories"
				>
					<MenuIcon aria-hidden className="size-4 shrink-0" />
				</BreadcrumbLink>
			</ContextMenuTrigger>
			<BreadcrumbContextMenuContent aria-label="Admin categories">
				<SortableCategories
					header={
						<span className="pl-2 text-xs font-medium text-content-secondary">
							Admin categories
						</span>
					}
					order={order}
					onReorder={reorder}
					categories={pages.map((page) => ({
						id: page.id,
						label: page.label,
						node: (
							<ContextMenuItem
								asChild
								aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
								onKeyDown={(event) => {
									if (
										!event.altKey ||
										(event.key !== "ArrowUp" && event.key !== "ArrowDown")
									) {
										return;
									}
									event.preventDefault();
									const from = pageOrder.indexOf(page.id);
									const to = from + (event.key === "ArrowUp" ? -1 : 1);
									if (to >= 0 && to < pageOrder.length) {
										reorder(arrayMove(pageOrder, from, to));
									}
								}}
							>
								<Link to={page.path}>
									<page.icon aria-hidden className="size-4" />
									<span className="truncate">{page.label}</span>
								</Link>
							</ContextMenuItem>
						),
					}))}
				/>
				{navbarMove && <NavbarMoveOption divided={pages.length > 0} />}
			</BreadcrumbContextMenuContent>
		</ContextMenu>
	);
};
