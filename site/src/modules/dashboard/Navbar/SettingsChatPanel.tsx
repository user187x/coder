import { Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { Button } from "#/components/Button/Button";
import type { ConversationActions } from "#/modules/platform/chat/ChatConversation";
import { ChatList, ChatOnSwitch } from "#/modules/platform/chat/ChatPanel";
import {
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
