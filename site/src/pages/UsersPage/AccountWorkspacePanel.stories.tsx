import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { workspacePowerHistory } from "#/api/queries/workspacePower";
import { MockUserMember, MockWorkspace } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { AccountWorkspacePanelView } from "./AccountWorkspacePanel";

const meta: Meta<typeof AccountWorkspacePanelView> = {
	title: "pages/UsersPage/AccountWorkspacePanel",
	component: AccountWorkspacePanelView,
	args: {
		user: MockUserMember,
		canManage: false,
		selected: new Map(),
		onSelect: fn(),
		workspaces: [MockWorkspace],
	},
	decorators: [withAuthProvider],
};
export default meta;
type Story = StoryObj<typeof AccountWorkspacePanelView>;
export const Workspaces: Story = {};
export const Management: Story = {
	args: { canManage: true },
	parameters: {
		queries: [
			{
				key: workspacePowerHistory(MockWorkspace.organization_id).queryKey,
				data: { operations: [] },
			},
		],
	},
};
export const Loading: Story = { args: { workspaces: [], loading: true } };
export const Empty: Story = { args: { workspaces: [] } };
export const ReadError: Story = {
	args: {
		workspaces: [],
		error: new Error("Workspace list could not be loaded"),
		onRetry: fn(),
	},
};
export const RefetchError: Story = {
	args: {
		error: new Error("Workspace refresh failed; showing the previous results"),
		onRetry: fn(),
	},
};
