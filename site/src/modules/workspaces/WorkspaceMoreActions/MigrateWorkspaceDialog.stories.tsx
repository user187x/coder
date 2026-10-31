import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { workspaceMigrationKey } from "#/api/queries/workspaceMigrations";
import { WorkspaceMigrationsAPI } from "#/api/workspaceMigrations";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceMigrationPlan } from "#/testHelpers/workspaceMigrations";
import { MigrateWorkspaceDialog } from "./MigrateWorkspaceDialog";

const meta: Meta<typeof MigrateWorkspaceDialog> = {
	title: "modules/workspaces/MigrateWorkspaceDialog",
	component: MigrateWorkspaceDialog,
	args: { workspace: MockWorkspace, open: true, onClose: fn() },
	parameters: {
		queries: [
			{
				key: workspaceMigrationKey(MockWorkspace.id),
				data: MockWorkspaceMigrationPlan,
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof MigrateWorkspaceDialog>;
export const Destinations: Story = {};
export const Selected: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole("button", {
				name: "Migrate to worker-02",
			}),
		);
	},
};
export const Unavailable: Story = {
	parameters: {
		queries: [
			{
				key: workspaceMigrationKey(MockWorkspace.id),
				data: {
					...MockWorkspaceMigrationPlan,
					nodes: MockWorkspaceMigrationPlan.nodes.map((node) => ({
						...node,
						eligible: false,
						reasons: ["Disk measurements unavailable"],
					})),
				},
			},
		],
	},
};
export const Copying: Story = {
	parameters: {
		queries: [
			{
				key: workspaceMigrationKey(MockWorkspace.id),
				data: {
					...MockWorkspaceMigrationPlan,
					operation: {
						id: "migration",
						status: "running",
						phase: "copy",
						sourceNode: "worker-01",
						target: "worker-02",
						message:
							"Copying and verifying home files, ownership, permissions and extended attributes.",
						error: null,
						retainedVolume: null,
					},
				},
			},
		],
	},
};
export const Interrupted: Story = {
	parameters: {
		queries: [
			{
				key: workspaceMigrationKey(MockWorkspace.id),
				data: {
					...MockWorkspaceMigrationPlan,
					operation: {
						id: "migration",
						status: "interrupted",
						phase: "cutover",
						sourceNode: "worker-01",
						target: "worker-02",
						message: null,
						error: null,
						retainedVolume: "pvc-source-recovery-volume",
					},
				},
			},
		],
	},
};
export const Loading: Story = {
	parameters: { queries: [] },
	beforeEach: () => {
		spyOn(WorkspaceMigrationsAPI, "plan").mockReturnValue(
			new Promise(() => {}),
		);
	},
};
export const ErrorState: Story = {
	parameters: { queries: [] },
	beforeEach: () => {
		spyOn(WorkspaceMigrationsAPI, "plan").mockRejectedValue(
			new Error("Migration is unavailable for this workspace's storage type."),
		);
	},
};
export const Mobile: Story = {
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
