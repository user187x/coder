import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WorkspacePowerHistoryFeedback } from "./AccountWorkspaceActions";

const meta: Meta<typeof WorkspacePowerHistoryFeedback> = {
	title: "pages/UsersPage/WorkspacePowerHistoryFeedback",
	component: WorkspacePowerHistoryFeedback,
};
export default meta;
type Story = StoryObj<typeof WorkspacePowerHistoryFeedback>;
export const Loading: Story = { args: { loading: true } };
export const ReadError: Story = {
	args: {
		error: new Error("Workspace power history is unavailable"),
		onRetry: fn(),
	},
};
export const Retrying: Story = { args: { ...ReadError.args, retrying: true } };
