import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { GlobalWorkspaceActionsView } from "./GlobalWorkspaceActions";

const meta: Meta<typeof GlobalWorkspaceActionsView> = {
	title: "modules/platform/GlobalWorkspaceActions",
	component: GlobalWorkspaceActionsView,
	args: { workspaces: [MockWorkspace], onRun: fn() },
};
export default meta;
type Story = StoryObj<typeof GlobalWorkspaceActionsView>;
export const Ready: Story = {};
export const ConfirmShutDown: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Shut Down" }),
		);
	},
};
export const ConfirmTerminate: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Terminate" }),
		);
	},
};
export const Running: Story = {
	args: {
		busy: true,
		operations: [
			{
				...MockWorkspacePowerOperation,
				status: "running",
				completed: 0,
				workspaces: MockWorkspacePowerOperation.workspaces.map((w) => ({
					...w,
					status: "stopping",
				})),
			},
		],
	},
};
export const PartialFailure: Story = {
	args: {
		operations: [
			{
				...MockWorkspacePowerOperation,
				action: "terminate",
				status: "partial",
				workspaces: MockWorkspacePowerOperation.workspaces.map((w) => ({
					...w,
					status: "unsupported",
					error:
						"Force termination is unavailable for this workspace provider.",
				})),
			},
		],
	},
};
export const Completed: Story = {
	args: { operations: [MockWorkspacePowerOperation] },
};
export const Loading: Story = { args: { loading: true, workspaces: [] } };
export const NoWorkspaces: Story = { args: { workspaces: [] } };
export const ReadError: Story = {
	args: {
		error: new Error("Could not read workspace targets"),
		onRefresh: fn(),
	},
};
