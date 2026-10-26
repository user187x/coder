import type { ChatPeer, ChatSettings, ChatState } from "#/api/platform";

export const MockChatPeer: ChatPeer = {
	id: "chat-contact",
	username: "alex",
	name: "Alex",
};
export const MockChatState: ChatState = {
	me: {
		id: "chat-member",
		username: "member",
		name: "Member",
		admin: false,
		chatOn: true,
	},
	conversations: [
		{
			peer: MockChatPeer,
			unread: 0,
			last: {
				id: 1,
				from: MockChatPeer.id,
				fromName: "alex",
				fromDisplay: "Alex",
				to: "chat-member",
				toName: "member",
				toDisplay: "Member",
				text: "Can you help me with my workspace?",
				at: "2026-10-25T12:00:00Z",
				fromAdmin: true,
				toAdmin: false,
				image: null,
				page: null,
			},
		},
	],
	cursor: 1,
	typing: [],
	clearVersion: 0,
	available: [MockChatPeer.id],
	off: [],
	availVersion: 1,
};

export const MockChatSettings: ChatSettings = {
	peers: true,
	discoverAll: false,
	keepDays: 30,
	keepRange: [1, 365],
	updatedBy: null,
	updatedAt: null,
	stats: {
		messages: 0,
		peerMessages: 0,
		oldest: null,
		screenshots: 0,
		bytes: 0,
		fileBytes: 0,
	},
};
