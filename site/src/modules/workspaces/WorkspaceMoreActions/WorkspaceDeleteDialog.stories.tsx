import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import {
	MockFailedWorkspace,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { daysAgo } from "#/utils/time";
import { WorkspaceDeleteDialog } from "./WorkspaceDeleteDialog";

const meta: Meta<typeof WorkspaceDeleteDialog> = {
	title: "modules/workspaces/WorkspaceDeleteDialog",
	component: WorkspaceDeleteDialog,
	decorators: [withAuthProvider],
	parameters: { user: MockUserOwner },
	args: {
		workspace: {
			...MockWorkspace,
			latest_build: {
				...MockWorkspace.latest_build,
				created_at: daysAgo(2),
			},
		},
		canDeleteFailedWorkspace: false,
		isOpen: true,
		onCancel: fn(),
		onConfirm: fn(),
	},
};

export default meta;
type Story = StoryObj<typeof WorkspaceDeleteDialog>;

export const Example: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const confirm = body.getByTestId("delete-dialog-name-confirmation");

		await userEvent.type(confirm, MockWorkspace.name);
	},
};

// Should look the same as `Example`
export const Unhealthy: Story = {
	args: {
		workspace: MockFailedWorkspace,
	},
};

// Should look the same as `Example`
export const AdminView: Story = {
	args: {
		canDeleteFailedWorkspace: true,
	},
};

// Should show the `--orphan` option
export const UnhealthyAdminView: Story = {
	args: {
		workspace: MockFailedWorkspace,
		canDeleteFailedWorkspace: true,
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const orphan = body.getByTestId("orphan-checkbox");
		const confirm = body.getByTestId("delete-dialog-name-confirmation");

		await userEvent.click(orphan);
		await userEvent.type(confirm, MockFailedWorkspace.name);
	},
};

export const FilledWrong: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const confirm = body.getByTestId("delete-dialog-name-confirmation");

		await userEvent.type(confirm, "wrong-name");
		// Blur so the mismatch error becomes visible.
		await userEvent.tab();
	},
};

// Shows the error while the input still has focus after pressing Enter.
export const FilledWrongSubmitted: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.type(
			body.getByTestId("delete-dialog-name-confirmation"),
			"wrong name{Enter}",
		);
	},
};
