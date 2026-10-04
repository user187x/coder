import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MockLogo } from "#/testHelpers/platform";
import { LogoView } from "./CustomizeSettingsPage";

const meta: Meta<typeof LogoView> = {
	title: "pages/DeploymentSettingsPage/CustomizeSettingsPage/LogoView",
	component: LogoView,
	args: { logo: MockLogo, onUpload: fn(), onReset: fn() },
};

export default meta;
type Story = StoryObj<typeof LogoView>;

export const CoderLogo: Story = {};

export const CustomLogo: Story = {
	args: {
		logo: {
			...MockLogo,
			set: true,
			url: "/icon/code.svg",
			type: "image/svg+xml",
			bytes: 2048,
			updatedBy: "admin",
			updatedAt: "2026-09-30T10:00:00Z",
		},
	},
};

export const NotAvailable: Story = {
	args: { logo: { ...MockLogo, available: false } },
};
