import { cn } from "cn";
import { PencilIcon } from "lucide-react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { WORKSPACE_HEALTH_PATH } from "#/pages/HealthPage/healthSections";
import type { AdminPage } from "./adminQuickLinks";

/**
 * Permissions that determine which items appear in the Admin menu.
 * Shared by the desktop `DeploymentDropdown` and the mobile `MobileMenu` so
 * both surfaces render the same set of items from a single source of truth.
 */
type AdminSettingsItemsProps = {
	itemClassName?: string;
	permissions: AdminSettingsPermissions;
	/**
	 * The page each quick link opens (where Accounts and Health are by
	 * default). Without it, Accounts and Health are shown when permitted.
	 */
	quickLinks?: readonly (AdminPage | undefined)[];
	/** Offers "Customize quick links" when set. */
	onCustomizeQuickLinks?: () => void;
};

/** An admin's choice of quick links, and how to change it. */
export type AdminQuickLinks = {
	/** The pages this admin can pick from. */
	pages: readonly AdminPage[];
	/** The page in each slot. */
	links: readonly (AdminPage | undefined)[];
	isSaving: boolean;
	error: unknown;
	onSave: (ids: string[], onSaved: () => void) => void;
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
 * offered here to those who cannot open General. Two quick links, Accounts and
 * Health unless the admin chose other pages, open admin pages directly. The
 * menu ends with the cluster's CPU and memory, which only admins get an
 * answer for.
 */
export const AdminSettingsItems: React.FC<AdminSettingsItemsProps> = ({
	itemClassName,
	permissions,
	quickLinks = [
		permissions.canViewUsers
			? {
					id: "accounts",
					label: "Accounts",
					path: "/deployment/users",
					group: "General",
				}
			: undefined,
		permissions.canViewHealth
			? {
					id: "health",
					label: "Workspace Health",
					menuLabel: "Health",
					path: WORKSPACE_HEALTH_PATH,
					group: "Health",
				}
			: undefined,
	],
	onCustomizeQuickLinks,
}) => {
	const quickLink = (page: AdminPage | undefined) =>
		page && (
			<DropdownMenuItem asChild className={itemClassName}>
				<Link to={page.path}>{page.menuLabel ?? page.label}</Link>
			</DropdownMenuItem>
		);
	return (
		<>
			{permissions.canViewDeployment && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/deployment">Settings</Link>
				</DropdownMenuItem>
			)}
			{quickLink(quickLinks[0])}
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
			{quickLink(quickLinks[1])}
			{onCustomizeQuickLinks && (
				<DropdownMenuItem
					className={cn("text-content-secondary", itemClassName)}
					onSelect={onCustomizeQuickLinks}
				>
					<PencilIcon />
					Customize quick links…
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
