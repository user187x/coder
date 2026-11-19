import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { userEvent, within } from "storybook/test";
import {
	reactRouterOutlet,
	reactRouterParameters,
} from "storybook-addon-remix-react-router";
import { userUIPreferences } from "#/api/queries/platform";
import { NavbarStartTarget } from "#/modules/dashboard/Navbar/NavbarAction";
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
		await userEvent.click(
			await within(canvasElement).findByRole("button", { name: "Account" }),
		);
	},
};

export const NavbarSectionsMenu: Story = {
	parameters: {
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: { admin_nav_in_navbar: true, navbar_settings_side: "right" },
			},
		],
	},
	render: function Render() {
		const [start, setStart] = useState<HTMLDivElement | null>(null);
		return (
			<NavbarStartTarget.Provider value={start}>
				<div className="navbar-start" ref={setStart} />
				<Layout />
			</NavbarStartTarget.Provider>
		);
	},
	play: async ({ canvasElement }) => {
		const trigger = await within(canvasElement).findByRole("button", {
			name: "User Settings",
		});
		trigger.focus();
		await userEvent.keyboard("{ArrowDown}");
	},
};
