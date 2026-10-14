import {
	ActivityIcon,
	AppWindowIcon,
	BellIcon,
	BrainCircuitIcon,
	DatabaseIcon,
	HeartPulseIcon,
	KeyRoundIcon,
	LayoutDashboardIcon,
	LockIcon,
	type LucideIcon,
	MegaphoneIcon,
	NetworkIcon,
	PaletteIcon,
	TagIcon,
	TelescopeIcon,
	UsersIcon,
} from "lucide-react";
import { MaxAdminQuickLinks } from "#/api/typesGenerated";
import type { Permissions } from "#/modules/permissions";
import { WORKSPACE_HEALTH_PATH } from "#/pages/HealthPage/healthSections";

/** An admin page (a category of General) the Admin menu can link to directly. */
export type AdminPage = {
	/** Stored in the user's preferences; never change an existing ID. */
	id: string;
	label: string;
	path: string;
	/** Shown before its label in the Admin menu. */
	icon: LucideIcon;
};

type AdminPageAccess = {
	permissions: Permissions;
	/** The deployment offers OAuth2 applications. */
	oauth2Provider: boolean;
	canViewAISettings: boolean;
};

/**
 * The categories of General (the deployment settings), in the order of its
 * sidebar (DeploymentSidebarView) and with the same permissions.
 */
const ADMIN_PAGES: readonly (AdminPage & {
	allowed: (access: AdminPageAccess) => boolean;
})[] = [
	{
		id: "accounts",
		label: "Accounts",
		icon: UsersIcon,
		path: "/deployment/users",
		allowed: ({ permissions }) => permissions.viewAllUsers,
	},
	{
		id: "super-intelligence",
		label: "Super Intelligence",
		icon: BrainCircuitIcon,
		path: "/ai/settings",
		allowed: ({ canViewAISettings }) => canViewAISettings,
	},
	{
		id: "announcement",
		label: "Announcement",
		icon: MegaphoneIcon,
		path: "/deployment/announcement",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "authentication",
		label: "Authentication",
		icon: KeyRoundIcon,
		path: "/deployment/userauth",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "classification",
		label: "Classification",
		icon: TagIcon,
		path: "/deployment/classification",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "customize",
		label: "Customize",
		icon: PaletteIcon,
		path: "/deployment/customize",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "health",
		label: "Health",
		icon: HeartPulseIcon,
		path: WORKSPACE_HEALTH_PATH,
		allowed: ({ permissions }) => permissions.viewDebugInfo,
	},
	{
		id: "monitoring",
		label: "Monitoring",
		icon: ActivityIcon,
		path: "/deployment/monitoring",
		allowed: ({ permissions }) => permissions.editDeploymentConfig,
	},
	{
		id: "network",
		label: "Network",
		icon: NetworkIcon,
		path: "/deployment/network",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "notifications",
		label: "Notifications",
		icon: BellIcon,
		path: "/deployment/notifications",
		allowed: ({ permissions }) => permissions.viewNotificationTemplate,
	},
	{
		id: "oauth2-applications",
		label: "OAuth2 Applications",
		icon: AppWindowIcon,
		path: "/deployment/oauth2-provider/apps",
		allowed: ({ permissions, oauth2Provider }) =>
			permissions.viewDeploymentConfig && oauth2Provider,
	},
	{
		id: "observability",
		label: "Observability",
		icon: TelescopeIcon,
		path: "/deployment/observability",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "overview",
		label: "Overview",
		icon: LayoutDashboardIcon,
		path: "/deployment/overview",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "persistence",
		label: "Persistence",
		icon: DatabaseIcon,
		path: "/deployment/persistence",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
	{
		id: "security",
		label: "Security",
		icon: LockIcon,
		path: "/deployment/security",
		allowed: ({ permissions }) => permissions.viewDeploymentConfig,
	},
];

/** The admin pages this user can open, in the order the add menu lists them. */
export const adminPagesFor = (access: AdminPageAccess): AdminPage[] =>
	ADMIN_PAGES.filter((page) => page.allowed(access)).map(
		({ allowed: _allowed, ...page }) => page,
	);

/**
 * The user's quick links, in their order: the pages they chose that they can
 * still open, each once. None until they add some.
 */
export const resolveAdminQuickLinks = (
	chosen: readonly string[],
	pages: readonly AdminPage[],
): AdminPage[] => {
	const used = new Set<string>();
	const links: AdminPage[] = [];
	for (const id of chosen) {
		const page = pages.find((p) => p.id === id);
		if (page && !used.has(page.id)) {
			used.add(page.id);
			links.push(page);
		}
	}
	return links.slice(0, MaxAdminQuickLinks);
};

/** The pages that can still be added: those not linked yet, in sidebar order. */
export const addableAdminPages = (
	links: readonly AdminPage[],
	pages: readonly AdminPage[],
): AdminPage[] =>
	links.length >= MaxAdminQuickLinks
		? []
		: pages.filter((page) => !links.some((link) => link.id === page.id));

/** The paths of each category beyond its own (its subpages are matched too). */
const CATEGORY_PREFIXES: Record<string, readonly string[]> = {
	"super-intelligence": ["/ai/settings", "/deployment/agents"],
	health: ["/health"],
	"oauth2-applications": ["/deployment/oauth2-provider"],
};

/**
 * The category of General a page belongs to (for the breadcrumb), e.g.
 * Health for /health/user-quota; null for pages outside the categories.
 */
export const adminCategory = (pathname: string): AdminPage | null => {
	const under = (prefix: string) =>
		pathname === prefix || pathname.startsWith(`${prefix}/`);
	const page = ADMIN_PAGES.find((p) =>
		[p.path, ...(CATEGORY_PREFIXES[p.id] ?? [])].some(under),
	);
	if (!page) {
		return null;
	}
	const { allowed: _allowed, ...category } = page;
	return category;
};

/** The category's label, e.g. "Health" for /health/user-quota. */
export const adminCategoryLabel = (pathname: string): string | null =>
	adminCategory(pathname)?.label ?? null;

/** A category's icon (the one its quick link shows), by its ID. */
export const adminPageIcon = (id: string): LucideIcon | undefined =>
	ADMIN_PAGES.find((page) => page.id === id)?.icon;
