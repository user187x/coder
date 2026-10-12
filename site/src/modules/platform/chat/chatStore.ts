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
 * list, one open at a time. While it is open, or once the dock holds as many
 * windows as fit, a new message from someone else does not pop up a window:
 * it waits in the console's list, counted, so a busy hour stays orderly.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
	type ChatAvailability,
	type ChatConversation,
	type ChatMessage,
	type ChatPeer,
	type ChatState,
	PlatformAPI,
	PlatformError,
} from "#/api/platform";

const OPEN_KEY = "coder-ui-chat-windows";
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

type ChatSnapshot = {
	me: ChatState["me"] | null;
	conversations: ReadonlyMap<string, ChatConversation>;
	/** Rightmost first: a new window opens at the right, older ones move left. */
	windows: readonly ChatWindowState[];
	typing: ReadonlySet<string>;
	available: ReadonlySet<string>;
	off: ReadonlySet<string>;
	availVersion: number;
	drawerOpen: boolean;
	/** Admins: the chat console, and the conversation open in it. */
	consoleOpen: boolean;
	consoleView: ChatWindowState | null;
};

const initialSnapshot: ChatSnapshot = {
	me: null,
	conversations: new Map(),
	windows: [],
	typing: new Set(),
	available: new Set(),
	off: new Set(),
	availVersion: 0,
	drawerOpen: false,
	consoleOpen: false,
	consoleView: null,
};

let snapshot = initialSnapshot;
let cursor = 0;
let clearVersion = 0;
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

export const displayName = (peer: Pick<ChatPeer, "name" | "username">) =>
	peer.name || peer.username;

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

/** No admin is taking chats: a developer's panel is greyed out. */
export const noAdminAvailable = (state: ChatSnapshot): boolean =>
	Boolean(state.me && !state.me.admin && state.available.size === 0);

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

/** Changes the conversation's window and, if it is the one there, the console's view of it. */
const updateWindow = (
	peerId: string,
	change: (w: ChatWindowState) => ChatWindowState,
) => {
	const view = snapshot.consoleView;
	update({
		windows: snapshot.windows.map((w) =>
			w.peer.id === peerId ? change(w) : w,
		),
		consoleView: view && view.peer.id === peerId ? change(view) : view,
	});
};

const findWindow = (peerId: string) =>
	snapshot.windows.find((w) => w.peer.id === peerId);

/** The conversation's window, or the console's view of it while the console shows it. */
const findView = (peerId: string) =>
	findWindow(peerId) ??
	(snapshot.consoleOpen && snapshot.consoleView?.peer.id === peerId
		? snapshot.consoleView
		: undefined);

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

/** As many windows as fit side by side (at most three); the oldest gives way. */
const maxOpenWindows = () =>
	Math.max(1, Math.min(3, Math.floor((window.innerWidth - 32) / 340)));

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
	if (!w || w.minimized || document.visibilityState !== "visible") {
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

const popsUp = () =>
	!snapshot.me?.admin ||
	(!snapshot.consoleOpen && snapshot.windows.length < maxOpenWindows());

const receive = (m: ChatMessage) => {
	const me = snapshot.me;
	if (!me) {
		return;
	}
	cursor = Math.max(cursor, m.id);
	const incoming = m.to === me.id;
	const peer: ChatPeer = incoming
		? { id: m.from, username: m.fromName, name: m.fromDisplay }
		: { id: m.to, username: m.toName, name: m.toDisplay };
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

const applyAvailability = (availability: ChatAvailability) => {
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
		me: me && chatOn !== undefined ? { ...me, chatOn } : me,
		drawerOpen: noneAvailable ? false : snapshot.drawerOpen,
	});
};

// ---------------------------------------------------------------- lifecycle

const signedOut = () => {
	snapshot = initialSnapshot;
	cursor = 0;
	clearVersion = 0;
	for (const listener of listeners) {
		listener();
	}
	try {
		sessionStorage.removeItem(OPEN_KEY);
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
	while (docks > 0) {
		try {
			const result = await PlatformAPI.pollChat({
				after: cursor,
				typing: [...snapshot.typing],
				cleared: clearVersion,
				availVersion: snapshot.availVersion,
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
			update({ typing: new Set(result.typing) });
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
			state = await PlatformAPI.getChatState();
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
	const conversations = state.conversations ?? [];
	update({
		me: state.me,
		conversations: new Map(conversations.map((c) => [c.peer.id, c])),
		typing: new Set(state.typing ?? []),
		available: new Set(state.available ?? []),
		off: new Set(state.off ?? []),
		availVersion: state.availVersion || 0,
	});
	for (const saved of loadOpenWindows()) {
		if (saved.id !== state.me.id) {
			openWindow(
				{ id: saved.id, username: saved.username, name: saved.name ?? "" },
				{ minimized: Boolean(saved.min) },
			);
		}
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
		return () => {
			docks--;
		};
	}, [enabled]);
};

const onVisibilityChange = () => {
	for (const w of snapshot.windows) {
		markRead(w.peer.id, false);
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
	if (snapshot.consoleOpen && snapshot.me.admin) {
		selectInConsole(peer, true);
		return;
	}
	openWindow(peer, { focus: true });
	markRead(peer.id, true);
};

/** Every conversation with unread messages, expanded; else the Chats panel. Admins: the console, at the first. */
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
	if (!unread.length) {
		setDrawerOpen(true);
		return;
	}
	unread.forEach((c, i) =>
		openWindow(c.peer, { focus: i === unread.length - 1 }),
	);
	for (const c of unread) {
		markRead(c.peer.id, true);
	}
};

export const setDrawerOpen = (open: boolean) => {
	if (open && noAdminAvailable(snapshot)) {
		return;
	}
	update({ drawerOpen: open });
};

const newClientId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Sends one message. It carries an id of its own, so when the answer is lost
 * (a network hiccup) the one retry, or any later one, does not store it twice.
 */
export const sendChatMessage = async (
	peerId: string,
	text: string,
	screenshot?: { dataURL: string; page: string },
) => {
	const request = {
		to: peerId,
		text,
		clientId: newClientId(),
		...(screenshot ? { image: screenshot.dataURL, page: screenshot.page } : {}),
	};
	let result: { message: ChatMessage };
	try {
		result = await PlatformAPI.sendChatMessage(request);
	} catch (error) {
		if (statusOf(error) !== 0) {
			throw error;
		}
		await sleep(800);
		result = await PlatformAPI.sendChatMessage(request);
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

/** Opens the console, on this conversation (else the one it showed, else the first waiting). */
export const openConsole = (peer?: ChatPeer) => {
	update({ consoleOpen: true, drawerOpen: false });
	if (peer) {
		selectInConsole(peer);
	} else if (!snapshot.consoleView) {
		const first = [...snapshot.conversations.values()].sort(
			(a, b) => b.last.id - a.last.id,
		)[0];
		if (first) {
			selectInConsole(first.peer);
		}
	} else {
		markRead(snapshot.consoleView.peer.id, true);
	}
};

export const closeConsole = () => update({ consoleOpen: false });

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
	const open = findWindow(peer.id);
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

/** Pops the console's conversation out into a window of its own. */
export const popOutOfConsole = (peer: ChatPeer) => {
	closeConsole();
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
