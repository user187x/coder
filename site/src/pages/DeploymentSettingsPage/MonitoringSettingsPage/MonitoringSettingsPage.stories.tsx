import type { Meta, StoryObj } from "@storybook/react-vite";
import { monitoringKey } from "#/api/queries/platform";
import { MockMonitoringOverview } from "#/testHelpers/platform";
import MonitoringSettingsPage from "./MonitoringSettingsPage";

const meta: Meta<typeof MonitoringSettingsPage> = {
	title: "pages/DeploymentSettingsPage/MonitoringSettingsPage",
	component: MonitoringSettingsPage,
	parameters: {
		queries: [{ key: monitoringKey, data: MockMonitoringOverview }],
	},
};

export default meta;
type Story = StoryObj<typeof MonitoringSettingsPage>;

export const Default: Story = {};

export const NobodyRunning: Story = {
	parameters: {
		queries: [
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
