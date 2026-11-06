import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { MockHudNode } from "#/testHelpers/hud";
import { HudNodeStrip } from "./HudNodeStrip";

const meta: Meta<typeof HudNodeStrip> = {
	title: "pages/HUD/NodeStrip",
	component: HudNodeStrip,
	args: {
		nodes: [
			{
				...MockHudNode,
				name: "k3d-coder-ha-lab-server-0",
				roles: ["control-plane"],
			},
			MockHudNode,
			{
				...MockHudNode,
				name: "k3d-coder-ha-lab-agent-1",
				health: "warning",
				pressure: ["DiskPressure"],
			},
			{ ...MockHudNode, name: "k3d-coder-ha-lab-agent-2", health: "down" },
			{
				...MockHudNode,
				name: "k3d-coder-ha-lab-agent-3",
				unschedulable: true,
				health: "warning",
			},
		],
	},
	decorators: [
		(Story) => (
			<div className="w-[900px] overflow-hidden rounded-lg border border-solid border-border bg-surface-secondary/40">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof HudNodeStrip>;

export const MixedHealth: Story = {};
export const LargeCluster: Story = {
	args: {
		nodes: Array.from({ length: 120 }, (_, i) => ({
			...MockHudNode,
			name: `node-${String(i).padStart(3, "0")}`,
			health: i % 17 === 0 ? "down" : i % 7 === 0 ? "warning" : "ok",
		})),
	},
};
export const NodeDetails: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "k3d-coder-ha-lab-agent-1: Degraded",
			}),
		);
	},
};
