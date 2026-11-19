import { useQuery } from "react-query";
import { inboxNotifications } from "#/api/queries/notifications";
import { userUIPreferences } from "#/api/queries/platform";
import {
	unreadTotal,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";

/** Dock layouts in which the chat's conversations are on screen. */
const CHAT_SHOWN = new Set(["window", "side", "full"]);

/**
 * Whether the Settings chevron glows: unread chat messages or notifications are waiting while the chat is not on
 * screen (hidden, or folded to its bar, and not open in the Settings menu's Chat face), so the user knows to look in
 * Settings. The user turns it off from the Chat face's header (settings_unread_glow: false).
 */
export const useUnreadGlow = () => {
	const preferences = useQuery(userUIPreferences());
	const chat = useChatSnapshot();
	const inbox = useQuery({ ...inboxNotifications(), retry: false });
	const on = preferences.data?.settings_unread_glow !== false;
	const chatShown =
		!preferences.data?.chat_hidden &&
		(chat.menuOpen || CHAT_SHOWN.has(chat.dockMode));
	const enabled = on && !chatShown;
	return {
		chat: enabled && unreadTotal(chat) > 0,
		notifications: enabled && (inbox.data?.unread_count ?? 0) > 0,
	};
};

export type UnreadGlow = ReturnType<typeof useUnreadGlow>;

/** Highlights just the Settings destination responsible for an unread signal. */
export const unreadRowClass = (id: string, glow?: UnreadGlow) =>
	((id === "chat" && glow?.chat) ||
		(id === "notifications" && glow?.notifications)) &&
	"settings-unread-row";
