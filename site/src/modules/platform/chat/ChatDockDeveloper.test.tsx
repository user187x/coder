import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { type ChatState, PlatformAPI } from "#/api/platform";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { ChatDock } from "./ChatDock";

const ADMIN = { id: "adm", username: "adm", name: "Ada" };
const chatState: ChatState = {
	me: { id: "dev", username: "dev", name: "", admin: false, chatOn: true },
	conversations: [],
	cursor: 0,
	typing: [],
	clearVersion: 0,
	available: [ADMIN.id],
	off: [],
	availVersion: 1,
};

// A developer's dock, on the real chat store (booted once for the file).
const renderDock = () => {
	vi.spyOn(PlatformAPI, "getChatState").mockResolvedValue(chatState);
	vi.spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
	vi.spyOn(PlatformAPI, "getChatAdmins").mockResolvedValue({
		admins: [ADMIN],
	});
	vi.spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
		messages: [],
		readUpTo: 0,
	});
	renderWithRouter(
		createMemoryRouter([{ path: "/", element: <ChatDock /> }], {
			initialEntries: ["/"],
		}),
	);
};

describe("ChatDock: a developer's", () => {
	afterEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("raised window has no console control, and lists the admins to write to", async () => {
		const user = userEvent.setup();
		renderDock();
		await user.click(
			await screen.findByRole("button", { name: "Chat with an admin" }),
		);
		const raised = screen.getByTestId("chat-window-raised");
		expect(
			within(raised).queryByRole("button", {
				name: "Open in the chat console",
			}),
		).toBeNull();
		within(raised).getByRole("button", { name: "Attach to the right side" });

		await user.click(
			await within(raised).findByRole("button", { name: /Ada/ }),
		);
		await screen.findByRole("dialog", { name: "Chat with Ada" });

		await user.click(within(raised).getByTestId("chat-mode-attach"));
		const side = screen.getByTestId("chat-side-panel");
		within(side).getByRole("log", { name: "Messages with Ada" });
		expect(within(side).queryByTestId("chat-open-console")).toBeNull();
	});
});
