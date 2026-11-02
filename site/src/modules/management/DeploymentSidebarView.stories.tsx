import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { userEvent, within } from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { clusterMeshKey } from "#/api/clusterNetwork";
import { HEALTH_QUERY_KEY } from "#/api/queries/debug";
import { networkReportKey } from "#/api/queries/platform";
import {
	MockClusterNetworkReport,
	MockHealthyClusterNetworkReport,
	MockHealthyMeshReport,
	MockMeshReport,
} from "#/testHelpers/clusterNetwork";
import {
	MockBuildInfo,
	MockHealth,
	MockNoPermissions,
	MockPermissions,
} from "#/testHelpers/entities";
import { withDashboardProvider } from "#/testHelpers/storybook";
import { DeploymentSidebarView } from "./DeploymentSidebarView";
import { HealthNavItem } from "./HealthNavItem";
import { NetworkStatusIndicator } from "./NetworkStatusIndicator";

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
		health: <HealthNavItem />,
	},
	parameters: {
		reactRouter: reactRouterParameters({
			location: { path: "/health/derp" },
			routing: { path: "/health/derp" },
		}),
		queries: [{ key: HEALTH_QUERY_KEY, data: MockHealth }],
	},
};

export const NetworkHealthy: Story = {
	args: { health: <HealthNavItem />, network: <NetworkStatusIndicator /> },
	parameters: {
		reactRouter: reactRouterParameters({
			location: { path: "/deployment/network" },
			routing: { path: "/deployment/network" },
		}),
		queries: [
			{ key: HEALTH_QUERY_KEY, data: MockHealth },
			{ key: networkReportKey, data: MockHealthyClusterNetworkReport },
			{ key: clusterMeshKey, data: MockHealthyMeshReport },
		],
	},
};

export const NetworkIssues: Story = {
	...NetworkHealthy,
	parameters: {
		...NetworkHealthy.parameters,
		queries: [
			{ key: HEALTH_QUERY_KEY, data: MockHealth },
			{ key: networkReportKey, data: MockClusterNetworkReport },
			{ key: clusterMeshKey, data: MockMeshReport },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			await within(canvasElement).findByRole("img", {
				name: /Network needs attention/,
			}),
		);
	},
};

export const NetworkWarning: Story = {
	...NetworkHealthy,
	parameters: {
		...NetworkHealthy.parameters,
		queries: [
			{ key: HEALTH_QUERY_KEY, data: MockHealth },
			{
				key: networkReportKey,
				data: {
					...MockHealthyClusterNetworkReport,
					unplaced: MockHealthyClusterNetworkReport.workspaces,
				},
			},
			{ key: clusterMeshKey, data: MockHealthyMeshReport },
		],
	},
};

export const NetworkLoading: Story = {
	...NetworkHealthy,
	parameters: {
		...NetworkHealthy.parameters,
		queries: [{ key: HEALTH_QUERY_KEY, data: MockHealth }],
		msw: {
			handlers: [
				http.get("*/api/network", async () => {
					await delay("infinite");
				}),
				http.get("*/api/network/mesh", async () => {
					await delay("infinite");
				}),
			],
		},
	},
};

export const NetworkUnavailable: Story = {
	...NetworkHealthy,
	parameters: {
		...NetworkHealthy.parameters,
		queries: [{ key: HEALTH_QUERY_KEY, data: MockHealth }],
		msw: {
			handlers: [
				http.get("*/api/network", () =>
					HttpResponse.json(
						{ message: "Network report unavailable" },
						{ status: 503 },
					),
				),
				http.get("*/api/network/mesh", () =>
					HttpResponse.json(
						{ message: "Network report unavailable" },
						{ status: 503 },
					),
				),
			],
		},
	},
	play: async ({ canvasElement }) => {
		await userEvent.hover(
			await within(canvasElement).findByRole("img", {
				name: "Network status unavailable",
			}),
		);
	},
};
