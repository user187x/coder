import { cn } from "cn";
import {
	ChevronUpIcon,
	Maximize2Icon,
	MessageSquareIcon,
	Minimize2Icon,
	MinusIcon,
	PanelRightIcon,
	PanelsTopLeftIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import type { ChatPeer } from "#/api/platform";
import { chatAdmins } from "#/api/queries/platform";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
import { navbarTileTriggerClass } from "#/modules/dashboard/Navbar/NavbarLogo";
import { ChatAvatar } from "./ChatAvatar";
import { ChatPeople } from "./ChatPeople";
import { CountBadge } from "./ChatWindow";
import {
	displayName,
	hasRecentConversation,
	markRead,
	noAdminAvailable,
	openChatWith,
	openConsoleOverlay,
	setChatOn,
	setDockMode,
	unreadTotal,
	useChatSnapshot,
	windowsBeside,
} from "./chatStore";

const LISTED_CONVERSATIONS = 15;
/** The raised window: Gmail's chat window, within the room under the navbar (ChatDock measures it). */
const RAISED_HEIGHT = "min(520px, var(--chat-space, 520px))";
/** The bar alone: its 44 px and the card's border. */
const BAR_HEIGHT = "46px";

/**
 * The "Chats" panel at the far right, Gmail style: a bar at the bottom of the
 * window that rises into a small chat window (and back down), listing the
 * recent conversations to open one in a window beside it. From the window the
 * chat attaches to the right side or goes full screen (ChatAttached). For
 * everyone who is not an admin it is also their line to support, listing the
 * admins to write to, and, when the admins turn peer-to-peer chat on, the
 * People online or active today (ChatPeople) with their own visible /
 * invisible switch. Admins have an on/off switch beside the title (developers
 * only write to admins with chat on), and a button that brings the chat console
 * (ChatConsole) up over the page, the rest blurred (ChatConsoleOverlay).
 */
export const ChatPanel: React.FC = () => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const raised = state.dockMode === "window";
	const total = unreadTotal(state);
	const none = noAdminAvailable(state);

	if (state.dockMode === "compact") {
		return (
			<RestoreChatButton total={total} onRestore={() => setDockMode("bar")} />
		);
	}

	// Beside the raised window when there is room; on a narrow screen above the bar, the window lowered.
	const open = (peer: ChatPeer) => {
		if (!windowsBeside()) {
			setDockMode("bar");
		}
		void openChatWith(peer).then(() => markRead(peer.id, true));
	};

	return (
		<div
			data-chat-panel=""
			data-testid={raised ? "chat-window-raised" : "chat-bar"}
			// Platform: a card floating clear of the page's bottom bar (ChatDock lifts it), rounded all round; it rises from its bottom edge
			className="flex w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border border-solid border-border bg-surface-primary shadow-[0_8px_28px_rgb(0_0_0/.16),0_1px_3px_rgb(0_0_0/.08)] transition-[height] duration-250 ease-out motion-reduce:transition-none"
			style={{ height: raised ? RAISED_HEIGHT : BAR_HEIGHT }}
		>
			<div
				className={cn(
					"flex shrink-0 items-center bg-surface-primary",
					raised && "border-0 border-b border-solid border-border pr-1",
				)}
			>
				<button
					type="button"
					aria-expanded={raised}
					aria-disabled={none}
					aria-label={total ? `Chats, ${total} unread` : panelTitle(state)}
					title={
						none
							? "No admin is taking chats right now"
							: raised
								? "Minimize"
								: undefined
					}
					onClick={() => setDockMode(raised ? "bar" : "window")}
					className={cn(
						"flex h-11 min-w-0 flex-1 items-center gap-2 border-0 bg-transparent pl-3.5 pr-2 text-left text-[13px] font-semibold text-inherit",
						none
							? "cursor-not-allowed opacity-50 grayscale"
							: "cursor-pointer hover:bg-surface-tertiary",
					)}
				>
					<ChatHeading />
					{!raised && (
						<ChevronUpIcon className="size-3.5 shrink-0 text-content-secondary" />
					)}
				</button>
				{raised ? (
					<>
						{me.admin && <ChatOnSwitch className="px-1.5" />}
						{me.admin && <ConsoleButton />}
						<DockButton
							label="Attach to the right side"
							testId="chat-mode-attach"
							onClick={() => setDockMode("side")}
						>
							<PanelRightIcon />
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
					</>
				) : (
					<>
						{me.admin && (
							<button
								type="button"
								onClick={() => openConsoleOverlay()}
								aria-label="Open the chat console"
								title="Open the chat console over this page"
								data-testid="chat-open-console"
								className="inline-flex h-11 shrink-0 cursor-pointer items-center border-0 bg-transparent px-1.5 text-content-secondary hover:text-content-primary"
							>
								<PanelsTopLeftIcon className="size-4" />
							</button>
						)}
						{me.admin && <ChatOnSwitch className="pr-3.5 pl-1.5" />}
						<DockButton
							label="Hide chat bar"
							testId="chat-mode-compact"
							onClick={() => setDockMode("compact")}
						>
							<Minimize2Icon />
						</DockButton>
					</>
				)}
			</div>
			{raised && <ChatList onOpen={open} className="min-h-0 flex-1" />}
		</div>
	);
};

const panelTitle = (state: ReturnType<typeof useChatSnapshot>) =>
	noAdminAvailable(state)
		? "Chat unavailable"
		: state.me?.admin || state.peers || hasRecentConversation(state)
			? "Chats"
			: "Chat with an admin";

/** The chat's title, in the bar and every header: "Chats" (or what a developer may do) and the unread count. */
export const ChatHeading: React.FC = () => {
	const state = useChatSnapshot();
	const total = unreadTotal(state);
	const dim = Boolean(state.me?.admin && !state.me.chatOn);
	return (
		<>
			<MessageSquareIcon
				className={cn(
					"size-3.5 shrink-0 text-content-secondary",
					dim && "opacity-55",
				)}
			/>
			<span className={cn("min-w-0 flex-1 truncate", dim && "opacity-55")}>
				{panelTitle(state)}
			</span>
			{total > 0 ? (
				<CountBadge count={total} />
			) : (
				!noAdminAvailable(state) && (
					<span
						className="shrink-0 text-xs font-normal text-content-secondary"
						data-testid="chat-unread"
					>
						0 unread
					</span>
				)
			)}
		</>
	);
};

/** An admin's own switch: off = developers can't write to them. */
export const ChatOnSwitch: React.FC<{ className?: string }> = ({
	className,
}) => {
	const { me } = useChatSnapshot();
	if (!me) {
		return null;
	}
	const label = me.chatOn
		? "Chat is on: developers can message you. Click to turn it off."
		: "Chat is off: developers can't message you. Click to turn it on.";
	return (
		<button
			type="button"
			role="switch"
			aria-checked={me.chatOn}
			aria-label={label}
			title={label}
			onClick={() => {
				void setChatOn(!me.chatOn);
			}}
			className={cn(
				"inline-flex h-11 shrink-0 cursor-pointer items-center border-0 bg-transparent",
				className,
			)}
		>
			<span
				className={cn(
					"relative h-[18px] w-8 rounded-full transition-colors motion-reduce:transition-none",
					me.chatOn
						? "bg-content-success"
						: "bg-surface-tertiary shadow-[inset_0_0_0_1px_hsl(var(--border-default))]",
				)}
			>
				<span
					className={cn(
						"absolute top-0.5 left-0.5 size-3.5 rounded-full bg-surface-primary shadow transition-transform motion-reduce:transition-none",
						me.chatOn && "translate-x-3.5",
					)}
				/>
			</span>
		</button>
	);
};

type DockButtonProps = {
	label: string;
	/** The tooltip, when it says more than the label. */
	title?: string;
	testId: string;
	onClick: () => void;
	children: React.ReactNode;
};

/** One of the chat's window controls: an icon, named for screen readers and in its tooltip. */
export const DockButton: React.FC<DockButtonProps> = ({
	label,
	title,
	testId,
	onClick,
	children,
}) => (
	<Button
		variant="subtle"
		size="icon"
		aria-label={label}
		title={title ?? label}
		data-testid={testId}
		onClick={onClick}
	>
		{children}
	</Button>
);

/**
 * Admins: the chat console over the page (ChatConsoleOverlay), on this conversation when one is open - on the Chat
 * page, the console there, focused.
 */
export const ConsoleButton: React.FC<{ peer?: ChatPeer }> = ({ peer }) => (
	<DockButton
		label="Open in the chat console"
		title="Open in the chat console, over this page"
		testId="chat-open-console"
		onClick={() => openConsoleOverlay(peer)}
	>
		<PanelsTopLeftIcon />
	</DockButton>
);

const listItemClass =
	"flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent p-2 text-left text-inherit hover:bg-surface-secondary focus-visible:bg-surface-secondary focus-visible:outline-hidden aria-[current=true]:bg-surface-secondary";

type ChatListProps = {
	onOpen: (peer: ChatPeer) => void;
	/** The conversation shown beside the list (full screen). */
	selectedId?: string;
	className?: string;
};

/** The recent conversations, and for developers the People online and the admins to write to. */
export const ChatList: React.FC<ChatListProps> = ({
	onOpen,
	selectedId,
	className,
}) => {
	const state = useChatSnapshot();
	const me = state.me;
	const adminsQuery = useQuery({
		...chatAdmins(state.availVersion),
		enabled: Boolean(me && !me.admin),
	});
	if (!me) {
		return null;
	}
	const conversations = [...state.conversations.values()]
		.sort((a, b) => b.last.id - a.last.id)
		.slice(0, LISTED_CONVERSATIONS);

	return (
		<nav
			aria-label="Recent chats"
			className={cn("overflow-y-auto overscroll-contain p-1.5", className)}
		>
			{conversations.map((c) => {
				const mine = c.last.from === me.id;
				const last =
					c.last.text.replace(/\s+/g, " ") ||
					(c.last.image ? "Screenshot" : "");
				return (
					<button
						key={c.peer.id}
						type="button"
						className={listItemClass}
						aria-current={c.peer.id === selectedId || undefined}
						onClick={() => onOpen(c.peer)}
					>
						<ChatAvatar peer={c.peer} />
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="truncate font-semibold">
								{displayName(c.peer)}
							</span>
							<span className="truncate text-xs text-content-secondary">
								{mine ? "You: " : ""}
								{last}
							</span>
						</span>
						{c.unread > 0 && <CountBadge count={c.unread} />}
					</button>
				);
			})}
			{me.admin ? (
				!conversations.length && (
					<p className="m-2 text-[13px] text-content-secondary">
						No conversations yet. Start one with "Chat" in Controls › Settings ›
						Accounts.
					</p>
				)
			) : (
				<>
					{state.peers && (
						<ChatPeople onOpen={onOpen} withoutAdmins onlineOnly />
					)}
					<div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
						Need help? Message an admin
					</div>
					{adminsQuery.isLoading && (
						<p className="m-2 text-[13px] text-content-secondary">Loading…</p>
					)}
					{adminsQuery.data?.length === 0 || adminsQuery.isError ? (
						<p className="m-2 text-[13px] text-content-secondary">
							No admin can be reached right now.
						</p>
					) : null}
					{adminsQuery.data?.map((admin) => (
						<button
							key={admin.id}
							type="button"
							className={listItemClass}
							aria-current={admin.id === selectedId || undefined}
							onClick={() => onOpen(admin)}
						>
							<ChatAvatar peer={admin} />
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate font-semibold">
									{displayName(admin)}
								</span>
								<span className="truncate text-xs text-content-secondary">
									@{admin.username} · admin
								</span>
							</span>
						</button>
					))}
				</>
			)}
		</nav>
	);
};

export const RestoreChatButton: React.FC<{
	total: number;
	onRestore: () => void;
}> = ({ total, onRestore }) => {
	return (
		<button
			type="button"
			className={cn(
				navbarTileTriggerClass,
				"rounded-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link",
			)}
			aria-label={
				total ? `Restore chat bar, ${total} unread` : "Restore chat bar"
			}
			title="Restore chat bar"
			onClick={onRestore}
		>
			<Avatar size="lg" className="items-center justify-center">
				<MessageSquareIcon aria-hidden className="size-5" />
			</Avatar>
			{total > 0 && (
				<span className="absolute -right-1 -top-1">
					<CountBadge count={total} />
				</span>
			)}
		</button>
	);
};
