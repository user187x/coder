import type { Meta, StoryObj } from "@storybook/react-vite";
import { BadgeGroup } from "./Badge";
import {
	AlphaBadge,
	DeprecatedBadge,
	DisabledBadge,
	EnabledBadge,
} from "./PresetBadges";

const meta: Meta<typeof BadgeGroup> = {
	title: "components/Badge/PresetBadges",
	component: BadgeGroup,
};

export default meta;
type Story = StoryObj<typeof BadgeGroup>;

export const Enabled: Story = {
	args: {
		children: <EnabledBadge />,
	},
};

export const Disabled: Story = {
	args: {
		children: <DisabledBadge />,
	},
};

export const Alpha: Story = {
	args: {
		children: <AlphaBadge />,
	},
};

export const Deprecated: Story = {
	args: {
		children: <DeprecatedBadge />,
	},
};
