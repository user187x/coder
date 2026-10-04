import type { BuildInfoResponse } from "#/api/typesGenerated";
import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem as SidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import type { Permissions } from "#/modules/permissions";

type DeploymentSidebarViewProps = {
	/** Site-wide permissions. */
	permissions: Permissions;
	buildInfo: BuildInfoResponse;
	/** General's Super Intelligence entry (AISettingsTree), shown after Accounts. */
	aiSettings?: React.ReactNode;
	/** General's Health entry (HealthSettingsTree), placed in alphabetical order. */
	health?: React.ReactNode;
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
}) => {
	return (
		<BaseSidebar>
			<div className="flex flex-col gap-1">
				{permissions.viewAllUsers && (
					<SidebarNavItem href="/deployment/users">Accounts</SidebarNavItem>
				)}
				{aiSettings}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/announcement">
						Announcement
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/userauth">
						Authentication
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/classification">
						Classification
					</SidebarNavItem>
				)}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/customize">
						Customize
					</SidebarNavItem>
				)}
				{health}
				{permissions.editDeploymentConfig && (
					<SidebarNavItem href="/deployment/monitoring">
						Monitoring
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/network">Network</SidebarNavItem>
				)}
				{permissions.viewNotificationTemplate && (
					<SidebarNavItem href="/deployment/notifications">
						Notifications
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && buildInfo.oauth2_provider && (
					<SidebarNavItem href="/deployment/oauth2-provider/apps">
						OAuth2 Applications
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/observability">
						Observability
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/overview">Overview</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/persistence">
						Persistence
					</SidebarNavItem>
				)}
				{permissions.viewDeploymentConfig && (
					<SidebarNavItem href="/deployment/security">Security</SidebarNavItem>
				)}
			</div>
		</BaseSidebar>
	);
};
