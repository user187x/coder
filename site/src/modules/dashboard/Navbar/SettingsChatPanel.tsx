import { cn } from "cn";
import {
	BellRingIcon,
	Maximize2Icon,
	Minimize2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import type { ConversationActions } from "#/modules/platform/chat/ChatConversation";
import { ChatList, ChatOnSwitch } from "#/modules/platform/chat/ChatPanel";
import {
	type ChatLink,
	closePanelView,
	selectInPanel,
	setChatMenuOpen,
	useChatConnection,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";
import { PanelConversation } from "#/modules/platform/chat/PanelConversation";

/**
 * A compact conversation surface using the same history, uploads, and sharing controls as the dock. With
 * `onExpandedChange`, its header has a button that grows it over the Settings menu below the menu's header row and back.
 */
export const SettingsChatPanel = ({
	onClose,
	expanded = false,
	onExpandedChange,
}: {
	onClose: () => void;
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
}) => {
	const actions = useRef<ConversationActions>(null);
	const state = useChatSnapshot();
	useChatConnection(true);
	useEffect(() => {
		setChatMenuOpen(true);
		return () => setChatMenuOpen(false);
	}, []);
	return (
		<div
			role="region"
			aria-label="Quick chat"
			data-settings-chat
			// It fills its face of the Settings panel's bottom panel, the faces' one height, inside its border.
			className="settings-compact-chat flex h-full min-h-[220px] min-w-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary"
			onKeyDown={(event) => event.stopPropagation()}
		>
			<header className="flex h-9 shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-2">
				<ChatLinkStatus link={state.link} />
				<UnreadGlowDimple />
				<strong className="flex-1 text-xs">Enable Messaging</strong>
				{state.me?.admin && <ChatOnSwitch className="h-8" />}
				{onExpandedChange && (
					<Button
						size="icon"
						variant="subtle"
						aria-label={expanded ? "Restore quick chat" : "Expand quick chat"}
						aria-pressed={expanded}
						onClick={() => onExpandedChange(!expanded)}
					>
						{expanded ? <Minimize2Icon /> : <Maximize2Icon />}
					</Button>
				)}
				<Button
					size="icon"
					variant="subtle"
					aria-label="Dismiss quick chat"
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</header>
			{!state.me ? (
				<p className="px-3 text-xs text-content-secondary">
					Connecting to chat…
				</p>
			) : state.panelView ? (
				<PanelConversation
					actionsRef={actions}
					compact
					key={state.panelView.peer.id}
					view={state.panelView}
					onBack={closePanelView}
					onEscape={closePanelView}
				/>
			) : (
				<ChatList
					className="min-h-0 flex-1 pb-2 text-xs"
					onOpen={(peer) => selectInPanel(peer, true)}
					onSendFile={(peer) => {
						flushSync(() => selectInPanel(peer, true));
						actions.current?.chooseFile();
					}}
				/>
			)}
		</div>
	);
};

const LINK: Record<ChatLink, { label: string; note: string; dot: string }> = {
	connecting: {
		label: "Connecting",
		note: "Connecting to chat.",
		dot: "bg-content-secondary animate-pulse",
	},
	connected: {
		label: "Connected",
		note: "Chat is connected.",
		dot: "bg-content-success",
	},
	degraded: {
		label: "Degraded",
		note: "Chat is having trouble reaching Coder and is retrying. Messages may be slow or fail to send.",
		dot: "bg-content-warning",
	},
	disconnected: {
		label: "Disconnected",
		note: "Chat cannot reach Coder. Messages will not send until it reconnects.",
		dot: "bg-content-destructive",
	},
	broken: {
		label: "Broken",
		note: "Chat is failing on Coder's side. Messages will not send.",
		dot: "bg-content-destructive",
	},
	off: {
		label: "Off",
		note: "An admin turned chat off.",
		dot: "bg-content-secondary",
	},
};

/**
 * The chat's link to Coder: a dot, with its word once it is not connected, so a failing chat says so before anyone
 * types into it.
 */
const ChatLinkStatus: React.FC<{ link: ChatLink }> = ({ link }) => {
	const { label, note, dot } = LINK[link];
	return (
		<span
			role="status"
			aria-label={`Chat ${label}: ${note}`}
			title={note}
			className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-content-secondary"
		>
			<span aria-hidden className={cn("size-2 rounded-full", dot)} />
			{link !== "connected" && <span aria-hidden>{label}</span>}
		</span>
	);
};

/**
 * A dimple in the header: whether the Settings chevron glows while unread chats or notifications wait and the chat is
 * not on screen (useUnreadGlow).
 */
const UnreadGlowDimple: React.FC = () => {
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(client));
	const on = preferences.data?.settings_unread_glow !== false;
	return (
		<button
			type="button"
			aria-pressed={on}
			aria-label="Glow the Settings chevron for unread messages"
			title={
				on
					? "The Settings chevron glows for unread messages: turn it off"
					: "Glow the Settings chevron for unread messages"
			}
			disabled={!preferences.isSuccess || save.isPending}
			onClick={() => save.mutate({ settings_unread_glow: on ? false : null })}
			className={cn("settings-glow-dimple", on && "settings-glow-dimple-on")}
		>
			<BellRingIcon aria-hidden className="size-3" />
		</button>
	);
};
