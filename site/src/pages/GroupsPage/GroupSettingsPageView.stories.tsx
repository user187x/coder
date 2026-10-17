import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { MockGroup } from "#/testHelpers/entities";
import GroupSettingsPageView from "./GroupSettingsPageView";

const meta: Meta<typeof GroupSettingsPageView> = {
	title: "pages/OrganizationGroupsPage/GroupSettingsPageView",
	component: GroupSettingsPageView,
	args: {
		onSubmit: fn(),
		group: MockGroup,
		formErrors: undefined,
		isUpdating: false,
	},
};

export default meta;
type Story = StoryObj<typeof GroupSettingsPageView>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("textbox", { name: /^Name/ })).toBeVisible();
		await expect(canvas.getByText("*")).toBeVisible();
		await expect(canvas.getByText("Unique identifier.")).toBeVisible();
		await expect(
			canvas.getByText("Friendly name. Defaults to the name if blank."),
		).toBeVisible();
	},
};
