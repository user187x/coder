import { SettingsIcon } from "lucide-react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterGauge } from "#/modules/platform/ClusterGauge";
import { AdminQuickLinksMenu } from "./AdminQuickLinksMenu";
import type { AdminPage } from "./adminQuickLinks";

/**
 * Permissions that determine which items appear in the Admin menu.
 * Shared by the desktop `DeploymentDropdown` and the mobile `MobileMenu` so
 * both surfaces render the same set of items from a single source of truth.
 */
type AdminSettingsItemsProps = {
	itemClassName?: string;
	permissions: AdminSettingsPermissions;
	/** The admin's quick links, in their order. None by default. */
	quickLinks?: readonly AdminPage[];
	/** Makes the quick links editable in place: add, remove and reorder. */
	quickLinksEditor?: AdminQuickLinksEditor;
};

/** Changes to an admin's quick links, made from the Admin menu. */
export type AdminQuickLinksEditor = {
	/** The pages that can still be added. */
	addable: readonly AdminPage[];
	/** The new list of page IDs, in order. */
	onChange: (ids: string[]) => void;
};

/** An admin's quick links, and how to change them. */
export type AdminQuickLinks = {
	/** The pages this admin can link to. */
	pages: readonly AdminPage[];
	/** The links, in the admin's order. */
	links: readonly AdminPage[];
	/** Saves the new list of page IDs, in order. */
	onChange: (ids: string[]) => void;
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
 * deployment settings are called "Settings" (they open General). Under it are
 * the admin's quick links to General's categories, none until they add some
 * with the row after them; each link can be removed or dragged into another
 * place. AI settings live in General's sidebar as "Super Intelligence", which
 * is only offered here to those who cannot open General. The menu ends with
 * the cluster's CPU and memory, which only admins get an answer for.
 */
export const AdminSettingsItems: React.FC<AdminSettingsItemsProps> = ({
	itemClassName,
	permissions,
	quickLinks = [],
	quickLinksEditor,
}) => {
	return (
		<>
			{permissions.canViewDeployment && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/deployment">
						<SettingsIcon aria-hidden />
						Settings
					</Link>
				</DropdownMenuItem>
			)}
			{quickLinksEditor ? (
				<AdminQuickLinksMenu
					links={quickLinks}
					addable={quickLinksEditor.addable}
					onChange={quickLinksEditor.onChange}
					itemClassName={itemClassName}
				/>
			) : (
				quickLinks.map((page) => (
					<DropdownMenuItem key={page.id} asChild className={itemClassName}>
						<Link to={page.path}>{page.label}</Link>
					</DropdownMenuItem>
				))
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
