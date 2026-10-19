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

type ChatUserButtonProps = {
	user: Pick<
		User,
		"id" | "username" | "name" | "is_service_account" | "status"
	>;
};

/**
 * Admin > Accounts: start a conversation with this user, or - from its menu - send them a message with Forced Focus
 * (in front of everything on their dashboard until they acknowledge it). Admins only; not for service accounts,
 * suspended users or yourself.
 */
export const ChatUserButton: React.FC<ChatUserButtonProps> = ({ user }) => {
	const { me } = useChatSnapshot();
	const [forcing, setForcing] = useState(false);

	if (
		!me?.admin ||
		me.id === user.id ||
		user.is_service_account ||
		user.status === "suspended"
	) {
		return null;
	}
	const peer = { id: user.id, username: user.username, name: user.name ?? "" };

	return (
		<span className="inline-flex">
			<Button
				size="sm"
				variant="outline"
				className="rounded-r-none"
				aria-label={`Chat with ${user.username}`}
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
						variant="outline"
						className="-ml-px rounded-l-none px-1.5"
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
