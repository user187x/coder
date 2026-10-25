import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceQuarantineCardView } from "./WorkspaceQuarantine";

const meta: Meta<typeof WorkspaceQuarantineCardView> = {
	title: "modules/platform/WorkspaceQuarantineCard",
	component: WorkspaceQuarantineCardView,
	args: {
		workspaces: [MockWorkspace],
		selected: "",
		onSelect: fn(),
		onRetry: fn(),
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceQuarantineCardView>;
export const Ready: Story = {};
export const Empty: Story = { args: { workspaces: [] } };
export const Loading: Story = {
	args: { workspaces: undefined, loading: true },
};
export const ReadError: Story = {
	args: {
		workspaces: undefined,
		error: new Error("Workspace list unavailable"),
	},
};
export const RefetchError: Story = {
	args: {
		error: new Error("Refresh failed; the previous workspace list is retained"),
	},
};
