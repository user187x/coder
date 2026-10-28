import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { setAnimationsEnabled } from "../animations/animations";
import { LavaDialog } from "./LavaDialog";

const meta: Meta<typeof LavaDialog> = {
	title: "modules/platform/LavaDialog",
	component: LavaDialog,
	args: { open: true, onOpenChange: fn(), onCreate: fn() },
	// A still preview, so the screenshot is the same every time.
	beforeEach: () => {
		setAnimationsEnabled(false);
		return () => setAnimationsEnabled(true);
	},
};
export default meta;
type Story = StoryObj<typeof LavaDialog>;

export const Avatar: Story = { args: { round: true } };
export const Picture: Story = {};
