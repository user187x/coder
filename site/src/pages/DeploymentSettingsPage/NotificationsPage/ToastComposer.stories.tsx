import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { usersKey } from "#/api/queries/users";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { ToastComposer } from "./ToastComposer";

const meta: Meta<typeof ToastComposer> = {
	title: "pages/DeploymentSettingsPage/NotificationsPage/ToastComposer",
	component: ToastComposer,
	args: { canEdit: true },
};
export default meta;
type Story = StoryObj<typeof ToastComposer>;

export const Empty: Story = {
	parameters: {
		queries: [
			{
				key: usersKey({ q: "status:active", limit: 25 }),
				data: { users: [MockUserOwner, MockUserMember], count: 2 },
			},
		],
	},
};
export const Draft: Story = {
	...Empty,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "Notification title" }),
			"Scheduled maintenance",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "Notification message" }),
			"Please **save your work** before 22:00 UTC.",
		);
		await userEvent.click(
			await canvas.findByRole("checkbox", {
				name: `Select user ${MockUserMember.username}`,
			}),
		);
		await userEvent.click(canvas.getByText("Preview notification"));
	},
};
export const NoUsers: Story = {
	parameters: {
		queries: [
			{
				key: usersKey({ q: "status:active", limit: 25 }),
				data: { users: [], count: 0 },
			},
		],
	},
};
export const ReadOnly: Story = { ...Empty, args: { canEdit: false } };
