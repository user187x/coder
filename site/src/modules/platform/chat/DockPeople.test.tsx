import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { MockChatPeer, MockChatState } from "#/testHelpers/chat";
import { render } from "#/testHelpers/renderHelpers";
import { deleteConversations, useChatSnapshot } from "./chatStore";
import { DockPeople } from "./DockPeople";

vi.mock("./chatStore", async (original) => ({
	...(await original<typeof import("./chatStore")>()),
	useChatSnapshot: vi.fn(),
	deleteConversations: vi.fn(),
}));

const other = {
	...MockChatPeer,
	id: "other-contact",
	username: "zoe",
	name: "Zoe",
};

beforeEach(() => {
	vi.mocked(useChatSnapshot).mockReturnValue({
		me: { ...MockChatState.me, admin: true },
		conversations: new Map(
			MockChatState.conversations.map((chat) => [chat.peer.id, chat]),
		),
		windows: [],
		typing: new Set(),
		available: new Set(),
		off: new Set(),
		availVersion: 0,
		presenceVersion: 0,
		maxFileMb: 25,
		peers: true,
		dockMode: "bar",
		dockTab: "people",
		fullFrom: "window",
		panelView: null,
		consoleOpen: false,
		consoleOverlay: false,
		consoleView: null,
		consoleRequest: 0,
		focus: [],
	});
	vi.spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
		enabled: true,
		people: [other, MockChatPeer].map((peer) => ({
			...peer,
			online: true,
			lastSeen: null,
		})),
	});
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		people_sort: "manual",
		people_order: [other.id, MockChatPeer.id],
	});
	vi.spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
		async (settings) => settings,
	);
	vi.mocked(deleteConversations).mockResolvedValue({
		deleted: [MockChatPeer.id],
		failed: [],
	});
});

afterEach(() => vi.restoreAllMocks());

it("persists alphabetical sorting through the shared preferences API", async () => {
	const user = userEvent.setup();
	render(<DockPeople />);
	await user.click(
		await screen.findByRole("button", { name: "List people alphabetically" }),
	);
	await waitFor(() =>
		expect(PlatformAPI.setUserUIPreferences).toHaveBeenCalledWith({
			people_sort: "name",
		}),
	);
});

it("keeps bulk selection and limits bulk deletion to the search results", async () => {
	const user = userEvent.setup();
	render(<DockPeople />);
	await screen.findByRole("checkbox", { name: `Select ${MockChatPeer.name}` });
	await user.type(
		screen.getByRole("textbox", { name: "Find people" }),
		MockChatPeer.username,
	);
	await user.click(screen.getByText("Bulk actions · 0 selected"));
	await user.click(screen.getByRole("button", { name: "Select all" }));
	await user.click(screen.getByRole("button", { name: "Delete chats" }));
	await user.click(await screen.findByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(deleteConversations).toHaveBeenCalledWith([MockChatPeer.id]),
	);
});
