import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { adminNotesKey } from "#/api/queries/adminNotes";
import { organizations } from "#/api/queries/organizations";
import { MockAdminNote } from "#/testHelpers/adminNotes";
import { MockOrganization } from "#/testHelpers/entities";
import { AdminNotesPanel } from "./AdminNotesPanel";

const meta: Meta<typeof AdminNotesPanel> = {
	title: "modules/dashboard/AdminNotesPanel",
	component: AdminNotesPanel,
	args: { enabled: true, onClose: fn() },
	decorators: [
		(Story) => (
			<div className="w-[360px] rounded-xl border border-solid border-border bg-surface-primary">
				<Story />
			</div>
		),
	],
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{
				key: adminNotesKey(MockOrganization.id),
				data: {
					notes: [
						MockAdminNote,
						{
							...MockAdminNote,
							id: "shared",
							author_name: "another-admin",
							text: "Shared handover: the cluster is ready for new workspaces.",
							shared: true,
							can_edit: false,
						},
					],
				},
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof AdminNotesPanel>;
export const Rows: Story = {};
export const Editing: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", { name: "Edit note" }),
		);
	},
};
export const Empty: Story = {
	parameters: {
		queries: [
			{ key: organizations().queryKey, data: [MockOrganization] },
			{ key: adminNotesKey(MockOrganization.id), data: { notes: [] } },
		],
	},
};

export const Shared: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("combobox", { name: "Visibility" }),
		);
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole("option", {
				name: "Admins",
			}),
		);
	},
};
export const TallerEditor: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Edit note" }),
		);
		canvas.getByRole("button", { name: "Resize notes panel" }).focus();
		await userEvent.keyboard("{ArrowDown>8/}");
	},
};
