import type { BuildInfoResponse } from "#/api/typesGenerated";
import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem as SidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import type { Permissions } from "#/modules/permissions";
import { ChatUnreadIndicator } from "#/modules/platform/chat/ChatUnreadIndicator";
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
	/** The platform service is connected to Keycloak: a green check after Authentication. */
	keycloakConnected?: boolean;
	/** The admin's order of the categories (page IDs); empty or missing: alphabetical. */
	order?: readonly string[];
	/** Saves a new order ([]: alphabetical). Without it the categories cannot be moved. */
	onReorder?: (ids: string[]) => void;
};

/**
 * Navigation for General (the deployment settings): its categories in the
 * order the admin arranged them (alphabetical until then). Licenses,
 * Workspace Proxies, Groups, IdP Organization Sync and External
 * Authentication are not offered here; their pages still answer.
 */
export const DeploymentSidebarView: React.FC<DeploymentSidebarViewProps> = ({
	permissions,
	buildInfo,
	health,
	keycloakConnected,
	order = [],
	onReorder,
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
			<SidebarNavItem href={href}>
				<AdminCategoryLabel id={id}>
					{label}
					{extra}
				</AdminCategoryLabel>
			</SidebarNavItem>
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
					<ChatUnreadIndicator className="absolute top-1/2 right-2 -translate-y-1/2" />
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
		permissions.editDeploymentConfig &&
			item("customize", "/deployment/customize", "Appearance"),
		Boolean(health) && { id: "health", label: "Health", node: health },
		permissions.editDeploymentConfig &&
			item("monitoring", "/deployment/monitoring", "Monitoring"),
		permissions.viewDeploymentConfig &&
			item("network", "/deployment/network", "Network"),
		permissions.viewNotificationTemplate &&
			item("notifications", "/deployment/notifications", "Notifications"),
		permissions.viewDeploymentConfig &&
			buildInfo.oauth2_provider &&
			item(
				"oauth2-applications",
				"/deployment/oauth2-provider/apps",
				"OAuth2 Applications",
			),
		permissions.viewDeploymentConfig &&
			item("observability", "/deployment/observability", "Observability"),
		permissions.viewDeploymentConfig &&
			item("persistence", "/deployment/persistence", "Persistence"),
		permissions.viewDeploymentConfig &&
			item("security", "/deployment/security", "Security"),
	];
	const categories = candidates.filter((c): c is SidebarCategory => Boolean(c));

	return (
		<BaseSidebar>
			{onReorder ? (
				<SortableCategories
					categories={categories}
					order={order}
					onReorder={onReorder}
				/>
			) : (
				<div className="flex flex-col gap-1">
					{orderCategories(categories, order).map((c) => (
						<div key={c.id}>{c.node}</div>
					))}
				</div>
			)}
		</BaseSidebar>
	);
};
