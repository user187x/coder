import { Building2Icon, CableIcon, ScrollTextIcon } from "lucide-react";
import { AdminQuickLinksMenu } from "./AdminQuickLinksMenu";
import type { AdminPage } from "./adminQuickLinks";
import { PageMenuItem } from "./InlineMenu";
import { SettingsMetricGraphs } from "./SettingsMetricGraphs";

/**
 * Permissions that determine which items appear in the Admin menu.
 * Shared by the desktop latency and Controls menu (`ProxyMenu`; Platform: the
 * Controls button's own menu, merged into it) and the mobile `MobileMenu` so
 * both surfaces render the same set of items from a single source of truth.
 */
type AdminSettingsItemsProps = {
	itemClassName?: string;
	permissions: AdminSettingsPermissions;
	/** The admin's quick links, in their order. None by default. */
	quickLinks?: readonly AdminPage[];
	/** Makes the quick links editable in place: add, remove and reorder. */
	quickLinksEditor?: AdminQuickLinksEditor;
	externalMetrics?: boolean;
	chatExpanded?: boolean;
	onChatToggle?: () => void;
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
	canViewHud?: boolean;
	canViewUsers?: boolean;
	canViewOrganizations?: boolean;
	canViewAuditLog?: boolean;
	canViewConnectionLog?: boolean;
	canViewHealth?: boolean;
	/** Platform: may change the deployment's settings - the admins, who alone see Images. */
	canEditDeployment?: boolean;
};

export const AdminSettingsItems: React.FC<AdminSettingsItemsProps> = ({
	itemClassName,
	permissions,
	quickLinks = [],
	quickLinksEditor,
	externalMetrics,
	chatExpanded,
	onChatToggle,
}) => {
	return (
		<>
			<AdminQuickLinksMenu
				admin={permissions.canEditDeployment}
				chatExpanded={chatExpanded}
				onChatToggle={onChatToggle}
				links={quickLinks}
				addable={quickLinksEditor?.addable ?? []}
				onChange={quickLinksEditor?.onChange}
			/>
			{permissions.canViewOrganizations && (
				<PageMenuItem
					to="/organizations"
					icon={Building2Icon}
					label="Organizations"
					className={itemClassName}
				/>
			)}
			{permissions.canViewAuditLog && (
				<PageMenuItem
					to="/audit"
					icon={ScrollTextIcon}
					label="Audit logs"
					className={itemClassName}
				/>
			)}
			{permissions.canViewConnectionLog && (
				<PageMenuItem
					to="/connectionlog"
					icon={CableIcon}
					label="Connection logs"
					className={itemClassName}
				/>
			)}
			{!externalMetrics && canViewAdminSettings(permissions) && (
				<SettingsMetricGraphs chatExpanded={Boolean(chatExpanded)} />
			)}
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
