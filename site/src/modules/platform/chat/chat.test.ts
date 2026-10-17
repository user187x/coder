import type { ChatConversation, ChatMessage } from "#/api/platform";
import { consoleList, isWaiting } from "./ChatConsole";
import { newMessages } from "./chatStore";

const ME = "me";
const message = (id: number, from: string, text = `m${id}`): ChatMessage => ({
	id,
	from,
	fromName: from,
	fromDisplay: "",
	to: from === ME ? "peer" : ME,
	toName: "",
	toDisplay: "",
	text,
	at: new Date(2026, 9, 11, 12, 0, id).toISOString(),
	fromAdmin: from === ME,
	toAdmin: from !== ME,
	image: null,
	page: null,
});
const conversation = (
	peer: string,
	last: ChatMessage,
	unread = 0,
): ChatConversation => ({
	peer: { id: peer, username: peer, name: peer.toUpperCase() },
	last,
	unread,
});

describe("newMessages", () => {
	it("keeps a message that came twice in one batch once", () => {
		// The window opened for message 7, which was queued while the history
		// (that also holds 7) loaded.
		const history = [message(5, "dev"), message(6, ME), message(7, "dev")];
		const queued = [message(7, "dev")];
		expect(newMessages([], [...history, ...queued]).map((m) => m.id)).toEqual([
			5, 6, 7,
		]);
	});

	it("leaves out what is shown already", () => {
		expect(
			newMessages([message(1, "dev")], [message(1, "dev"), message(2, "dev")])
				.length,
		).toBe(1);
	});
});

describe("consoleList", () => {
	const list = [
		conversation("alice", message(30, "alice", "build fails"), 2),
		conversation("bob", message(10, "bob", "how do I restart?"), 1),
		conversation("carol", message(20, ME, "try again")),
	];

	it("waiting: theirs last, longest-waiting first", () => {
		expect(consoleList(list, ME, "waiting", "").map((c) => c.peer.id)).toEqual([
			"bob",
			"alice",
		]);
		expect(isWaiting(list[2], ME)).toBe(false);
	});

	it("all: newest first; unread: only unread", () => {
		expect(consoleList(list, ME, "all", "").map((c) => c.peer.id)).toEqual([
			"alice",
			"carol",
			"bob",
		]);
		expect(consoleList(list, ME, "unread", "").length).toBe(2);
	});

	it("searches names and the last message", () => {
		expect(consoleList(list, ME, "all", "restart")[0].peer.id).toBe("bob");
		expect(consoleList(list, ME, "all", "CAROL")[0].peer.id).toBe("carol");
	});
});

describe("peer-to-peer chat", () => {
	it("says how present someone is", async () => {
		const { presenceText } = await import("./ChatPeople");
		expect(presenceText({ online: true, lastSeen: null })).toBe("online");
		const ago = (minutes: number) =>
			new Date(Date.now() - minutes * 60_000).toISOString();
		expect(presenceText({ online: false, lastSeen: ago(5) })).toBe(
			"active 5 min ago",
		);
		expect(presenceText({ online: false, lastSeen: ago(185) })).toBe(
			"active 3 h ago",
		);
	});

	it("does not grey a developer's panel out when they may chat with each other", async () => {
		const { noAdminAvailable } = await import("./chatStore");
		const me = {
			id: "u",
			username: "ann",
			name: "",
			admin: false,
			chatOn: true,
		};
		const base = {
			me,
			conversations: new Map(),
			windows: [],
			typing: new Set<string>(),
			available: new Set<string>(),
			off: new Set<string>(),
			availVersion: 1,
			presenceVersion: 0,
			maxFileMb: 25,
			drawerOpen: false,
			consoleOpen: false,
			consoleView: null,
		};
		expect(noAdminAvailable({ ...base, peers: false })).toBe(true);
		expect(noAdminAvailable({ ...base, peers: true })).toBe(false);
	});
});
