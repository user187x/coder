import {
	Building2Icon,
	CableIcon,
	type LucideIcon,
	ScrollTextIcon,
	UserRoundIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	preferenceSettings,
	preferenceSettingsKey,
	updatePreferenceSettings,
} from "#/api/queries/users";
import type { UserPreferenceSettings } from "#/api/typesGenerated";
import { AdminQuickLinksMenu } from "./AdminQuickLinksMenu";
import type { AdminPage } from "./adminQuickLinks";
import { HideableMenuRows } from "./HideableMenuRows";
import { ProfileSections } from "./ProfileSections";
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
	/** Its right-click options besides Open and the Default View (Profile: the User Settings sections). */
	options?: React.ReactNode;
};

const hideableItems = (
	permissions: AdminSettingsPermissions,
): HideableMenuItem[] => [
	{
		id: "profile",
		label: "Profile",
		path: "/settings/account",
		icon: UserRoundIcon,
		options: <ProfileSections />,
	},
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
	const sidebar = useQuery(preferenceSettings());
	const saveOrder = useMutation(updatePreferenceSettings(client));
	const hiddenIds = preferences.data?.settings_menu_hidden ?? [];
	const items = [
		// Chat has its own entry (ChatMenuItem) under Controls.
		...categories.filter(
			(page) =>
				page.id !== "chat" && !quickLinks.some((link) => link.id === page.id),
		),
		...hideableItems(permissions),
	];
	// The rows after the quick links in the admin's own order (their sidebar order), the rest after them.
	const order = sidebar.data?.admin_sidebar_order ?? [];
	const rank = (id: string) => {
		const index = order.indexOf(id);
		return index < 0 ? Number.POSITIVE_INFINITY : index;
	};
	const shown = items
		.filter((item) => !hiddenIds.includes(item.id))
		.map((item, index) => ({ item, index }))
		.sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.index - b.index)
		.map(({ item }) => item);
	const reorder = (ids: string[]) => {
		const next = [...ids, ...order.filter((id) => !ids.includes(id))];
		client.setQueryData<UserPreferenceSettings>(preferenceSettingsKey, (old) =>
			old ? { ...old, admin_sidebar_order: next } : old,
		);
		saveOrder.mutate({ admin_sidebar_order: next });
	};
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
				shownIds={shown.map((item) => item.id)}
				// The other items in the quick links' list, as the quick links: a hover trash can hides one under
				// Controls, a hover handle moves it (saved as the admin's sidebar order).
				moreLinks={
					<HideableMenuRows
						items={shown}
						itemClassName={itemClassName}
						onHide={(id) => setHidden(id, true)}
						onReorder={reorder}
					/>
				}
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
