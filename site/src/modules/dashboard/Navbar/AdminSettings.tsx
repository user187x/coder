import { Building2Icon, CableIcon, ScrollTextIcon } from "lucide-react";
import { Link } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { AdminQuickLinksMenu } from "./AdminQuickLinksMenu";
import type { AdminPage } from "./adminQuickLinks";
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
	metricsRef?: React.Ref<HTMLDivElement>;
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
	metricsRef,
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
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/organizations">
						<Building2Icon aria-hidden />
						Organizations
					</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewAuditLog && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/audit">
						<ScrollTextIcon aria-hidden />
						Audit logs
					</Link>
				</DropdownMenuItem>
			)}
			{permissions.canViewConnectionLog && (
				<DropdownMenuItem asChild className={itemClassName}>
					<Link to="/connectionlog">
						<CableIcon aria-hidden />
						Connection logs
					</Link>
				</DropdownMenuItem>
			)}
			{canViewAdminSettings(permissions) && (
				<SettingsMetricGraphs
					anchor={metricsRef}
					chatExpanded={Boolean(chatExpanded)}
				/>
			)}
		</>
	);
};

/**
 * Whether the user has any permission that should surface the Admin menu.
 * Organizations alone does not gate visibility, matching prior behavior.
 */
const canViewAdminSettings = (permissions: AdminSettingsPermissions): boolean =>
	Object.values(permissions).some((canView) => canView);
