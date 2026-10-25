import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	type ChatConversation,
	type ChatMessage,
	PlatformAPI,
} from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { ChatConsole } from "./ChatConsole";
import type { useChatSnapshot } from "./chatStore";

type Snapshot = ReturnType<typeof useChatSnapshot>;

const ME = "me";
const message = (id: number, from: string): ChatMessage => ({
	id,
	from,
	fromName: from,
	fromDisplay: "",
	to: from === ME ? "peer" : ME,
	toName: "",
	toDisplay: "",
	text: `m${id}`,
	at: new Date().toISOString(),
	fromAdmin: from === ME,
	toAdmin: from !== ME,
	image: null,
	page: null,
});
const conversation = (id: string, n: number): ChatConversation => ({
	peer: id.startsWith("g:")
		? { id, username: "Team", name: "ann, bob", group: true }
		: { id, username: id, name: "" },
	last: message(n, ME),
	unread: 0,
});
const conversations = [
	conversation("ann", 4),
	conversation("bob", 3),
	conversation("g:0a1b", 2),
	conversation("cat", 1),
];

// The console reads the chat store; these tests give it a fixed one.
const snapshot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./chatStore", async (importOriginal) => ({
	...(await importOriginal<typeof import("./chatStore")>()),
	useChatSnapshot: () => snapshot.current,
}));

const renderConsole = () => {
	snapshot.current = {
		me: { id: ME, username: ME, name: "", admin: true, chatOn: true },
		conversations: new Map(conversations.map((c) => [c.peer.id, c])),
		windows: [],
		typing: new Set(),
		available: new Set(),
		off: new Set(),
		availVersion: 0,
		presenceVersion: 0,
		maxFileMb: 25,
		peers: false,
		dockMode: "bar",
		dockTab: "people",
		fullFrom: "window",
		panelView: null,
		consoleOpen: true,
		consoleOverlay: false,
		consoleView: null,
		consoleRequest: 0,
		focus: [],
	} satisfies Snapshot;
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockReturnValue(
		new Promise(() => {}),
	);
	vi.spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
		enabled: true,
		people: [],
	});
	render(<ChatConsole place="card" />);
};

const row = (name: string) =>
	screen
		.getAllByTestId("chat-console-row")
		.find((r) => within(r).queryByText(name)) as HTMLElement;
const deleted = () =>
	vi.mocked(PlatformAPI.deleteChatConversation).mock.calls.map((c) => c[0]);

describe("ChatConsole: choosing conversations", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "deleteChatConversation").mockResolvedValue({
			ok: true,
			deleted: 1,
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("deletes every chosen conversation, group chats too", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		await user.click(row("ann"));
		await user.click(row("Team"));
		expect(screen.getByTestId("chat-console-selection")).toHaveTextContent(
			"2 chosen",
		);
		await user.click(screen.getByTestId("chat-console-delete-chosen"));
		const dialog = await screen.findByTestId("dialog");
		expect(dialog).toHaveTextContent("Delete 2 conversations?");
		expect(dialog).toHaveTextContent("ann · Team");
		await user.click(within(dialog).getByRole("button", { name: "Delete 2" }));
		await waitFor(() => expect(deleted().sort()).toEqual(["ann", "g:0a1b"]));
	});

	it("Select all takes the whole list, and again none of it", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		const all = screen.getByTestId("chat-console-select-all");
		await user.click(row("bob"));
		expect(all).toHaveProperty("indeterminate", true);
		await user.click(all);
		expect(all).toBeChecked();
		expect(screen.getByTestId("chat-console-selection")).toHaveTextContent(
			"4 chosen",
		);
		await user.click(screen.getByTestId("chat-console-delete-chosen"));
		await user.click(
			within(await screen.findByTestId("dialog")).getByRole("button", {
				name: "Delete 4",
			}),
		);
		await waitFor(() =>
			expect(deleted().sort()).toEqual(["ann", "bob", "cat", "g:0a1b"]),
		);
	});

	it("Select all only takes what the search shows", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		await user.type(screen.getByLabelText("Search conversations"), "cat");
		await user.click(screen.getByTestId("chat-console-select-all"));
		expect(screen.getByTestId("chat-console-selection")).toHaveTextContent(
			"1 chosen",
		);
		await user.click(screen.getByTestId("chat-console-select-all"));
		expect(screen.getByTestId("chat-console-selection")).toHaveTextContent(
			"Choose conversations",
		);
	});

	it("a chosen row's right-click Delete takes all the chosen ones", async () => {
		const user = userEvent.setup();
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		await user.click(row("ann"));
		await user.click(row("cat"));
		await user.pointer({ keys: "[MouseRight]", target: row("cat") });
		await user.click(
			within(await screen.findByTestId("chat-console-row-menu")).getByText(
				"Delete the 2 chosen",
			),
		);
		await user.click(
			within(await screen.findByTestId("dialog")).getByRole("button", {
				name: "Delete 2",
			}),
		);
		await waitFor(() => expect(deleted().sort()).toEqual(["ann", "cat"]));
	});

	it("says which were not deleted", async () => {
		const user = userEvent.setup();
		vi.mocked(PlatformAPI.deleteChatConversation).mockImplementation((to) =>
			to.startsWith("g:")
				? Promise.reject(
						new Error("Only the admin who started this chat can delete it."),
					)
				: Promise.resolve({ ok: true, deleted: 1 }),
		);
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		await user.click(row("bob"));
		await user.click(row("Team"));
		await user.click(screen.getByTestId("chat-console-delete-chosen"));
		await user.click(
			within(await screen.findByTestId("dialog")).getByRole("button", {
				name: "Delete 2",
			}),
		);
		// The one not deleted stays chosen.
		await waitFor(() =>
			expect(screen.getByTestId("chat-console-selection")).toHaveTextContent(
				"1 chosen",
			),
		);
		expect(row("Team").dataset.chosen).toBe("true");
	});

	it("a group chat with the chosen people leaves group chats out", async () => {
		const user = userEvent.setup();
		const create = vi
			.spyOn(PlatformAPI, "createChatGroup")
			.mockReturnValue(new Promise(() => {}));
		renderConsole();
		await user.click(await screen.findByTestId("chat-console-select"));
		await user.click(row("Team"));
		expect(screen.getByTestId("chat-console-group")).toBeDisabled();
		await user.click(row("ann"));
		await user.click(row("bob"));
		await user.click(screen.getByTestId("chat-console-group"));
		expect(create).toHaveBeenCalledWith(["ann", "bob"]);
	});
});
