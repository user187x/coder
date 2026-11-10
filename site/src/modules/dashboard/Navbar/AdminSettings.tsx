import { cn } from "cn";
import {
	Building2Icon,
	CableIcon,
	EyeOffIcon,
	type LucideIcon,
	ScrollTextIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
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
	/** The admin settings' categories to list too (those not already quick links), each hideable under Controls. */
	categories?: readonly AdminPage[];
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
	/** The admin settings' categories, in the admin's sidebar order (the Settings menu lists them with the settings
	 * navigation in the navbar). */
	categories?: readonly AdminPage[];
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
	/** Platform: may open the Templates pages (canSeeTemplates); others reach templates by creating a workspace. */
	canViewTemplates?: boolean;
};

/** A Settings menu item that is not a quick link, hidden into the Controls list by the user's choice. */
export type HideableMenuItem = {
	/** Stored in the user's preferences (settings_menu_hidden): a category's page ID, or organizations, audit-logs or
	 * connection-logs; never change an existing ID. */
	id: string;
	label: string;
	path: string;
	icon: LucideIcon;
};

const hideableItems = (
	permissions: AdminSettingsPermissions,
): HideableMenuItem[] => [
	...(permissions.canViewOrganizations
		? [
				{
					id: "organizations",
					label: "Organizations",
					path: "/organizations",
					icon: Building2Icon,
				},
			]
		: []),
	...(permissions.canViewAuditLog
		? [
				{
					id: "audit-logs",
					label: "Audit logs",
					path: "/audit",
					icon: ScrollTextIcon,
				},
			]
		: []),
	...(permissions.canViewConnectionLog
		? [
				{
					id: "connection-logs",
					label: "Connection logs",
					path: "/connectionlog",
					icon: CableIcon,
				},
			]
		: []),
];

export const AdminSettingsItems: React.FC<AdminSettingsItemsProps> = ({
	itemClassName,
	permissions,
	quickLinks = [],
	quickLinksEditor,
	externalMetrics,
	chatExpanded,
	onChatToggle,
	categories = [],
}) => {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(client));
	const hiddenIds = preferences.data?.settings_menu_hidden ?? [];
	const items = [
		...categories.filter(
			(page) => !quickLinks.some((link) => link.id === page.id),
		),
		...hideableItems(permissions),
	];
	const setHidden = (id: string, hide: boolean) =>
		save.mutate({
			settings_menu_hidden: hide
				? [...hiddenIds.filter((other) => other !== id), id]
				: hiddenIds.filter((other) => other !== id),
		});
	return (
		<>
			<AdminQuickLinksMenu
				admin={permissions.canEditDeployment}
				chatExpanded={chatExpanded}
				onChatToggle={onChatToggle}
				links={quickLinks}
				addable={quickLinksEditor?.addable ?? []}
				onChange={quickLinksEditor?.onChange}
				hiddenItems={items.filter((item) => hiddenIds.includes(item.id))}
				onShowItem={(id) => setHidden(id, false)}
				// The other items in the quick links' list, each hideable under Controls like a quick link.
				moreLinks={items
					.filter((item) => !hiddenIds.includes(item.id))
					.map((item) => (
						<div
							key={item.id}
							className="group/hideable flex flex-wrap items-center rounded-full"
						>
							<PageMenuItem
								to={item.path}
								icon={item.icon}
								label={item.label}
								className={cn("min-w-0 flex-1", itemClassName)}
								panelClassName="order-last"
								options={
									<DropdownMenuItem
										onSelect={(event) => {
											event.preventDefault();
											setHidden(item.id, true);
										}}
									>
										Hide under Controls
									</DropdownMenuItem>
								}
							/>
							<DropdownMenuItem
								aria-label={`Hide ${item.label} under Controls`}
								title="Hide under Controls"
								className="invisible flex-none px-2 text-content-secondary group-focus-within/hideable:visible group-hover/hideable:visible"
								onSelect={(event) => {
									// Stay open, so several items can be hidden in a row.
									event.preventDefault();
									setHidden(item.id, true);
								}}
							>
								<EyeOffIcon aria-hidden />
							</DropdownMenuItem>
						</div>
					))}
			/>
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
