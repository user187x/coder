import { cn } from "cn";
import { ChevronLeftIcon, TrashIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { ChatAvatar } from "./ChatAvatar";
import { ChatConversation, type ConversationActions } from "./ChatConversation";
import { ConversationMenu, CountBadge } from "./ChatWindow";
import {
	type ChatWindowState,
	displayName,
	markRead,
	unreadTotal,
	useChatSnapshot,
} from "./chatStore";

type PanelConversationProps = {
	actionsRef?: React.RefObject<ConversationActions | null>;
	dock: React.RefObject<HTMLElement | null>;
	view: ChatWindowState;
	/** Back to the list (in full screen only where the list is not beside it). */
	onBack: () => void;
	backClassName?: string;
	/** Escape in the message box (the side panel: back to the list; full screen ends on it instead). */
	onEscape?: () => void;
};

/** The conversation open in the side panel or full screen: who it is with, its menu, and the conversation itself. */
export const PanelConversation: React.FC<PanelConversationProps> = ({
	view,
	dock,
	onBack,
	backClassName,
	onEscape,
	actionsRef,
}) => {
	const state = useChatSnapshot();
	const [shooting, setShooting] = useState(false);
	const localActions = useRef<ConversationActions>(null);
	const actions = actionsRef ?? localActions;
	const peer = view.peer;
	// Unread elsewhere: shown on the way back to the list.
	const elsewhere =
		unreadTotal(state) - (state.conversations.get(peer.id)?.unread ?? 0);

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			onPointerDown={() => markRead(peer.id, true)}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						role="group"
						aria-label={`Conversation with ${displayName(peer)}`}
						className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border py-1 pr-1 pl-1.5"
					>
						<span className={cn("flex shrink-0 items-center", backClassName)}>
							<Button
								variant="subtle"
								size="icon"
								aria-label={
									elsewhere
										? `Back to the chats, ${elsewhere} unread`
										: "Back to the chats"
								}
								title="Back to the chats"
								data-testid="chat-panel-back"
								onClick={onBack}
							>
								<ChevronLeftIcon />
							</Button>
							{elsewhere > 0 && <CountBadge count={elsewhere} />}
						</span>
						<ChatAvatar peer={peer} />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-semibold">
								{displayName(peer)}
							</span>
							<span className="truncate text-xs text-content-secondary">
								@{peer.username}
							</span>
						</span>
						<ConversationMenu
							peer={peer}
							actions={actions}
							shooting={shooting}
						/>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent className="z-[110]">
					<ContextMenuItem
						className="text-content-destructive"
						onSelect={() => actions.current?.askDelete()}
					>
						<TrashIcon />
						Delete conversation
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<ChatConversation
				ref={actions}
				view={view}
				dock={dock}
				className="min-h-0 flex-1"
				onEscape={onEscape}
				onShootingChange={setShooting}
			/>
		</div>
	);
};
