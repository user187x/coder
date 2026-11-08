import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockBuildInfo } from "#/testHelpers/entities";
import { IntegrationPageView } from "./IntegrationPage";

const meta: Meta<typeof IntegrationPageView> = {
	title: "pages/UserSettingsPage/IntegrationPage",
	component: IntegrationPageView,
	args: {
		build: {
			...MockBuildInfo,
			version: "v1.8.36+abc1234",
			build_time: "2026-11-08T17:03:45Z",
		},
	},
};

export default meta;
type Story = StoryObj<typeof IntegrationPageView>;

export const Default: Story = {};
export const NoReleaseDate: Story = {
	args: { build: { ...MockBuildInfo, build_time: undefined } },
};
