import type { Meta, StoryObj } from "@storybook/react-vite";
import { FeatureUnavailable } from "./FeatureUnavailable";

const meta: Meta<typeof FeatureUnavailable> = {
	title: "components/FeatureUnavailable",
	component: FeatureUnavailable,
	args: { feature: "Audit logs" },
};

export default meta;
type Story = StoryObj<typeof FeatureUnavailable>;

export const Default: Story = {};
