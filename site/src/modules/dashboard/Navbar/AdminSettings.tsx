import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { WORKSPACE_HEALTH_PATH } from "#/pages/HealthPage/healthSections";

/**
 * Permissions that determine which items appear in the Admin menu.
 * Shared by the desktop `DeploymentDropdown` and the mobile `MobileMenu` so
 * both surfaces render the same set of items from a single source of truth.
 */
type AdminSettingsItemsProps = {
	itemClassName?: string;
	permissions: AdminSettingsPermissions;
};

export type AdminSettingsPermissions = {
	canViewDeployment?: boolean;
	canViewUsers?: boolean;
	canViewOrganizations?: boolean;
	canViewAISettings?: boolean;
	canViewAuditLog?: boolean;
	canViewConnectionLog?: boolean;
	canViewAIBridge?: boolean;
	canViewHealth?: boolean;
};

/**
 * Builds the ordered list of Admin menu items for the given permissions. The
 * deployment settings are called "Settings" (they open General), and AI
 * settings live in General's sidebar as "Super Intelligence", which is only
 * offered here to those who cannot open General. The menu ends with the cluster's CPU and memory, which
 * only admins get an answer for.
 */
export const AdminSettingsItems: React.FC<AdminSettingsItemsProps> = ({
	itemClassName,
	permissions,
}) => {
	return (
		<>
			{permissions.canViewDeployment && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/deployment">Settings</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewUsers && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/deployment/users">Accounts</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewOrganizations && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/organizations">Organizations</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewAISettings && !permissions.canViewDeployment && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/ai/settings">Super Intelligence</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewAuditLog && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/audit">Audit logs</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewConnectionLog && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/connectionlog">Connection logs</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewAIBridge && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/ai-gateway/sessions">AI sessions</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewHealth && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to={WORKSPACE_HEALTH_PATH}>Health</Link>
				</DropdownMenuItem>
			)}
			<ClusterGauge />
		</>
	);
};

/**
 * Whether the user has any permission that should surface the Admin menu.
 * Organizations alone does not gate visibility, matching prior behavior.
 */
export const canViewAdminSettings = (
	permissions: AdminSettingsPermissions,
): boolean => Object.values(permissions).some((canView) => canView);
