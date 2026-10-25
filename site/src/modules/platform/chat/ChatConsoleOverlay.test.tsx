import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet } from "react-router";
import { type ChatMessage, type ChatState, PlatformAPI } from "#/api/platform";
import { RadialMenu } from "#/modules/platform/radialMenu/RadialMenu";
import { MockPermissions } from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { ChatConsoleCard } from "./ChatConsoleCard";
import { ChatDock } from "./ChatDock";
import { closeConsoleOverlay, closeWindow, setDockMode } from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";

const auth = { permissions: MockPermissions };
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => auth,
}));

const ME = "me";
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
	conversations: ["ann", "bob"].map((id, i) => ({
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

// An admin's dashboard on the real chat store (booted once for the file): a page, the dock, the quick access wheel.
const renderDashboard = (at = "/") => {
	vi.spyOn(PlatformAPI, "getChatState").mockResolvedValue(chatState);
	vi.spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
	vi.spyOn(PlatformAPI, "chatActivity").mockResolvedValue({ ok: true });
	vi.spyOn(PlatformAPI, "markChatRead").mockResolvedValue({ ok: true });
	vi.spyOn(PlatformAPI, "getChatMessages").mockImplementation(async (peer) => ({
		messages: [message(1, peer, ME)],
		readUpTo: 1,
	}));
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockReturnValue(
		new Promise(() => {}),
	);
	vi.spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
		enabled: true,
		people: [],
	});
	vi.spyOn(PlatformAPI, "getQuickMenu").mockResolvedValue({
		items: null,
		wedges: [3, 12],
	});
	const router = createMemoryRouter(
		[
			{
				element: (
					<>
						<Outlet />
						<ChatDock />
						<RadialMenu />
					</>
				),
				children: [
					{ path: "/", element: <p>Workspaces</p> },
					{ path: CHAT_CONSOLE_PAGE, element: <ChatConsoleCard /> },
				],
			},
		],
		{ initialEntries: [at] },
	);
	renderWithRouter(router);
	return router;
};

/** The bar's console button (under the overlay, out of the accessibility tree: by its test ID). */
const consoleButton = () => screen.findByTestId("chat-open-console");

/** Opened: the dialog, once its outside-click listener is on (Radix adds it a tick after it opens). */
const openOverlay = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(await consoleButton());
	const dialog = await screen.findByRole("dialog", { name: "Chat console" });
	await act(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
	return dialog;
};

const closed = () =>
	waitFor(() =>
		expect(screen.queryByTestId("chat-console-overlay")).toBeNull(),
	);

describe("ChatConsoleOverlay: the chat bar's console button", () => {
	beforeEach(() => {
		document.documentElement.dataset.animations = "off";
	});
	afterEach(() => {
		act(() => {
			closeConsoleOverlay();
			setDockMode("bar");
			for (const id of ["ann", "bob"]) {
				closeWindow(id);
			}
		});
		delete document.documentElement.dataset.animations;
		localStorage.clear();
		sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("opens the console over the page, centred, instead of going to its page", async () => {
		const user = userEvent.setup();
		const router = renderDashboard();
		vi.mocked(PlatformAPI.getChatMessages).mockImplementation(async (peer) => ({
			messages: [message(1, peer, ME)],
			readUpTo: 0,
		}));
		const dialog = await openOverlay(user);
		await user.click(
			await within(dialog).findByRole("textbox", { name: "Message bob" }),
		);
		await waitFor(() =>
			expect(PlatformAPI.markChatRead).toHaveBeenCalledWith("bob", 1),
		);

		expect(router.state.location.pathname).toBe("/");
		expect(dialog).toHaveAttribute("aria-modal", "true");
		expect(dialog).toHaveAttribute("data-testid", "chat-console-overlay-panel");
		expect(screen.getByTestId("chat-console-overlay")).toContainElement(dialog);
		expect(within(dialog).getByTestId("chat-console")).toHaveAttribute(
			"data-place",
			"overlay",
		);
		// On the newest conversation, its message box focused; the page still there, under it.
		await within(dialog).findByRole("log", { name: "Messages with bob" });
		await waitFor(() =>
			expect(
				within(dialog).getByRole("textbox", { name: "Message bob" }),
			).toHaveFocus(),
		);
		screen.getByText("Workspaces");
	});

	it("keeps the focus in it: Tab goes round the panel", async () => {
		const user = userEvent.setup();
		renderDashboard();
		const dialog = await openOverlay(user);

		const first = within(dialog).getByRole("checkbox", {
			name: "Next after reply",
		});
		first.focus();
		await user.tab({ shift: true });
		expect(dialog).toContainElement(document.activeElement as HTMLElement);
		expect(first).not.toHaveFocus();
		await user.tab();
		expect(first).toHaveFocus();
	});

	it("preserves the dock draft while using the console overlay", async () => {
		const user = userEvent.setup();
		const send = vi
			.spyOn(PlatformAPI, "sendChatMessage")
			.mockResolvedValue({ message: message(9, ME, "bob") });
		vi.spyOn(PlatformAPI, "sendChatTyping").mockResolvedValue({ ok: true });
		renderDashboard();
		await user.click(await screen.findByRole("button", { name: "Chats" }));
		await user.click(
			within(screen.getByTestId("chat-window-raised")).getByRole("button", {
				name: /bob/,
			}),
		);
		await user.type(
			await screen.findByRole("textbox", { name: "Message bob" }),
			"draft survives console",
		);
		await openOverlay(user);
		await user.keyboard("{Escape}");
		await closed();
		await user.click(screen.getByRole("button", { name: "Chats" }));
		await user.click(
			within(screen.getByTestId("chat-window-raised")).getByRole("button", {
				name: "Send",
			}),
		);
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({ to: "bob", text: "draft survives console" }),
			),
		);
	});

	it("closes on a click outside the panel, the focus back on the button", async () => {
		const user = userEvent.setup();
		renderDashboard();
		const dialog = await openOverlay(user);

		// Inside the panel: it stays.
		await user.click(within(dialog).getByRole("tab", { name: /All/ }));
		screen.getByRole("dialog", { name: "Chat console" });

		await user.click(screen.getByTestId("chat-console-overlay"));
		await closed();
		await waitFor(async () => expect(await consoleButton()).toHaveFocus());
	});

	it("closes on Escape, which does not open the quick access wheel too", async () => {
		const user = userEvent.setup();
		renderDashboard();
		await openOverlay(user);

		await user.keyboard("{Escape}");
		await closed();
		await act(() => new Promise((resolve) => window.setTimeout(resolve, 20)));
		expect(screen.queryByTestId("radial-menu")).toBeNull();

		// The next Escape is the wheel's again.
		await user.keyboard("{Escape}");
		expect(await screen.findByTestId("radial-menu")).toBeInTheDocument();
	});

	it("closes with Close in its header", async () => {
		const user = userEvent.setup();
		renderDashboard();
		const dialog = await openOverlay(user);

		await user.click(within(dialog).getByTestId("chat-console-overlay-close"));
		await closed();
		await waitFor(async () => expect(await consoleButton()).toHaveFocus());
	});

	it("goes to the console's page with the link in its header", async () => {
		const user = userEvent.setup();
		const router = renderDashboard();
		const dialog = await openOverlay(user);

		const link = within(dialog).getByTestId("chat-console-overlay-page");
		expect(link).toHaveAttribute("href", CHAT_CONSOLE_PAGE);
		await user.click(link);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(CHAT_CONSOLE_PAGE),
		);
		await closed();
		// The console there, on the same conversation.
		const card = await screen.findByTestId("chat-console-card");
		await within(card).findByRole("log", { name: "Messages with bob" });
	});

	it("on the console's page, focuses the console there instead", async () => {
		const user = userEvent.setup();
		renderDashboard(CHAT_CONSOLE_PAGE);
		const card = await screen.findByTestId("chat-console-card");
		await within(card).findByRole("log", { name: "Messages with bob" });

		await user.click(await consoleButton());
		await waitFor(() =>
			expect(
				within(card).getByRole("textbox", { name: "Message bob" }),
			).toHaveFocus(),
		);
		expect(screen.queryByTestId("chat-console-overlay")).toBeNull();
	});
});
