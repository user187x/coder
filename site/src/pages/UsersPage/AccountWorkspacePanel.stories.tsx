import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { workspacePowerHistory } from "#/api/queries/workspacePower";
import { workspaceQuarantineKey } from "#/api/queries/workspaceQuarantine";
import { MockUserMember, MockWorkspace } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
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

export const UpdateAvailable: Story = {
	...Management,
	args: { canManage: true, workspaces: [{ ...MockWorkspace, outdated: true }] },
};
export const LongNames: Story = {
	...Management,
	args: {
		canManage: true,
		workspaces: [
			{
				...MockWorkspace,
				name: "a-workspace-with-a-long-name",
				template_display_name: "A template with a long display name",
			},
		],
	},
};

export const Quarantined: Story = {
	parameters: {
		queries: [
			{
				key: workspaceQuarantineKey(
					MockWorkspace.organization_id,
					MockWorkspace.id,
				),
				data: MockWorkspaceQuarantine,
			},
		],
	},
};
