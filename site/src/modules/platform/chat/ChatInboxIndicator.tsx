import { cn } from "cn";
import { openUnreadChats, unreadTotal, useChatSnapshot } from "./chatStore";

/**
 * Unread chat messages, at the bottom-right corner of the navbar's inbox bell
 * (Coder's own notification count stays at its top-right). A click opens the
 * unread conversations instead of the inbox.
 */
export const ChatInboxIndicator: React.FC = () => {
	const state = useChatSnapshot();
	const unread = unreadTotal(state);

	if (!unread) {
		return null;
	}

	return (
		<button
			type="button"
			onClick={() => {
				void openUnreadChats();
			}}
			aria-label={`${unread} unread chat ${unread === 1 ? "message" : "messages"}: open them`}
			title="New chat messages: open them"
			className={cn(
				"absolute right-0 bottom-0 z-10 translate-x-[35%] translate-y-[35%]",
				"inline-flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-full border-0 px-1",
				"bg-surface-red text-highlight-red text-[10px] leading-none font-bold shadow-[0_0_0_2px_hsl(var(--surface-primary))]",
				"animate-in zoom-in-0 duration-500",
			)}
		>
			{Math.min(unread, 99)}
		</button>
	);
};
