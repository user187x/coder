import { cn } from "cn";
import {
	ChevronLeftIcon,
	Maximize2Icon,
	Minimize2Icon,
	MinusIcon,
	PictureInPicture2Icon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "#/components/Button/Button";
import { ChatAvatar } from "./ChatAvatar";
import { ChatConversation, type ConversationActions } from "./ChatConversation";
import {
	ChatHeading,
	ChatList,
	ChatOnSwitch,
	ConsoleButton,
	DockButton,
} from "./ChatPanel";
import { ConversationMenu, CountBadge } from "./ChatWindow";
import {
	type ChatWindowState,
	closePanelView,
	displayName,
	exitFullScreen,
	markRead,
	selectInPanel,
	setDockMode,
	unreadTotal,
	useChatSnapshot,
} from "./chatStore";

type AttachedProps = {
	/** The dock, left out of screenshots. */
	dock: React.RefObject<HTMLElement | null>;
};

/** From the navbar's bottom down to the bottom bars (ChatDock measures both). */
const BELOW_NAVBAR: React.CSSProperties = {
	top: "var(--chat-top, 0px)",
	bottom: "var(--chat-bottom, 0px)",
};

const headerClass =
	"flex h-11 shrink-0 items-center gap-2 border-0 border-b border-solid border-border pl-3.5 pr-1 text-[13px] font-semibold";

/**
 * The chat attached to the right side: a panel from the navbar's bottom down
 * to the bottom bars, which the page narrows beside on a wide screen
 * (chatDock.css). Its list, and the conversation picked from it, live in it
 * rather than in windows. It stays where it is - clicks elsewhere and Escape
 * leave it be - until it is detached (back to the raised window), goes full
 * screen or is minimized to the bar. It comes back attached on the next page
 * load (initialDockMode).
 */
export const ChatSidePanel: React.FC<AttachedProps> = ({ dock }) => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const view = state.panelView;
	return (
		<section
			aria-label="Chats side panel"
			data-testid="chat-side-panel"
			className="fixed right-0 flex w-[min(380px,100vw)] flex-col border-0 border-l border-solid border-border bg-surface-primary shadow-[-8px_0_28px_rgb(0_0_0/.12)] animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
			style={BELOW_NAVBAR}
		>
			<header className={headerClass}>
				<ChatHeading />
				{me.admin && <ChatOnSwitch className="px-1" />}
				{me.admin && <ConsoleButton peer={view?.peer} />}
				<DockButton
					label="Detach into a window"
					testId="chat-mode-detach"
					onClick={() => setDockMode("window")}
				>
					<PictureInPicture2Icon />
				</DockButton>
				<DockButton
					label="Full screen"
					testId="chat-mode-fullscreen"
					onClick={() => setDockMode("full")}
				>
					<Maximize2Icon />
				</DockButton>
				<DockButton
					label="Minimize"
					testId="chat-mode-minimize"
					onClick={() => setDockMode("bar")}
				>
					<MinusIcon />
				</DockButton>
			</header>
			{view ? (
				<PanelConversation
					view={view}
					dock={dock}
					onBack={closePanelView}
					onEscape={closePanelView}
				/>
			) : (
				<ChatList
					onOpen={(peer) => selectInPanel(peer, true)}
					className="min-h-0 flex-1"
				/>
			)}
		</section>
	);
};

/**
 * The chat over the page below the navbar, like a messenger: the list on the
 * left, the conversation picked from it on the right (on a narrow screen one
 * at a time). Exit full screen, or Escape, goes back to the raised window or
 * the side panel, whichever it came from; so does going to another page
 * (ChatDock).
 */
export const ChatFullScreen: React.FC<AttachedProps> = ({ dock }) => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const view = state.panelView;
	return (
		<section
			role="dialog"
			aria-label="Chats full screen"
			// The quick access wheel leaves Escape to an open dialog (RadialMenu's POPUPS): here it ends full screen.
			data-state="open"
			data-testid="chat-fullscreen"
			className="fixed inset-x-0 flex flex-col bg-surface-primary animate-in fade-in-0 duration-150 motion-reduce:animate-none"
			style={BELOW_NAVBAR}
		>
			<header className={cn(headerClass, "bg-surface-secondary pl-4")}>
				<ChatHeading />
				{me.admin && <ChatOnSwitch className="px-1" />}
				{me.admin && <ConsoleButton peer={view?.peer} />}
				<DockButton
					label="Exit full screen"
					title="Exit full screen (Escape)"
					testId="chat-mode-exit-fullscreen"
					onClick={exitFullScreen}
				>
					<Minimize2Icon />
				</DockButton>
			</header>
			<div className="grid min-h-0 flex-1 grid-rows-1 sm:grid-cols-[minmax(240px,320px)_1fr]">
				<ChatList
					onOpen={(peer) => selectInPanel(peer, true)}
					selectedId={view?.peer.id}
					className={cn(
						"min-h-0 border-0 border-solid border-border sm:border-r",
						view && "max-sm:hidden",
					)}
				/>
				{view ? (
					<PanelConversation
						view={view}
						dock={dock}
						onBack={closePanelView}
						backClassName="sm:hidden"
					/>
				) : (
					<p className="m-auto p-4 text-sm text-content-secondary max-sm:hidden">
						Pick a conversation to read it here.
					</p>
				)}
			</div>
		</section>
	);
};

type PanelConversationProps = AttachedProps & {
	view: ChatWindowState;
	/** Back to the list (in full screen only where the list is not beside it). */
	onBack: () => void;
	backClassName?: string;
	/** Escape in the message box (the side panel: back to the list; full screen ends on it instead). */
	onEscape?: () => void;
};

/** The conversation open in the side panel or full screen: who it is with, its menu, and the conversation itself. */
const PanelConversation: React.FC<PanelConversationProps> = ({
	view,
	dock,
	onBack,
	backClassName,
	onEscape,
}) => {
	const state = useChatSnapshot();
	const [shooting, setShooting] = useState(false);
	const actions = useRef<ConversationActions>(null);
	const peer = view.peer;
	// Unread elsewhere: shown on the way back to the list.
	const elsewhere =
		unreadTotal(state) - (state.conversations.get(peer.id)?.unread ?? 0);

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			onPointerDown={() => markRead(peer.id, true)}
		>
			<div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border py-1 pr-1 pl-1.5">
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
				<ConversationMenu peer={peer} actions={actions} shooting={shooting} />
			</div>
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
