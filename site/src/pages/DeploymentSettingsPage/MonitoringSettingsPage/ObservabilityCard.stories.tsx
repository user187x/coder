import type { Meta, StoryObj } from "@storybook/react-vite";
import { deploymentConfigQueryKey } from "#/api/queries/deployment";
import { MockDeploymentConfig } from "#/testHelpers/entities";
import { MockObservabilityOptions } from "#/testHelpers/platform";
import { ObservabilityCard } from "./ObservabilityCard";

const meta: Meta<typeof ObservabilityCard> = {
	title:
		"pages/DeploymentSettingsPage/MonitoringSettingsPage/ObservabilityCard",
	component: ObservabilityCard,
	parameters: {
		queries: [
			{
				key: deploymentConfigQueryKey,
				data: { ...MockDeploymentConfig, options: MockObservabilityOptions },
			},
		],
	},
};
export default meta;
type Story = StoryObj<typeof ObservabilityCard>;
export const Default: Story = {};
export const Empty: Story = {
	parameters: {
		queries: [{ key: deploymentConfigQueryKey, data: MockDeploymentConfig }],
	},
};
export const LoadError: Story = {
	parameters: {
		queries: [
			{
				key: deploymentConfigQueryKey,
				data: undefined,
				isError: true,
			},
		],
	},
};
