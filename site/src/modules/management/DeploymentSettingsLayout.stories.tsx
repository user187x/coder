import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
	reactRouterOutlet,
	reactRouterParameters,
} from "storybook-addon-remix-react-router";
import { keycloakReportKey, userUIPreferences } from "#/api/queries/platform";
import { Navbar } from "#/modules/dashboard/Navbar/Navbar";
import { KeycloakSection } from "#/pages/DeploymentSettingsPage/KeycloakSettingsPage/KeycloakSettingsPage";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import { pixelWithDesktop } from "#/testHelpers/pixel";
import { MockKeycloakReport } from "#/testHelpers/platform";
import {
	withAuthProvider,
	withDashboardProvider,
	withProxyProvider,
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
		await userEvent.dblClick(
			await within(canvasElement).findByRole("button", {
				name: "Accounts",
			}),
		);
	},
};

export const AuthenticationWithDockedSettings: Story = {
	decorators: [withProxyProvider()],
	render: () => (
		<>
			<Navbar />
			<main id="main-content">
				<DeploymentSettingsLayout />
			</main>
		</>
	),
	parameters: {
		pixel: { matrix: pixelWithDesktop },
		reactRouter: reactRouterParameters({
			location: { path: "/deployment/userauth" },
			routing: reactRouterOutlet(
				{ path: "/deployment/userauth" },
				<KeycloakSection />,
			),
		}),
		queries: [
			{
				key: userUIPreferences().queryKey,
				data: {
					settings_sidebar: true,
					navbar_layout: {
						order: ["workspaces", "latency"],
						hidden: ["logo", "banner", "notifications", "account"],
					},
				},
			},
			{
				key: keycloakReportKey,
				data: {
					...MockKeycloakReport,
					facts: { ...MockKeycloakReport.facts, keycloakConnected: false },
				},
			},
		],
	},
};
