import { cn } from "cn";
import {
	CameraIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	ClockIcon,
	CloudIcon,
	CrosshairIcon,
	KeyboardIcon,
	ListChecksIcon,
	MonitorIcon,
	PictureInPicture2Icon,
	SearchIcon,
	SkipForwardIcon,
	TrashIcon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type ChatConversation as Conversation,
	isChatGroupId,
} from "#/api/platform";
import { cloudDrivePeers } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { AskForCloudDriveDialog } from "#/modules/platform/cloudDrive/CloudDrivePeers";
import {
	userCloudDriveHref,
	userWorkspaceHref,
} from "#/modules/users/userPlaces";
import { ChatAvatar } from "./ChatAvatar";
import { ChatConversation, type ConversationActions } from "./ChatConversation";
import { ChatPeople } from "./ChatPeople";
import { CountBadge } from "./ChatWindow";
import {
	deleteConversation,
	displayName,
	forceResponse,
	popOutOfConsole,
	selectInConsole,
	startGroupChat,
	useChatSnapshot,
} from "./chatStore";
import "./chatConsole.css";

const ROW_HEIGHT = 60;
const OVERSCAN = 6;
const AUTO_NEXT_KEY = "coder-ui-chat-auto-next";
const SHORTCUTS = [
	"Alt+↓ / Alt+↑: next / previous conversation",
	"Alt+N: next waiting",
	"/ or Ctrl+K: search",
	"↑ ↓ Enter: move in the list, open",
	"Escape: back to the list",
	"Ctrl+click: choose people for a group chat",
	"Right-click a conversation: delete, workspace, Cloud Drive, Force Response",
].join("\n");

export type ConsoleFilter = "waiting" | "unread" | "all";

/** The last message is theirs: they are waiting for an answer. */
export const isWaiting = (c: Conversation, meId: string) =>
	c.last.from !== meId;

/**
 * The console's list for a filter and a search: waiting conversations
 * longest-waiting first (triage order), the others newest first.
 */
export const consoleList = (
	conversations: Iterable<Conversation>,
	meId: string,
	filter: ConsoleFilter,
	query: string,
): Conversation[] => {
	const q = query.trim().toLowerCase();
	const list = [...conversations].filter((c) => {
		if (filter === "waiting" && !isWaiting(c, meId)) {
			return false;
		}
		if (filter === "unread" && !c.unread) {
			return false;
		}
		return (
			!q ||
			c.peer.username.toLowerCase().includes(q) ||
			c.peer.name.toLowerCase().includes(q) ||
			c.last.text.toLowerCase().includes(q)
		);
	});
	return filter === "waiting"
		? list.sort((a, b) => a.last.id - b.last.id)
		: list.sort((a, b) => b.last.id - a.last.id);
};

const ago = (iso: string, now: number) => {
	const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
	if (s < 60) {
		return "now";
	}
	if (s < 3600) {
		return `${Math.floor(s / 60)}m`;
	}
	if (s < 86_400) {
		return `${Math.floor(s / 3600)}h`;
	}
	return `${Math.floor(s / 86_400)}d`;
};

const readAutoNext = () => {
	try {
		return localStorage.getItem(AUTO_NEXT_KEY) === "1";
	} catch {
		return false;
	}
};

const isTextField = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.tagName === "TEXTAREA" ||
		target.tagName === "INPUT" ||
		target.isContentEditable);

type ChatConsoleProps = {
	/** What screenshots leave out (the dock, or the console's own window). */
	dock?: React.RefObject<HTMLElement | null>;
	/** Where it is: the Chat page's card, or a window of its own (its links then open in the dashboard's tab). */
	place: "card" | "window";
	/** More buttons for its header (the card's Pop out, the window's Pop back in). */
	actions?: React.ReactNode;
	className?: string;
};

/**
 * Admins' chat console: every conversation in one place, one open at a time,
 * like a Rolodex. The list on the left is the card index: what is waiting for
 * an answer (longest-waiting first), what is unread, or everything, searched
 * by person or text and drawn only where it is on screen, so hundreds of chats
 * stay quick. The card on the right is the conversation; moving through the
 * index flips to the next card. With "Next after reply" on, answering one flips
 * straight to the next waiting chat.
 *
 * Keys: Alt+↓ / Alt+↑ next and previous card, Alt+N next waiting, / or
 * Ctrl+K search, ↑ ↓ and Enter in the list, Escape back to the list (from the
 * message box).
 *
 * It lives on the Chat page (a card at its top) or in a window of its own,
 * popped out of it - not over the dashboard. Several people chosen (Select, or
 * Ctrl+click) get one group chat; a conversation's right-click menu deletes it,
 * goes to the person's workspace or Cloud Drive (read only), or forces a
 * response (the newest admin message in front of everything for them).
 */
export const ChatConsole: React.FC<ChatConsoleProps> = ({
	dock,
	place,
	actions,
	className,
}) => {
	const own = useRef<HTMLElement>(null);
	const state = useChatSnapshot();
	const me = state.me;
	const view = state.consoleView;
	const [filter, setFilter] = useState<ConsoleFilter>(() =>
		me && [...state.conversations.values()].some((c) => isWaiting(c, me.id))
			? "waiting"
			: "all",
	);
	const [query, setQuery] = useState("");
	const [autoNext, setAutoNext] = useState(readAutoNext);
	const [direction, setDirection] = useState<"next" | "prev">("next");
	const [shooting, setShooting] = useState(false);
	const [now, setNow] = useState(Date.now);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const conversation = useRef<ConversationActions>(null);
	// Cloud Drives shared between users: the conversation's person asked for theirs, while admins have it on.
	const [asking, setAsking] = useState(false);
	const peers = useQuery({ ...cloudDrivePeers(), refetchInterval: 60_000 });

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);

	const meId = me?.id ?? "";
	const list = useMemo(
		() => consoleList(state.conversations.values(), meId, filter, query),
		[state.conversations, meId, filter, query],
	);
	const counts = useMemo(() => {
		let waiting = 0;
		let unread = 0;
		for (const c of state.conversations.values()) {
			waiting += isWaiting(c, meId) ? 1 : 0;
			unread += c.unread ? 1 : 0;
		}
		return { waiting, unread, all: state.conversations.size };
	}, [state.conversations, meId]);

	const selectedId = view?.peer.id;
	const index = list.findIndex((c) => c.peer.id === selectedId);

	const go = (
		to: Conversation | undefined,
		dir: "next" | "prev",
		focus = false,
	) => {
		if (!to) {
			return;
		}
		setDirection(dir);
		selectInConsole(to.peer, focus);
		const i = list.findIndex((c) => c.peer.id === to.peer.id);
		const box = listRef.current;
		if (box && i >= 0) {
			const top = i * ROW_HEIGHT;
			if (top < box.scrollTop) {
				box.scrollTop = top;
			} else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight) {
				box.scrollTop = top + ROW_HEIGHT - box.clientHeight;
			}
		}
	};
	const step = (by: 1 | -1) =>
		go(
			list[index < 0 ? 0 : (index + by + list.length) % list.length],
			by > 0 ? "next" : "prev",
		);
	/** On to the conversation waiting longest; `focus`: its message box (after a reply). */
	const nextWaiting = (focus = false) => {
		const waiting = consoleList(
			state.conversations.values(),
			meId,
			"waiting",
			"",
		).filter((c) => c.peer.id !== selectedId);
		go(waiting[0], "next", focus);
	};

	// Several people chosen: one group chat with them all.
	const [selecting, setSelecting] = useState(false);
	const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
	const [grouping, setGrouping] = useState(false);
	const stopSelecting = () => {
		setSelecting(false);
		setPicked(new Set());
	};
	const toggle = (c: Conversation) => {
		if (isChatGroupId(c.peer.id)) {
			return;
		}
		setSelecting(true);
		setPicked((now) => {
			const next = new Set(now);
			if (next.has(c.peer.id)) {
				next.delete(c.peer.id);
			} else {
				next.add(c.peer.id);
			}
			return next;
		});
	};
	const chatWithPicked = async () => {
		setGrouping(true);
		try {
			await startGroupChat([...picked]);
			stopSelecting();
		} catch (error) {
			toast.error(getErrorMessage(error, "The group chat was not started."));
		} finally {
			setGrouping(false);
		}
	};

	// A conversation's right-click menu.
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [deleting, setDeleting] = useState<Conversation | null>(null);
	const visit = (href: string) => {
		// From its own window: in the dashboard's tab (the window keeps the console).
		const opener: Window | null = place === "window" ? window.opener : null;
		if (opener && !opener.closed) {
			opener.location.assign(href);
			opener.focus();
		} else {
			navigate(href);
		}
	};
	const menu: RowMenu = {
		onDelete: setDeleting,
		onWorkspace: (c) =>
			void userWorkspaceHref(queryClient, c.peer.username).then(visit),
		onCloudDrive: (c) =>
			visit(userCloudDriveHref({ id: c.peer.id, username: c.peer.username })),
		onForce: (c) =>
			void forceResponse(c.peer.id).then(
				() =>
					toast.success(
						`Your last message is in front of ${displayName(c.peer)}'s dashboard until they acknowledge it.`,
					),
				(error) => toast.error(getErrorMessage(error, "Not forced.")),
			),
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (
			event.altKey &&
			(event.key === "ArrowDown" || event.key === "ArrowUp")
		) {
			event.preventDefault();
			step(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.altKey && event.key.toLowerCase() === "n") {
			event.preventDefault();
			nextWaiting(true);
		} else if (
			(event.key === "/" && !isTextField(event.target)) ||
			((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")
		) {
			event.preventDefault();
			searchRef.current?.focus();
			searchRef.current?.select();
		} else if (
			event.key === "Escape" &&
			selecting &&
			!isTextField(event.target)
		) {
			event.preventDefault();
			stopSelecting();
		}
	};

	if (!me) {
		return null;
	}

	return (
		<section
			ref={own}
			aria-label="Chat console"
			data-testid="chat-console"
			data-place={place}
			onKeyDown={onKeyDown}
			className={cn(
				"chat-console flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary",
				className,
			)}
		>
			<header className="flex items-center gap-3 border-0 border-b border-solid border-border bg-surface-secondary px-3 py-1.5">
				<span className="text-[13px] font-semibold">Chat console</span>
				<span className="flex items-center gap-2 text-xs text-content-secondary">
					<span>
						<b className="text-highlight-orange">{counts.waiting}</b> waiting
					</span>
					<span aria-hidden>·</span>
					<span>
						<b className="text-content-primary">{counts.unread}</b> unread
					</span>
					<span aria-hidden>·</span>
					<span>{counts.all} conversations</span>
				</span>
				<span className="flex-1" />
				<label
					className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary"
					title="After you send a reply, go straight to the next conversation waiting for an answer"
				>
					<input
						type="checkbox"
						checked={autoNext}
						onChange={(event) => {
							setAutoNext(event.target.checked);
							try {
								localStorage.setItem(
									AUTO_NEXT_KEY,
									event.target.checked ? "1" : "0",
								);
							} catch {
								// Not remembered.
							}
						}}
					/>
					Next after reply
				</label>
				<span
					className="flex text-content-secondary"
					title={SHORTCUTS}
					role="img"
					aria-label="Keyboard shortcuts"
				>
					<KeyboardIcon className="size-4" />
				</span>
				{actions}
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,300px)_1fr]">
				<nav
					aria-label="Conversations"
					className="flex min-h-0 flex-col border-0 border-r border-solid border-border"
				>
					<div className="flex flex-col gap-1.5 p-2">
						<label className="flex items-center gap-1.5 rounded-md border border-solid border-border bg-surface-primary px-2">
							<SearchIcon className="size-3.5 shrink-0 text-content-secondary" />
							<input
								ref={searchRef}
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown" || event.key === "Enter") {
										event.preventDefault();
										if (event.key === "Enter" && list[0]) {
											go(list[0], "next");
										}
										listRef.current?.focus();
									}
									if (event.key === "Escape") {
										event.stopPropagation();
										setQuery("");
										listRef.current?.focus();
									}
								}}
								placeholder="Search people or messages"
								aria-label="Search conversations"
								className="h-8 min-w-0 flex-1 border-0 bg-transparent text-[13px] text-inherit outline-hidden"
							/>
						</label>
						<div className="flex gap-1">
							<div
								role="tablist"
								aria-label="Show"
								className="flex flex-1 gap-1"
							>
								{(
									[
										["waiting", "Waiting", counts.waiting],
										["unread", "Unread", counts.unread],
										["all", "All", counts.all],
									] as const
								).map(([value, label, n]) => (
									<button
										key={value}
										type="button"
										role="tab"
										aria-selected={filter === value}
										onClick={() => setFilter(value)}
										className={cn(
											"flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-solid px-1.5 py-1 text-xs",
											filter === value
												? "border-border bg-surface-tertiary font-semibold text-content-primary"
												: "border-transparent bg-transparent text-content-secondary hover:text-content-primary",
										)}
									>
										{label}
										<span className="tabular-nums opacity-70">{n}</span>
									</button>
								))}
							</div>
							<Button
								variant={selecting ? "outline" : "subtle"}
								size="icon"
								className="size-7 shrink-0"
								onClick={() =>
									selecting ? stopSelecting() : setSelecting(true)
								}
								aria-pressed={selecting}
								aria-label="Choose people for a group chat"
								title="Choose people for a group chat (or Ctrl+click them)"
								data-testid="chat-console-select"
							>
								<ListChecksIcon />
							</Button>
						</div>
					</div>
					<RolodexList
						listRef={listRef}
						list={list}
						meId={meId}
						selectedId={selectedId}
						typing={state.typing}
						now={now}
						onPick={(c, event) =>
							selecting || event?.ctrlKey || event?.metaKey
								? toggle(c)
								: go(c, list.indexOf(c) < index ? "prev" : "next")
						}
						selecting={selecting}
						picked={picked}
						menu={menu}
						onStep={step}
						onOpen={() => conversation.current?.focus()}
						empty={
							query
								? "Nobody matches."
								: filter === "waiting"
									? "Nobody is waiting for an answer."
									: filter === "unread"
										? "Nothing unread."
										: 'No conversations yet. Start one with "Chat" in Admin › Accounts.'
						}
					/>
					{selecting && (
						<div
							className="flex shrink-0 items-center gap-2 border-0 border-t border-solid border-border px-2.5 py-2 text-xs"
							data-testid="chat-console-selection"
						>
							<span className="flex-1 text-content-secondary">
								{picked.size === 0
									? "Choose people (not group chats)"
									: `${picked.size} chosen`}
							</span>
							<Button size="xs" variant="outline" onClick={stopSelecting}>
								Cancel
							</Button>
							<Button
								size="xs"
								disabled={picked.size === 0 || grouping}
								onClick={() => void chatWithPicked()}
								data-testid="chat-console-group"
							>
								<UsersIcon />
								Chat with {picked.size === 1 ? "them" : "all"}
							</Button>
						</div>
					)}
					{/* Who is online now (grey when idle): a conversation with any of them, from here. */}
					<ChatPeople
						onOpen={(peer) => selectInConsole(peer)}
						onlineOnly
						className="max-h-[40%] shrink-0 overflow-y-auto border-0 border-t border-solid border-border"
					/>
				</nav>

				{view ? (
					<div className="relative flex min-h-0 min-w-0 flex-col">
						<div className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-1.5">
							<ChatAvatar peer={view.peer} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-sm font-semibold">
									{displayName(view.peer)}
								</span>
								<span className="truncate text-xs text-content-secondary">
									@{view.peer.username}
									{index >= 0 ? ` · ${index + 1} of ${list.length}` : ""}
								</span>
							</span>
							<Button
								variant="subtle"
								size="icon"
								onClick={() => step(-1)}
								disabled={list.length < 2}
								aria-label="Previous conversation"
								title="Previous (Alt+↑)"
							>
								<ChevronUpIcon />
							</Button>
							<Button
								variant="subtle"
								size="icon"
								onClick={() => step(1)}
								disabled={list.length < 2}
								aria-label="Next conversation"
								title="Next (Alt+↓)"
							>
								<ChevronDownIcon />
							</Button>
							<Button
								variant="subtle"
								size="icon"
								onClick={() => nextWaiting(true)}
								disabled={
									counts.waiting === 0 ||
									(counts.waiting === 1 && isWaitingSelected(state, meId))
								}
								aria-label="Next waiting conversation"
								title="Next waiting (Alt+N)"
							>
								<SkipForwardIcon />
							</Button>
							<span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
							<Button
								variant="subtle"
								size="icon"
								disabled={shooting}
								onClick={() => conversation.current?.screenshot()}
								aria-label="Screenshot"
								title="Attach a screenshot of this page"
							>
								<CameraIcon />
							</Button>
							{peers.data?.settings.enabled &&
								!view.peer.group &&
								view.peer.id !== meId && (
									<Button
										variant="subtle"
										size="icon"
										onClick={() => setAsking(true)}
										aria-label="Ask for their Cloud Drive"
										title="Ask for their Cloud Drive"
										data-testid="chat-ask-cloud-drive"
									>
										<CloudIcon />
									</Button>
								)}
							{asking && (
								<AskForCloudDriveDialog
									owner={{ id: view.peer.id, name: displayName(view.peer) }}
									onClose={() => setAsking(false)}
								/>
							)}
							<Button
								variant="subtle"
								size="icon"
								onClick={() => popOutOfConsole(view.peer)}
								aria-label="Open in its own window"
								title="Open in its own window"
							>
								<PictureInPicture2Icon />
							</Button>
							<Button
								variant="subtle"
								size="icon"
								onClick={() => conversation.current?.askDelete()}
								aria-label="Delete conversation"
								title="Delete conversation"
							>
								<TrashIcon />
							</Button>
						</div>
						<div
							key={view.peer.id}
							className="chat-card flex min-h-0 flex-1 flex-col"
							data-direction={direction}
						>
							<ChatConversation
								ref={conversation}
								view={view}
								dock={dock ?? own}
								className="min-h-0 flex-1"
								onEscape={() => listRef.current?.focus()}
								onSent={autoNext ? () => nextWaiting(true) : undefined}
								onShootingChange={setShooting}
							/>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-content-secondary">
						<KeyboardIcon className="size-6 opacity-60" />
						<p className="m-0">Pick a conversation on the left.</p>
						<p className="m-0 text-xs">
							Alt+N opens the next one waiting for an answer.
						</p>
					</div>
				)}
			</div>
			{deleting && (
				<ConfirmDialog
					open
					type="delete"
					title={`Delete the conversation with ${displayName(deleting.peer)}?`}
					description="Every message goes, for both of you."
					confirmText="Delete"
					onConfirm={() => {
						const peer = deleting.peer;
						setDeleting(null);
						void deleteConversation(peer.id).catch((error) =>
							toast.error(getErrorMessage(error, "Not deleted.")),
						);
					}}
					onClose={() => setDeleting(null)}
				/>
			)}
		</section>
	);
};

/** A conversation's right-click menu: what each item does. */
type RowMenu = {
	onDelete: (c: Conversation) => void;
	onWorkspace: (c: Conversation) => void;
	onCloudDrive: (c: Conversation) => void;
	onForce: (c: Conversation) => void;
};

const isWaitingSelected = (
	state: ReturnType<typeof useChatSnapshot>,
	meId: string,
) => {
	const id = state.consoleView?.peer.id;
	const c = id ? state.conversations.get(id) : undefined;
	return Boolean(c && isWaiting(c, meId));
};

type RolodexListProps = {
	listRef: React.RefObject<HTMLDivElement | null>;
	list: readonly Conversation[];
	meId: string;
	selectedId: string | undefined;
	typing: ReadonlySet<string>;
	now: number;
	empty: string;
	/** A row clicked (the click, for Ctrl / Cmd: choose it) or chosen with the keys. */
	onPick: (c: Conversation, event?: React.MouseEvent) => void;
	onStep: (by: 1 | -1) => void;
	onOpen: () => void;
	/** Choosing people for a group chat: a box on each row, and who is chosen. */
	selecting: boolean;
	picked: ReadonlySet<string>;
	menu: RowMenu;
};

/**
 * The card index: one row per conversation, drawn only while it is in view
 * (fixed-height rows), so a list of thousands scrolls as lightly as ten.
 */
const RolodexList: React.FC<RolodexListProps> = ({
	listRef,
	list,
	meId,
	selectedId,
	typing,
	now,
	empty,
	onPick,
	onStep,
	onOpen,
	selecting,
	picked,
	menu,
}) => {
	const [scrollTop, setScrollTop] = useState(0);
	const [height, setHeight] = useState(400);

	useEffect(() => {
		const box = listRef.current;
		if (!box) {
			return;
		}
		const observer = new ResizeObserver(() => setHeight(box.clientHeight));
		observer.observe(box);
		setHeight(box.clientHeight);
		return () => observer.disconnect();
	}, [listRef]);

	const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
	const last = Math.min(
		list.length,
		Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
	);
	const shown = list.slice(first, last);

	return (
		<div
			ref={listRef}
			role="listbox"
			tabIndex={0}
			aria-label="Conversations"
			aria-activedescendant={
				selectedId ? `chat-console-row-${selectedId}` : undefined
			}
			className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-hidden focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--content-link))]"
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			onKeyDown={(event) => {
				if (event.altKey) {
					return;
				}
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					onStep(event.key === "ArrowDown" ? 1 : -1);
				} else if (event.key === "Enter") {
					event.preventDefault();
					onOpen();
				}
			}}
		>
			{list.length === 0 ? (
				<p className="m-3 text-[13px] text-content-secondary">{empty}</p>
			) : (
				<div style={{ height: list.length * ROW_HEIGHT }} className="relative">
					{shown.map((c, i) => {
						const top = (first + i) * ROW_HEIGHT;
						const selected = c.peer.id === selectedId;
						const waiting = isWaiting(c, meId);
						const preview =
							c.last.text.replace(/\s+/g, " ") ||
							(c.last.image ? "Screenshot" : "");
						const group = isChatGroupId(c.peer.id);
						const chosen = picked.has(c.peer.id);
						return (
							<ContextMenu key={c.peer.id}>
								<ContextMenuTrigger asChild>
									<div
										id={`chat-console-row-${c.peer.id}`}
										role="option"
										aria-selected={selected}
										tabIndex={-1}
										data-testid="chat-console-row"
										onClick={(event) => onPick(c, event)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												onPick(c);
											}
										}}
										className={cn(
											"absolute right-0 left-0 flex cursor-pointer items-center gap-2.5 border-0 border-l-[3px] border-solid px-2.5",
											selected
												? "chat-row-selected border-l-content-link bg-surface-tertiary"
												: "border-l-transparent hover:bg-surface-secondary",
										)}
										style={{ top, height: ROW_HEIGHT }}
										data-chosen={chosen || undefined}
									>
										{selecting && (
											<input
												type="checkbox"
												checked={chosen}
												disabled={group}
												readOnly
												tabIndex={-1}
												aria-label={`Choose ${displayName(c.peer)}`}
												title={
													group ? "A group chat: choose people" : undefined
												}
												className="pointer-events-none shrink-0"
											/>
										)}
										<ChatAvatar peer={c.peer} />
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="flex items-center gap-1.5">
												<span
													className={cn(
														"min-w-0 flex-1 truncate text-[13px]",
														c.unread ? "font-bold" : "font-semibold",
													)}
												>
													{displayName(c.peer)}
												</span>
												<span
													className={cn(
														"flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums",
														waiting
															? "text-highlight-orange"
															: "text-content-secondary",
													)}
													title={
														waiting
															? `Waiting for an answer since ${new Date(c.last.at).toLocaleString()}`
															: new Date(c.last.at).toLocaleString()
													}
												>
													{waiting && <ClockIcon className="size-3" />}
													{ago(c.last.at, now)}
												</span>
											</span>
											<span className="flex items-center gap-1.5">
												<span className="min-w-0 flex-1 truncate text-xs text-content-secondary">
													{typing.has(c.peer.id) ? (
														<i className="text-content-link not-italic">
															typing…
														</i>
													) : (
														<>
															{c.last.from === meId ? "You: " : ""}
															{preview}
														</>
													)}
												</span>
												{c.unread > 0 && <CountBadge count={c.unread} />}
											</span>
										</span>
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent data-testid="chat-console-row-menu">
									<ContextMenuItem
										disabled={group}
										onSelect={() => menu.onWorkspace(c)}
									>
										<MonitorIcon />
										Workspace
									</ContextMenuItem>
									<ContextMenuItem
										disabled={group}
										onSelect={() => menu.onCloudDrive(c)}
									>
										<CloudIcon />
										Cloud Drive
									</ContextMenuItem>
									<ContextMenuItem onSelect={() => menu.onForce(c)}>
										<CrosshairIcon />
										Force Response
									</ContextMenuItem>
									<ContextMenuSeparator />
									<ContextMenuItem onSelect={() => menu.onDelete(c)}>
										<TrashIcon />
										Delete
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						);
					})}
				</div>
			)}
		</div>
	);
};
