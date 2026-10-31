import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { deploymentConfigQueryKey } from "#/api/queries/deployment";
import {
	MockDeploymentConfig,
	MockWorkspace,
	MockWorkspaceAgent,
} from "#/testHelpers/entities";
import { withProxyProvider, withWebSocket } from "#/testHelpers/storybook";
import { AgentTerminalSection } from "./AgentTerminalSection";
import { saveSessions } from "./terminalSession";

const meta: Meta<typeof AgentTerminalSection> = {
	title: "modules/platform/AgentTerminalSection",
	component: AgentTerminalSection,
	args: {
		agent: MockWorkspaceAgent,
		workspace: MockWorkspace,
		ready: true,
		initiallyOpen: true,
		panelId: "terminal-tiles-story",
	},
	decorators: [withProxyProvider(), withWebSocket],
	parameters: {
		queries: [{ key: deploymentConfigQueryKey, data: MockDeploymentConfig }],
		webSocket: [
			{ event: "open" },
			{
				event: "message",
				data: "\u001b[32mworkspace ~ $\u001b[0m ",
			},
		],
	},
	beforeEach: () => {
		saveSessions(`${MockWorkspaceAgent.id}:terminal-tiles-story`, []);
	},
};
export default meta;
type Story = StoryObj<typeof AgentTerminalSection>;
export const Single: Story = {};
export const VerticalTiles: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Add terminal below" }),
		);
	},
};
export const ThreeTiles: Story = {
	play: async ({ canvasElement }) => {
		const add = within(canvasElement).getByRole("button", {
			name: "Add terminal below",
		});
		await userEvent.click(add);
		await userEvent.click(add);
	},
};
export const MixedSplits: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: await within(
				canvas.getByRole("group", { name: "Terminal 1" }),
			).findByRole("textbox", { name: "Terminal input" }),
		});
		await userEvent.click(
			within(document.body).getByRole("menuitem", { name: "Split vertically" }),
		);
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: await within(
				await canvas.findByRole("group", { name: "Terminal 2" }),
			).findByRole("textbox", { name: "Terminal input" }),
		});
		await userEvent.click(
			within(document.body).getByRole("menuitem", {
				name: "Split horizontally",
			}),
		);
	},
};
export const WaitingForAgent: Story = { args: { ready: false } };
