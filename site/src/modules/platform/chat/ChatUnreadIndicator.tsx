import { cn } from "cn";
import { Link } from "react-router";
import { CountBadge } from "./ChatWindow";
import { unreadTotal, useChatSnapshot } from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";

/**
 * The unread chat messages, at the right of Controls › Settings' Chat entry (one more place that tells of new
 * messages, beside the Chats panel, its windows and the bell). Nothing while none are unread.
 */
export const ChatUnreadIndicator: React.FC<{ className?: string }> = ({
	className,
}) => {
	const state = useChatSnapshot();
	const total = unreadTotal(state);
	if (!state.me?.admin || total === 0) {
		return null;
	}
	return (
		<Link
			to={CHAT_CONSOLE_PAGE}
			className={cn("inline-flex no-underline", className)}
			aria-label={`${total} unread chat ${total === 1 ? "message" : "messages"}`}
			title={`${total} unread chat ${total === 1 ? "message" : "messages"}`}
			data-testid="chat-unread-indicator"
		>
			<CountBadge count={total} />
		</Link>
	);
};
