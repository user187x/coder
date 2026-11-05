import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
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
export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByText("Observability Configurations"),
		);
	},
};
export const Empty: Story = {
	play: Expanded.play,
	parameters: {
		queries: [{ key: deploymentConfigQueryKey, data: MockDeploymentConfig }],
	},
};
export const LoadError: Story = {
	play: Expanded.play,
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
