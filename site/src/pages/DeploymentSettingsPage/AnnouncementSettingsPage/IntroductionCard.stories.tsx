import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { IntroductionCard } from "./IntroductionCard";

const meta: Meta<typeof IntroductionCard> = {
	title:
		"pages/DeploymentSettingsPage/AnnouncementSettingsPage/IntroductionCard",
	component: IntroductionCard,
	args: { settings: { introductions: false }, onChange: fn() },
};

export default meta;
type Story = StoryObj<typeof IntroductionCard>;

export const Off: Story = {};

export const On: Story = { args: { settings: { introductions: true } } };

export const PewPewBlackExtraLarge: Story = {
	args: {
		settings: {
			introductions: true,
			introEffect: "pewpew",
			introDurationMs: 6500,
			introSize: "xlarge",
			introWeight: "black",
		},
	},
};

export const Disabled: Story = {
	args: { settings: { introductions: true }, disabled: true },
};
