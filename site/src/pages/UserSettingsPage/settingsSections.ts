import {
	AppWindowIcon,
	BellIcon,
	CalendarClockIcon,
	CircleUserIcon,
	FileKeyIcon,
	KeySquareIcon,
	LockIcon,
	PaletteIcon,
	PlugIcon,
	TicketIcon,
	VaultIcon,
} from "lucide-react";

/** Route labels and glyphs shared by the personal settings rail, breadcrumb and card headers. */
export const settingsSections = {
	account: { label: "Account", icon: CircleUserIcon },
	"oauth2-provider": { label: "OAuth2 Applications", icon: AppWindowIcon },
	schedule: { label: "Schedule", icon: CalendarClockIcon },
	security: { label: "Security", icon: LockIcon },
	"ssh-keys": { label: "SSH Keys", icon: KeySquareIcon },
	tokens: { label: "Tokens", icon: TicketIcon },
	integration: { label: "Integration", icon: PlugIcon },
	secrets: { label: "Secrets", icon: VaultIcon },
	certificates: { label: "Certificates", icon: FileKeyIcon },
	notifications: { label: "Notifications", icon: BellIcon },
	appearance: { label: "Appearance", icon: PaletteIcon },
};
export type UserSettingsSection = keyof typeof settingsSections;
