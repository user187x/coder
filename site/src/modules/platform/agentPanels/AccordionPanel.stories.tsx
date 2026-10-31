import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { AccordionPanel } from "./AccordionPanel";
import { AgentPanels } from "./AgentPanels";

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

export const PanelViewMenu: Story = {
	render: (args) => (
		<AgentPanels
			order={["logs", "desktop"]}
			onReorder={fn()}
			panels={["logs", "desktop"].map((id) => ({
				id,
				label: id,
				render: (handle) => (
					<AccordionPanel
						{...args}
						id={id}
						title={id === "desktop" ? "Desktop" : "Logs"}
						slug={id}
						handle={handle}
						onCloseSession={undefined}
					/>
				),
			}))}
		/>
	),
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			target: within(canvasElement).getByRole("button", {
				name: "Desktop",
			}),
			keys: "[MouseRight]",
		});
	},
};
export const FocusedDesktop: Story = {
	...PanelViewMenu,
	play: async (context) => {
		await PanelViewMenu.play?.(context);
		await userEvent.click(
			within(document.body).getByRole("menuitem", {
				name: "Hide other panels",
			}),
		);
	},
};
