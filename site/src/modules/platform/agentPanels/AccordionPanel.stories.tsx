import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { AccordionPanel } from "./AccordionPanel";

const meta: Meta<typeof AccordionPanel> = {
	title: "modules/AccordionPanel",
	component: AccordionPanel,
	args: {
		id: "browser-panel-story",
		title: "Web Browser",
		kind: "app",
		slug: "neko-browser",
		initiallyOpen: true,
		height: 240,
		href: "about:blank",
		onHeightChange: fn(),
		onRemove: fn(),
		onCloseSession: fn().mockResolvedValue(undefined),
		children: <div className="h-full bg-surface-secondary" />,
	},
};
export default meta;
type Story = StoryObj<typeof AccordionPanel>;

export const Browser: Story = {};
export const KeepSession: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("switch", { name: "Keep session" }),
		);
	},
};
export const CloseError: Story = {
	args: { onCloseSession: fn().mockRejectedValue(new Error("Unavailable")) },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Web Browser" }),
		);
	},
};
