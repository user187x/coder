import type { BuildInfoResponse } from "#/api/typesGenerated";
import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem as SidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import type { Permissions } from "#/modules/permissions";
import { HealthIcon } from "#/pages/HealthPage/Content";
import { AdminCategoryLabel } from "./AdminCategoryLabel";

type DeploymentSidebarViewProps = {
	/** Site-wide permissions. */
	permissions: Permissions;
	buildInfo: BuildInfoResponse;
	/** General's Super Intelligence entry (AISettingsTree), shown after Accounts. */
	aiSettings?: React.ReactNode;
	/** General's Health entry (HealthSettingsTree), placed in alphabetical order. */
	health?: React.ReactNode;
	/** The platform service is connected to Keycloak: a green check after Authentication. */
	keycloakConnected?: boolean;
};

/**
 * Navigation for General (the deployment settings), in alphabetical order.
 * Licenses, Workspace Proxies, Groups, IdP Organization Sync and External
 * Authentication are not offered here; their pages still answer.
 */
export const DeploymentSidebarView: React.FC<DeploymentSidebarViewProps> = ({
	permissions,
	buildInfo,
	aiSettings,
	health,
	keycloakConnected,
}) => {
	return (
		<BaseSidebar>
			<div className="flex flex-col gap-1">
				{permissions.viewAllUsers && (
					<SidebarNavItem href="/deployment/users">
						<AdminCategoryLabel id="accounts">Accounts</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{aiSettings}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/announcement">
						<AdminCategoryLabel id="announcement">
							Announcement
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/chat">
						<AdminCategoryLabel id="chat">Chat</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/userauth">
						<AdminCategoryLabel id="authentication">
							Authentication
							{keycloakConnected && (
								<span title="Connected to Keycloak" className="inline-flex">
									<HealthIcon size={14} severity="ok" />
								</span>
							)}
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/classification">
						<AdminCategoryLabel id="classification">
							Classification
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/customize">
						<AdminCategoryLabel id="customize">Appearance</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{health}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/monitoring">
						<AdminCategoryLabel id="monitoring">Monitoring</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/network">
						<AdminCategoryLabel id="network">Network</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewNotificationTemplate && (
					<SidebarNavItem href="/deployment/notifications">
						<AdminCategoryLabel id="notifications">
							Notifications
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && buildInfo.oauth2_provider && (
					<SidebarNavItem href="/deployment/oauth2-provider/apps">
						<AdminCategoryLabel id="oauth2-applications">
							OAuth2 Applications
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/observability">
						<AdminCategoryLabel id="observability">
							Observability
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/online">
						<AdminCategoryLabel id="online-users">
							Online Users
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/overview">
						<AdminCategoryLabel id="overview">Overview</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/persistence">
						<AdminCategoryLabel id="persistence">
							Persistence
						</AdminCategoryLabel>
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/security">
						<AdminCategoryLabel id="security">Security</AdminCategoryLabel>
					</SidebarNavItem>
				)}
			</div>
		</BaseSidebar>
	);
};
