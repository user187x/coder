import type { Permissions } from "#/modules/permissions";
import {
	HEALTH_SECTIONS,
	USER_QUOTA_PATH,
	WORKSPACE_HEALTH_PATH,
} from "#/pages/HealthPage/healthSections";

/** An admin page the Admin menu can link to directly. */
export type AdminPage = {
	/** Stored in the user's preferences; never change an existing ID. */
	id: string;
	label: string;
	/** A shorter name for the Admin menu, where the page's group is not shown. */
	menuLabel?: string;
	path: string;
	group: "General" | "Health";
};

/** How many quick links the Admin menu has. */
export const ADMIN_QUICK_LINK_SLOTS = 2;

/** The quick links an admin gets until they choose others: Accounts and Health. */
export const DEFAULT_ADMIN_QUICK_LINKS: readonly string[] = [
	"accounts",
	"health",
];

type AdminPageAccess = {
	permissions: Permissions;
	/** The deployment offers OAuth2 applications. */
	oauth2Provider: boolean;
	canViewAISettings: boolean;
};

const ADMIN_PAGES: readonly (AdminPage & {
	allowed: (access: AdminPageAccess) => boolean;
})[] = [
	{
		id: "accounts",
		label: "Accounts",
		path: "/deployment/users",
		group: "General",
		allowed: ({ permissions }) => permissions.viewAllUsers,
	},
	{
		id: "announcement",
		label: "Announcement",
		path: "/deployment/announcement",
		group: "General",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "authentication",
		label: "Authentication",
		path: "/deployment/userauth",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "classification",
		label: "Classification",
		path: "/deployment/classification",
		group: "General",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "customize",
		label: "Customize",
		path: "/deployment/customize",
		group: "General",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "monitoring",
		label: "Monitoring",
		path: "/deployment/monitoring",
		group: "General",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "network",
		label: "Network",
		path: "/deployment/network",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "notifications",
		label: "Notifications",
		path: "/deployment/notifications",
		group: "General",
		allowed: ({ permissions }) => permissions.viewNotificationTemplate,
	},
	{
		id: "oauth2-applications",
		label: "OAuth2 Applications",
		path: "/deployment/oauth2-provider/apps",
		group: "General",
		allowed: ({ permissions, oauth2Provider }) =>
			permissions.viewDeploymentConfig && oauth2Provider,
	},
	{
		id: "observability",
		label: "Observability",
		path: "/deployment/observability",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "overview",
		label: "Overview",
		path: "/deployment/overview",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "persistence",
		label: "Persistence",
		path: "/deployment/persistence",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "security",
		label: "Security",
		path: "/deployment/security",
		group: "General",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "super-intelligence",
		label: "Super Intelligence",
		path: "/ai/settings",
		group: "General",
		allowed: ({ canViewAISettings }) => canViewAISettings,
	},
	{
		id: "health",
		label: "Workspace Health",
		menuLabel: "Health",
		path: WORKSPACE_HEALTH_PATH,
		group: "Health",
		allowed: ({ permissions }) => permissions.viewDebugInfo,
	},
	{
		id: "health-user-quota",
		label: "User Quota",
		path: USER_QUOTA_PATH,
		group: "Health",
		allowed: ({ permissions }) =>
			permissions.viewDebugInfo && permissions.editDeploymentConfig,
	},
	...HEALTH_SECTIONS.map((section) => ({
		id: `health-${section.path.split("/").at(-1)}`,
		label: section.label,
		path: section.path,
		group: "Health" as const,
		allowed: ({ permissions }: AdminPageAccess) => permissions.viewDebugInfo,
	})),
];

/** The admin pages this user can open, in the order the picker lists them. */
export const adminPagesFor = (access: AdminPageAccess): AdminPage[] =>
	ADMIN_PAGES.filter((page) => page.allowed(access)).map(
		({ allowed: _allowed, ...page }) => page,
	);

/**
 * The page in each quick link slot: the user's choice when they can still
 * open it, else that slot's default, else nothing. A page is shown once.
 */
export const resolveAdminQuickLinks = (
	chosen: readonly string[],
	pages: readonly AdminPage[],
): (AdminPage | undefined)[] => {
	const used = new Set<string>();
	const pick = (id: string | undefined) => {
		const page = pages.find((p) => p.id === id);
		if (!page || used.has(page.id)) {
			return undefined;
		}
		used.add(page.id);
		return page;
	};
	const slots = Array.from({ length: ADMIN_QUICK_LINK_SLOTS }, (_, i) =>
		pick(chosen[i]),
	);
	return slots.map((page, i) => page ?? pick(DEFAULT_ADMIN_QUICK_LINKS[i]));
};

/** What to store for these slots: nothing when they are the defaults, so later default changes apply. */
export const adminQuickLinksToSave = (ids: readonly string[]): string[] =>
	ids.length === DEFAULT_ADMIN_QUICK_LINKS.length &&
	ids.every((id, i) => id === DEFAULT_ADMIN_QUICK_LINKS[i])
		? []
		: [...ids];
