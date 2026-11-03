import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { PlatformAPI } from "#/api/platform";
import {
	MockChatPeer,
	MockChatPerson,
	MockChatSettings,
	MockChatState,
	MockOnlineChatUser,
} from "#/testHelpers/chat";
import { MockAccountCloudDrivePeers } from "#/testHelpers/cloudDriveShares";
import { ChatConsoleCard } from "./ChatConsoleCard";
import { ChatConsoleWorkspace } from "./ChatConsoleWorkspace";
import { useChatConnection } from "./chatStore";

const meta: Meta<typeof ChatConsoleWorkspace> = {
	title: "modules/platform/ChatConsoleWorkspace",
	component: ChatConsoleWorkspace,
	args: { place: "card", className: "h-[720px]" },
	decorators: [
		(Story) => {
			useChatConnection(true);
			return <Story />;
		},
	],
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatState").mockResolvedValue({
			...MockChatState,
			me: { ...MockChatState.me, admin: true },
		});
		spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
			enabled: true,
			people: [MockChatPerson],
		});
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
		spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue(
			MockAccountCloudDrivePeers,
		);
		spyOn(PlatformAPI, "getChatSettings").mockResolvedValue(MockChatSettings);
		spyOn(PlatformAPI, "getChatPairs").mockResolvedValue({
			pairs: [],
			total: 0,
		});
		spyOn(PlatformAPI, "getPresence").mockResolvedValue({
			online: [MockOnlineChatUser],
			recent: [],
			idleSeconds: 30,
			generatedAt: "2026-10-25T12:00:05Z",
		});
	},
};
export default meta;
type Story = StoryObj<typeof ChatConsoleWorkspace>;
export const Conversations: Story = {};
export const NoConversations: Story = {
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatState").mockResolvedValue({
			...MockChatState,
			me: { ...MockChatState.me, admin: true },
			conversations: [],
		});
	},
};
export const People: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("tab", { name: "People" }),
		);
	},
};
export const Connections: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("tab", { name: "Connections" }),
		);
	},
};
export const Settings: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("tab", { name: "Settings" }),
		);
	},
};
export const SettingsUnavailable: Story = {
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatSettings").mockRejectedValue(
			new Error("Settings could not be loaded."),
		);
	},
	play: Settings.play,
};
export const Compact: Story = {
	args: { className: "h-[650px] max-w-[500px]" },
	play: Settings.play,
};

export const ViewportConsole: Story = {
	render: () => <ChatConsoleCard />,
};
