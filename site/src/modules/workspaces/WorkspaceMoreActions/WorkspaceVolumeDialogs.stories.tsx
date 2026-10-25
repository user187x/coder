import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { workspaceVolumeKey } from "#/api/workspaceVolumes";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	MockVMVolumeOperation,
	MockVMWorkspaceVolume,
} from "#/testHelpers/workspaceVolumes";
import { BackupHomeDialog, ExpandDiskDialog } from "./WorkspaceVolumeDialogs";

const meta: Meta<typeof ExpandDiskDialog> = {
	title: "modules/workspaces/WorkspaceVolumeDialogs",
	component: ExpandDiskDialog,
	args: { workspace: MockWorkspace, open: true, onClose: fn() },
	parameters: {
		queries: [
			{
				key: workspaceVolumeKey(MockWorkspace.id),
				data: MockVMWorkspaceVolume,
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof ExpandDiskDialog>;
export const VMStopped: Story = {};
export const VMRunning: Story = {
	parameters: {
		queries: [
			{
				key: workspaceVolumeKey(MockWorkspace.id),
				data: { ...MockVMWorkspaceVolume, running: true },
			},
		],
	},
};
export const VMExpanding: Story = {
	parameters: {
		queries: [
			{
				key: workspaceVolumeKey(MockWorkspace.id),
				data: {
					...MockVMWorkspaceVolume,
					busy: true,
					disk: [MockVMVolumeOperation],
				},
			},
		],
	},
};
export const VMExpansionFailed: Story = {
	parameters: {
		queries: [
			{
				key: workspaceVolumeKey(MockWorkspace.id),
				data: {
					...MockVMWorkspaceVolume,
					disk: [
						{
							...MockVMVolumeOperation,
							status: "failed",
							error:
								"The VM must remain stopped until its disk has been verified.",
						},
					],
				},
			},
		],
	},
};
export const VMBackupStopped: Story = {
	render: (args) => <BackupHomeDialog {...args} />,
};
export const VMBackupRunning: Story = {
	render: (args) => <BackupHomeDialog {...args} />,
	parameters: {
		queries: [
			{
				key: workspaceVolumeKey(MockWorkspace.id),
				data: { ...MockVMWorkspaceVolume, running: true },
			},
		],
	},
};
