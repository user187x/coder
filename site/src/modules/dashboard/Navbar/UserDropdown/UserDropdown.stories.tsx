import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { MockBuildInfo, MockUserOwner } from "#/testHelpers/entities";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { UserDropdown } from "./UserDropdown";

const meta: Meta<typeof UserDropdown> = {
	title: "modules/dashboard/UserDropdown",
	component: UserDropdown,
	args: {
		user: MockUserOwner,
		buildInfo: MockBuildInfo,
		supportLinks: [
			{ icon: "docs", name: "Documentation", target: "" },
			{ icon: "bug", name: "Report a bug", target: "" },
			{ icon: "chat", name: "Join the Coder Discord", target: "" },
			{ icon: "star", name: "Star the Repo", target: "" },
			{ icon: "/icon/aws.svg", name: "Amazon Web Services", target: "" },
		],
	},
	decorators: [withDashboardProvider],
};

export default meta;
type Story = StoryObj<typeof UserDropdown>;

const openDropdown = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button"));
	return within(
		await within(canvasElement.ownerDocument.body).findByRole("menu"),
	);
};

const Example: Story = {};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		await openDropdown(canvasElement);
	},
};

export { Example as UserDropdown };

export const ThemeColors: Story = {
	play: async ({ canvasElement }) => {
		const menu = await openDropdown(canvasElement);
		// Theme colors is inside the menu's Appearance group.
		await userEvent.click(menu.getByRole("menuitem", { name: "Appearance" }));
		await userEvent.click(menu.getByRole("menuitem", { name: "Theme colors" }));
	},
};
