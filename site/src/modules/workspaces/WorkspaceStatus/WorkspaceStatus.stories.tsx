import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { WorkspaceStatuses } from "#/api/typesGenerated";
import {
	MockDormantWorkspace,
	MockWorkspace,
	MockWorkspaceAgent,
} from "#/testHelpers/entities";
import { getWorkspaceRestartReasons } from "#/utils/workspace";
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

const workspaceNeedingUpdates = {
	...MockWorkspace,
	outdated: true,
	latest_build: {
		...MockWorkspace.latest_build,
		resources: [
			{
				...MockWorkspace.latest_build.resources[0],
				agents: [
					{
						...MockWorkspaceAgent,
						name: "browser",
						version: "v1.9.0",
						api_version: "1.0",
					},
				],
			},
		],
	},
};
export const RestartReasons: Story = {
	args: {
		workspace: workspaceNeedingUpdates,
		pill: true,
		agentUpdateAvailable: true,
		restartReasons: getWorkspaceRestartReasons(
			workspaceNeedingUpdates,
			"v2.0.0",
			"2.12",
		),
		onUpdate: fn(),
	},
	decorators: [
		(Story) => (
			<div className="p-32">
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", { name: /Running. Restart/ }),
		);
	},
};
export const RestartUnavailable: Story = {
	...RestartReasons,
	args: { ...RestartReasons.args, updateDisabled: true },
};
