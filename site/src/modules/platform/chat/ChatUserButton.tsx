import { ChevronDownIcon, CrosshairIcon } from "lucide-react";
import { useState } from "react";
import type { User } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { openChatWith, useChatSnapshot } from "./chatStore";
import { ForcedFocusDialog } from "./ForcedFocusDialog";
import { useChatEnabled } from "./useChatEnabled";
import "./chatUserButton.css";

type ChatUserButtonProps = {
	user: Pick<
		User,
		"id" | "username" | "name" | "is_service_account" | "status"
	>;
};

/**
 * Admin > Accounts: start a conversation with this user, or - from its menu - send them a message with Forced Focus
 * (in front of everything on their dashboard until they acknowledge it). Admins only; not for service accounts,
 * suspended users, and not in your own row.
 */
export const ChatUserButton: React.FC<ChatUserButtonProps> = ({ user }) => {
	const { me, conversations } = useChatSnapshot();
	// What this user wrote that the admin has not read: the button pulses until the conversation is opened.
	const unread = conversations.get(user.id)?.unread ?? 0;
	const [forcing, setForcing] = useState(false);

	const chatOn = useChatEnabled();
	if (!chatOn || !me?.admin || me.id === user.id) return null;
	if (user.is_service_account || user.status === "suspended")
		return (
			<span
				title={
					user.is_service_account
						? "Service accounts cannot receive chat messages"
						: "This account is suspended"
				}
			>
				<Button size="sm" variant="subtle" disabled>
					Chat
				</Button>
			</span>
		);
	const peer = { id: user.id, username: user.username, name: user.name ?? "" };

	return (
		<span
			className="chat-user-button inline-flex h-7 shrink-0 items-stretch rounded-md border border-solid border-border-default bg-transparent focus-within:ring-2 focus-within:ring-content-link"
			data-unread={unread > 0 || undefined}
		>
			<Button
				size="sm"
				variant="subtle"
				className="h-full min-w-0 rounded-r-none px-2"
				aria-label={`Chat with ${user.username}${unread > 0 ? `, ${unread} unread` : ""}`}
				onClick={(event) => {
					// The row itself opens the user's workspace.
					event.stopPropagation();
					void openChatWith(peer);
				}}
			>
				Chat
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="subtle"
						className="h-full w-6 min-w-0 rounded-l-none border-0 border-l border-solid border-border-default px-1"
						aria-label={`More ways to message ${user.username}`}
						onClick={(event) => event.stopPropagation()}
						data-testid={`chat-more-${user.username}`}
					>
						<ChevronDownIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					onClick={(event) => event.stopPropagation()}
				>
					<DropdownMenuItem
						onSelect={() => setForcing(true)}
						data-testid="chat-forced-focus"
					>
						<CrosshairIcon />
						Forced Focus
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{forcing && (
				<ForcedFocusDialog peer={peer} onClose={() => setForcing(false)} />
			)}
		</span>
	);
};
