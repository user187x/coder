import type { User } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { openChatWith, useChatSnapshot } from "./chatStore";

type ChatUserButtonProps = {
	user: Pick<
		User,
		"id" | "username" | "name" | "is_service_account" | "status"
	>;
};

/**
 * Admin > Accounts: start a conversation with this user. Admins only; not for
 * service accounts, suspended users or yourself.
 */
export const ChatUserButton: React.FC<ChatUserButtonProps> = ({ user }) => {
	const { me } = useChatSnapshot();

	if (
		!me?.admin ||
		me.id === user.id ||
		user.is_service_account ||
		user.status === "suspended"
	) {
		return null;
	}

	return (
		<Button
			size="sm"
			variant="outline"
			aria-label={`Chat with ${user.username}`}
			onClick={(event) => {
				// The row itself opens the user's workspace.
				event.stopPropagation();
				void openChatWith({
					id: user.id,
					username: user.username,
					name: user.name ?? "",
				});
			}}
		>
			Chat
		</Button>
	);
};
