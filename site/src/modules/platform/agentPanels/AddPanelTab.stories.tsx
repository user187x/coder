import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { AddPanelTab } from "./AddPanelTab";

const meta: Meta<typeof AddPanelTab> = {
	title: "modules/AddPanelTab",
	component: AddPanelTab,
	args: { apps: [], terminal: true, disabled: false, onAdd: fn() },
	decorators: [
		(Story) => (
			<div className="relative m-10 w-96">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof AddPanelTab>;
export const Terminal: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Add a panel" }),
		);
	},
};
export const Unavailable: Story = { args: { disabled: true } };
export const NoTerminal: Story = { ...Terminal, args: { terminal: false } };
