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
import DeploymentSettingsLayout from "./DeploymentSettingsLayout";

const meta: Meta<typeof DeploymentSettingsLayout> = {
	component: DeploymentSettingsLayout,
	title: "modules/management/DeploymentSettingsLayout",
	decorators: [withAuthProvider, withDashboardProvider],
	parameters: {
		layout: "fullscreen",
		user: MockUserOwner,
		permissions: MockPermissions,
		reactRouter: reactRouterParameters({
			location: { path: "/deployment/users" },
			routing: reactRouterOutlet(
				{ path: "/deployment/users" },
				<h1>Accounts</h1>,
			),
		}),
	},
};
export default meta;
type Story = StoryObj<typeof DeploymentSettingsLayout>;
export const CategoriesExpanded: Story = {};
export const CategoriesCollapsed: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", {
				name: "Hide categories",
			}),
		);
	},
};
