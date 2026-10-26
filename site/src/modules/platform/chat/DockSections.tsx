import { cn } from "cn";
import { BellIcon, MessageSquareIcon, UsersRoundIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "react-query";
import { inboxNotifications } from "#/api/queries/notifications";
import { chatPeople } from "#/api/queries/platform";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import type { ConversationActions } from "./ChatConversation";
import { CountBadge } from "./ChatWindow";
import { setDockTab, unreadTotal, useChatSnapshot } from "./chatStore";
import { DockNotifications } from "./DockNotifications";
import { DockPeople } from "./DockPeople";
import type { DockListActions } from "./dockActions";
import { PanelConversation } from "./PanelConversation";

/** The same sections remain available when the dock is attached to the page. */
export const DockSections: React.FC<{
	dock: React.RefObject<HTMLElement | null>;
	wide?: boolean;
}> = ({ dock, wide = false }) => {
	const peopleActions = useRef<DockListActions>(null);
	const notificationActions = useRef<DockListActions>(null);
	const chatActions = useRef<ConversationActions>(null);
	const state = useChatSnapshot();
	const total = unreadTotal(state);

	const inbox = useQuery(inboxNotifications());
	const roster = useQuery({
		...chatPeople(state.availVersion, state.presenceVersion),
		enabled: Boolean(
			state.me && (state.peers || state.discoverAll || state.me.admin),
		),
	});
	const [seenPeople, setSeenPeople] = useState<Set<string>>(new Set());
	const newPeople =
		state.dockTab === "people"
			? 0
			: (roster.data?.people ?? []).filter((p) => !seenPeople.has(p.id)).length;
	const view =
		state.panelView ?? state.windows.find((window) => !window.minimized);
	const views =
		state.panelView &&
		!state.windows.some((window) => window.peer.id === state.panelView?.peer.id)
			? [...state.windows, state.panelView]
			: state.windows;
	return (
		<Tabs
			orientation="vertical"
			value={state.dockTab}
			onValueChange={(tab) => {
				if (tab === "people" || state.dockTab === "people")
					setSeenPeople(new Set(roster.data?.people.map((p) => p.id) ?? []));
				if (tab === "people" || tab === "chat" || tab === "notifications")
					setDockTab(tab);
			}}
			className="flex min-h-0 flex-1"
		>
			<TabsList
				aria-label="Chat sections"
				className="flex w-12 shrink-0 flex-col items-center gap-2 border-0 border-r border-solid border-border bg-surface-secondary/30 py-2"
			>
				<SectionTab
					value="people"
					actionsRef={peopleActions}
					title="People"
					className="chat-dock-section-tab relative"
				>
					<UsersRoundIcon aria-hidden className="size-4" />
					<span className="sr-only">People</span>
					{newPeople > 0 && (
						<span className="absolute -right-1.5 -top-1.5">
							<CountBadge count={newPeople} />
						</span>
					)}
				</SectionTab>
				<SectionTab
					value="chat"
					actionsRef={chatActions}
					title="Chat"
					className="chat-dock-section-tab relative"
				>
					<MessageSquareIcon aria-hidden className="size-4" />
					<span className="sr-only">Chat</span>
					{total > 0 && (
						<span className="absolute -right-1.5 -top-1.5">
							<CountBadge count={total} />
						</span>
					)}
				</SectionTab>
				<SectionTab
					value="notifications"
					actionsRef={notificationActions}
					title="Notifications"
					className="chat-dock-section-tab relative"
				>
					<BellIcon aria-hidden className="size-4" />
					<span className="sr-only">Notifications</span>
					{Boolean(inbox.data?.unread_count) && (
						<span className="absolute -right-1.5 -top-1.5">
							<CountBadge count={inbox.data?.unread_count ?? 0} />
						</span>
					)}
				</SectionTab>
			</TabsList>
			<TabsContent
				value="notifications"
				forceMount
				hidden={state.dockTab !== "notifications"}
				className="flex min-h-0 min-w-0 flex-1 flex-col data-[state=inactive]:hidden"
			>
				<DockNotifications actionsRef={notificationActions} />
			</TabsContent>
			<TabsContent
				value="people"
				hidden={state.dockTab !== "people"}
				forceMount
				className="flex min-h-0 min-w-0 flex-1 flex-col data-[state=inactive]:hidden"
			>
				<DockPeople actionsRef={peopleActions} />
			</TabsContent>
			<TabsContent
				value="chat"
				hidden={state.dockTab !== "chat"}
				forceMount
				className="flex min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden"
			>
				{wide && (
					<aside className="hidden min-h-0 w-72 shrink-0 border-0 border-r border-solid border-border sm:flex">
						<DockPeople />
					</aside>
				)}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{views.map((window) => (
						<div
							key={window.peer.id}
							hidden={view?.peer.id !== window.peer.id}
							className={cn(
								"flex min-h-0 flex-1 flex-col",
								view?.peer.id !== window.peer.id && "hidden",
							)}
						>
							<PanelConversation
								actionsRef={
									view?.peer.id === window.peer.id ? chatActions : undefined
								}
								view={
									state.panelView?.peer.id === window.peer.id
										? state.panelView
										: window
								}
								dock={dock}
								onBack={() => setDockTab("people")}
								onEscape={() => setDockTab("people")}
							/>
						</div>
					))}
					{!view && (
						<p className="p-4 text-sm text-content-secondary">
							Select someone in People to open a conversation.
						</p>
					)}
				</div>
			</TabsContent>
		</Tabs>
	);
};

const SectionTab: React.FC<
	React.ComponentProps<typeof TabsTrigger> & {
		actionsRef: React.RefObject<DockListActions | null>;
	}
> = ({ actionsRef, children, ...props }) => (
	<ContextMenu>
		<ContextMenuTrigger asChild>
			<TabsTrigger {...props}>{children}</TabsTrigger>
		</ContextMenuTrigger>
		<ContextMenuContent className="z-[110]">
			<ContextMenuItem
				onSelect={() => {
					if (
						props.value === "people" ||
						props.value === "chat" ||
						props.value === "notifications"
					)
						setDockTab(props.value);
				}}
			>
				Open {props.title}
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => actionsRef.current?.selectAll()}>
				Select all
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => actionsRef.current?.clearSelection()}>
				Clear selection
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => actionsRef.current?.clearAll()}>
				Clear all
			</ContextMenuItem>
		</ContextMenuContent>
	</ContextMenu>
);
