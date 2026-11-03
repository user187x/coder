import type { Meta, StoryObj } from "@storybook/react-vite";
import { deploymentConfigQueryKey } from "#/api/queries/deployment";
import { monitoringKey } from "#/api/queries/platform";
import {
	MockDeploymentConfig,
	MockPermissions,
	MockUserOwner,
} from "#/testHelpers/entities";
import {
	MockMonitoringOverview,
	MockObservabilityOptions,
} from "#/testHelpers/platform";
import { withAuthProvider } from "#/testHelpers/storybook";
import MonitoringSettingsPage from "./MonitoringSettingsPage";

const meta: Meta<typeof MonitoringSettingsPage> = {
	title: "pages/DeploymentSettingsPage/MonitoringSettingsPage",
	component: MonitoringSettingsPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		queries: [
			{ key: monitoringKey, data: MockMonitoringOverview },
			{
				key: deploymentConfigQueryKey,
				data: { ...MockDeploymentConfig, options: MockObservabilityOptions },
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof MonitoringSettingsPage>;

export const Default: Story = {};

export const NobodyRunning: Story = {
	parameters: {
		queries: [
			{
				key: deploymentConfigQueryKey,
				data: { ...MockDeploymentConfig, options: MockObservabilityOptions },
			},
			{
				key: monitoringKey,
				data: {
					...MockMonitoringOverview,
					users: MockMonitoringOverview.users.map((u) => ({
						...u,
						instances: [],
					})),
				},
			},
		],
	},
};
