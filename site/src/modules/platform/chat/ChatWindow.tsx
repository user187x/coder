import {
	CameraIcon,
	CloudIcon,
	EllipsisVerticalIcon,
	PanelsTopLeftIcon,
	TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import type { ChatPeer } from "#/api/platform";
import { cloudDrivePeers } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { AskForCloudDriveDialog } from "#/modules/platform/cloudDrive/CloudDrivePeers";
import { ChatScreenShareMenuItem } from "../screenShare/ChatScreenShareMenuItem";
import type { ConversationActions } from "./ChatConversation";
import {
	displayName,
	isBlocked,
	openConsole,
	useChatSnapshot,
} from "./chatStore";

type ConversationMenuProps = {
	peer: ChatPeer;
	/** The conversation it acts on. */
	actions: React.RefObject<ConversationActions | null>;
	/** A screenshot is being taken. */
	shooting: boolean;
	/** Before Screenshot and Delete: what brings the conversation on screen (a minimized window expands). */
	onReveal?: () => void;
};

/**
 * A conversation's More menu, in its window and in the side panel or full
 * screen: a screenshot of the page for the next message, the conversation in
 * the chat console (admins), asking for the person's Cloud Drive (while admins
 * have sharing on), and deleting it.
 */
export const ConversationMenu: React.FC<ConversationMenuProps> = ({
	peer,
	actions,
	shooting,
	onReveal,
}) => {
	const state = useChatSnapshot();
	const blocked = isBlocked(state, peer.id);
	// Cloud Drives shared between users: asked for from here, while admins have it on (read when the menu opens).
	const [menuOpen, setMenuOpen] = useState(false);
	const [asking, setAsking] = useState(false);
	const peers = useQuery({
		...cloudDrivePeers(menuOpen && !peer.group),
		refetchInterval: false,
	});
	const canAsk =
		!peer.group && peer.id !== state.me?.id && peers.data?.settings.enabled;

	return (
		<>
			<DropdownMenu onOpenChange={setMenuOpen}>
				<DropdownMenuTrigger asChild>
					<Button variant="subtle" size="icon" aria-label="More" title="More">
						<EllipsisVerticalIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="z-[70] w-[236px]">
					<DropdownMenuItem
						disabled={blocked || shooting}
						onSelect={() => {
							onReveal?.();
							// The conversation mounts when the window expands.
							window.setTimeout(() => actions.current?.screenshot());
						}}
					>
						<CameraIcon />
						Screenshot
					</DropdownMenuItem>
					{!peer.group && (
						<ChatScreenShareMenuItem
							peer={peer.id}
							disabled={blocked}
							admin={Boolean(state.me?.admin)}
						/>
					)}
					{state.me?.admin && (
						<DropdownMenuItem
							onSelect={() => openConsole(peer)}
							data-testid="chat-window-open-console"
						>
							<PanelsTopLeftIcon />
							Open in the chat console
						</DropdownMenuItem>
					)}
					{canAsk && (
						<DropdownMenuItem
							onSelect={() => setAsking(true)}
							data-testid="chat-ask-cloud-drive"
						>
							<CloudIcon />
							Ask for their Cloud Drive
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						className="text-content-destructive"
						onSelect={() => {
							onReveal?.();
							window.setTimeout(() => actions.current?.askDelete());
						}}
					>
						<TrashIcon />
						Delete conversation
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{asking && (
				<AskForCloudDriveDialog
					owner={{ id: peer.id, name: displayName(peer) }}
					onClose={() => setAsking(false)}
				/>
			)}
		</>
	);
};

export const CountBadge: React.FC<{ count: number }> = ({ count }) => (
	<span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-red px-1 text-[11px] leading-none font-semibold text-highlight-red">
		{count > 99 ? "99+" : count}
	</span>
);
