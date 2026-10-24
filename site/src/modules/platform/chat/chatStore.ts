/**
 * Chat between admins and users. The platform service keeps the messages
 * (30 days) and decides who may write: admins to anyone, everyone else to the
 * admins who have chat on, or to whoever wrote to them first.
 *
 * This store keeps one long poll open (/api/chat/poll): the service answers
 * it as soon as a message, a typing change, a deleted conversation or an
 * admin's availability concerns this user. The windows that are open are
 * remembered per tab (sessionStorage), so they survive reloads.
 *
 * Admins have the chat console besides (ChatConsole): every conversation in one
 * list, one open at a time. It lives on the Chat page of Controls › Settings (or
 * in a window of its own, popped out of it): opening it asks the dashboard to go
 * there (consoleRequest) - but for the chat's own console buttons, which bring it
 * up over whatever page is open (consoleOverlay, ChatConsoleOverlay). While it is
 * on screen, or once the dock holds as many windows as fit, a new message from
 * someone else does not pop up a window: it waits in the console's list, counted,
 * so a busy hour stays orderly.
 *
 * The dock shows a compact restore button, the Chats bar, a raised window,
 * an attached right panel, or full screen. Attached or
 * full screen, conversations open in it (panelView) rather than in windows.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
	type ChatAvailability,
	type ChatConversation,
	type ChatFocus,
	type ChatMessage,
	type ChatPeer,
	type ChatState,
	isChatGroupId,
	PlatformAPI,
	PlatformError,
} from "#/api/platform";
import {
	pageLeaving,
	startPresence,
	stopPresence,
	TAB_ID,
} from "./chatPresence";

const OPEN_KEY = "coder-ui-chat-windows";
const PANEL_KEY = "coder-ui-chat-panel";
const MODE_KEY = "coder-ui-chat-dock";
/** From Tailwind's md up, the dock's windows sit beside the Chats panel (ChatDock); below it, above it. */
const WINDOWS_BESIDE_FROM = 768;
const TYPING_EVERY_MS = 2500;
const SIGNED_OUT_RETRY_MS = 30_000;
const UNAVAILABLE_RETRY_MS = 10_000;
/** The panel says "Chats" (not "Chat with an admin") after recent conversations. */
const RECENT_DAYS = 14;
/** Messages per page of history (the service's default). */
const HISTORY_PAGE = 100;

export type ChatWindowState = {
	peer: ChatPeer;
	minimized: boolean;
	loading: boolean;
	loadError: string | null;
	messages: readonly ChatMessage[];
	/** Messages that arrived while the history was loading. */
	pending: readonly ChatMessage[];
	/** The newest message received from the peer, and the newest reported read. */
	lastIn: number;
	readSent: number;
	/** The peer deleted the conversation while this window was open. */
	clearedByPeer: boolean;
	/** Bumped to ask the window to focus its message box. */
	focusRequest: number;
	/** Older messages: being fetched; none left. */
	loadingOlder: boolean;
	olderDone: boolean;
};

/**
 * How the dock shows the chat: "bar", its handle at the bottom right;
 * "compact", a small restore button with the unread count;
 * "window", raised from it into a small window (Gmail's chat); "side",
 * attached to the right side, from the navbar down; "full", over the page
 * below the navbar.
 */
export type DockMode = "bar" | "compact" | "window" | "side" | "full";

type ChatSnapshot = {
	me: ChatState["me"] | null;
	conversations: ReadonlyMap<string, ChatConversation>;
	/** Rightmost first: a new window opens at the right, older ones move left. */
	windows: readonly ChatWindowState[];
	typing: ReadonlySet<string>;
	available: ReadonlySet<string>;
	off: ReadonlySet<string>;
	availVersion: number;
	/** Bumped by the service whenever someone comes online, goes idle or active, or leaves. */
	presenceVersion: number;
	/** The largest file a message may carry (MB). */
	maxFileMb: number;
	/** Peer-to-peer chat is on: developers see the People list and write to each other. */
	peers: boolean;
	dockMode: DockMode;
	/** What full screen goes back to. */
	fullFrom: "window" | "side";
	/** The conversation open in the side panel or full screen (null: their list). */
	panelView: ChatWindowState | null;
	/** Admins: the chat console (shown on the Chat page, or popped out), and the conversation open in it. */
	consoleOpen: boolean;
	/** Admins: the console over the page open (ChatConsoleOverlay), from the chat's own console buttons. */
	consoleOverlay: boolean;
	consoleView: ChatWindowState | null;
	/** Bumped to ask the dashboard to show the console's page (ChatDock follows it). */
	consoleRequest: number;
	/** Group chats' first messages this user has not clicked yet: in front of everything (ChatFocusOverlay). */
	focus: readonly ChatFocus[];
};

/**
 * How the dock starts on a page load: attached to the right side when it was
 * left attached or compact - a layout chosen for every page - and
 * at the bar otherwise: a raised window or full screen would cover the page
 * just opened. Without storage, at the bar.
 */
export const initialDockMode = (): DockMode => {
	try {
		const saved = localStorage.getItem(MODE_KEY);
		return saved === "side" || saved === "compact" ? saved : "bar";
	} catch {
		return "bar";
	}
};

/** Full screen is remembered as what it goes back to. */
const rememberDockMode = (mode: DockMode, fullFrom: "window" | "side") => {
	try {
		localStorage.setItem(MODE_KEY, mode === "full" ? fullFrom : mode);
	} catch {
		// For this page only.
	}
};

const initialSnapshot: ChatSnapshot = {
	me: null,
	conversations: new Map(),
	windows: [],
	typing: new Set(),
	available: new Set(),
	off: new Set(),
	availVersion: 0,
	presenceVersion: 0,
	maxFileMb: 25,
	peers: false,
	dockMode: initialDockMode(),
	fullFrom: "window",
	panelView: null,
	consoleOpen: false,
	consoleOverlay: false,
	consoleView: null,
	consoleRequest: 0,
	focus: [],
};

let snapshot = initialSnapshot;
let cursor = 0;
let clearVersion = 0;
let purgeVersion = 0;
let focusVersion: number | undefined;
// The conversation the console shows once it is on screen (openConsole before the Chat page is there).
let pendingConsolePeer: ChatPeer | null = null;
let started: Promise<void> | null = null;
// The chat runs while a dock shows it; its loops stop once none does (the
// page left the dashboard), and start again with the next dock.
let docks = 0;
let focusedPeer: string | null = null;
const typedAt = new Map<string, number>();
const listeners = new Set<() => void>();

const update = (patch: Partial<ChatSnapshot>) => {
	snapshot = { ...snapshot, ...patch };
	for (const listener of listeners) {
		listener();
	}
};

export const useChatSnapshot = (): ChatSnapshot =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => snapshot,
	);

const sleep = (ms: number) =>
	new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const statusOf = (error: unknown) =>
	error instanceof PlatformError ? error.status : 0;

export const displayName = (
	peer: Pick<ChatPeer, "name" | "username"> & { id?: string },
) =>
	peer.id && isChatGroupId(peer.id)
		? peer.username
		: peer.name || peer.username;

export const unreadTotal = (state: ChatSnapshot): number => {
	let total = 0;
	for (const conversation of state.conversations.values()) {
		total += conversation.unread;
	}
	return total;
};

export const hasRecentConversation = (state: ChatSnapshot): boolean => {
	const since = Date.now() - RECENT_DAYS * 86_400_000;
	for (const conversation of state.conversations.values()) {
		if (new Date(conversation.last.at).getTime() > since) {
			return true;
		}
	}
	return false;
};

/** No admin is taking chats and no one else may be written to: a developer's panel is greyed out. */
export const noAdminAvailable = (state: ChatSnapshot): boolean =>
	Boolean(
		state.me && !state.me.admin && state.available.size === 0 && !state.peers,
	);

/** A developer writing to an admin who turned chat off. */
export const isBlocked = (state: ChatSnapshot, peerId: string): boolean =>
	Boolean(state.me && !state.me.admin && state.off.has(peerId));

/**
 * Admins' messages on the left in their colour, developers' on the right.
 * Between two admins (or messages from before roles were recorded): yours on
 * the right.
 */
export const messageSide = (
	message: ChatMessage,
	meId: string,
): "admin" | "dev" => {
	if (message.fromAdmin !== message.toAdmin) {
		return message.fromAdmin ? "admin" : "dev";
	}
	return message.from === meId ? "dev" : "admin";
};

// ---------------------------------------------------------------- windows

const saveOpenWindows = () => {
	const list = snapshot.windows.map((w) => ({
		id: w.peer.id,
		username: w.peer.username,
		name: w.peer.name,
		min: w.minimized,
	}));
	try {
		sessionStorage.setItem(OPEN_KEY, JSON.stringify(list));
	} catch {
		// Not remembered.
	}
};

const isSavedWindow = (
	value: unknown,
): value is { id: string; username: string; name?: string; min?: boolean } =>
	typeof value === "object" &&
	value !== null &&
	"id" in value &&
	typeof value.id === "string" &&
	"username" in value &&
	typeof value.username === "string";

const loadOpenWindows = () => {
	try {
		const parsed: unknown = JSON.parse(
			sessionStorage.getItem(OPEN_KEY) ?? "[]",
		);
		return Array.isArray(parsed) ? parsed.filter(isSavedWindow) : [];
	} catch {
		return [];
	}
};

/** The side panel's (or full screen's) conversation, remembered per tab like the windows. */
const setPanelView = (view: ChatWindowState | null) => {
	update({ panelView: view });
	try {
		if (view) {
			const { id, username, name } = view.peer;
			sessionStorage.setItem(PANEL_KEY, JSON.stringify({ id, username, name }));
		} else {
			sessionStorage.removeItem(PANEL_KEY);
		}
	} catch {
		// Not remembered.
	}
};

const loadPanelPeer = () => {
	try {
		const parsed: unknown = JSON.parse(
			sessionStorage.getItem(PANEL_KEY) ?? "null",
		);
		return isSavedWindow(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

/** Changes the conversation's window and, if it is the one there, the console's and the side panel's view of it. */
const updateWindow = (
	peerId: string,
	change: (w: ChatWindowState) => ChatWindowState,
) => {
	const view = snapshot.consoleView;
	const panel = snapshot.panelView;
	update({
		windows: snapshot.windows.map((w) =>
			w.peer.id === peerId ? change(w) : w,
		),
		consoleView: view && view.peer.id === peerId ? change(view) : view,
		panelView: panel && panel.peer.id === peerId ? change(panel) : panel,
	});
};

const findWindow = (peerId: string) =>
	snapshot.windows.find((w) => w.peer.id === peerId);

/** Attached to the right side or full screen: conversations open in it, and the windows are put away. */
const attached = () =>
	snapshot.dockMode === "side" || snapshot.dockMode === "full";

/** The console is on screen: on the Chat page (or popped out), or over the page (consoleOverlay). */
const consoleShown = () => snapshot.consoleOpen || snapshot.consoleOverlay;

/**
 * The conversation where it is on screen: its window (while attached, the
 * side panel's view instead, the windows being put away), or the console's
 * view of it while the console shows it - first, over the page, where the
 * dock's windows are hidden under it.
 */
const findView = (peerId: string) => {
	const inConsole =
		consoleShown() && snapshot.consoleView?.peer.id === peerId
			? snapshot.consoleView
			: undefined;
	if (snapshot.consoleOverlay && inConsole) {
		return inConsole;
	}
	return (
		(attached()
			? snapshot.panelView?.peer.id === peerId
				? snapshot.panelView
				: undefined
			: findWindow(peerId)) ?? inConsole
	);
};

const newView = (peer: ChatPeer, minimized: boolean, focus: boolean) => ({
	peer,
	minimized,
	loading: true,
	loadError: null,
	messages: [],
	pending: [],
	lastIn: 0,
	readSent: 0,
	clearedByPeer: false,
	focusRequest: focus && !minimized ? 1 : 0,
	loadingOlder: false,
	olderDone: false,
});

/** The dock's windows sit beside the Chats panel, Gmail style (on a narrow screen they stack above it). */
export const windowsBeside = () => window.innerWidth >= WINDOWS_BESIDE_FROM;

/** As many windows as fit side by side, beside the panel (at most three); the oldest gives way. */
const maxOpenWindows = () =>
	Math.max(
		1,
		Math.min(
			3,
			Math.floor((window.innerWidth - 32 - (windowsBeside() ? 372 : 0)) / 340),
		),
	);

/**
 * The messages of `incoming` not shown yet, each once. A message can come
 * twice in one batch: it arrived (and was queued) while the history that also
 * holds it was loading.
 */
export const newMessages = (
	shown: readonly ChatMessage[],
	incoming: readonly ChatMessage[],
): ChatMessage[] => {
	const known = new Set(shown.map((m) => m.id));
	const fresh: ChatMessage[] = [];
	for (const m of incoming) {
		if (!known.has(m.id)) {
			known.add(m.id);
			fresh.push(m);
		}
	}
	return fresh;
};

const appendMessages = (
	w: ChatWindowState,
	messages: readonly ChatMessage[],
): ChatWindowState => {
	if (w.loading) {
		return { ...w, pending: [...w.pending, ...messages] };
	}
	const fresh = newMessages(w.messages, messages);
	if (!fresh.length) {
		return w;
	}
	const meId = snapshot.me?.id;
	let lastIn = w.lastIn;
	for (const m of fresh) {
		if (m.from !== meId) {
			lastIn = Math.max(lastIn, m.id);
		}
	}
	return {
		...w,
		messages: [...w.messages, ...fresh].sort((a, b) => a.id - b.id),
		lastIn,
		clearedByPeer: false,
	};
};

const loadHistory = async (peerId: string) => {
	try {
		const { messages, readUpTo } = await PlatformAPI.getChatMessages(peerId);
		updateWindow(peerId, (w) => {
			const ready = {
				...w,
				loading: false,
				olderDone: messages.length < HISTORY_PAGE,
				readSent: Math.max(w.readSent, readUpTo),
			};
			return appendMessages({ ...ready, pending: [] }, [
				...messages,
				...w.pending,
			]);
		});
	} catch (error) {
		updateWindow(peerId, (w) =>
			appendMessages(
				{
					...w,
					loading: false,
					pending: [],
					loadError: `Could not load the conversation: ${error instanceof Error ? error.message : "unknown error"}`,
				},
				w.pending,
			),
		);
	}
	markRead(peerId, false);
};

type OpenOptions = { minimized?: boolean; focus?: boolean };

const openWindow = (
	peer: ChatPeer,
	{ minimized = false, focus = false }: OpenOptions = {},
) => {
	const existing = findWindow(peer.id);
	if (existing) {
		updateWindow(peer.id, (w) => ({
			...w,
			minimized,
			focusRequest: focus && !minimized ? w.focusRequest + 1 : w.focusRequest,
		}));
	} else {
		const created: ChatWindowState = newView(peer, minimized, focus);
		const windows = [created, ...snapshot.windows];
		update({ windows: windows.slice(0, maxOpenWindows()) });
		void loadHistory(peer.id);
	}
	saveOpenWindows();
};

export const closeWindow = (peerId: string) => {
	update({ windows: snapshot.windows.filter((w) => w.peer.id !== peerId) });
	saveOpenWindows();
};

export const setMinimized = (peerId: string, minimized: boolean) => {
	updateWindow(peerId, (w) => ({ ...w, minimized }));
	saveOpenWindows();
	if (!minimized) {
		markRead(peerId, true);
	}
};

/** Where the keyboard focus is, so arriving messages count as read there. */
export const setFocusedWindow = (peerId: string | null) => {
	focusedPeer = peerId;
};

/**
 * Read = the window is in use (clicked, typed in or expanded just now; else it
 * holds the focus) in a visible tab. A window that only popped up leaves its
 * messages unread: its title bar, the panel and the bell say so.
 */
export const markRead = (peerId: string, used: boolean) => {
	const w = findView(peerId);
	if (
		snapshot.dockMode === "compact" ||
		!w ||
		w.minimized ||
		document.visibilityState !== "visible"
	) {
		return;
	}
	if (!used && focusedPeer !== peerId) {
		return;
	}
	const conversation = snapshot.conversations.get(peerId);
	if (conversation?.unread) {
		const conversations = new Map(snapshot.conversations);
		conversations.set(peerId, { ...conversation, unread: 0 });
		update({ conversations });
	}
	if (w.lastIn > w.readSent) {
		const last = w.lastIn;
		updateWindow(peerId, (current) => ({ ...current, readSent: last }));
		PlatformAPI.markChatRead(peerId, last).catch(() => {
			// The count comes back on the next page load; nothing else to do.
		});
	}
};

// ---------------------------------------------------------------- messages

/** Attached or full screen, nothing pops up: the message is counted in its list. */
const popsUp = () =>
	snapshot.dockMode !== "compact" &&
	!attached() &&
	(!snapshot.me?.admin ||
		(!consoleShown() && snapshot.windows.length < maxOpenWindows()));

const receive = (m: ChatMessage) => {
	const me = snapshot.me;
	if (!me) {
		return;
	}
	cursor = Math.max(cursor, m.id);
	// A group chat's message: the group is the conversation, whoever wrote it.
	const group = isChatGroupId(m.to);
	const incoming = group ? m.from !== me.id : m.to === me.id;
	const peer: ChatPeer =
		group || !incoming
			? { id: m.to, username: m.toName, name: m.toDisplay, group }
			: { id: m.from, username: m.fromName, name: m.fromDisplay };
	const known = snapshot.conversations.get(peer.id);
	if (known && known.last.id >= m.id) {
		updateWindow(peer.id, (w) => appendMessages(w, [m]));
		return;
	}
	const conversations = new Map(snapshot.conversations);
	conversations.set(peer.id, {
		peer,
		last: m,
		unread: (known?.unread ?? 0) + (incoming ? 1 : 0),
	});
	const typing = new Set(snapshot.typing);
	if (incoming) {
		typing.delete(peer.id);
	}
	update({ conversations, typing });
	// A new message brings its conversation up: opened if it was closed, left
	// minimized (with its count) if it was. For admins only while the console
	// is closed and the dock has room: otherwise it waits in the console.
	if (incoming && !findView(peer.id) && popsUp()) {
		openWindow(peer);
	}
	// Every copy of the conversation (its window, the console's view, even
	// while the console is closed) gets the message.
	updateWindow(peer.id, (w) => appendMessages(w, [m]));
	if (findView(peer.id)) {
		markRead(peer.id, false);
	}
};

const cleared = (peerId: string, byMe: boolean) => {
	const conversations = new Map(snapshot.conversations);
	conversations.delete(peerId);
	update({ conversations });
	if (byMe) {
		closeWindow(peerId);
		if (snapshot.consoleView?.peer.id === peerId) {
			update({ consoleView: null });
		}
		if (snapshot.panelView?.peer.id === peerId) {
			setPanelView(null);
		}
		return;
	}
	updateWindow(peerId, (w) => ({
		...w,
		messages: [],
		pending: [],
		lastIn: 0,
		readSent: 0,
		clearedByPeer: true,
	}));
};

/** The admins purged every chat: the conversations (and open windows' messages) are gone. */
const purged = () => {
	update({
		conversations: new Map(),
		windows: snapshot.windows.map((w) => ({
			...w,
			messages: [],
			pending: [],
			lastIn: 0,
			readSent: 0,
		})),
		consoleView: snapshot.consoleView
			? { ...snapshot.consoleView, messages: [], pending: [] }
			: null,
		panelView: snapshot.panelView
			? { ...snapshot.panelView, messages: [], pending: [] }
			: null,
	});
};

const applyAvailability = (availability: ChatAvailability) => {
	if ((availability.purgeVersion ?? 0) > purgeVersion) {
		purgeVersion = availability.purgeVersion ?? 0;
		purged();
	}
	if ((availability.availVersion || 0) < snapshot.availVersion) {
		return;
	}
	const me = snapshot.me;
	let chatOn = me?.chatOn;
	if (me?.admin && availability.available.includes(me.id)) {
		chatOn = true;
	}
	if (me?.admin && availability.off.includes(me.id)) {
		chatOn = false;
	}
	const noneAvailable = Boolean(
		me && !me.admin && availability.available.length === 0,
	);
	update({
		available: new Set(availability.available),
		off: new Set(availability.off),
		availVersion: availability.availVersion || snapshot.availVersion,
		presenceVersion: Math.max(
			snapshot.presenceVersion,
			availability.presenceVersion ?? 0,
		),
		maxFileMb: availability.maxFileMb ?? snapshot.maxFileMb,
		peers: availability.peers ?? snapshot.peers,
		me: me && chatOn !== undefined ? { ...me, chatOn } : me,
		// Nobody to write to: a raised window lowers (attached, its list says so).
		dockMode:
			noneAvailable &&
			!(availability.peers ?? snapshot.peers) &&
			snapshot.dockMode === "window"
				? "bar"
				: snapshot.dockMode,
	});
};

// ---------------------------------------------------------------- lifecycle

const signedOut = () => {
	snapshot = { ...initialSnapshot, dockMode: initialDockMode() };
	cursor = 0;
	clearVersion = 0;
	purgeVersion = 0;
	focusVersion = undefined;
	for (const listener of listeners) {
		listener();
	}
	try {
		sessionStorage.removeItem(OPEN_KEY);
		sessionStorage.removeItem(PANEL_KEY);
	} catch {
		// Nothing kept.
	}
	started = null;
	// Signing in does not reload the page.
	window.setTimeout(() => {
		if (docks > 0) {
			void startChat();
		}
	}, SIGNED_OUT_RETRY_MS);
};

const poll = async () => {
	let backoff = 2000;
	while (docks > 0 && !pageLeaving()) {
		try {
			const result = await PlatformAPI.pollChat({
				after: cursor,
				typing: [...snapshot.typing],
				cleared: clearVersion,
				availVersion: snapshot.availVersion,
				tab: TAB_ID,
				presenceVersion: snapshot.presenceVersion,
				focusVersion,
			});
			backoff = 2000;
			clearVersion = Math.max(clearVersion, result.clearVersion || 0);
			for (const peerId of result.cleared ?? []) {
				cleared(peerId, false);
			}
			applyAvailability(result);
			for (const message of result.messages) {
				receive(message);
			}
			focusVersion = result.focusVersion ?? focusVersion;
			update({ typing: new Set(result.typing), focus: result.focus ?? [] });
		} catch (error) {
			if (statusOf(error) === 401) {
				signedOut();
				return;
			}
			await sleep(backoff);
			backoff = Math.min(backoff * 2, 30_000);
		}
	}
	started = null;
};

const boot = async () => {
	let state: ChatState | undefined;
	while (!state) {
		try {
			state = await PlatformAPI.getChatState(TAB_ID);
		} catch (error) {
			await sleep(
				statusOf(error) === 401 ? SIGNED_OUT_RETRY_MS : UNAVAILABLE_RETRY_MS,
			);
		}
		if (docks === 0) {
			started = null;
			return;
		}
	}
	cursor = state.cursor;
	clearVersion = state.clearVersion || 0;
	purgeVersion = state.purgeVersion ?? 0;
	focusVersion = state.focusVersion;
	const conversations = state.conversations ?? [];
	update({
		me: state.me,
		conversations: new Map(conversations.map((c) => [c.peer.id, c])),
		typing: new Set(state.typing ?? []),
		available: new Set(state.available ?? []),
		off: new Set(state.off ?? []),
		availVersion: state.availVersion || 0,
		presenceVersion: state.presenceVersion ?? 0,
		maxFileMb: state.maxFileMb ?? snapshot.maxFileMb,
		peers: Boolean(state.peers),
		focus: state.focus ?? [],
	});
	for (const saved of loadOpenWindows()) {
		if (saved.id !== state.me.id) {
			openWindow(
				{
					id: saved.id,
					username: saved.username,
					name: saved.name ?? "",
					group: isChatGroupId(saved.id),
				},
				{ minimized: Boolean(saved.min) },
			);
		}
	}
	// Attached: the side panel shows what it showed before the reload.
	const panelPeer = attached() ? loadPanelPeer() : null;
	if (panelPeer && panelPeer.id !== state.me.id) {
		selectInPanel({
			id: panelPeer.id,
			username: panelPeer.username,
			name: panelPeer.name ?? "",
			group: isChatGroupId(panelPeer.id),
		});
	}
	// Unread conversations come up minimized, with their count (for admins as
	// many as fit; the console has the rest).
	for (const conversation of conversations) {
		if (conversation.unread && !findWindow(conversation.peer.id) && popsUp()) {
			openWindow(conversation.peer, { minimized: true });
		}
	}
	void poll();
};

/** Starts the chat for this page (once). */
const startChat = (): Promise<void> => {
	started ??= boot();
	return started;
};

/** Keeps the chat running while the calling component (the dock) is mounted. */
export const useChatConnection = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		docks++;
		void startChat();
		startPresence();
		return () => {
			docks--;
			if (docks === 0) {
				stopPresence();
			}
		};
	}, [enabled]);
};

const onVisibilityChange = () => {
	for (const w of snapshot.windows) {
		markRead(w.peer.id, false);
	}
	if (snapshot.panelView) {
		markRead(snapshot.panelView.peer.id, false);
	}
};
document.addEventListener("visibilitychange", onVisibilityChange);

// ---------------------------------------------------------------- actions

/** Opens (or brings up) the conversation with this user. */
export const openChatWith = async (peer: ChatPeer) => {
	await startChat();
	if (!snapshot.me || peer.id === snapshot.me.id) {
		return;
	}
	if (consoleShown() && snapshot.me.admin) {
		selectInConsole(peer, true);
		return;
	}
	if (attached()) {
		selectInPanel(peer, true);
		return;
	}
	openWindow(peer, { focus: true });
	markRead(peer.id, true);
};

/**
 * Every conversation with unread messages, expanded; else the Chats panel. Admins: the console, at the first.
 * Attached or full screen: the one waiting longest, in it.
 */
export const openUnreadChats = async () => {
	await startChat();
	if (snapshot.me?.admin) {
		const first = [...snapshot.conversations.values()]
			.filter((c) => c.unread)
			.sort((a, b) => a.last.id - b.last.id)[0];
		openConsole(first?.peer);
		return;
	}
	const unread = [...snapshot.conversations.values()]
		.filter((c) => c.unread)
		.sort((a, b) => a.last.id - b.last.id);
	if (attached()) {
		if (unread[0]) {
			selectInPanel(unread[0].peer, true);
		}
		return;
	}
	if (!unread.length) {
		setDockMode("window");
		return;
	}
	unread.forEach((c, i) =>
		openWindow(c.peer, { focus: i === unread.length - 1 }),
	);
	for (const c of unread) {
		markRead(c.peer.id, true);
	}
};

/** Invisible: left out of everyone's People list but admins'. */
export const setInvisible = async (invisible: boolean) => {
	const me = snapshot.me;
	if (!me) {
		return;
	}
	update({ me: { ...me, invisible } });
	try {
		await PlatformAPI.setChatInvisible(invisible);
	} catch (error) {
		update({
			me: snapshot.me ? { ...snapshot.me, invisible: !invisible } : null,
		});
		throw error;
	}
};

// ---------------------------------------------------------------- the dock's modes

/** The window in use (it holds the focus), else the first one expanded, else the first. */
const windowInUse = () =>
	snapshot.windows.find((w) => w.peer.id === focusedPeer) ??
	snapshot.windows.find((w) => !w.minimized) ??
	snapshot.windows[0];

/** The panel's conversation goes on in a window of the dock's, its messages as they are. */
const windowFromPanel = (view: ChatWindowState) => {
	if (findWindow(view.peer.id)) {
		openWindow(view.peer, { focus: true });
		return;
	}
	update({
		windows: [
			{ ...view, minimized: false, focusRequest: 1 },
			...snapshot.windows,
		].slice(0, maxOpenWindows()),
	});
	saveOpenWindows();
};

/**
 * Shows the chat another way (DockMode), remembered in this browser
 * (initialDockMode). Attached or full screen, the windows are put away - they
 * come back when the chat floats again - and the window in use goes on in it;
 * back in the raised window, the conversation open in it goes on in a window.
 * A developer with no one to write to stays at the bar.
 */
export const setDockMode = (mode: DockMode) => {
	const from = snapshot.dockMode;
	const next = mode === "window" && noAdminAvailable(snapshot) ? "bar" : mode;
	if (next === from) {
		return;
	}
	const wasAttached = attached();
	const attaching = next === "side" || next === "full";
	const fullFrom =
		next === "full" ? (from === "side" ? "side" : "window") : snapshot.fullFrom;
	if (attaching && !wasAttached) {
		const w = windowInUse();
		focusedPeer = null;
		setPanelView(w ? { ...w, minimized: false, focusRequest: 0 } : null);
	}
	const leaving = wasAttached && !attaching ? snapshot.panelView : null;
	update({ dockMode: next, fullFrom });
	if (wasAttached && !attaching) {
		focusedPeer = null;
		setPanelView(null);
		if (leaving && next === "window") {
			windowFromPanel(leaving);
		}
	}
	rememberDockMode(next, fullFrom);
};

/** Raises the Chats bar into its window, or lowers it (the quick access wheel's Chat); attached or full screen, the chat shows already. */
export const setDrawerOpen = (open: boolean) => {
	if (!attached()) {
		setDockMode(open ? "window" : "bar");
	}
};

/** Full screen ends: back to the raised window or the side panel, whichever it came from. */
export const exitFullScreen = () => {
	if (snapshot.dockMode === "full") {
		setDockMode(snapshot.fullFrom);
	}
};

/** The chat console comes up: a raised window lowers to the bar and full screen ends (the side panel stays). */
const makeWayForConsole = () => {
	const mode = snapshot.dockMode;
	if (
		mode === "window" ||
		(mode === "full" && snapshot.fullFrom === "window")
	) {
		setDockMode("bar");
	} else if (mode === "full") {
		setDockMode("side");
	}
};

/** Shows this conversation in the side panel or full screen (its window, put away, keeps its own copy). */
export const selectInPanel = (peer: ChatPeer, focus = false) => {
	const current = snapshot.panelView;
	if (current?.peer.id === peer.id) {
		if (focus) {
			update({
				panelView: { ...current, focusRequest: current.focusRequest + 1 },
			});
		}
		markRead(peer.id, true);
		return;
	}
	const open =
		findWindow(peer.id) ??
		(snapshot.consoleView?.peer.id === peer.id
			? snapshot.consoleView
			: undefined);
	setPanelView(
		open
			? { ...open, minimized: false, focusRequest: focus ? 1 : 0 }
			: newView(peer, false, focus),
	);
	if (!open) {
		void loadHistory(peer.id);
	}
	markRead(peer.id, true);
};

/** The side panel (or full screen) goes back to its list. */
export const closePanelView = () => setPanelView(null);

const newClientId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** No answer, or the proxy's: worth one more try. */
const retryable = (error: unknown) =>
	[0, 502, 503, 504].includes(statusOf(error));

/**
 * Sends one message. It carries an id of its own, so when the answer is lost
 * (a network hiccup, a busy proxy) the retries do not store it twice.
 */
export const sendChatMessage = async (
	peerId: string,
	text: string,
	screenshot?: { dataURL: string; page: string },
	upload?: string,
	options: { focus?: boolean } = {},
) => {
	const request = {
		to: peerId,
		text,
		clientId: newClientId(),
		...(screenshot ? { image: screenshot.dataURL, page: screenshot.page } : {}),
		...(upload ? { upload } : {}),
		...(options.focus ? { focus: true } : {}),
	};
	let result: { message: ChatMessage } | undefined;
	for (let attempt = 0; !result; attempt++) {
		try {
			result = await PlatformAPI.sendChatMessage(request);
		} catch (error) {
			if (attempt >= 2 || !retryable(error)) {
				throw error;
			}
			await sleep(400 * 2 ** attempt + Math.random() * 300);
		}
	}
	typedAt.delete(peerId);
	receive(result.message);
};

/** The page of messages before the oldest one shown. */
export const loadOlderMessages = async (peerId: string) => {
	const w = findView(peerId);
	if (!w || w.loading || w.loadingOlder || w.olderDone || !w.messages.length) {
		return;
	}
	updateWindow(peerId, (v) => ({ ...v, loadingOlder: true }));
	try {
		const { messages } = await PlatformAPI.getChatMessages(
			peerId,
			w.messages[0].id,
		);
		updateWindow(peerId, (v) => {
			const known = new Set(v.messages.map((m) => m.id));
			return {
				...v,
				loadingOlder: false,
				olderDone: messages.length < HISTORY_PAGE,
				messages: [...messages.filter((m) => !known.has(m.id)), ...v.messages],
			};
		});
	} catch {
		updateWindow(peerId, (v) => ({ ...v, loadingOlder: false }));
	}
};

// ---------------------------------------------------------------- console (admins)

/**
 * Shows the console, on this conversation (else the one it showed, else the newest): where it is on screen (its page,
 * or over the page), at once; else the dashboard is asked to go to its page (the Chat page), where it opens on it
 * (attachConsole).
 */
export const openConsole = (peer?: ChatPeer) => {
	makeWayForConsole();
	if (!consoleShown()) {
		pendingConsolePeer = peer ?? pendingConsolePeer;
		update({ consoleRequest: snapshot.consoleRequest + 1 });
		return;
	}
	if (peer) {
		selectInConsole(peer);
	}
};

/** The console on screen shows this conversation, else the one it showed, else the newest; `focus`: its message box. */
const showInConsole = (peer: ChatPeer | null | undefined, focus: boolean) => {
	makeWayForConsole();
	const newest = () =>
		[...snapshot.conversations.values()].sort(
			(a, b) => b.last.id - a.last.id,
		)[0]?.peer;
	const shown = peer ?? snapshot.consoleView?.peer ?? newest();
	if (shown) {
		selectInConsole(shown, focus);
	}
};

/** The console is on screen (the Chat page's card, or its own window): it shows what was asked for, else the newest. */
export const attachConsole = () => {
	const peer = pendingConsolePeer;
	pendingConsolePeer = null;
	update({ consoleOpen: true });
	showInConsole(peer, false);
};

/** The console left the screen (its page closed, or it went into a window of its own). */
export const closeConsole = () => update({ consoleOpen: false });

/**
 * The chat's own console buttons (the Chats bar's, the raised window's, the side panel's and full screen's): the
 * console over whatever page is open (ChatConsoleOverlay), on this conversation - else the one it showed, else the
 * newest - its message box focused. Where the console is on screen already (the Chat page's card), it is that one,
 * focused.
 */
export const openConsoleOverlay = (peer?: ChatPeer) => {
	if (!consoleShown()) {
		update({ consoleOverlay: true });
	}
	showInConsole(peer, true);
};

/** The console over the page goes (Escape, a click off it, its close button, another page). */
export const closeConsoleOverlay = () => {
	if (snapshot.consoleOverlay) {
		update({ consoleOverlay: false });
	}
};

// Escape puts the console over the page away, and goes no further. The quick access wheel (RadialMenu) listens for
// Escape on the window in the capture phase too, and opens on every one - over an open dialog as well, once that has
// closed on it. Listeners on one target run in the order they were added: this one is added as the store loads, ahead
// of the wheel's, which RadialMenu (importing this store) adds when it mounts. Whatever is open in the console (a
// menu, a confirmation) goes with it; an Escape that ends an input method's composition is only that.
window.addEventListener(
	"keydown",
	(event) => {
		if (event.key !== "Escape" || !snapshot.consoleOverlay) {
			return;
		}
		event.stopImmediatePropagation();
		if (!event.isComposing) {
			event.preventDefault();
			closeConsoleOverlay();
		}
	},
	true,
);

/** Shows this conversation in the console (its window, if one is open, keeps its own copy). */
export const selectInConsole = (peer: ChatPeer, focus = false) => {
	const current = snapshot.consoleView;
	if (current?.peer.id === peer.id) {
		update({
			consoleView: focus
				? { ...current, focusRequest: current.focusRequest + 1 }
				: current,
		});
		markRead(peer.id, true);
		return;
	}
	const open =
		findWindow(peer.id) ??
		(snapshot.panelView?.peer.id === peer.id ? snapshot.panelView : undefined);
	update({
		consoleView: open
			? { ...open, minimized: false, focusRequest: focus ? 1 : 0 }
			: newView(peer, false, focus),
	});
	if (!open) {
		void loadHistory(peer.id);
	}
	markRead(peer.id, true);
};

/** The console's conversation in a chat window of its own too (the dock's, on every page; attached, in the side panel). */
export const popOutOfConsole = (peer: ChatPeer) => {
	if (attached()) {
		selectInPanel(peer, true);
		return;
	}
	openWindow(peer, { focus: true });
	markRead(peer.id, true);
};

/** Renews the service's few-second "typing" signal while keys are pressed. */
export const reportTyping = (peerId: string) => {
	if (Date.now() - (typedAt.get(peerId) ?? 0) < TYPING_EVERY_MS) {
		return;
	}
	typedAt.set(peerId, Date.now());
	PlatformAPI.sendChatTyping(peerId).catch(() => {
		// Only an indicator for the other side.
	});
};

/** Deletes every message with this peer, for both people. */
export const deleteConversation = async (peerId: string) => {
	await PlatformAPI.deleteChatConversation(peerId);
	cleared(peerId, true);
};

const DELETE_AT_ONCE = 4;

/** Deletes these conversations, a few at a time: the ones deleted, and why each other one was not. */
export const deleteConversations = async (peerIds: readonly string[]) => {
	const deleted: string[] = [];
	const failed: { id: string; error: unknown }[] = [];
	const queue = [...peerIds];
	const worker = async () => {
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
			try {
				await deleteConversation(id);
				deleted.push(id);
			} catch (error) {
				failed.push({ id, error });
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(DELETE_AT_ONCE, queue.length) }, worker),
	);
	return { deleted, failed };
};

/** An admin's own switch: off = developers can't write to them. */
export const setChatOn = async (on: boolean) => {
	const me = snapshot.me;
	if (!me) {
		return;
	}
	update({ me: { ...me, chatOn: on } });
	try {
		applyAvailability(await PlatformAPI.setChatAvailability(on));
	} catch {
		update({ me: { ...me, chatOn: me.chatOn } });
	}
};

/** Admins: one thread with these accounts (Admin > Accounts, Chat), opened to write its first message. */
export const startGroupChat = async (memberIds: readonly string[]) => {
	const { peer } = await PlatformAPI.createChatGroup(memberIds);
	await openChatWith(peer);
	return peer;
};

/**
 * The user clicked what took their focus - a group chat's first message, or a message an admin forced on them: it
 * lets go of the page, and (with `reply`, the default) its conversation opens to answer.
 */
export const acknowledgeFocus = async (item: ChatFocus, reply = true) => {
	update({
		focus: snapshot.focus.filter((f) =>
			item.forced
				? !(f.forced && f.message.id === item.message.id)
				: f.forced || f.group.id !== item.group.id,
		),
	});
	try {
		if (item.forced) {
			await PlatformAPI.acknowledgeForcedChat(item.message.id);
		} else {
			await PlatformAPI.acknowledgeChatFocus(item.group.id);
		}
	} catch {
		// Shown again by the next poll if it was not recorded.
	}
	if (reply) {
		await openChatWith(item.group);
	}
};

/** Admins: Force Response - the newest admin message in the conversation comes up in front of everything for them. */
export const forceResponse = (peerId: string) =>
	PlatformAPI.forceChatResponse(peerId);
