import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn, userEvent, within } from "storybook/test";
import { API } from "#/api/api";
import { MockDeploymentSSH, MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceSSHDetails } from "./WorkspaceSSHDetails";

const meta: Meta<typeof WorkspaceSSHDetails> = {
	title: "modules/workspaces/WorkspaceSSHDetails",
	component: WorkspaceSSHDetails,
	args: { workspace: MockWorkspace },
	render: (args) => (
		<div className="flex items-center gap-3">
			<WorkspaceSSHDetails {...args}>
				{(events) => (
					<button
						type="button"
						{...events}
						aria-label="Workspace avatar"
						className="inline-flex rounded-full bg-surface-secondary p-3"
					>
						Avatar
					</button>
				)}
			</WorkspaceSSHDetails>
			<a href="#workspace">{args.workspace.name}</a>
		</div>
	),
	beforeEach: () => {
		spyOn(API, "getWorkspace").mockResolvedValue(MockWorkspace);
		spyOn(API, "getDeploymentSSHConfig").mockResolvedValue(MockDeploymentSSH);
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			within(canvasElement).getByRole("button", { name: "Workspace avatar" }),
		);
	},
};
export default meta;
type Story = StoryObj<typeof WorkspaceSSHDetails>;
export const Connected: Story = {};
export const Stopped: Story = {
	beforeEach: () => {
		spyOn(API, "getWorkspace").mockResolvedValue({
			...MockWorkspace,
			latest_build: {
				...MockWorkspace.latest_build,
				status: "stopped",
				resources: [],
			},
		});
	},
};
export const Unavailable: Story = {
	beforeEach: () => {
		spyOn(API, "getWorkspace").mockRejectedValue(
			new Error("Unable to check workspace agents"),
		);
	},
};
