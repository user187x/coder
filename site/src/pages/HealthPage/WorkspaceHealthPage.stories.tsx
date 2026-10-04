import type { Meta, StoryObj } from "@storybook/react-vite";
import { workspacesKey } from "#/api/queries/workspaces";
import { MockFailedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import WorkspaceHealthPage from "./WorkspaceHealthPage";

const allWorkspaces = workspacesKey({ q: "", limit: 1000 });

const meta: Meta<typeof WorkspaceHealthPage> = {
	title: "pages/HealthPage/WorkspaceHealthPage",
	component: WorkspaceHealthPage,
};

export default meta;
type Story = StoryObj<typeof WorkspaceHealthPage>;

export const AllHealthy: Story = {
	parameters: {
		queries: [
			{ key: allWorkspaces, data: { workspaces: [MockWorkspace], count: 1 } },
		],
	},
};

export const NeedsAttention: Story = {
	parameters: {
		queries: [
			{
				key: allWorkspaces,
				data: { workspaces: [MockWorkspace, MockFailedWorkspace], count: 2 },
			},
		],
	},
};
