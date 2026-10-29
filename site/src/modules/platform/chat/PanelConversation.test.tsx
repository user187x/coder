import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useImperativeHandle } from "react";
import { MockChatPeer } from "#/testHelpers/chat";
import { render } from "#/testHelpers/renderHelpers";
import type { ConversationActions } from "./ChatConversation";
import type { ChatWindowState } from "./chatStore";
import { PanelConversation } from "./PanelConversation";

const askDelete = vi.hoisted(() => vi.fn());
vi.mock("./ChatConversation", () => ({
	ChatConversation: ({ ref }: { ref: React.Ref<ConversationActions> }) => {
		useImperativeHandle(ref, () => ({
			askDelete,
			focus: vi.fn(),
			screenshot: vi.fn(),
			selectAll: vi.fn(),
			clearAll: vi.fn(),
			clearSelection: vi.fn(),
		}));
		return null;
	},
}));
vi.mock("./ChatWindow", () => ({
	ConversationMenu: () => null,
	CountBadge: () => null,
}));

it("opens deletion confirmation from the conversation header without deleting immediately", async () => {
	const view: ChatWindowState = {
		peer: MockChatPeer,
		minimized: false,
		loading: false,
		loadError: null,
		messages: [],
		pending: [],
		lastIn: 0,
		readSent: 0,
		clearedByPeer: false,
		focusRequest: 0,
		loadingOlder: false,
		olderDone: true,
	};
	render(
		<PanelConversation view={view} dock={{ current: null }} onBack={vi.fn()} />,
	);
	await userEvent.pointer({
		target: screen.getByRole("group", { name: "Conversation with Alex" }),
		keys: "[MouseRight]",
	});
	expect(askDelete).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("menuitem", { name: "Delete conversation" }),
	);
	expect(askDelete).toHaveBeenCalledOnce();
});
