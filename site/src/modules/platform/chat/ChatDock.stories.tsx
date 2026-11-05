import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import { MockChatPeer, MockChatState } from "#/testHelpers/chat";
import { MockNotification } from "#/testHelpers/entities";
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
		spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
			async (settings) => settings,
		);
		spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [MockNotification],
			unread_count: 1,
		});
		spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
			enabled: true,
			people: [],
		});
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
			await within(document.body).findByRole("button", {
				name: /^Alex Can you help/,
			}),
		);
	},
};

export const Notifications: Story = {
	play: async () => {
		setDockTab("notifications");
	},
};
export const SelectedNotification: Story = {
	play: async () => {
		setDockTab("notifications");
		await userEvent.click(
			await within(document.body).findByRole("checkbox", {
				name: `Select ${MockNotification.title}`,
			}),
		);
	},
};

export const ConversationHeaderMenu: Story = {
	play: async () => {
		setDockMode("side");
		await userEvent.click(
			await within(document.body).findByRole("button", {
				name: /^Alex Can you help/,
			}),
		);
		await userEvent.pointer({
			target: await within(document.body).findByRole("group", {
				name: "Conversation with Alex",
			}),
			keys: "[MouseRight]",
		});
	},
};

export const ExpandedWorkspace: Story = {
	decorators: [
		(Story) => (
			<div className="workspace-dashboard-page" data-workspace-expanded>
				<div
					className="workspace-dashboard-scroll"
					style={{ position: "fixed", inset: "48px 0 16px" }}
				/>
				<span
					data-testid="workspace-uptime"
					className="fixed bottom-4 right-4 rounded-full border border-border bg-surface-primary px-3 py-2 text-xs"
				>
					Uptime 1h 20m
				</span>
				<Story />
			</div>
		),
	],
};

export const ExpandedWorkspaceCompact: Story = {
	...ExpandedWorkspace,
	play: () => {
		setDockMode("compact");
	},
};

export const ExpandedWorkspaceBar: Story = {
	...ExpandedWorkspace,
	play: () => {
		setDockMode("bar");
	},
};

export const TopEdge: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { chat_position: { edge: "top", offset: 0.5 } },
			},
		],
	},
	play: async () => {
		setDockMode("bar");
	},
};
export const LeftEdge: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { chat_position: { edge: "left", offset: 0.5 } },
			},
		],
	},
	play: async () => {
		setDockMode("bar");
	},
};

export const SmallWindow: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					chat_size: { width: 320, height: 240 },
					chat_position: { edge: "left", offset: 1 },
				},
			},
		],
	},
};
export const WideWindow: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { chat_size: { width: 700, height: 350 } },
			},
		],
	},
};

export const PinnedWindow: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { chat_keep_open: true, chat_size: { width: 360, height: 280 } },
			},
		],
	},
};
export const PositionMenu: Story = {
	play: async () => {
		await userEvent.pointer({
			target: await within(document.body).findByRole("button", {
				name: "Chats",
			}),
			keys: "[MouseRight]",
		});
	},
};

export const UnreadConversation: Story = {
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
			messages: [
				MockChatState.conversations[0].last,
				{
					...MockChatState.conversations[0].last,
					id: 2,
					text: "There is a new update for you.",
				},
			],
			readUpTo: 1,
		});
	},
	play: Conversation.play,
};
export const SelectedMessages: Story = {
	beforeEach: UnreadConversation.beforeEach,
	play: async (context) => {
		await Conversation.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("button", {
				name: "Select all loaded",
			}),
		);
	},
};

export const UnreadHistory: Story = {
	beforeEach: () => {
		spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
			messages: Array.from({ length: 30 }, (_, index) => ({
				...MockChatState.conversations[0].last,
				id: index + 1,
				text: `Workspace update ${index + 1}. The build and application health checks have completed.`,
			})),
			readUpTo: 20,
		});
	},
	play: Conversation.play,
};
