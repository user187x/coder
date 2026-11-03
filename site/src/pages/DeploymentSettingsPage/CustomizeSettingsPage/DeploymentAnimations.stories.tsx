import type { Meta, StoryObj } from "@storybook/react-vite";
import { animationPolicy } from "#/api/queries/platform";
import { DEFAULT_ANIMATION_POLICY } from "#/hooks/useAnimationSettings";
import { DeploymentAnimations } from "./DeploymentAnimations";

const meta: Meta<typeof DeploymentAnimations> = {
	title: "pages/DeploymentSettings/Appearance/DeploymentAnimations",
	component: DeploymentAnimations,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const SomeDisabled: Story = {
	parameters: {
		queries: [
			{
				key: animationPolicy().queryKey,
				data: { ...DEFAULT_ANIMATION_POLICY, effects: false, gifs: false },
			},
		],
	},
};
export const Paused: Story = {
	parameters: {
		queries: [
			{
				key: animationPolicy().queryKey,
				data: { ...DEFAULT_ANIMATION_POLICY, all: false },
			},
		],
	},
};
