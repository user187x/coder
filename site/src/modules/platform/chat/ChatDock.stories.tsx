import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { PlatformAPI } from "#/api/platform";
import { MockChatPeer, MockChatState } from "#/testHelpers/chat";
import { ChatDock } from "./ChatDock";
import {
	closeConsoleOverlay,
	closePanelView,
	setDockMode,
	setDockTab,
} from "./chatStore";

const meta: Meta<typeof ChatDock> = {
	title: "modules/platform/ChatDock",
	component: ChatDock,
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatState").mockResolvedValue(MockChatState);
		spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
		spyOn(PlatformAPI, "getChatAdmins").mockResolvedValue({
			admins: [MockChatPeer],
		});
		spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
			messages: [MockChatState.conversations[0].last],
			readUpTo: 1,
		});
		spyOn(PlatformAPI, "chatActivity").mockResolvedValue({ ok: true });
		spyOn(PlatformAPI, "markChatRead").mockResolvedValue({ ok: true });
		closeConsoleOverlay();
		closePanelView();
		setDockTab("people");
		setDockMode("window");
	},
};
export default meta;
type Story = StoryObj<typeof ChatDock>;
export const People: Story = {};
export const Conversation: Story = {
	play: async () => {
		await userEvent.click(
			await within(document.body).findByRole("button", { name: /Alex/ }),
		);
	},
};
