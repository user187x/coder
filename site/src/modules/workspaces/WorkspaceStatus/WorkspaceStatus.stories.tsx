import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceStatuses } from "#/api/typesGenerated";
import { MockDormantWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceStatus } from "./WorkspaceStatus";

const meta: Meta<typeof WorkspaceStatus> = {
	title: "modules/workspaces/WorkspaceStatus",
	component: WorkspaceStatus,
	args: {
		workspace: MockWorkspace,
	},
};

export default meta;
type Story = StoryObj<typeof WorkspaceStatus>;

export const Running: Story = {};

export const Dormant: Story = {
	args: {
		workspace: MockDormantWorkspace,
	},
};

export const StatusPills: Story = {
	render: () => (
		<div className="flex flex-wrap gap-6 p-4">
			{WorkspaceStatuses.map((status) => (
				<WorkspaceStatus
					key={status}
					pill
					workspace={{
						...MockWorkspace,
						latest_build: { ...MockWorkspace.latest_build, status },
					}}
				/>
			))}
		</div>
	),
};
export const AgentUpdateAvailable: Story = {
	args: { pill: true, agentUpdateAvailable: true },
};

export const RunningUpToDate: Story = {
	args: {
		pill: true,
		agentUpdateAvailable: false,
		workspace: {
			...MockWorkspace,
			outdated: false,
			health: { healthy: true, failing_agents: [] },
		},
	},
};
