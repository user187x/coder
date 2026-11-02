import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { quickMenuKey } from "#/api/queries/quickMenu";
import { MockQuickMenu } from "#/testHelpers/appearance";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import QuickMenuSettingsPage from "./QuickMenuSettingsPage";

const meta: Meta<typeof QuickMenuSettingsPage> = {
	title: "pages/DeploymentSettingsPage/QuickMenuSettingsPage",
	component: QuickMenuSettingsPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		queries: [{ key: quickMenuKey, data: MockQuickMenu }],
	},
};
export default meta;
type Story = StoryObj<typeof QuickMenuSettingsPage>;
export const Default: Story = {};
export const Disabled: Story = {
	parameters: {
		queries: [
			{ key: quickMenuKey, data: { ...MockQuickMenu, enabled: false } },
		],
	},
};
export const AddWedge: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Add a wedge" }),
		);
	},
};
