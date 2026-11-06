import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { IntroductionCard } from "./IntroductionCard";

const meta: Meta<typeof IntroductionCard> = {
	title:
		"pages/DeploymentSettingsPage/AnnouncementSettingsPage/IntroductionCard",
	component: IntroductionCard,
	args: { checked: false, onCheckedChange: fn() },
};

export default meta;
type Story = StoryObj<typeof IntroductionCard>;

export const Off: Story = {};

export const On: Story = { args: { checked: true } };
