import {
	BriefcaseIcon,
	CircleUserIcon,
	ContainerIcon,
	EyeIcon,
	FileTextIcon,
	type LucideIcon,
	MessagesSquareIcon,
} from "lucide-react";
import {
	type AdminPageAccess,
	adminPageChoices,
} from "#/modules/dashboard/Navbar/adminQuickLinks";
import { canViewDeploymentSettings } from "#/modules/permissions";

/**
 * A choice for a wedge of the quick access wheel (Escape): one of the dashboard's own pages, or a category of
 * Admin Settings (the same categories, labels, icons and permissions as its sidebar). Stored by its ID (Admin
 * Settings > Quick Menu): never change an existing one.
 */
export type WheelChoice = {
	id: string;
	label: string;
	icon: LucideIcon;
	/** Where it goes; chat: the chat console for admins, the Chats panel for the others. */
	to?: string;
	chat?: true;
	group: "dashboard" | "admin";
	/** Who may open it; the others see the wedge dimmed. */
	allowed: (access: AdminPageAccess) => boolean;
};

const everyone = () => true;

const DASHBOARD: readonly WheelChoice[] = [
	{
		id: "workspaces",
		label: "Workspaces",
		icon: BriefcaseIcon,
		to: "/workspaces",
		group: "dashboard",
		allowed: everyone,
	},
	{
		id: "templates",
		label: "Templates",
		icon: FileTextIcon,
		to: "/templates",
		group: "dashboard",
		allowed: everyone,
	},
	// the Resources menu's icon for it
	{
		id: "images",
		label: "Images",
		icon: ContainerIcon,
		to: "/images",
		group: "dashboard",
		// Platform: the admins' alone
		allowed: ({ permissions }) => Boolean(permissions.editDeploymentConfig),
	},
	{
		id: "account",
		label: "Account",
		icon: CircleUserIcon,
		to: "/settings/account",
		group: "dashboard",
		allowed: everyone,
	},
	{
		id: "chat",
		label: "Chat",
		icon: MessagesSquareIcon,
		chat: true,
		group: "dashboard",
		allowed: everyone,
	},
	{
		id: "hud",
		label: "HUD",
		icon: EyeIcon,
		to: "/hud",
		group: "dashboard",
		allowed: ({ permissions }) => canViewDeploymentSettings(permissions),
	},
];

/** The wheel's label where a category's would not fit a wedge. */
const SHORT: Record<string, string> = { "oauth2-applications": "OAuth2 Apps" };

/** Every choice: the dashboard's pages, then every category of Admin Settings (Chat is the dashboard's: both ways). */
export const wheelChoices = (): WheelChoice[] => [
	...DASHBOARD,
	...adminPageChoices()
		.filter((page) => !DASHBOARD.some((d) => d.id === page.id))
		.map((page) => ({
			id: page.id,
			label: SHORT[page.id] ?? page.label,
			icon: page.icon,
			to: page.path,
			group: "admin" as const,
			allowed: page.allowed,
		})),
];

/** The wheel until admins arrange it (the eight of radial-menu.html). */
export const DEFAULT_WHEEL: readonly string[] = [
	"workspaces",
	"templates",
	"images",
	"accounts",
	"account",
	"chat",
	"announcement",
	"hud",
];

/** How many wedges the wheel takes. */
export const WHEEL_WEDGES = { least: 3, most: 12 } as const;

/** The wheel's wedges from the saved choices: unknown ones left out; none (or too few known): the default wheel. */
export const wheelOf = (ids: readonly string[] | null | undefined) => {
	const all = wheelChoices();
	const pick = (list: readonly string[]) =>
		list
			.map((id) => all.find((choice) => choice.id === id))
			.filter((choice): choice is WheelChoice => Boolean(choice))
			.slice(0, WHEEL_WEDGES.most);
	const chosen = pick(ids ?? []);
	return chosen.length >= WHEEL_WEDGES.least ? chosen : pick(DEFAULT_WHEEL);
};
