import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { FillDialog } from "./FillDialog";

const meta: Meta<typeof FillDialog> = {
	title: "modules/platform/FillDialog",
	component: FillDialog,
	args: { open: true, onOpenChange: fn(), onPick: fn() },
};
export default meta;
type Story = StoryObj<typeof FillDialog>;
export const Solid: Story = {};
export const Gradient: Story = {
	play: async () => {
		const body = within(document.body);
		await userEvent.click(body.getByRole("combobox", { name: "Fill style" }));
		await userEvent.click(
			body.getByRole("option", { name: "Radial gradient" }),
		);
	},
};
