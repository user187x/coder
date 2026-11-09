import { cn } from "cn";
import type { BuildInfoResponse } from "#/api/typesGenerated";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem as SidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import type { Permissions } from "#/modules/permissions";
import { canSeeTemplates } from "#/modules/permissions/templates";
import { ChatUnreadIndicator } from "#/modules/platform/chat/ChatUnreadIndicator";
import { ChatGate } from "#/modules/platform/chat/useChatEnabled";
import { HealthIcon } from "#/pages/HealthPage/Content";
import { AdminCategoryLabel } from "./AdminCategoryLabel";
import {
	orderCategories,
	type SidebarCategory,
	SortableCategories,
} from "./SortableCategories";

type DeploymentSidebarViewProps = {
	/** Site-wide permissions. */
	permissions: Permissions;
	buildInfo: BuildInfoResponse;
	/** General's Health entry (HealthNavItem). */
	health?: React.ReactNode;
	network?: React.ReactNode;
	/** The platform service is connected to Keycloak: a green check after Authentication. */
	keycloakConnected?: boolean;
	/** The admin's order of the categories (page IDs); empty or missing: alphabetical. */
	order?: readonly string[];
	/** Saves a new order ([]: alphabetical). Without it the categories cannot be moved. */
	onReorder?: (ids: string[]) => void;
	/** Above the list in place of its "Settings" label: the settings breadcrumb. */
	header?: React.ReactNode;
	/** The page Settings opens on for the user (a category's path), set from a category's right-click menu. */
	defaultView?: string | null;
	onDefaultViewChange?: (path: string | null) => void;
};

/**
 * Navigation for General (the deployment settings): its categories in the
 * order the admin arranged them (alphabetical until then), with Templates and
 * Workspaces among them. Licenses,
 * Workspace Proxies, Groups, IdP Organization Sync and External
 * Authentication are not offered here; their pages still answer.
 */
export const DeploymentSidebarView: React.FC<DeploymentSidebarViewProps> = ({
	permissions,
	buildInfo,
	health,
	network,
	keycloakConnected,
	order = [],
	onReorder,
	header,
	defaultView = null,
	onDefaultViewChange,
}) => {
	const item = (
		id: string,
		href: string,
		label: string,
		extra?: React.ReactNode,
	): SidebarCategory => ({
		id,
		label,
		node: (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					{/* The default view in the theme's accent colour (--content-link, a custom theme's accent): only its
					    text changes, so nothing moves */}
					<div
						data-default-view={defaultView === href || undefined}
						title={defaultView === href ? "Set as default view" : undefined}
						className={cn(defaultView === href && "[&>a]:!text-content-link")}
					>
						<SidebarNavItem href={href}>
							<AdminCategoryLabel id={id}>
								{label}
								{extra}
							</AdminCategoryLabel>
						</SidebarNavItem>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent aria-label={`${label} actions`}>
					<ContextMenuCheckboxItem
						checked={defaultView === href}
						disabled={!onDefaultViewChange}
						onCheckedChange={(on) => onDefaultViewChange?.(on ? href : null)}
					>
						Default View
					</ContextMenuCheckboxItem>
				</ContextMenuContent>
			</ContextMenu>
		),
	});
	const candidates: (SidebarCategory | false | undefined)[] = [
		permissions.viewAllUsers &&
			item("accounts", "/deployment/users", "Accounts"),
		permissions.editDeploymentConfig &&
			item("announcement", "/deployment/announcement", "Announcement"),
		permissions.editDeploymentConfig && {
			// unread chat messages at the entry's right (the row's, beyond its link)
			...item("chat", "/deployment/chat", "Chat"),
			node: (
				<div className="relative">
					<SidebarNavItem href="/deployment/chat">
						<AdminCategoryLabel id="chat">Chat</AdminCategoryLabel>
					</SidebarNavItem>
					<ChatGate>
						<ChatUnreadIndicator className="absolute top-1/2 right-2 -translate-y-1/2" />
					</ChatGate>
				</div>
			),
		},
		permissions.viewDeploymentConfig &&
			item(
				"authentication",
				"/deployment/userauth",
				"Authentication",
				keycloakConnected && (
					<span title="Connected to Keycloak" className="inline-flex">
						<HealthIcon size={14} severity="ok" />
					</span>
				),
			),
		permissions.editDeploymentConfig &&
			item("classification", "/deployment/classification", "Classification"),
		// Platform: the Cloud Drive for everyone (on or off), where it keeps files, every account's capacity
		permissions.editDeploymentConfig &&
			item("cloud-drive", "/deployment/cloud-drive", "Cloud Drive"),
		permissions.editDeploymentConfig &&
			item("customize", "/deployment/customize", "Appearance"),
		item("dashboard", "/dashboard", "Dashboard"),
		Boolean(health) && { id: "health", label: "Health", node: health },
		permissions.editDeploymentConfig && item("images", "/images", "Images"),
		(permissions.editDeploymentConfig || permissions.viewDeploymentConfig) &&
			item("monitoring", "/deployment/monitoring", "Monitoring"),
		permissions.viewDeploymentConfig &&
			item("network", "/deployment/network", "Network", network),
		permissions.viewNotificationTemplate &&
			item("notifications", "/deployment/notifications", "Notifications"),
		permissions.viewDeploymentConfig &&
			buildInfo.oauth2_provider &&
			item(
				"oauth2-applications",
				"/deployment/oauth2-provider/apps",
				"OAuth2 Applications",
			),
		// Platform: the quick access wheel's wedges (Escape, on every page)
		permissions.editDeploymentConfig &&
			item("quick-menu", "/deployment/quick-menu", "Quick Menu"),
		permissions.viewDeploymentConfig &&
			item("persistence", "/deployment/persistence", "Persistence"),
		permissions.viewDeploymentConfig &&
			item("security", "/deployment/security", "Security"),
		canSeeTemplates(permissions) &&
			item("templates", "/templates", "Templates"),
		item("traffic-control", "/traffic-control", "Traffic Control"),
		item("workspaces", "/workspaces", "Workspaces"),
	];
	const categories = candidates.filter((c): c is SidebarCategory => Boolean(c));

	return (
		<BaseSidebar className="lg:sticky lg:top-[calc(var(--dashboard-navigation-height,72px)+var(--admin-breadcrumb-height,0px)+16px+var(--coder-classification-h,0px))] lg:self-start [@media(max-height:640px)]:static">
			{onReorder ? (
				<SortableCategories
					categories={categories}
					order={order}
					onReorder={onReorder}
					header={header}
				/>
			) : (
				<div className="flex flex-col gap-1">
					{header && <div className="pb-1">{header}</div>}
					{orderCategories(categories, order).map((c) => (
						<div key={c.id}>{c.node}</div>
					))}
				</div>
			)}
		</BaseSidebar>
	);
};
