import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet } from "react-router";
import { API } from "#/api/api";
import { type ChatMessage, type ChatState, PlatformAPI } from "#/api/platform";
import { MockNotification } from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { ChatDock } from "./ChatDock";
import {
	closeConsoleOverlay,
	closePanelView,
	closeWindow,
	initialDockMode,
	markRead,
	openChatWith,
	setDockMode,
} from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";

const ME = "me";
const PEERS = ["ann", "bob"];
const message = (id: number, from: string, to: string): ChatMessage => ({
	id,
	from,
	fromName: from,
	fromDisplay: "",
	to,
	toName: to,
	toDisplay: "",
	text: `m${id}`,
	at: new Date().toISOString(),
	fromAdmin: from === ME,
	toAdmin: to === ME,
	image: null,
	page: null,
});
const chatState: ChatState = {
	me: { id: ME, username: ME, name: "", admin: true, chatOn: true },
	conversations: PEERS.map((id, i) => ({
		peer: { id, username: id, name: "" },
		last: message(i + 1, id, ME),
		unread: 0,
	})),
	cursor: 2,
	typing: [],
	clearVersion: 0,
	available: [ME],
	off: [],
	availVersion: 1,
};

// The dock runs on the real chat store: booted once for the file (an admin), its mode put back after each test.
const renderDock = () => {
	vi.spyOn(PlatformAPI, "getChatState").mockResolvedValue(chatState);
	vi.spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
	vi.spyOn(PlatformAPI, "chatActivity").mockResolvedValue({ ok: true });
	vi.spyOn(PlatformAPI, "markChatRead").mockResolvedValue({ ok: true });
	vi.spyOn(PlatformAPI, "getChatMessages").mockImplementation(async (peer) => ({
		messages: [message(1, peer, ME)],
		readUpTo: 1,
	}));
	// The console, over the page.
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockReturnValue(
		new Promise(() => {}),
	);
	vi.spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
		enabled: true,
		people: [],
	});
	const router = createMemoryRouter(
		[
			{
				element: (
					<>
						<Outlet />
						<ChatDock />
					</>
				),
				children: [
					{ path: "/", element: <p>Workspaces</p> },
					{ path: "/templates", element: <p>Templates</p> },
					{ path: CHAT_CONSOLE_PAGE, element: <p>Chat console</p> },
				],
			},
		],
		{ initialEntries: ["/"] },
	);
	renderWithRouter(router);
	return router;
};

const raise = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(await screen.findByRole("button", { name: "Chats" }));
	return screen.getByTestId("chat-window-raised");
};

describe("ChatDock: the bar, the raised window, the side panel and full screen", () => {
	afterEach(() => {
		act(() => {
			closeConsoleOverlay();
			setDockMode("bar");
			closePanelView();
			for (const id of PEERS) {
				closeWindow(id);
			}
		});
		localStorage.clear();
		sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("the bar rises into the chat window, and Minimize lowers it", async () => {
		const user = userEvent.setup();
		renderDock();
		const bar = await screen.findByRole("button", { name: "Chats" });
		expect(bar).toHaveAttribute("aria-expanded", "false");

		const raised = await raise(user);
		expect(
			within(raised).getByRole("button", { name: "Chats" }),
		).toHaveAttribute("aria-expanded", "true");
		within(raised).getByRole("navigation", { name: "Recent chats" });

		await user.click(within(raised).getByTestId("chat-mode-minimize"));
		expect(screen.queryByTestId("chat-window-raised")).toBeNull();
		expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("hides the bar into a remembered squircle and restores its conversation draft", async () => {
		const user = userEvent.setup();
		const send = vi.spyOn(PlatformAPI, "sendChatMessage").mockResolvedValue({
			message: message(9, ME, "ann"),
		});
		vi.spyOn(PlatformAPI, "sendChatTyping").mockResolvedValue({ ok: true });
		renderDock();
		const raised = await raise(user);
		await user.click(within(raised).getByRole("button", { name: /ann/ }));
		await user.type(
			await screen.findByRole("textbox", { name: "Message ann" }),
			"draft kept",
		);
		await user.click(within(raised).getByRole("tab", { name: "People" }));
		await user.click(within(raised).getByRole("tab", { name: "Chat" }));
		await user.click(within(raised).getByRole("button", { name: "Chats" }));
		await user.click(screen.getByRole("button", { name: "Hide chat bar" }));
		expect(initialDockMode()).toBe("compact");
		await user.click(screen.getByRole("button", { name: "Restore chat bar" }));
		expect(initialDockMode()).toBe("bar");
		await user.click(screen.getByRole("button", { name: "Chats" }));
		await user.click(
			within(screen.getByTestId("chat-window-raised")).getByRole("button", {
				name: "Send",
			}),
		);
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({ to: "ann", text: "draft kept" }),
			),
		);
	});

	it("does not mark hidden compact conversations as read", async () => {
		const user = userEvent.setup();
		renderDock();
		await user.click(
			await screen.findByRole("button", { name: "Hide chat bar" }),
		);
		const read = vi.mocked(PlatformAPI.markChatRead);
		read.mockClear();
		await act(() => openChatWith({ id: "bob", username: "bob", name: "" }));
		act(() => markRead("bob", true));
		expect(read).not.toHaveBeenCalled();
	});

	it("the window's controls attach it to the right side and go full screen, and back", async () => {
		const user = userEvent.setup();
		renderDock();
		const raised = await raise(user);

		await user.click(
			within(raised).getByRole("button", { name: "Attach to the right side" }),
		);
		const side = screen.getByTestId("chat-side-panel");
		expect(screen.queryByTestId("chat-window-raised")).toBeNull();

		await user.click(within(side).getByRole("button", { name: "Full screen" }));
		const full = screen.getByTestId("chat-fullscreen");
		await user.click(
			within(full).getByRole("button", { name: "Exit full screen" }),
		);
		screen.getByTestId("chat-side-panel");

		await user.click(
			screen.getByRole("button", { name: "Detach into a window" }),
		);
		await user.click(
			within(screen.getByTestId("chat-window-raised")).getByRole("button", {
				name: "Full screen",
			}),
		);
		screen.getByTestId("chat-fullscreen");

		// Escape: back to where it came from (the raised window), and again: down to the bar.
		await user.keyboard("{Escape}");
		screen.getByTestId("chat-window-raised");
		await user.keyboard("{Escape}");
		screen.getByTestId("chat-bar");
	});

	it("the side panel stays on clicks elsewhere; Minimize takes it down to the bar", async () => {
		const user = userEvent.setup();
		renderDock();
		await user.click(within(await raise(user)).getByTestId("chat-mode-attach"));
		await user.click(screen.getByText("Workspaces"));
		await user.keyboard("{Escape}");
		const side = screen.getByTestId("chat-side-panel");
		await user.click(within(side).getByTestId("chat-mode-minimize"));
		screen.getByTestId("chat-bar");
	});

	it("in the side panel a picked conversation opens inside it, not in a window", async () => {
		const user = userEvent.setup();
		renderDock();
		await user.click(within(await raise(user)).getByTestId("chat-mode-attach"));
		const side = screen.getByTestId("chat-side-panel");

		await user.click(within(side).getByRole("button", { name: /ann/ }));
		await within(side).findByRole("log", { name: "Messages with ann" });
		expect(screen.queryByRole("dialog", { name: "Chat with ann" })).toBeNull();
		expect(PlatformAPI.getChatMessages).toHaveBeenCalledWith("ann");

		await user.click(
			within(side).getByRole("button", { name: "Back to the chats" }),
		);
		within(side).getByRole("navigation", { name: "Recent chats" });
	});

	it("attaching takes the open window into the side panel; detaching gives it back", async () => {
		const user = userEvent.setup();
		renderDock();
		const raised = await raise(user);
		await user.click(within(raised).getByRole("button", { name: /bob/ }));
		await within(screen.getByTestId("chat-window-raised")).findByRole(
			"textbox",
			{ name: "Message bob" },
		);

		await user.click(within(raised).getByTestId("chat-mode-attach"));
		const side = screen.getByTestId("chat-side-panel");
		within(side).getByRole("log", { name: "Messages with bob" });
		expect(screen.queryByRole("dialog", { name: "Chat with bob" })).toBeNull();

		await user.click(within(side).getByTestId("chat-mode-detach"));
		await within(screen.getByTestId("chat-window-raised")).findByRole(
			"textbox",
			{ name: "Message bob" },
		);
		screen.getByTestId("chat-window-raised");
	});

	it("an admin's console control brings the chat console over the page, not to its page (ChatConsoleOverlay)", async () => {
		const user = userEvent.setup();
		const router = renderDock();
		const raised = await raise(user);
		await user.click(
			within(raised).getByRole("button", { name: "Open in the chat console" }),
		);
		await screen.findByRole("dialog", { name: "Chat console" });
		expect(router.state.location.pathname).toBe("/");
		// The raised window made way for it (the dock is under the overlay: hidden from the accessibility tree).
		expect(
			screen.getByRole("button", { name: "Chats", hidden: true }),
		).toHaveAttribute("aria-expanded", "false");
	});

	it("full screen gives way to another page", async () => {
		const user = userEvent.setup();
		const router = renderDock();
		await user.click(
			within(await raise(user)).getByTestId("chat-mode-fullscreen"),
		);
		screen.getByTestId("chat-fullscreen");
		await act(() => router.navigate("/templates"));
		expect(screen.queryByTestId("chat-fullscreen")).toBeNull();
		screen.getByTestId("chat-window-raised");
	});

	it("remembers the side panel for the next page load, and nothing else", () => {
		expect(initialDockMode()).toBe("bar");
		setDockMode("window");
		expect(initialDockMode()).toBe("bar");
		setDockMode("side");
		expect(initialDockMode()).toBe("side");
		// Full screen over the side panel: the side panel.
		setDockMode("full");
		expect(initialDockMode()).toBe("side");
		setDockMode("bar");
		expect(initialDockMode()).toBe("bar");
	});

	it("works without storage", async () => {
		const denied = (key: string) => {
			if (key.startsWith("coder-ui-chat")) {
				throw new DOMException("denied", "SecurityError");
			}
		};
		const { getItem, setItem, removeItem } = Storage.prototype;
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
			this: Storage,
			key,
		) {
			denied(key);
			return getItem.call(this, key);
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
			this: Storage,
			key,
			value,
		) {
			denied(key);
			setItem.call(this, key, value);
		});
		vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
			this: Storage,
			key,
		) {
			denied(key);
			removeItem.call(this, key);
		});
		expect(initialDockMode()).toBe("bar");

		const user = userEvent.setup();
		renderDock();
		await user.click(within(await raise(user)).getByTestId("chat-mode-attach"));
		const side = screen.getByTestId("chat-side-panel");
		await user.click(within(side).getByRole("button", { name: /ann/ }));
		await within(side).findByRole("log", { name: "Messages with ann" });
	});
});

describe("Dock selection actions", () => {
	afterEach(() => {
		act(() => {
			setDockMode("bar");
			closePanelView();
			closeWindow("ann");
		});
		vi.restoreAllMocks();
	});
	it("deletes only selected inbox entries after confirmation", async () => {
		vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [MockNotification],
			unread_count: 1,
		});
		const remove = vi
			.spyOn(PlatformAPI, "deleteInboxNotifications")
			.mockResolvedValue({ cleared: 1 });
		renderDock();
		const user = userEvent.setup();
		const raised = await raise(user);
		await user.click(
			within(raised).getByRole("tab", { name: /^Notifications/ }),
		);
		await user.click(
			await screen.findByRole("checkbox", {
				name: `Select ${MockNotification.title}`,
			}),
		);
		await user.click(screen.getByRole("button", { name: "Delete selected" }));
		expect(remove).not.toHaveBeenCalled();
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);
		await waitFor(() =>
			expect(remove).toHaveBeenCalledWith([MockNotification.id]),
		);
	});
	it("deletes selected messages through the participant-scoped API", async () => {
		const remove = vi
			.spyOn(PlatformAPI, "deleteChatMessages")
			.mockResolvedValue({ peer: "ann", ids: [1], conversation: null });
		renderDock();
		const user = userEvent.setup();
		await raise(user);
		await act(() => openChatWith({ id: "ann", username: "ann", name: "" }));
		await user.click(
			await screen.findByRole("checkbox", { name: "Select message 1" }),
		);
		const log = screen.getByRole("log", { name: "Messages with ann" });
		await user.click(
			within(log).getByRole("button", { name: "Delete selected" }),
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);
		await waitFor(() => expect(remove).toHaveBeenCalledWith("ann", [1]));
	});
});

it("clears the inbox through the Notifications tab context menu after confirmation", async () => {
	vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
		notifications: [MockNotification],
		unread_count: 1,
	});
	const clear = vi
		.spyOn(PlatformAPI, "clearInbox")
		.mockResolvedValue({ cleared: 1 });
	renderDock();
	const user = userEvent.setup();
	await act(() => setDockMode("window"));
	const tab = await screen.findByRole("tab", { name: /^Notifications/ });
	await user.pointer({ target: tab, keys: "[MouseRight]" });
	await user.click(screen.getByRole("menuitem", { name: "Clear all" }));
	expect(clear).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }),
	);
	await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
	await act(() => setDockMode("bar"));
	vi.restoreAllMocks();
});
