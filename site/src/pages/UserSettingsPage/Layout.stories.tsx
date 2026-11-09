import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
	reactRouterOutlet,
	reactRouterParameters,
} from "storybook-addon-remix-react-router";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import {
	withAuthProvider,
	withDashboardProvider,
} from "#/testHelpers/storybook";
import Layout from "./Layout";

const meta: Meta<typeof Layout> = {
	component: Layout,
	title: "pages/UserSettingsPage/Layout",
	decorators: [withAuthProvider, withDashboardProvider],
	parameters: {
		layout: "fullscreen",
		user: MockUserOwner,
		permissions: MockPermissions,
		reactRouter: reactRouterParameters({
			location: { path: "/settings/account" },
			routing: reactRouterOutlet(
				{ path: "/settings/:section" },
				<h1>Account</h1>,
			),
		}),
	},
};
export default meta;
type Story = StoryObj<typeof Layout>;

export const SectionsExpanded: Story = {};

export const SectionsCollapsed: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.dblClick(
			await within(canvasElement).findByRole("button", { name: "Account" }),
		);
	},
};
