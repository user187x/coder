import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { MockNetworkOptions } from "#/testHelpers/clusterNetwork";
import { NetworkSettingsPageView } from "./NetworkSettingsPageView";

const meta: Meta<typeof NetworkSettingsPageView> = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPageView",
	component: NetworkSettingsPageView,
	args: {
		options: MockNetworkOptions,
	},
};

export default meta;
type Story = StoryObj<typeof NetworkSettingsPageView>;

export const Page: Story = {};

export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: /^Coder Configurations/,
			}),
		);
	},
};

export const KeyboardExpanded: Story = {
	play: async ({ canvasElement }) => {
		within(canvasElement)
			.getByRole("button", { name: /^Coder Configurations/ })
			.focus();
		await userEvent.keyboard("{Enter}");
	},
};

export const InvalidExperiments: Story = {
	args: { invalidExperiments: ["unknown-experiment"] },
};

export const Empty: Story = {
	args: { options: [] },
	play: Expanded.play,
};
