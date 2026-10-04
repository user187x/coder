import type { Meta, StoryObj } from "@storybook/react-vite";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { HEALTH_QUERY_KEY } from "#/api/queries/debug";
import {
	MockBuildInfo,
	MockHealth,
	MockNoPermissions,
	MockPermissions,
} from "#/testHelpers/entities";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { DeploymentSidebarView } from "./DeploymentSidebarView";
import { HealthSettingsTree } from "./HealthSettingsTree";

const meta: Meta<typeof DeploymentSidebarView> = {
	title: "modules/management/DeploymentSidebarView",
	component: DeploymentSidebarView,
	decorators: [withDashboardProvider],
	args: {
		permissions: MockPermissions,
		buildInfo: MockBuildInfo,
	},
};

export default meta;
type Story = StoryObj<typeof DeploymentSidebarView>;

export const NoViewUsers: Story = {
	args: {
		permissions: {
			...MockPermissions,
			viewAllUsers: false,
		},
	},
};

export const NoAuditLog: Story = {
	args: {
		permissions: {
			...MockPermissions,
			viewAnyAuditLog: false,
		},
	},
};

export const NoDeploymentValues: Story = {
	args: {
		permissions: {
			...MockPermissions,
			viewDeploymentConfig: false,
			editDeploymentConfig: false,
		},
	},
};

export const NoPermissions: Story = {
	args: {
		permissions: MockNoPermissions,
	},
};

// Explicit so the story does not depend on the fixture default.
export const OAuth2ProviderEnabled: Story = {
	args: {
		buildInfo: { ...MockBuildInfo, oauth2_provider: true },
	},
};

// The OAuth2 item follows the deployment flag, not the build type, so a
// development build with the flag off still hides it.
export const OAuth2ProviderDisabled: Story = {
	args: {
		buildInfo: {
			...MockBuildInfo,
			version: "v2.99.99-devel+abcdef",
			oauth2_provider: false,
		},
	},
};

// On a health page the Health entry starts open, each section marked with its
// severity and the current one highlighted.
export const HealthOpen: Story = {
	args: {
		health: <HealthSettingsTree />,
	},
	parameters: {
		reactRouter: reactRouterParameters({
			location: { path: "/health/derp" },
			routing: { path: "/health/derp" },
		}),
		queries: [{ key: HEALTH_QUERY_KEY, data: MockHealth }],
	},
};
