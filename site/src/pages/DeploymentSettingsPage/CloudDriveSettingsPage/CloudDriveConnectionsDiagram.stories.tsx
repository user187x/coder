import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockCloudDriveConnectionsOverview } from "#/testHelpers/cloudDriveConnections";
import { mockApiError } from "#/testHelpers/entities";
import { CloudDriveConnectionsView } from "./CloudDriveConnectionsDiagram";

const meta: Meta<typeof CloudDriveConnectionsView> = {
	title: "pages/DeploymentSettingsPage/CloudDriveConnectionsView",
	component: CloudDriveConnectionsView,
	args: {
		overview: MockCloudDriveConnectionsOverview,
		isLoading: false,
	},
};

export default meta;
type Story = StoryObj<typeof CloudDriveConnectionsView>;

export const Default: Story = {};

export const ManyWorkspaces: Story = {
	args: {
		overview: {
			drives: [
				{
					owner: { id: "u-ann", username: "ann" },
					encrypted: false,
					source: null,
					workspaces: Array.from({ length: 9 }, (_, i) => ({
						id: `ws-${i}`,
						name: `workspace-${i + 1}`,
						state: i % 4 === 3 ? "disconnected" : "connected",
					})),
				},
				...MockCloudDriveConnectionsOverview.drives,
			],
		},
	},
};

export const Empty: Story = {
	args: { overview: { drives: [] } },
};

export const Loading: Story = {
	args: { overview: undefined, isLoading: true },
};

export const ErrorState: Story = {
	args: {
		overview: undefined,
		error: mockApiError({
			message: "Only admins see every account's Cloud Drive connections.",
		}),
	},
};
