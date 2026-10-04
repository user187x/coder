import { cn } from "cn";
import { ChevronUpIcon, MessageSquareIcon } from "lucide-react";
import { useQuery } from "react-query";
import { chatAdmins } from "#/api/queries/platform";
import { ChatAvatar } from "./ChatAvatar";
import { CountBadge } from "./ChatWindow";
import {
	displayName,
	hasRecentConversation,
	markRead,
	noAdminAvailable,
	openChatWith,
	setChatOn,
	setDrawerOpen,
	unreadTotal,
	useChatSnapshot,
} from "./chatStore";

const LISTED_CONVERSATIONS = 15;

/**
 * The "Chats" panel at the far right: its handle stays at the bottom of the
 * window and the list of recent conversations slides up from it, to reopen
 * one. For everyone who is not an admin it is also their line to support,
 * listing the admins to write to. Admins have an on/off switch beside the
 * handle: developers only write to admins with chat on.
 */
export const ChatPanel: React.FC = () => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const open = state.drawerOpen;
	const total = unreadTotal(state);
	const none = noAdminAvailable(state);
	const label = none
		? "Chat unavailable"
		: me.admin || hasRecentConversation(state)
			? "Chats"
			: "Chat with an admin";
	const switchLabel = me.chatOn
		? "Chat is on: developers can message you. Click to turn it off."
		: "Chat is off: developers can't message you. Click to turn it on.";

	return (
		<div
			data-chat-panel=""
			className="flex w-[min(328px,calc(100vw-32px))] flex-col overflow-hidden rounded-t-lg border border-b-0 border-solid border-border bg-surface-primary shadow-[0_-4px_20px_rgb(0_0_0/.18)]"
		>
			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-250 motion-reduce:transition-none",
					open
						? "grid-rows-[1fr] border-0 border-b border-solid border-border"
						: "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">{open && <ChatList />}</div>
			</div>
			<div className="flex items-center bg-surface-secondary">
				<button
					type="button"
					aria-expanded={open}
					aria-disabled={none}
					aria-label={total ? `Chats, ${total} unread` : label}
					title={none ? "No admin is taking chats right now" : undefined}
					onClick={() => setDrawerOpen(!open)}
					className={cn(
						"flex h-9 min-w-0 flex-1 items-center gap-2 border-0 bg-surface-secondary px-2.5 text-left text-[13px] font-semibold text-inherit",
						none
							? "cursor-not-allowed opacity-50 grayscale"
							: "cursor-pointer hover:bg-surface-tertiary",
					)}
				>
					<MessageSquareIcon
						className={cn(
							"size-3.5 text-content-secondary",
							me.admin && !me.chatOn && "opacity-55",
						)}
					/>
					<span
						className={cn("flex-1", me.admin && !me.chatOn && "opacity-55")}
					>
						{label}
					</span>
					{total > 0 && <CountBadge count={total} />}
					<ChevronUpIcon
						className={cn(
							"size-3.5 text-content-secondary transition-transform duration-250 motion-reduce:transition-none",
							open && "rotate-180",
						)}
					/>
				</button>
				{me.admin && (
					<button
						type="button"
						role="switch"
						aria-checked={me.chatOn}
						aria-label={switchLabel}
						title={switchLabel}
						onClick={() => {
							void setChatOn(!me.chatOn);
						}}
						className="inline-flex h-9 shrink-0 cursor-pointer items-center border-0 bg-transparent pr-2.5 pl-1.5"
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
				)}
			</div>
		</div>
	);
};

const listItemClass =
	"flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent p-2 text-left text-inherit hover:bg-surface-secondary focus-visible:bg-surface-secondary focus-visible:outline-hidden";

const ChatList: React.FC = () => {
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

	const open = (peer: { id: string; username: string; name: string }) => {
		setDrawerOpen(false);
		void openChatWith(peer).then(() => markRead(peer.id, true));
	};

	return (
		<nav
			aria-label="Recent chats"
			className="max-h-[min(360px,calc(100vh-var(--chat-bottom,0px)-160px))] overflow-y-auto p-1.5"
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
						onClick={() => open(c.peer)}
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
						No conversations yet. Start one with "Chat" in Admin › Accounts.
					</p>
				)
			) : (
				<>
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
							onClick={() => open(admin)}
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
