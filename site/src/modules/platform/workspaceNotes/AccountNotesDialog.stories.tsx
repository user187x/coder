import type { Meta, StoryObj } from "@storybook/react-vite";
import { workspaceNotesKey } from "#/api/queries/workspaceNotes";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceNote } from "#/testHelpers/workspaceNotes";
import { AccountWorkspaceNotes } from "./AccountNotesDialog";

const meta: Meta<typeof AccountWorkspaceNotes> = {
	title: "modules/platform/AccountWorkspaceNotes",
	component: AccountWorkspaceNotes,
	args: { workspaceId: MockWorkspace.id },
	parameters: {
		queries: [
			{
				key: workspaceNotesKey(MockWorkspace.id),
				data: { canEdit: true, notes: [MockWorkspaceNote] },
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof AccountWorkspaceNotes>;
export const Manage: Story = {};
export const Create: Story = { args: { create: true } };
export const Empty: Story = {
	parameters: {
		queries: [
			{
				key: workspaceNotesKey(MockWorkspace.id),
				data: { canEdit: true, notes: [] },
			},
		],
	},
};
